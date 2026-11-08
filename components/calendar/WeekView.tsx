"use client";

import { useEffect, useMemo, useRef } from "react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { EventRecord } from "@/lib/local/types";
import { feedTitle, type FeedEntry } from "@/lib/local/unified";

const HOUR_H = 48; // px per hour row — 24h totals 1152px, scrolled container

/**
 * Week view with hour slots (Monday-first). Timed events are positioned by
 * start/end minutes; all-day events + dated todos/notes sit in the top row.
 * Clicking an empty slot opens the event dialog prefilled to that half hour.
 *
 * ONE scroll container holds the weekday header, the all-day row, and the
 * hour grid: every row is a grid over the same containing block with the
 * same tracks, so the columns cannot drift apart. Tracks are minmax(0,1fr),
 * NOT 1fr: a plain 1fr floors each track at its cells' min-content, and the
 * all-day chips are nowrap (truncate) — one long title made ONLY the
 * all-day row's columns grow past the shared width and drift right of the
 * hour grid. minmax(0,1fr) makes every row's tracks content-independent and
 * identical; long chips just clip. The header + all-day block sticks to the
 * top while the hours scroll.
 */
export function WeekView({
  days,
  events,
  feeds,
  today,
  onSlotClick,
  onEventClick,
}: {
  days: string[];
  events: EventRecord[];
  feeds: Map<string, FeedEntry[]>;
  today: string;
  onSlotClick: (dateISO: string, startMin: number) => void;
  onEventClick: (eventId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const nowMin = useMemo(() => {
    if (!days.includes(today)) return null;
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }, [days, today]);

  // Auto-scroll to ~07:00 so the working day is centered on open (the sticky
  // header overlays the first rows, so 07:00 lands right beneath it).
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 6.5 * HOUR_H;
  }, []);

  const byId = useMemo(
    () => new Map(events.map((e) => [e.id, e] as const)),
    [events],
  );

  return (
    <div>
      <div
        ref={scroller}
        className="max-h-[70vh] overflow-auto rounded-xl border border-[var(--border)]"
      >
        <div className="min-w-[44rem]">
          {/* Weekday headers + all-day row, pinned to the top while the
              hours scroll. Same grid tracks as the hour grid below. */}
          <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)]">
            <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] divide-x divide-[var(--border)]">
              <div className="bg-[var(--card)]" />
              {days.map((iso) => (
                <div
                  key={iso}
                  className={cn(
                    "bg-[var(--card)] py-1 text-center text-xs font-semibold",
                    iso === today
                      ? "text-[var(--color-check)]"
                      : "text-[var(--muted)]",
                  )}
                >
                  {format(parseISO(iso), "EEE d")}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] divide-x divide-[var(--border)] border-t border-[var(--border)]">
              <div className="bg-[var(--card)] p-1 text-center text-[0.6rem] uppercase text-[var(--muted)]">
                all day
              </div>
              {days.map((iso) => {
                const allday = (feeds.get(iso) ?? []).filter((f) => f.allDay);
                return (
                  <div
                    key={iso}
                    className={cn(
                      "flex min-h-10 flex-col gap-0.5 bg-[var(--card)] p-1",
                      iso === today && "bg-[var(--color-check-soft)]",
                    )}
                  >
                    {allday.slice(0, 2).map((f) => (
                      <span
                        key={f.id}
                        className={cn(
                          "truncate rounded px-1 text-[0.68rem] leading-4",
                          f.kind === "event"
                            ? f.external
                              ? "bg-[var(--color-exempt-soft)] font-medium text-[var(--color-exempt)]"
                              : "bg-[var(--color-check-soft)] text-[var(--color-check)]"
                            : "text-[var(--muted)]",
                        )}
                        title={feedTitle(f)}
                      >
                        {feedTitle(f)}
                      </span>
                    ))}
                    {allday.length > 2 && (
                      <span className="text-[0.68rem] leading-4 text-[var(--muted)]">
                        +{allday.length - 2}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Hour grid */}
          <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] divide-x divide-[var(--border)]">
            {/* hour labels */}
            <div>
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="relative border-t border-[var(--border)] pr-1 pt-0.5 text-right text-[0.65rem] tabular-nums text-[var(--muted)]"
                  style={{ height: HOUR_H }}
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {days.map((iso) => {
              const timed = (feeds.get(iso) ?? []).filter((f) => !f.allDay);
              return (
                <div
                  key={iso}
                  className={cn(
                    "relative",
                    iso === today && "bg-[var(--color-check-soft)]/30",
                  )}
                  style={{ height: 24 * HOUR_H }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const min = Math.floor(
                      ((e.clientY - rect.top) / rect.height) * 1440,
                    );
                    onSlotClick(iso, Math.max(0, Math.min(1410, Math.round(min / 30) * 30)));
                  }}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={h}
                      className="border-t border-[var(--border)]"
                      style={{ height: HOUR_H }}
                    />
                  ))}
                  {timed.map((f) => {
                    const ev = f.kind === "event" ? byId.get(f.id) : undefined;
                    if (!ev) return null;
                    const start = ev.startMin ?? 0;
                    const dur = Math.max(30, (ev.endMin ?? start + 60) - start);
                    return (
                      <button
                        key={ev.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(ev.id);
                        }}
                        className={cn(
                          "absolute inset-x-0.5 overflow-hidden rounded border px-1 py-0.5 text-left text-[0.68rem] leading-4",
                          f.external
                            ? "border-[var(--color-exempt)] bg-[var(--color-exempt-soft)]"
                            : "border-[var(--color-check)] bg-[var(--color-check-soft)]",
                        )}
                        style={{
                          top: `${(start / 1440) * 100}%`,
                          height: `calc(${(dur / 1440) * 100}% - 2px)`,
                          minHeight: 18,
                        }}
                      >
                        <span
                          className={cn(
                            "block truncate font-semibold",
                            f.external
                              ? "text-[var(--color-exempt)]"
                              : "text-[var(--color-check)]",
                          )}
                        >
                          {feedTitle(f)}
                        </span>
                        <span className="block truncate text-[var(--muted)]">
                          {f.time}
                          {ev.location ? ` · ${ev.location}` : ""}
                        </span>
                      </button>
                    );
                  })}
                  {iso === today && nowMin !== null && (
                    <div
                      className="pointer-events-none absolute inset-x-0 border-t-2 border-red-500"
                      style={{ top: `${(nowMin / 1440) * 100}%` }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Tap an empty slot to add an event at that time.
      </p>
    </div>
  );
}
