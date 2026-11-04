-- ===========================================================================
-- Calendar & todo reminders — settings columns + dedupe log.
-- Run once in the Supabase SQL editor. Idempotent: safe to re-run.
--
-- RUN THIS BEFORE DEPLOYING the reminders code: /api/settings selects these
-- columns explicitly, so the settings page 500s until they exist.
--
-- Re-running over an earlier reminders version is fine: it widens the offset
-- range to a full day, snaps sub-hour offsets up to the new 1-hour default,
-- and adds the remind_day_enabled morning switch (default on — nobody who
-- gets the morning ping today loses it). The scheduler stays hourly — if the
-- job currently runs every 5 minutes, re-run supabase/cron.sql to reschedule.
-- ===========================================================================

-- Reminder switches + timing, per user (same row style as notify_11/17/21).
alter table public.user_settings add column if not exists remind_todos       boolean not null default false;
alter table public.user_settings add column if not exists remind_events      boolean not null default false;
alter table public.user_settings add column if not exists remind_offset_min  integer not null default 60;   -- minutes before a timed event starts (1 h / 3 h / 1 day)
alter table public.user_settings add column if not exists remind_day_enabled boolean not null default true;  -- master switch for the morning ping (todos + all-day events)
alter table public.user_settings add column if not exists remind_day_min     integer not null default 540;   -- morning time for todos + all-day events (minutes from midnight)
alter table public.user_settings alter column remind_offset_min set default 60;

-- Offsets are 1 h / 3 h / 1 day, so the v1 range (0–360) widens to a full
-- day. Drop-then-add: adding won't replace an existing v1 constraint of the
-- same name. Postgres has no "add constraint if not exists" either, hence
-- the duplicate_object swallow — same pattern schema.sql uses elsewhere.
alter table public.user_settings drop constraint if exists user_settings_remind_offset_min_check;
do $$ begin
  alter table public.user_settings
    add constraint user_settings_remind_offset_min_check
    check (remind_offset_min between 0 and 1440);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.user_settings
    add constraint user_settings_remind_day_min_check
    check (remind_day_min between 0 and 1439);
exception when duplicate_object then null; end $$;

-- v1 offered minute-level offsets; anything finer than the new 1-hour
-- preset snaps up to it.
update public.user_settings set remind_offset_min = 60 where remind_offset_min < 60;

-- Item-reminder dedupe (push_log can't be reused: CHECK (hour in (11,17,21))).
-- One row per (user, dedupe_key); keys are "todos@YYYY-MM-DD" and
-- "event:<uuid>@YYYY-MM-DD" (the ITEM's local date — with a 1-day offset the
-- send itself happens the day before). `date` exists only so retention
-- cleanup can do `date < cutoff` without parsing the key.
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
