import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { localDateISO, localHourMinute } from "@/lib/time";
import { sendToUser } from "@/lib/push";
import {
  claimPushLog,
  claimReminderLog,
  countPushSubscriptions,
  deletePushLogOlderThanDays,
  deleteReminderLogOlderThanDays,
  getActiveNotificationSettings,
  getReminderEvents,
  getReminderTodos,
  markPushLogSent,
  markReminderLogSent,
  releasePushLog,
  releaseReminderLog,
} from "@/lib/db";

// Node runtime (web-push + node:crypto); 60s gives multi-user sends room on
// the Hobby plan's default 10s budget.
export const runtime = "nodejs";
export const maxDuration = 60;

const SLOTS = [11, 17, 21] as const;
type Slot = (typeof SLOTS)[number];

const PAYLOADS: Record<Slot, { title: string; body: string }> = {
  11: { title: "Midday check-in", body: "Half the day gone — how's your list looking?" },
  17: { title: "Late-afternoon reminder", body: "A few hours left — check off what you can." },
  21: { title: "Last call", body: "Finish today's checks before midnight." },
};

const WINDOW_MIN = 60; // fire when local time is 0–59 min past the slot

// Item reminders (the scheduler ticks hourly — supabase/cron.sql):
// - day items (the todos summary + all-day events) fire any time in the
//   first DAY_WINDOW_MIN minutes after the morning time;
// - timed events fire within EVENT_WINDOW_MIN of their (start − offset)
//   minute, which can fall the day BEFORE the event for the 1-day offset.
//   Any 60-minute half-open window catches exactly one hourly tick, and
//   since the smallest offset is an hour, delivery always precedes the
//   start. A reminder missed for longer than its window is dropped, never
//   delivered long after the fact.
const DAY_WINDOW_MIN = 120;
const EVENT_WINDOW_MIN = 60;

/** Constant-time Bearer check against CRON_SECRET. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return false;
  const a = createHash("sha256").update(auth).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Minutes from midnight → "HH:MM" (24h, zero-padded). */
function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Next day's ISO date ("2026-11-04" → "2026-11-05") — noon UTC so a DST
 *  transition can never shift the calendar day. */
function nextDateISO(dateISO: string): string {
  const t = new Date(`${dateISO}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed — never run notifications unauthenticated.
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 404 },
    );
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Dev-only overrides: pretend it's exactly `slot` o'clock for every user so
  // the slots can be exercised without waiting for a real hour; `remindMin`
  // (0–1439) forces the reminder engine's local minute and `date` its query
  // date, so item reminders can be tested the same way.
  const devSlot = process.env.NODE_ENV !== "production"
    ? Number(req.nextUrl.searchParams.get("slot"))
    : NaN;
  const useDev = SLOTS.includes(devSlot as Slot);
  const devRemindMin = process.env.NODE_ENV !== "production"
    ? Number(req.nextUrl.searchParams.get("remindMin"))
    : NaN;
  const useDevRemind =
    Number.isInteger(devRemindMin) && devRemindMin >= 0 && devRemindMin <= 1439;
  const devDate =
    process.env.NODE_ENV !== "production"
      ? req.nextUrl.searchParams.get("date")
      : null;

  const now = new Date();
  let claimed = 0;
  let sent = 0;
  let skipped = 0;
  let remindersSent = 0;
  let errors = 0;

  try {
    const rows = await getActiveNotificationSettings();
    for (const s of rows) {
      const tz = s.timezone!;
      const { hour, minute } = useDev
        ? { hour: devSlot as number, minute: 0 }
        : localHourMinute(now, tz);
      const date = useDev ? "1970-01-01" : localDateISO(now, tz);
      const nowMin = hour * 60 + minute;

      // ---- engine 1: the fixed 11/17/21 check-ins --------------------------
      try {
        const slot = SLOTS.find((h) => {
          const on = h === 11 ? s.notify_11 : h === 17 ? s.notify_17 : s.notify_21;
          if (!on) return false;
          // "Just passed": within the last hour (handles ticks landing
          // anywhere in the window, incl. half-hour-offset timezones).
          const passed = nowMin - h * 60;
          return passed >= 0 && passed < WINDOW_MIN;
        });
        if (!slot) {
          skipped++;
        } else if ((await countPushSubscriptions(s.user_id)) === 0) {
          // No device to receive it — skip WITHOUT claiming, so the slot
          // still fires (within its window) once a device subscribes.
          skipped++;
        } else {
          // Claim (user, date, slot) — exactly-once across overlapping runs.
          const claimId = await claimPushLog(s.user_id, date, slot);
          if (claimId) {
            claimed++;
            try {
              sent += await sendToUser(s.user_id, PAYLOADS[slot]);
              await markPushLogSent(claimId);
            } catch {
              // Config error (e.g. VAPID missing) — release the claim so the
              // next run retries this slot instead of silently losing it.
              await releasePushLog(claimId).catch(() => {});
            }
          }
        }
      } catch {
        errors++; // per-user isolation — one bad row must not kill the run
      }

      // ---- engine 2: item reminders -----------------------------------------
      // Todos summary + per-event reminders, computed from the server-side
      // mirror of the local-first tables in the user's stored timezone.
      // Skipped under ?slot= — its fake 1970-01-01 date must not leak into
      // the event/todo queries.
      if (useDev || (!s.remind_todos && !s.remind_events)) continue;

      try {
        const rdate = useDevRemind
          ? (devDate ?? localDateISO(now, tz))
          : date;
        const rnowMin = useDevRemind ? devRemindMin : nowMin;
        const dayWindow =
          rnowMin >= s.remind_day_min &&
          rnowMin < s.remind_day_min + DAY_WINDOW_MIN;

        // The offset can reach a full day, so a timed event's reminder is
        // due up to a day before its own date: fetch today's AND tomorrow's.
        const events = s.remind_events
          ? await getReminderEvents(s.user_id, [rdate, nextDateISO(rdate)])
          : [];
        // Todos are only queried inside the window — an empty summary is NOT
        // claimed, so a todo added later that morning still fires it.
        const todoRes =
          s.remind_todos && dayWindow
            ? await getReminderTodos(s.user_id, rdate)
            : { count: 0, texts: [] };

        const timed = events.filter((e) => {
          if (e.all_day || e.start_min == null) return false;
          // The event's fire minute on TODAY'S clock: tomorrow's events sit
          // 1440 minutes ahead, so a 1-day offset lands at the same wall
          // time today, and smaller offsets on tomorrow's events fall out of
          // range (they fire tomorrow instead).
          const base = e.date === rdate ? 0 : 1440;
          const fire = base + e.start_min - s.remind_offset_min;
          return rnowMin >= fire && rnowMin < fire + EVENT_WINDOW_MIN;
        });
        // All-day events remind in the morning window on their own date.
        const allday = dayWindow
          ? events.filter(
              (e) =>
                e.date === rdate && (e.all_day || e.start_min == null),
            )
          : [];

        if (todoRes.count === 0 && timed.length === 0 && allday.length === 0) {
          skipped++;
          continue;
        }
        if ((await countPushSubscriptions(s.user_id)) === 0) {
          // Nothing to receive it yet — don't claim; a device subscribing
          // within the window still gets the reminder.
          skipped++;
          continue;
        }

        const sends: { key: string; tag: string; title: string; body: string }[] =
          [];
        if (todoRes.count > 0) {
          const shown = todoRes.texts.map((t) =>
            t.length > 40 ? t.slice(0, 39) + "…" : t,
          );
          const extra =
            todoRes.count > shown.length
              ? ` +${todoRes.count - shown.length} more`
              : "";
          sends.push({
            key: `todos@${rdate}`,
            tag: "olives-todos",
            title: "Today's todos",
            body: `${todoRes.count} due today — ${shown.join(", ")}${extra}`,
          });
        }
        for (const e of allday) {
          sends.push({
            key: `event:${e.id}@${e.date}`,
            tag: `event-${e.id}`,
            title: e.title || "Untitled event",
            body: e.location ? `All day today · ${e.location}` : "All day today",
          });
        }
        for (const e of timed) {
          // Dedupe keys carry the event's own date — with a 1-day offset the
          // send happens the day before, and the key must still be unique to
          // the occurrence.
          const when = e.date === rdate ? "Starts at" : "Tomorrow at";
          sends.push({
            key: `event:${e.id}@${e.date}`,
            tag: `event-${e.id}`,
            title: e.title || "Upcoming event",
            body: `${when} ${hhmm(e.start_min!)}${e.location ? ` · ${e.location}` : ""}`,
          });
        }

        for (const item of sends) {
          const claimId = await claimReminderLog(s.user_id, item.key, rdate);
          if (!claimId) continue;
          try {
            remindersSent += await sendToUser(
              s.user_id,
              { title: item.title, body: item.body },
              { tag: item.tag, url: "/calendar" },
            );
            await markReminderLogSent(claimId);
          } catch {
            // Release the claim so the next tick retries this reminder.
            await releaseReminderLog(claimId).catch(() => {});
          }
        }
      } catch {
        errors++;
      }
    }
    await deletePushLogOlderThanDays(60);
    await deleteReminderLogOlderThanDays(60);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "notify failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    claimed,
    sent,
    skipped,
    remindersSent,
    errors,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
