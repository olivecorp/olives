"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { addDays, addMonths, addWeeks, format, parseISO } from "date-fns";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { cn, fromISODate, toISODate } from "@/lib/utils";
import { monthDays, weekDays } from "@/lib/dates";
import {
  useEvents,
  useLocalUserId,
  useNotes,
  useStorageAvailable,
  useTodos,
} from "@/lib/local/hooks";
import { buildDayFeed, buildRangeFeeds, feedTitle } from "@/lib/local/unified";
import { readPref, writePref } from "@/lib/prefs";
import { MonthGrid } from "./MonthGrid";
import { WeekView } from "./WeekView";
import { AgendaList } from "./AgendaList";
import { EventDialog, type DialogState } from "./EventDialog";

type View = "month" | "week" | "agenda";

// Sticky per-device view, like the todo list's view tabs. Validated on read.
const VIEW_KEY = "calendar-view-v1";

function readView(): View {
  const v = readPref(VIEW_KEY);
  return v === "week" || v === "agenda" ? v : "month";
}

const AGENDA_DAYS = 30;

export function CalendarClient() {
  const userId = useLocalUserId();
  const searchParams = useSearchParams();
  const events = useEvents(userId);
  const todos = useTodos(userId);
  const notes = useNotes(userId);
  const storageOk = useStorageAvailable();

  const [view, setView] = useState<View>(readView);
  const paramDate = searchParams.get("date");
  const [anchor, setAnchor] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(paramDate ?? "") ? paramDate! : toISODate(new Date()),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const today = toISODate(new Date());
  const data = useMemo(
    () => ({ events: events ?? [], todos: todos ?? [], notes: notes ?? [] }),
    [events, todos, notes],
  );

  const month = useMemo(() => monthDays(anchor, "calendar"), [anchor]);
  const week = useMemo(() => weekDays(anchor, "calendar"), [anchor]);
  // Agenda covers today → +30d regardless of the anchor (it's the "upcoming" view).
  const agendaRange = useMemo(() => {
    const start = today;
    const end = toISODate(addDays(fromISODate(today), AGENDA_DAYS));
    return { start, end, days: rangeDays(start, end) };
  }, [today]);

  const monthFeeds = useMemo(
    () =>
      buildRangeFeeds(
        month.days[0],
        month.days[month.days.length - 1],
        data,
      ),
    [month, data],
  );
  const weekFeeds = useMemo(
    () => buildRangeFeeds(week[0], week[week.length - 1], data),
    [week, data],
  );
  const agendaFeeds = useMemo(
    () => buildRangeFeeds(agendaRange.start, agendaRange.end, data),
    [agendaRange, data],
  );

  function jump(iso: string) {
    setAnchor(iso);
    setSelected(null);
    window.history.replaceState(null, "", `?date=${iso}`);
  }

  function step(dir: 1 | -1) {
    const base = fromISODate(anchor);
    const next = view === "month" ? addMonths(base, dir) : addWeeks(base, dir);
    jump(toISODate(next));
  }

  function chooseView(v: View) {
    setView(v);
    writePref(VIEW_KEY, v);
  }

  const loading = events === undefined || todos === undefined || notes === undefined;
  // Week title skips the year unless the week straddles New Year's — it has
  // to fit between the chevrons on a phone.
  const sameYear =
    parseISO(week[0]).getFullYear() === parseISO(week[6]).getFullYear();
  const title =
    view === "week"
      ? `${format(parseISO(week[0]), "d MMM")} – ${format(parseISO(week[6]), sameYear ? "d MMM" : "d MMM yyyy")}`
      : format(parseISO(anchor), view === "month" ? "MMMM yyyy" : "d MMM yyyy");

  if (!userId) {
    return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="sr-only">Calendar</h1>
      <header className="mb-3 flex flex-col gap-2 md:mb-4 md:flex-row md:items-center">
        {/* Row 1: ‹ period title (tap to pick a date) › */}
        <div className="flex min-w-0 items-center gap-1.5 md:flex-1">
          <button
            onClick={() => step(-1)}
            aria-label="Previous"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-black/5"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <label
            className="flex h-9 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-center text-base font-semibold tracking-tight md:justify-start md:px-3"
            title="Pick a date"
          >
            <span className="truncate">{title}</span>
            <input
              type="date"
              value={anchor}
              onChange={(e) => e.target.value && jump(e.target.value)}
              className="sr-only"
            />
          </label>
          <button
            onClick={() => step(1)}
            aria-label="Next"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-black/5"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {/* Row 2: view toggle + Today + Event */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-xs sm:text-sm">
            {(["month", "week", "agenda"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => chooseView(v)}
                className={cn(
                  "rounded-md px-2 py-1 capitalize transition-colors sm:px-2.5",
                  view === v
                    ? "bg-[var(--color-check-soft)] font-semibold text-[var(--color-check)]"
                    : "text-[var(--muted)]",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={() => jump(today)}
            className="ml-auto h-8 rounded-lg border border-[var(--border)] px-2.5 text-sm text-[var(--muted)] hover:bg-black/5"
          >
            Today
          </button>
          <button
            onClick={() => setDialog({ date: anchor, startMin: null })}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--color-check)] px-2.5 text-sm font-semibold text-white"
          >
            <CalendarPlus className="h-4 w-4" />
            Event
          </button>
        </div>
      </header>

      {!storageOk && (
        <p className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm text-[var(--muted)]">
          Offline storage is unavailable in this browser (private mode?) —
          changes can&apos;t be saved.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : view === "month" ? (
        <>
          <MonthGrid
            days={month.days}
            leadOffset={month.leadOffset}
            feeds={monthFeeds}
            anchorMonth={parseISO(anchor).getMonth()}
            today={today}
            selected={selected}
            onSelect={(iso) => setSelected(iso === selected ? null : iso)}
          />
          {selected && (
            <DayDetail
              dateISO={selected}
              entries={buildDayFeed(selected, data)}
              onAdd={() => setDialog({ date: selected, startMin: null })}
              onEventClick={(id) => setDialog({ eventId: id, date: selected })}
            />
          )}
        </>
      ) : view === "week" ? (
        <WeekView
          days={week}
          events={data.events}
          feeds={weekFeeds}
          today={today}
          onSlotClick={(iso, startMin) => setDialog({ date: iso, startMin })}
          onEventClick={(id) => setDialog({ eventId: id, date: anchor })}
        />
      ) : (
        <AgendaList
          days={agendaRange.days}
          feeds={agendaFeeds}
          today={today}
          onEventClick={(id) => setDialog({ eventId: id, date: anchor })}
        />
      )}

      {dialog && (
        <EventDialog
          state={dialog}
          userId={userId}
          event={data.events.find((e) => e.id === dialog.eventId)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/** Selected-day detail under the month grid (unified feed + add button). */
function DayDetail({
  dateISO,
  entries,
  onAdd,
  onEventClick,
}: {
  dateISO: string;
  entries: ReturnType<typeof buildDayFeed>;
  onAdd: () => void;
  onEventClick: (id: string) => void;
}) {
  return (
    <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {format(parseISO(dateISO), "EEEE d MMM")}
        <button
          onClick={onAdd}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-xs text-[var(--muted)] hover:bg-black/5"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          Add event
        </button>
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Nothing this day — events, dated todos and dated notes appear here.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((f) => (
            <li
              key={`${f.kind}:${f.id}`}
              className="flex items-center gap-2 text-sm"
            >
              <span
                className={cn(
                  "w-14 shrink-0 text-xs tabular-nums text-[var(--muted)]",
                  f.kind === "event" &&
                    f.external &&
                    "font-semibold text-[var(--color-exempt)]",
                )}
              >
                {f.time ?? "all day"}
              </span>
              {f.kind === "event" ? (
                <button
                  className={cn(
                    "min-w-0 flex-1 truncate text-left hover:underline",
                    f.external && "font-medium text-[var(--color-exempt)]",
                  )}
                  onClick={() => onEventClick(f.id)}
                >
                  {feedTitle(f)}
                </button>
              ) : (
                <Link
                  href={f.kind === "todo" ? "/todos" : `/notes?id=${f.id}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {f.title}
                </Link>
              )}
              <span className="shrink-0 text-xs uppercase text-[var(--muted)]">
                {f.kind}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function rangeDays(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  let cur = startISO;
  for (let i = 0; i < 400 && cur <= endISO; i++) {
    out.push(cur);
    const d = addDays(fromISODate(cur), 1);
    cur = toISODate(d);
  }
  return out;
}
