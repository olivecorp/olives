"use client";

import { format, parseISO } from "date-fns";
import { CheckSquare, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedTitle, type FeedEntry } from "@/lib/local/unified";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Month grid (Monday-first, matching the checklist's Month view). Each cell
 * shows event chips, a dot per dated todo (green when done), and a note
 * marker; clicking a cell selects the day for the detail list below.
 */
export function MonthGrid({
  days,
  leadOffset,
  feeds,
  anchorMonth, // 0-based month the grid represents
  today,
  selected,
  onSelect,
}: {
  days: string[];
  leadOffset: number;
  feeds: Map<string, FeedEntry[]>;
  anchorMonth: number;
  today: string;
  selected: string | null;
  onSelect: (dateISO: string) => void;
}) {
  const cells: (string | null)[] = [
    ...Array.from({ length: leadOffset }, () => null),
    ...days,
    // pad the tail so the grid rows are complete weeks
    ...Array.from({ length: (7 - ((leadOffset + days.length) % 7)) % 7 }, () => null),
  ];

  return (
    <div className="min-w-0">
      <div>
        <div className="mb-1 grid grid-cols-7 text-center text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)] sm:text-xs">
          {WEEKDAYS.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px rounded-xl border border-[var(--border)] bg-[var(--border)]">
          {cells.map((iso, i) => {
            if (iso === null) return <div key={`empty-${i}`} className="min-h-16 bg-[var(--card)]/40 sm:min-h-24" />;
            const feed = feeds.get(iso) ?? [];
            const events = feed.filter((f) => f.kind === "event");
            const todos = feed.filter((f) => f.kind === "todo");
            const notes = feed.filter((f) => f.kind === "note");
            const inMonth = parseISO(iso).getMonth() === anchorMonth;
            const isToday = iso === today;
            return (
              <button
                key={iso}
                onClick={() => onSelect(iso)}
                className={cn(
                  "flex min-h-16 flex-col gap-0.5 overflow-hidden bg-[var(--card)] p-1 text-left align-top transition-colors hover:bg-black/[0.03] sm:min-h-24 sm:p-1.5",
                  !inMonth && "opacity-40",
                  isToday && "bg-[var(--color-check-soft)]",
                  selected === iso && "ring-2 ring-inset ring-[var(--color-check)]",
                )}
              >
                <span
                  className={cn(
                    "text-[0.65rem] font-semibold tabular-nums sm:text-xs",
                    isToday ? "text-[var(--color-check)]" : "text-[var(--muted)]",
                  )}
                >
                  {format(parseISO(iso), "d")}
                </span>
                {/* Times only (title on hover) — the day list below carries
                    the details; green marks it as an event time, amber an
                    externally-added one. */}
                {events.slice(0, 3).map((e) => (
                  <span
                    key={e.id}
                    title={feedTitle(e)}
                    className={cn(
                      "truncate text-[0.6rem] font-semibold leading-[0.95rem] sm:text-[0.65rem] sm:leading-4",
                      e.external
                        ? "text-[var(--color-exempt)]"
                        : "text-[var(--color-check)]",
                    )}
                  >
                    {e.time ?? "all day"}
                  </span>
                ))}
                {events.length > 3 && (
                  <span className="text-[0.6rem] leading-[0.95rem] text-[var(--muted)] sm:text-[0.68rem] sm:leading-4">
                    +{events.length - 3} more
                  </span>
                )}
                {(todos.length > 0 || notes.length > 0) && (
                  <span className="mt-auto flex items-center gap-1 pt-0.5">
                    {todos.slice(0, 4).map((t) => (
                      <span
                        key={t.id}
                        className={cn(
                          "h-1 w-1 rounded-full sm:h-1.5 sm:w-1.5",
                          t.completed
                            ? "bg-[var(--color-check)]"
                            : "bg-[var(--muted)]",
                        )}
                        title={t.title}
                      />
                    ))}
                    {notes.length > 0 && (
                      <span title={`${notes.length} dated note(s)`}>
                        <StickyNote className="h-2.5 w-2.5 text-[var(--muted)] sm:h-3 sm:w-3" />
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2 hidden items-center gap-2 text-xs text-[var(--muted)] md:flex">
          <CheckSquare className="h-3.5 w-3.5" /> Dots are dated todos (green
          when done); <StickyNote className="h-3.5 w-3.5" /> marks dated notes.
        </p>
      </div>
    </div>
  );
}
