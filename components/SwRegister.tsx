"use client";

import { useEffect } from "react";

/**
 * Registers the service worker at app boot for every device. Previously it
 * only registered inside the push-subscribe gesture, so devices that never
 * enabled reminders had no worker — and missed the app-shell cache that
 * makes reopening the app paint instantly. register() is idempotent and
 * fails silently (unsupported / private mode): push enabling still does its
 * own register + permission flow (lib/push-client.ts).
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Unsupported or blocked — the app just loads the old (network) way.
    });
  }, []);
  return null;
}
