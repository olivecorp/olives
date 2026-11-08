import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey, withV1Cors } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-helpers";
import { parseEvent } from "@/lib/api-events";
import { insertApiEvent, touchApiKey } from "@/lib/db";

/**
 * Internal write-only API: add a calendar event to the key owner's account,
 * as usual — events added here look like manual ones on the calendar. (The
 * hand-to-other-people surface is POST /api/v1/external/events, which tags
 * everything EXTERNAL instead.)
 *
 *   POST /api/v1/events
 *   Authorization: Bearer ac_…
 *   { "title": "Dentist", "date": "2026-11-04", "start": "09:30",
 *     "end": "10:15", "location": "123 Main St", "externalId": "id-1" }
 *
 * `start`/`end` are "HH:MM" local times; omitting `start` (or allDay:true)
 * makes an all-day event. `externalId` is optional dedup: sending the same
 * id again returns the existing event (200) instead of duplicating it (201).
 * Events are single-day; end must be after start. The row syncs to the
 * owner's devices on their next pull.
 *
 * Internal keys only — an external-scoped key gets a 403 here (and vice
 * versa on /api/v1/external/events).
 */
export const runtime = "nodejs";

export function OPTIONS() {
  return withV1Cors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  try {
    const key = await requireApiKey(req, "internal");
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
      insertApiEvent(key.userId, { ...parsed.input, source: "api" }),
      // Best-effort bookkeeping in parallel — a failed touch never blocks
      // the write (and never fires after the response, which Vercel freezes).
      touchApiKey(key.keyId).catch(() => null),
    ]);
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
