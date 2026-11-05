"use client";

import { useSearchParams } from "next/navigation";
import { useDashboard } from "@/lib/use-dashboard";
import { monthDays, type WindowMode } from "@/lib/dates";
import { toISODate } from "@/lib/utils";
import { readSummaryModeDefault } from "@/lib/prefs";
import { MonthView } from "./MonthView";
import { Spinner } from "./WeekTab";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function MonthTab() {
  const params = useSearchParams();
  const todayISO = toISODate(new Date());
  const dateParam = params.get("date");
  const anchor = dateParam && DATE_RE.test(dateParam) ? dateParam : todayISO;
  // An explicit ?mode= wins; otherwise the device's sticky default (set by
  // the RollingToggle) applies.
  const modeParam = params.get("mode");
  const mode: WindowMode =
    modeParam === "rolling" || modeParam === "calendar"
      ? modeParam
      : readSummaryModeDefault();
  const { days, leadOffset } = monthDays(anchor, mode);

  const { data, error } = useDashboard();
  if (error) return <p className="text-[var(--muted)]">Failed to load.</p>;
  if (!data) return <Spinner />;

  return (
    <MonthView
      users={data.users}
      tasks={data.tasks}
      completions={data.completions}
      days={days}
      leadOffset={leadOffset}
      anchorISO={anchor}
      mode={mode}
      todayISO={todayISO}
    />
  );
}
