"use client";

import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useDashboard } from "@/lib/use-dashboard";
import { weekDays, type WindowMode } from "@/lib/dates";
import { toISODate } from "@/lib/utils";
import { readSummaryModeDefault } from "@/lib/prefs";
import { WeekView } from "./WeekView";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function WeekTab() {
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
  const days = weekDays(anchor, mode);

  const { data, error } = useDashboard();
  if (error) return <p className="text-[var(--muted)]">Failed to load.</p>;
  if (!data) return <Spinner />;

  return (
    <WeekView
      users={data.users}
      tasks={data.tasks}
      completions={data.completions}
      days={days}
      anchorISO={anchor}
      mode={mode}
      todayISO={todayISO}
    />
  );
}

export function Spinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-2 text-[var(--muted)]">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}
