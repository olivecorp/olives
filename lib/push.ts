import "server-only";
import webpush from "web-push";
import {
  deletePushSubscriptionByEndpoint,
  getPushSubscriptions,
} from "./db";

/**
 * Server-side Web Push wrapper (Node runtime only — never import from
 * middleware). VAPID details are set lazily so a missing config only errors
 * when a notification is actually attempted.
 */

let configured = false;

function ensureVapid(): void {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      "VAPID keys are not configured. Generate with " +
        "`npx web-push generate-vapid-keys`, set NEXT_PUBLIC_VAPID_PUBLIC_KEY, " +
        "VAPID_PRIVATE_KEY and VAPID_SUBJECT (mailto:…) in Vercel, and redeploy.",
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
}

/** Per-send overrides: `tag` controls on-device replacement (notifications
 * sharing a tag replace each other; distinct tags stack) and `url` is where
 * the notification click lands. */
export interface SendOptions {
  tag?: string;
  url?: string;
}

/** Send to every subscription of the user; prune dead endpoints (404/410).
 * Returns how many sends succeeded (0 when the user has no subscriptions). */
export async function sendToUser(
  userId: string,
  payload: PushPayload,
  options?: SendOptions,
): Promise<number> {
  ensureVapid();
  const subs = await getPushSubscriptions(userId);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({
            ...payload,
            tag: options?.tag ?? "olives",
            url: options?.url ?? "/daily",
          }),
          // Stale pushes expire instead of buzzing hours later when a phone
          // reconnects.
          { TTL: 1800 },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await deletePushSubscriptionByEndpoint(s.endpoint).catch(() => {});
        }
        // Other errors (transient push-service issues) — drop silently; the
        // slot was claimed so we don't retry-spam.
      }
    }),
  );
  return sent;
}
