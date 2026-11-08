import type { EventRecord, NoteRecord, TodoRecord } from "./types";

// Unified calendar feed: events + dated todos + dated notes side by side.
// Pure functions only — the calendar views live-query the data and call these.

export type FeedKind = "event" | "todo" | "note";

export interface FeedEntry {
  kind: FeedKind;
  id: string;
  title: string;
  /** Display time "HH:MM", or null for all-day / no-time items. */
  time: string | null;
  allDay: boolean;
  startMin: number | null;
  /** Todos only. */
  completed?: boolean;
  /** Events only: added from outside the app (the external API today). */
  external?: boolean;
}

/** Display title — external events carry an "EXTERNAL: " prefix (after the
 *  time, wherever one shows) so their provenance is visible at a glance. */
export function feedTitle(f: FeedEntry): string {
  return f.external ? `EXTERNAL: ${f.title}` : f.title;
}

export interface UnifiedData {
  events: EventRecord[];
  todos: TodoRecord[];
  notes: NoteRecord[];
}

function minutesLabel(min: number | null): string | null {
  if (min === null) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const SORT_END = 10_000; // after any real minute (0–1439)

/** One day's entries, all-day first then by start time, then by kind. */
export function buildDayFeed(dateISO: string, data: UnifiedData): FeedEntry[] {
  const entries: FeedEntry[] = [];

  for (const e of data.events) {
    if (e.deleted || e.date !== dateISO) continue;
    entries.push({
      kind: "event",
      id: e.id,
      title: e.title || "(untitled event)",
      time: e.allDay ? null : minutesLabel(e.startMin),
      allDay: e.allDay,
      startMin: e.allDay ? null : (e.startMin ?? null),
      external: e.source !== "manual",
    });
  }
  for (const t of data.todos) {
    if (t.deleted || t.date !== dateISO) continue;
    entries.push({
      kind: "todo",
      id: t.id,
      title: t.text || "(untitled todo)",
      time: null,
      allDay: true, // todos are day-scoped, rendered like all-day items
      startMin: null,
      completed: t.completed,
    });
  }
  for (const n of data.notes) {
    if (n.deleted || n.date !== dateISO) continue;
    entries.push({
      kind: "note",
      id: n.id,
      title: n.title || "(untitled note)",
      time: null,
      allDay: true,
      startMin: null,
    });
  }

  entries.sort((a, b) => {
    const ka = (a.allDay ? -1 : (a.startMin ?? SORT_END));
    const kb = (b.allDay ? -1 : (b.startMin ?? SORT_END));
    if (ka !== kb) return ka - kb;
    return a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title);
  });
  return entries;
}

function nextDayISO(iso: string): string {
  const d = new Date(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)) + 1,
  );
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Feeds for every day in [fromISO, toISO] inclusive — Map may miss empty days. */
export function buildRangeFeeds(
  fromISO: string,
  toISO: string,
  data: UnifiedData,
): Map<string, FeedEntry[]> {
  const out = new Map<string, FeedEntry[]>();
  let cur = fromISO;
  // Hard cap guards against a corrupt range looping forever.
  for (let i = 0; i < 400 && cur <= toISO; i++) {
    const feed = buildDayFeed(cur, data);
    if (feed.length > 0) out.set(cur, feed);
    cur = nextDayISO(cur);
  }
  return out;
}
