"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { CalendarDays, CheckSquare, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedTitle, type FeedEntry } from "@/lib/local/unified";

const KIND_ICON = {
  event: CalendarDays,
  todo: CheckSquare,
  note: StickyNote,
} as const;

/**
 * Upcoming feed (today → +30d): events, dated todos and dated notes grouped
 * under day headings. Events open in the edit dialog; todos/notes deep-link
 * to their sections.
 */
export function AgendaList({
  days,
  feeds,
  today,
  onEventClick,
}: {
  days: string[];
  feeds: Map<string, FeedEntry[]>;
  today: string;
  onEventClick: (eventId: string) => void;
}) {
  const visible = days.filter((iso) => (feeds.get(iso) ?? []).length > 0);
  if (visible.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Nothing scheduled for the next 30 days.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {visible.map((iso) => {
        const isToday = iso === today;
        const isTomorrow =
          !isToday && iso === addOneDayISO(today);
        return (
          <section key={iso}>
            <h2
              className={cn(
                "mb-1 text-xs font-semibold uppercase tracking-wide",
                isToday ? "text-[var(--color-check)]" : "text-[var(--muted)]",
              )}
            >
              {isToday
                ? "Today"
                : isTomorrow
                  ? "Tomorrow"
                  : format(parseISO(iso), "EEE d MMM")}
            </h2>
            <ul className="divide-y divide-[var(--border)]">
              {(feeds.get(iso) ?? []).map((f) => {
                const Icon = KIND_ICON[f.kind];
                const inner = (
                  <>
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        f.kind === "todo" && f.completed
                          ? "text-[var(--color-check)]"
                          : f.external
                            ? "text-[var(--color-exempt)]"
                            : "text-[var(--muted)]",
                      )}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm",
                        f.kind === "todo" && f.completed
                          ? "text-[var(--muted)] line-through"
                          : "",
                        f.external && "font-medium text-[var(--color-exempt)]",
                      )}
                    >
                      {feedTitle(f)}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                      {f.time ?? (f.allDay ? "all day" : "")}
                    </span>
                  </>
                );
                const rowClass =
                  "flex w-full items-center gap-2 py-1.5 text-left";
                return (
                  <li key={`${f.kind}:${f.id}`}>
                    {f.kind === "event" ? (
                      <button className={rowClass} onClick={() => onEventClick(f.id)}>
                        {inner}
                      </button>
                    ) : (
                      <Link
                        href={f.kind === "todo" ? "/todos" : `/notes?id=${f.id}`}
                        className={rowClass}
                      >
                        {inner}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function addOneDayISO(iso: string): string {
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
