import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { generateApiKey } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-helpers";
import { createApiKey, listApiKeys } from "@/lib/db";

/**
 * Manage the account's API keys (used by the /api/v1/* add surfaces).
 * Session-gated like every other /api route. A key is scoped at creation:
 * internal keys may only call /api/v1/todos + /api/v1/events, external keys
 * only /api/v1/external/*. The full secret is returned exactly once, at
 * creation — afterwards only its sha256 hash exists server-side.
 */

const MAX_ACTIVE_KEYS = 20;

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  try {
    return NextResponse.json({ keys: await listApiKeys(user.userId) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    scope?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) {
    return NextResponse.json(
      { error: "name is required (1–100 characters)." },
      { status: 400 },
    );
  }
  // Default external — the hand-to-other-people surface is the reason keys
  // exist; the owner picks internal for their own automations.
  let scope: "internal" | "external" = "external";
  if (body?.scope != null) {
    if (body.scope !== "internal" && body.scope !== "external") {
      return NextResponse.json(
        { error: 'scope must be "internal" or "external".' },
        { status: 400 },
      );
    }
    scope = body.scope;
  }
  try {
    const active = (await listApiKeys(user.userId)).filter(
      (k) => !k.revokedAt,
    );
    if (active.length >= MAX_ACTIVE_KEYS) {
      return NextResponse.json(
        { error: "Too many active keys — revoke one first." },
        { status: 400 },
      );
    }
    const { secret, hash, prefix } = generateApiKey();
    const key = await createApiKey(user.userId, {
      name,
      keyHash: hash,
      keyPrefix: prefix,
      scope,
    });
    return NextResponse.json({ key, secret }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
