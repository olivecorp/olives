import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey, withV1Cors } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-helpers";
import { parseTodoFields } from "@/lib/api-todos";
import { insertApiTodo, touchApiKey } from "@/lib/db";

/**
 * Internal write-only API: add a todo to the key owner's account, as usual —
 * todos added here are indistinguishable from ones typed into the app. (The
 * hand-to-other-people surface is POST /api/v1/external/todos, which tags
 * everything EXTERNAL instead.)
 *
 *   POST /api/v1/todos
 *   Authorization: Bearer ac_…
 *   { "text": "Call the plumber", "date": "2026-10-29",   // date optional
 *     "priority": "high", "completed": false }            // both optional
 *
 * priority is the app's own tag: "high" pins the todo above Current's date
 * buckets, "low" parks it in the Low view. completed (default false) stamps
 * completed_at server-side, for callers that log finished items. The insert
 * lands in Supabase with synced_at = now(), so every device of the owner
 * merges it on the next pull (≤15s while the app is visible). Unknown fields
 * are ignored; responses carry CORS headers so browser-based callers work too.
 *
 * Internal keys only — an external-scoped key gets a 403 here (and vice
 * versa on /api/v1/external/todos).
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

    const parsed = parseTodoFields(body);
    if ("error" in parsed) {
      return withV1Cors(
        NextResponse.json({ error: parsed.error }, { status: 400 }),
      );
    }

    let priority: "high" | "low" | null = null;
    if (body.priority != null) {
      if (body.priority !== "high" && body.priority !== "low") {
        return withV1Cors(
          NextResponse.json(
            { error: 'priority must be "high" or "low".' },
            { status: 400 },
          ),
        );
      }
      priority = body.priority;
    }

    const [todo] = await Promise.all([
      insertApiTodo(key.userId, { ...parsed.input, priority }),
      // Best-effort bookkeeping in parallel — a failed touch never blocks
      // the write (and never fires after the response, which Vercel freezes).
      touchApiKey(key.keyId).catch(() => null),
    ]);
    return withV1Cors(NextResponse.json({ todo }, { status: 201 }));
  } catch (e) {
    return withV1Cors(jsonError(e));
  }
}
