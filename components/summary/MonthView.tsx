"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { addDays, addMonths, format, isToday, parseISO } from "date-fns";
import { toISODate } from "@/lib/utils";
import type { WindowMode } from "@/lib/dates";
import { writeSummaryModeDefault } from "@/lib/prefs";
import {
  buildCompletionIndex,
  scoreOverallDate,
  scoreUserDate,
} from "@/lib/scoring";
import { percentColor, percentTint } from "@/lib/colors";
import type { Task, TaskCompletion, User } from "@/lib/types";
import { DateStepper } from "./DateStepper";
import { RollingToggle } from "./RollingToggle";

interface Props {
  users: User[];
  tasks: Task[];
  completions: TaskCompletion[];
  days: string[];
  leadOffset: number;
  anchorISO: string;
  mode: WindowMode;
  todayISO: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthView(props: Props) {
  const router = useRouter();
  const { users, tasks, days, leadOffset, anchorISO, mode, todayISO } = props;

  const index = useMemo(
    () => buildCompletionIndex(props.completions),
    [props.completions],
  );

  function go(anchor: string, m: WindowMode) {
    const p = new URLSearchParams({ date: anchor, mode: m });
    router.push(`/month?${p.toString()}`);
  }
  const shift = (n: number) => {
    const base = parseISO(anchorISO);
    const next =
      mode === "calendar" ? addMonths(base, n) : addDays(base, n * 30);
    go(toISODate(next), mode);
  };

  const trailing = (7 - ((leadOffset + days.length) % 7)) % 7;

  return (
    <div className="space-y-4">
      {/* One-line header */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <h1 className="shrink-0 text-lg font-semibold tracking-tight">Month</h1>
        <div className="ml-auto flex items-center gap-1.5">
          <RollingToggle
            on={mode === "rolling"}
            onChange={(on) => {
              // The toggle sets this device's sticky mode default; date steps
              // just carry the current mode in the URL.
              const m: WindowMode = on ? "rolling" : "calendar";
              writeSummaryModeDefault(m);
              go(anchorISO, m);
            }}
          />
          <DateStepper
            value={anchorISO}
            onChange={(iso) => go(iso, mode)}
            onPrev={() => shift(-1)}
            onNext={() => shift(1)}
          />
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leadOffset }).map((_, i) => (
          <div key={`lead-${i}`} />
        ))}

        {days.map((iso) => {
          const dt = parseISO(iso);
          const future = iso > todayISO;
          const overall = scoreOverallDate(tasks, index, iso);
          const pct =
            overall.percent == null
              ? null
              : Math.round(overall.percent * 100);
          const today = isToday(dt);

          return (
            <div
              key={iso}
              className="min-h-[68px] rounded-lg border border-[var(--border)] bg-[var(--card)] p-1.5"
              style={{ backgroundColor: future ? undefined : percentTint(overall.percent) }}
              title={`${iso} — ${pct == null ? "no data" : `${pct}%`}`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={
                    today
                      ? "text-xs font-bold text-[var(--color-check)]"
                      : "text-xs font-medium text-[var(--muted)]"
                  }
                >
                  {format(dt, "d")}
                </span>
                {!future && (
                  <span className="text-[10px] font-medium text-[var(--muted)]">
                    {pct == null ? "—" : `${pct}%`}
                  </span>
                )}
              </div>

              {!future && (
                <div className="mt-1 flex flex-wrap gap-0.5">
                  {users.map((u) => {
                    const s = scoreUserDate(
                      tasks.filter((t) => t.user_id === u.id),
                      index,
                      iso,
                    );
                    const upct =
                      s.percent == null ? null : Math.round(s.percent * 100);
                    return (
                      <span
                        key={u.id}
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: percentColor(s.percent) }}
                        title={`${u.name}: ${upct == null ? "—" : `${upct}%`} (${s.check}/${s.denominator})`}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {Array.from({ length: trailing }).map((_, i) => (
          <div key={`trail-${i}`} />
        ))}
      </div>

      {users.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
          <span>Dots = one per user:</span>
          {users.map((u) => (
            <span key={u.id} className="inline-flex items-center gap-1">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: "#9ca3af" }}
              />
              {u.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
