"use client";

import { useEffect, useState } from "react";
import type { UserSettings } from "@/lib/types";
import { ApiKeys } from "@/components/settings/ApiKeys";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { PushSettings } from "@/components/settings/PushSettings";

interface SettingsData {
  user: { id: string; name: string; username: string | null };
  settings: UserSettings;
  subscriptionCount: number;
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/settings");
    if (!res.ok) {
      setError("Couldn't load settings.");
      return;
    }
    setData((await res.json()) as SettingsData);
  }

  useEffect(() => {
    void load();
  }, []);

  // Report this device's timezone whenever it differs from the stored one so
  // notification times follow the user (e.g. after traveling).
  useEffect(() => {
    if (!data) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== data.settings.timezone) {
      void patchSettings({ timezone: tz });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.settings.timezone]);

  async function patchSettings(patch: Record<string, unknown>) {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setError("Couldn't save settings.");
      return false;
    }
    const { settings } = (await res.json()) as { settings: UserSettings };
    setData((cur) => (cur ? { ...cur, settings } : cur));
    return true;
  }

  if (error && !data) {
    return <p className="text-sm text-[var(--color-nocheck)]">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <span className="text-sm text-[var(--muted)]">
          · signed in as {data.user.name}
          {data.user.username ? ` (@${data.user.username})` : ""}
        </span>
      </div>
      {error && (
        <p className="text-sm text-[var(--color-nocheck)]">{error}</p>
      )}

      <NotificationSettings
        settings={data.settings}
        onPatch={patchSettings}
      />

      <PushSettings
        subscriptionCount={data.subscriptionCount}
        onChanged={load}
      />

      <ApiKeys />

      <p className="text-xs text-[var(--muted)]">
        Accounts are managed by the administrator — usernames and passwords are
        configured server-side and can&rsquo;t be changed here.
      </p>
    </div>
  );
}
