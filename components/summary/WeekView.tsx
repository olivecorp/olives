"use client";

import { Fragment, useMemo } from "react";
import { useRouter } from "next/navigation";
import { addDays, format, isToday, parseISO } from "date-fns";
import { cn, toISODate } from "@/lib/utils";
import type { WindowMode } from "@/lib/dates";
import { writeSummaryModeDefault } from "@/lib/prefs";
import {
  buildCompletionIndex,
  getStatus,
  scoreOverallDate,
  tasksActiveOnDate,
} from "@/lib/scoring";
import type { Task, TaskCompletion, User } from "@/lib/types";
import { DateStepper } from "./DateStepper";
import { RollingToggle } from "./RollingToggle";
import { StatusGlyph, StatusLegend } from "./StatusGlyph";

interface Props {
  users: User[];
  tasks: Task[];
  completions: TaskCompletion[];
  days: string[];
  anchorISO: string;
  mode: WindowMode;
  todayISO: string;
}

export function WeekView(props: Props) {
  const router = useRouter();
  const { users, tasks, days, anchorISO, mode, todayISO } = props;

  const index = useMemo(
    () => buildCompletionIndex(props.completions),
    [props.completions],
  );

  function go(anchor: string, m: WindowMode) {
    const p = new URLSearchParams({ date: anchor, mode: m });
    router.push(`/week?${p.toString()}`);
  }
  const shift = (n: number) =>
    go(toISODate(addDays(parseISO(anchorISO), n)), mode);

  // status for a task/day; future days and missing rows are "no data" (undefined)
  const statusFor = (taskId: string, iso: string, future: boolean) =>
    future ? undefined : getStatus(index, taskId, iso);

  return (
    <div className="space-y-4">
      {/* One-line header */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <h1 className="shrink-0 text-lg font-semibold tracking-tight">Week</h1>
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
            onPrev={() => shift(-7)}
            onNext={() => shift(7)}
          />
        </div>
      </div>

      <StatusLegend />

      {/* Matrix — table-fixed so all 7 days fit without horizontal scroll. */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-[var(--border)]">
              <th className="sticky left-0 z-10 w-28 bg-[var(--card)] px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] sm:w-48 sm:text-xs">
                Task
              </th>
              {days.map((d) => {
                const dt = parseISO(d);
                const today = isToday(dt);
                const future = d > todayISO;
                const overall = scoreOverallDate(tasks, index, d);
                const pct =
                  overall.percent == null
                    ? null
                    : Math.round(overall.percent * 100);
                return (
                  <th key={d} className="px-0.5 py-1.5 text-center align-bottom">
                    <div className="flex flex-col items-center leading-tight">
                      <span
                        className={cn(
                          "text-[10px]",
                          today
                            ? "font-bold text-[var(--color-check)]"
                            : "text-[var(--muted)]",
                        )}
                      >
                        {format(dt, "EEEEE")}
                      </span>
                      <span className="text-[10px] text-[var(--muted)]">
                        {format(dt, "d")}
                      </span>
                      <span className="text-[9px] text-[var(--muted)]">
                        {future || pct == null ? "–" : `${pct}%`}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={days.length + 1}
                  className="px-3 py-8 text-center text-[var(--muted)]"
                >
                  No users yet — accounts are configured by the administrator.
                </td>
              </tr>
            )}
            {users.map((u) => {
              const userTasks = tasks.filter((t) => t.user_id === u.id);
              return (
                <Fragment key={u.id}>
                  <tr className="bg-[#f3f4f6] [&>td]:border-t [&>td]:border-[var(--border)]">
                    <td className="sticky left-0 z-10 w-28 bg-[#f3f4f6] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] sm:w-48 sm:text-xs">
                      {u.name}
                    </td>
                    {days.map((d) => (
                      <td key={d} />
                    ))}
                  </tr>
                  {userTasks.length === 0 ? (
                    <tr className="[&>td]:border-t [&>td]:border-[var(--border)]">
                      <td
                        colSpan={days.length + 1}
                        className="px-3 py-2 text-[10px] text-[var(--muted)]"
                      >
                        No tasks
                      </td>
                    </tr>
                  ) : (
                    userTasks.map((t) => (
                      <tr
                        key={t.id}
                        className="[&>td]:border-t [&>td]:border-[var(--border)]"
                      >
                        <td className="sticky left-0 z-10 w-28 bg-[var(--card)] px-2 py-1.5 align-top text-[11px] leading-tight sm:w-48 sm:text-xs">
                          <span className="line-clamp-2 break-words">
                            {t.title}
                          </span>
                        </td>
                        {days.map((d) => {
                          const future = d > todayISO;
                          const active = tasksActiveOnDate([t], d).length > 0;
                          return (
                            <td
                              key={d}
                              className="px-0.5 py-1.5 text-center align-middle"
                            >
                              {active ? (
                                <StatusGlyph
                                  status={statusFor(t.id, d, future)}
                                  className="mx-auto h-4 w-4"
                                />
                              ) : (
                                <span className="text-[var(--muted)] opacity-40">
                                  ·
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
