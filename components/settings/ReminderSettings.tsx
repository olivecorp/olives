"use client";

import { useState } from "react";
import type { UserSettings } from "@/lib/types";
import { Switch } from "./Switch";

const OFFSETS = [0, 5, 10, 15, 30, 60];
// Morning time for todos + all-day events, every half hour 00:00–23:30.
const DAY_TIMES = Array.from({ length: 48 }, (_, i) => i * 30);

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Option list for a <select> with the stored value kept present even when
 *  it isn't a preset (set via the API) — the select must never lie. */
function optionsFor(presets: number[], current: number): number[] {
  return presets.includes(current)
    ? presets
    : [...presets, current].sort((a, b) => a - b);
}

/**
 * Calendar & todo reminders — two global switches plus timing, all sent
 * through the same notification flow as the daily check-ins (one push
 * pipeline, one settings row). Edits are optimistic and revert if the save
 * fails, exactly like NotificationSettings.
 */
export function ReminderSettings({
  settings,
  onPatch,
}: {
  settings: UserSettings;
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [remind, setRemind] = useState({
    remind_todos: settings.remind_todos,
    remind_events: settings.remind_events,
    remind_offset_min: settings.remind_offset_min,
    remind_day_min: settings.remind_day_min,
  });

  async function patch<K extends keyof typeof remind>(
    key: K,
    value: (typeof remind)[K],
  ) {
    const prev = remind;
    setRemind({ ...remind, [key]: value });
    const ok = await onPatch({ [key]: value });
    if (!ok) setRemind(prev);
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
      <h2 className="text-base font-semibold">Calendar &amp; todo reminders</h2>
      <p className="mb-3 text-sm text-[var(--muted)]">
        A morning summary of the day&apos;s todos and all-day events, plus a
        reminder before each timed event — in your local timezone
        {settings.timezone ? ` (${settings.timezone})` : ""}.
      </p>
      <ul className="divide-y divide-[var(--border)]">
        <li className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-medium">Todos</div>
            <div className="text-xs text-[var(--muted)]">
              Morning summary of todos due today
            </div>
          </div>
          <Switch
            checked={remind.remind_todos}
            label="Todo reminders"
            onClick={() => void patch("remind_todos", !remind.remind_todos)}
          />
        </li>
        <li className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-medium">Events</div>
            <div className="text-xs text-[var(--muted)]">
              Before each timed event, and in the morning for all-day events
            </div>
          </div>
          <Switch
            checked={remind.remind_events}
            label="Event reminders"
            onClick={() => void patch("remind_events", !remind.remind_events)}
          />
        </li>
        <li className="flex items-center justify-between gap-3 py-2.5">
          <label
            htmlFor="remind-offset"
            className="text-sm font-medium"
          >
            Remind before events
          </label>
          <select
            id="remind-offset"
            value={remind.remind_offset_min}
            onChange={(e) =>
              void patch("remind_offset_min", Number(e.target.value))
            }
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
          >
            {optionsFor(OFFSETS, remind.remind_offset_min).map((v) => (
              <option key={v} value={v}>
                {v === 0 ? "At start" : `${v} min ahead`}
              </option>
            ))}
          </select>
        </li>
        <li className="flex items-center justify-between gap-3 py-2.5">
          <label htmlFor="remind-day" className="text-sm font-medium">
            Morning reminder at
          </label>
          <select
            id="remind-day"
            value={remind.remind_day_min}
            onChange={(e) => void patch("remind_day_min", Number(e.target.value))}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
          >
            {optionsFor(DAY_TIMES, remind.remind_day_min).map((v) => (
              <option key={v} value={v}>
                {hhmm(v)}
              </option>
            ))}
          </select>
        </li>
      </ul>
    </section>
  );
}
