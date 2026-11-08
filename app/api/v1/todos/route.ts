import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey, withV1Cors } from "@/lib/api-auth";
import { isValidISODate, jsonError } from "@/lib/api-helpers";
import { insertApiTodo, touchApiKey } from "@/lib/db";

/**
 * External write-only API: add a todo to the key owner's account.
 *
 *   POST /api/v1/todos
 *   Authorization: Bearer ac_…
 *   { "text": "Call the plumber", "date": "2026-10-29",   // date optional
 *     "completed": false }                                 // optional
 *
 * Every API-added todo is tagged priority "external" — the amber category
 * pinned above High in the Current view (a `priority` field in the body is
 * ignored). completed (default false) stamps completed_at server-side, for
 * callers that log finished items. The insert lands in Supabase with
 * synced_at = now(), so every device of the owner merges it on the next
 * pull (≤15s while the app is visible). Unknown fields are ignored;
 * responses carry CORS headers so browser-based callers work too.
 */
export const runtime = "nodejs";

export function OPTIONS() {
  return withV1Cors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  try {
    const key = await requireApiKey(req);
    if (!key) {
      return withV1Cors(
        NextResponse.json(
          { error: "Invalid or missing API key." },
          { status: 401 },
        ),
      );
    }

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

    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 2000) {
      return withV1Cors(
        NextResponse.json(
          { error: "text is required (1–2000 characters)." },
          { status: 400 },
        ),
      );
    }

    let date: string | null = null;
    if (body.date !== undefined && body.date !== null) {
      if (typeof body.date !== "string" || !isValidISODate(body.date)) {
        return withV1Cors(
          NextResponse.json(
            { error: "date must be a valid YYYY-MM-DD." },
            { status: 400 },
          ),
        );
      }
      date = body.date;
    }

    let completed = false;
    if (body.completed != null) {
      if (typeof body.completed !== "boolean") {
        return withV1Cors(
          NextResponse.json(
            { error: "completed must be a boolean." },
            { status: 400 },
          ),
        );
      }
      completed = body.completed;
    }

    const [todo] = await Promise.all([
      insertApiTodo(key.userId, { text, date, completed }),
      // Best-effort bookkeeping in parallel — a failed touch never blocks
      // the write (and never fires after the response, which Vercel freezes).
      touchApiKey(key.keyId).catch(() => null),
    ]);
    return withV1Cors(NextResponse.json({ todo }, { status: 201 }));
  } catch (e) {
    return withV1Cors(jsonError(e));
  }
}
