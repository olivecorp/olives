import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { isValidTimeZone } from "@/lib/time";
import {
  countPushSubscriptions,
  getUserSettings,
  updateUserSettings,
} from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const [settings, subscriptionCount] = await Promise.all([
    getUserSettings(user.userId),
    countPushSubscriptions(user.userId),
  ]);
  return NextResponse.json({
    user: { id: user.userId, name: user.name, username: user.username },
    settings,
    subscriptionCount,
  });
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));

  const patch: {
    notify_11?: boolean;
    notify_17?: boolean;
    notify_21?: boolean;
    remind_todos?: boolean;
    remind_events?: boolean;
    remind_offset_min?: number;
    remind_day_min?: number;
    timezone?: string | null;
  } = {};
  for (const k of [
    "notify_11",
    "notify_17",
    "notify_21",
    "remind_todos",
    "remind_events",
  ] as const) {
    if (typeof body?.[k] === "boolean") patch[k] = body[k];
  }
  // Reminder timing — ranges mirror the DB CHECK constraints.
  if (body?.remind_offset_min !== undefined) {
    const v = Number(body.remind_offset_min);
    if (!Number.isInteger(v) || v < 0 || v > 1440) {
      return NextResponse.json(
        { error: "remind_offset_min must be an integer 0–1440." },
        { status: 400 },
      );
    }
    patch.remind_offset_min = v;
  }
  if (body?.remind_day_min !== undefined) {
    const v = Number(body.remind_day_min);
    if (!Number.isInteger(v) || v < 0 || v > 1439) {
      return NextResponse.json(
        { error: "remind_day_min must be an integer 0–1439." },
        { status: 400 },
      );
    }
    patch.remind_day_min = v;
  }
  if ("timezone" in (body ?? {})) {
    const tz = body.timezone;
    if (tz !== null && (typeof tz !== "string" || !isValidTimeZone(tz))) {
      return NextResponse.json(
        { error: "Unknown timezone." },
        { status: 400 },
      );
    }
    patch.timezone = tz as string | null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const settings = await updateUserSettings(user.userId, patch);
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json(
      { error: "Couldn't save settings." },
      { status: 500 },
    );
  }
}
