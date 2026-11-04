"use client";

import { useState } from "react";
import type { UserSettings } from "@/lib/types";
import { Switch } from "./Switch";

const SLOTS = [
  { key: "notify_11" as const, label: "11:00 AM", title: "Midday check-in" },
  { key: "notify_17" as const, label: "5:00 PM", title: "Late-afternoon reminder" },
  { key: "notify_21" as const, label: "9:00 PM", title: "Last call" },
];

const OFFSETS = [60, 180, 1440];
const OFFSET_LABELS: Record<number, string> = {
  60: "1 hour ahead",
  180: "3 hours ahead",
  1440: "1 day ahead",
};
// Morning time for todos + all-day events, on the hour — the scheduler ticks
// hourly, so a :30 choice would silently land at the next hour anyway.
const DAY_TIMES = Array.from({ length: 24 }, (_, i) => i * 60);

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
 * All notification timing in one card: the fixed daily check-ins plus the
 * calendar & todo reminders, all sent through the same push flow. Edits are
 * optimistic and revert if the save fails.
 */
export function NotificationSettings({
  settings,
  onPatch,
}: {
  settings: UserSettings;
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [state, setState] = useState({
    notify_11: settings.notify_11,
    notify_17: settings.notify_17,
    notify_21: settings.notify_21,
    remind_todos: settings.remind_todos,
    remind_events: settings.remind_events,
    remind_offset_min: settings.remind_offset_min,
    remind_day_min: settings.remind_day_min,
  });

  async function patch<K extends keyof typeof state>(
    key: K,
    value: (typeof state)[K],
  ) {
    const prev = state;
    setState({ ...state, [key]: value });
    const ok = await onPatch({ [key]: value });
    if (!ok) setState(prev);
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
      <h2 className="text-base font-semibold">Reminders</h2>
      <p className="mb-3 text-sm text-[var(--muted)]">
        Sent in your local timezone
        {settings.timezone ? ` (${settings.timezone})` : ""}.
      </p>
      <ul className="divide-y divide-[var(--border)]">
        <li className="pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Daily check-ins
        </li>
        {SLOTS.map((s) => (
          <li key={s.key} className="flex items-center justify-between py-2.5">
            <div>
              <span className="text-sm font-medium">{s.label}</span>
              <span className="ml-2 text-xs text-[var(--muted)]">
                {s.title}
              </span>
            </div>
            <Switch
              checked={state[s.key]}
              label={`${s.label} reminder`}
              onClick={() => void patch(s.key, !state[s.key])}
            />
          </li>
        ))}
        <li className="pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Calendar &amp; todos
        </li>
        <li className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-medium">Todos</div>
            <div className="text-xs text-[var(--muted)]">
              Morning summary of todos due today
            </div>
          </div>
          <Switch
            checked={state.remind_todos}
            label="Todo reminders"
            onClick={() => void patch("remind_todos", !state.remind_todos)}
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
            checked={state.remind_events}
            label="Event reminders"
            onClick={() => void patch("remind_events", !state.remind_events)}
          />
        </li>
        <li className="flex items-center justify-between gap-3 py-2.5">
          <label htmlFor="remind-offset" className="text-sm font-medium">
            Remind before events
          </label>
          <select
            id="remind-offset"
            value={state.remind_offset_min}
            onChange={(e) =>
              void patch("remind_offset_min", Number(e.target.value))
            }
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
          >
            {optionsFor(OFFSETS, state.remind_offset_min).map((v) => (
              <option key={v} value={v}>
                {OFFSET_LABELS[v] ??
                  (v % 60 === 0 ? `${v / 60} hours ahead` : `${v} min ahead`)}
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
            value={state.remind_day_min}
            onChange={(e) =>
              void patch("remind_day_min", Number(e.target.value))
            }
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
          >
            {optionsFor(DAY_TIMES, state.remind_day_min).map((v) => (
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
