"use client";

import { useState } from "react";
import type { UserSettings } from "@/lib/types";
import { Switch } from "./Switch";

const SLOTS = [
  { key: "notify_11" as const, label: "11:00 AM", title: "Midday check-in" },
  { key: "notify_17" as const, label: "5:00 PM", title: "Late-afternoon reminder" },
  { key: "notify_21" as const, label: "9:00 PM", title: "Last call" },
];

export function NotificationSettings({
  settings,
  onPatch,
}: {
  settings: UserSettings;
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  // Optimistic toggle state; revert if the save fails.
  const [slots, setSlots] = useState({
    notify_11: settings.notify_11,
    notify_17: settings.notify_17,
    notify_21: settings.notify_21,
  });

  async function toggle(key: keyof typeof slots) {
    const next = { ...slots, [key]: !slots[key] };
    setSlots(next);
    const ok = await onPatch({ [key]: next[key] });
    if (!ok) setSlots(slots);
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
      <h2 className="text-base font-semibold">Daily reminders</h2>
      <p className="mb-3 text-sm text-[var(--muted)]">
        Sent at these times in your local timezone
        {settings.timezone ? ` (${settings.timezone})` : ""}.
      </p>
      <ul className="divide-y divide-[var(--border)]">
        {SLOTS.map((s) => (
          <li key={s.key} className="flex items-center justify-between py-2.5">
            <div>
              <span className="text-sm font-medium">{s.label}</span>
              <span className="ml-2 text-xs text-[var(--muted)]">
                {s.title}
              </span>
            </div>
            <Switch
              checked={slots[s.key]}
              label={`${s.label} reminder`}
              onClick={() => toggle(s.key)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
