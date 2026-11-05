import type { WindowMode } from "@/lib/dates";

/**
 * Per-device UI preferences in localStorage — deliberately separate from
 * lib/local/* (the synced data layer). Keys are plain strings, version-
 * suffixed so a format change can retire a key in one move (the
 * note-font-size-v2 pattern). Not cleared on logout (matches todo-view /
 * note-font-size). Reads return null during SSR / private mode; writes
 * swallow failures — the preference then lasts for the visit only.
 */

export function readPref(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode etc. — the choice lasts for this visit.
  }
}

// ---- Last visited page ----------------------------------------------------

const LAST_PAGE_KEY = "last-page-v1";

// Only these routes may be remembered or restored; anything else in the key
// (stale value, future route) falls back to /calendar at the consumer.
const APP_ROUTES: readonly string[] = [
  "/calendar",
  "/todos",
  "/notes",
  "/daily",
  "/week",
  "/month",
  "/year",
  "/settings",
];

/** This device's last visited app route, whitelist-validated (else null). */
export function readLastPage(): string | null {
  const v = readPref(LAST_PAGE_KEY);
  return v !== null && APP_ROUTES.includes(v) ? v : null;
}

export function rememberPage(pathname: string): void {
  if (APP_ROUTES.includes(pathname)) writePref(LAST_PAGE_KEY, pathname);
}

// ---- Summary window mode ---------------------------------------------------

const SUMMARY_MODE_KEY = "summary-mode-v1";

/** Persisted Week/Month/Year default for URLs carrying no valid ?mode=. */
export function readSummaryModeDefault(): WindowMode {
  return readPref(SUMMARY_MODE_KEY) === "rolling" ? "rolling" : "calendar";
}

export function writeSummaryModeDefault(mode: WindowMode): void {
  writePref(SUMMARY_MODE_KEY, mode);
}
