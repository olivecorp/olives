import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getApiKeyPrincipal } from "./db";

/**
 * Bearer API-key auth for the write-only routes (/api/v1/*). Keys look like
 * "ac_" + 43 base64url chars (192 random bits), live in the api_keys table
 * hashed with sha256, and are shown to the user exactly once at creation.
 * These routes never read the session cookie, so CORS with Allow-Origin:* is
 * safe (no credentials are involved — CSRF is structurally impossible).
 */

const AC_PREFIX = "ac_";
const KEY_LENGTH = AC_PREFIX.length + 43; // "ac_" + base64url(32 bytes)

/** The two key scopes: a key only ever works on its own surface. Internal
 *  keys call /api/v1/todos + /api/v1/events (items land as usual); external
 *  keys call /api/v1/external/* (items tagged EXTERNAL + a push). That way a
 *  key handed out to friends can't plant normal-looking items, and the
 *  owner's own keys can't be used on the hand-out surface. */
export type ApiKeyScope = "internal" | "external";

export interface ApiKeyPrincipal {
  userId: string;
  keyId: string;
  keyName: string;
  scope: ApiKeyScope;
}

/** Generate a fresh key: the caller sees `secret` once; store hash + prefix. */
export function generateApiKey(): {
  secret: string;
  hash: string;
  prefix: string;
} {
  const secret = AC_PREFIX + randomBytes(32).toString("base64url");
  return {
    secret,
    hash: createHash("sha256").update(secret).digest("hex"),
    prefix: secret.slice(0, 12),
  };
}

/**
 * Resolve the request's Bearer key to its owner AND gate it to one surface.
 * Returns the principal on success, or a ready-to-send NextResponse — 401
 * when the header is missing/malformed or no active key matches, 403 when a
 * valid key belongs to the other surface (internal key on /api/v1/external/*
 * or vice versa). Callers wrap the response in withV1Cors and return it:
 *
 *   const key = await requireApiKey(req, "external");
 *   if (key instanceof NextResponse) return withV1Cors(key);
 *
 * The format check runs before any DB call so garbage costs nothing; hash
 * lookup by equality (the index does the work — the hash is
 * preimage-resistant, so no constant-time compare is needed). DB errors
 * PROPAGATE — a Supabase outage is a 500, not a misleading 401.
 */
export async function requireApiKey(
  req: NextRequest,
  scope: ApiKeyScope,
): Promise<ApiKeyPrincipal | NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return apiKeyUnauthorized();
  const secret = auth.slice("Bearer ".length);
  // Cheap reject: right shape or don't touch the database.
  if (!secret.startsWith(AC_PREFIX) || secret.length !== KEY_LENGTH) {
    return apiKeyUnauthorized();
  }
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) return apiKeyUnauthorized();
  const hash = createHash("sha256").update(secret).digest("hex");
  const key = await getApiKeyPrincipal(hash);
  if (!key) return apiKeyUnauthorized();
  if (key.scope !== scope) {
    return NextResponse.json(
      {
        error:
          `This API key is ${key.scope}-only. Create a ${scope} key in ` +
          "Settings → API keys to use this endpoint.",
      },
      { status: 403 },
    );
  }
  return key;
}

function apiKeyUnauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Invalid or missing API key." },
    { status: 401 },
  );
}

/** CORS headers for /api/v1 — applied to every response, errors included
 *  (a browser caller can't read an error body without them). */
export const V1_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function withV1Cors(res: NextResponse): NextResponse {
  const withHeaders = new NextResponse(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
  for (const [k, v] of Object.entries(V1_CORS)) withHeaders.headers.set(k, v);
  return withHeaders;
}
