-- ===========================================================================
-- Calendar & todo reminders — settings columns + dedupe log.
-- Run once in the Supabase SQL editor. Idempotent: safe to re-run.
--
-- RUN THIS BEFORE DEPLOYING the reminders code: /api/settings selects these
-- columns explicitly, so the settings page 500s until they exist.
--
-- Afterwards re-run supabase/cron.sql to move the olives-notify scheduler
-- from hourly to every 5 minutes (minutes-before reminders need the finer
-- tick).
-- ===========================================================================

-- Reminder switches + timing, per user (same row style as notify_11/17/21).
alter table public.user_settings add column if not exists remind_todos      boolean not null default false;
alter table public.user_settings add column if not exists remind_events     boolean not null default false;
alter table public.user_settings add column if not exists remind_offset_min integer not null default 10;   -- minutes before a timed event starts (0 = at start)
alter table public.user_settings add column if not exists remind_day_min    integer not null default 540;   -- morning time for todos + all-day events (minutes from midnight)

-- Range guards (mirror the PATCH route validation). Postgres has no
-- "add constraint if not exists", hence the duplicate_object swallow —
-- same pattern schema.sql uses for the task_status enum.
do $$ begin
  alter table public.user_settings
    add constraint user_settings_remind_offset_min_check
    check (remind_offset_min between 0 and 360);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.user_settings
    add constraint user_settings_remind_day_min_check
    check (remind_day_min between 0 and 1439);
exception when duplicate_object then null; end $$;

-- Item-reminder dedupe (push_log can't be reused: CHECK (hour in (11,17,21))).
-- One row per (user, dedupe_key); keys are "todos@YYYY-MM-DD" and
-- "event:<uuid>@YYYY-MM-DD" in the user's LOCAL date. `date` exists only so
-- retention cleanup can do `date < cutoff` without parsing the key.
create table if not exists public.reminder_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  dedupe_key text not null,
  date       date not null,
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint reminder_log_user_dedupe_key unique (user_id, dedupe_key)
);
create index if not exists reminder_log_user_date_idx on public.reminder_log(user_id, date);

alter table public.reminder_log enable row level security;
