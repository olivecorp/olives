import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey, withV1Cors } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-helpers";
import { parseTodoFields } from "@/lib/api-todos";
import { insertApiTodo, touchApiKey } from "@/lib/db";

/**
 * External write-only API: add an EXTERNAL-tagged todo to the key owner's
 * account. This is the surface to hand to other people — what it adds is
 * visibly from outside. (POST /api/v1/todos is the internal twin that adds
 * as usual.)
 *
 *   POST /api/v1/external/todos
 *   Authorization: Bearer ac_…
 *   { "text": "Call the plumber", "date": "2026-10-29",   // date optional
 *     "completed": false }                                 // optional
 *
 * Every add is tagged priority "external" — the amber category pinned above
 * High in the Current view (a `priority` field in the body is ignored).
 * completed (default false) stamps completed_at server-side, for callers
 * that log finished items. The insert lands in Supabase with synced_at =
 * now(), so every device of the owner merges it on the next pull (≤15s
 * while the app is visible). Unknown fields are ignored; responses carry
 * CORS headers so browser-based callers work too.
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

    const parsed = parseTodoFields(body);
    if ("error" in parsed) {
      return withV1Cors(
        NextResponse.json({ error: parsed.error }, { status: 400 }),
      );
    }

    const [todo] = await Promise.all([
      insertApiTodo(key.userId, { ...parsed.input, priority: "external" }),
      // Best-effort bookkeeping in parallel — a failed touch never blocks
      // the write (and never fires after the response, which Vercel freezes).
      touchApiKey(key.keyId).catch(() => null),
    ]);
    return withV1Cors(NextResponse.json({ todo }, { status: 201 }));
  } catch (e) {
    return withV1Cors(jsonError(e));
  }
}
