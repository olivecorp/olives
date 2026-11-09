import { format, parseISO } from "date-fns";
import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey, withV1Cors } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-helpers";
import { parseEvent } from "@/lib/api-events";
import { insertApiEvent, touchApiKey } from "@/lib/db";
import { notifyExternalAdd } from "@/lib/push";

/**
 * External write-only API: add an EXTERNAL-tagged calendar event to the key
 * owner's account — the hand-to-other-people surface. Events land with
 * source "external" and render amber with an "EXTERNAL: " title prefix on
 * the calendar. (POST /api/v1/events is the internal twin that adds events
 * as usual.)
 *
 *   POST /api/v1/external/events
 *   Authorization: Bearer ac_…
 *   { "title": "Dinner", "date": "2026-11-12", "start": "14:00",
 *     "end": "15:00", "location": "123 Main St", "externalId": "id-1" }
 *
 * Same fields and validation as /api/v1/events (start/end "HH:MM", all-day
 * when start is omitted or allDay:true, single-day, end after start).
 * externalId dedup applies per source, so ids only collide with other
 * external adds. Every NEW add fires a push notification to the owner's
 * devices (a dedup hit adds nothing, so it stays silent). The row syncs to
 * the owner's devices on their next pull.
 *
 * External keys only — an internal-scoped key gets a 403 here (and vice
 * versa on /api/v1/events).
 */
export const runtime = "nodejs";

export function OPTIONS() {
  return withV1Cors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  try {
    const key = await requireApiKey(req, "external");
    if (key instanceof NextResponse) return withV1Cors(key);

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withV1Cors(
        NextResponse.json(
          { error: "Request body must be a JSON object." },
          { status: 400 },
        ),
      );
    }

    const parsed = parseEvent(body);
    if ("error" in parsed) {
      return withV1Cors(
        NextResponse.json({ error: parsed.error }, { status: 400 }),
      );
    }

    const [result] = await Promise.all([
      insertApiEvent(key.userId, { ...parsed.input, source: "external" }),
      // Best-effort bookkeeping in parallel — a failed touch never blocks
      // the write (and never fires after the response, which Vercel freezes).
      touchApiKey(key.keyId).catch(() => null),
    ]);
    // Push the owner's phone about the new event — but only when it's new: a
    // dedup hit added nothing, so it must not re-buzz. Awaited (Vercel
    // freezes the function at response time); notifyExternalAdd never throws
    // and logs its own failures, same as the todos twin.
    if (!result.existed) {
      const m = result.record.startMin;
      const time =
        m === null
          ? ""
          : ` ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      await notifyExternalAdd(key.userId, {
        isTodo: false,
        body: `${result.record.title} — ${format(parseISO(result.record.date), "d MMM")}${time} — via ${key.keyName}`,
        tag: `external-event-${result.record.id}`,
        url: "/calendar",
      });
    }
    // existed = the externalId dedup hit an already-imported row.
    return withV1Cors(
      NextResponse.json(
        { event: result.record },
        { status: result.existed ? 200 : 201 },
      ),
    );
  } catch (e) {
    return withV1Cors(jsonError(e));
  }
}
