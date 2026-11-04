// Shared domain types (mirror the Supabase schema in supabase/schema.sql).

export type CompletionStatus = "check" | "no_check" | "exempt";

export const STATUS_VALUES: CompletionStatus[] = ["check", "no_check", "exempt"];

export interface User {
  id: string;
  name: string;
  created_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
}

export interface TaskNote {
  id: string;
  task_id: string;
  date: string; // YYYY-MM-DD
  note: string;
}

export interface TaskCompletion {
  id: string;
  task_id: string;
  date: string; // YYYY-MM-DD
  status: CompletionStatus;
}

/** Per-user notification settings (user_settings row; missing row = defaults). */
export interface UserSettings {
  notify_11: boolean;
  notify_17: boolean;
  notify_21: boolean;
  /** Morning summary of dated todos (fires at remind_day_min local). */
  remind_todos: boolean;
  /** Per-event reminders: minutes before timed starts, morning for all-day. */
  remind_events: boolean;
  /** Minutes before a timed event's start (0 = at start). */
  remind_offset_min: number;
  /** Morning time for todos + all-day events, minutes from midnight. */
  remind_day_min: number;
  timezone: string | null; // IANA name, e.g. "America/New_York"
}

/** One browser/device push subscription (push_subscriptions row). */
export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** One external-API key (api_keys row). The secret itself is never stored. */
export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
