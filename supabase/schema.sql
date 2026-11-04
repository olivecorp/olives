-- ===========================================================================
-- Olives — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard > SQL > New query).
-- It is idempotent: safe to re-run.
-- ===========================================================================

-- Required extension for gen_random_uuid() (enabled by default on Supabase).
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Status enum for daily task completions
--   check     = task completed that day
--   no_check  = task not completed (also the implicit default when no row exists)
--   exempt    = user on vacation/ill — excluded from the completion denominator
-- ---------------------------------------------------------------------------
do $$ begin
  create type task_status as enum ('check', 'no_check', 'exempt');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- users: a named person (e.g. "Oliver"). name is unique.
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- tasks: a recurring task owned by one user (e.g. "do posture exercises").
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  title      text not null,
  created_at timestamptz not null default now()
);

-- Notes moved to per-task-per-day (task_notes). Drop the old per-task column if
-- a previous migration added it. Idempotent.
alter table public.tasks drop column if exists notes;

create index if not exists tasks_user_id_idx on public.tasks(user_id);

-- ---------------------------------------------------------------------------
-- task_notes: a free-text note for one task on one day (independent of status).
-- ---------------------------------------------------------------------------
create table if not exists public.task_notes (
  id      uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  date    date not null,
  note    text not null default '',
  constraint task_notes_task_date_key unique (task_id, date)
);

create index if not exists task_notes_task_id_idx on public.task_notes(task_id);

-- ---------------------------------------------------------------------------
-- task_completions: the status of one task on one calendar day.
-- UNIQUE(task_id, date) guarantees at most one status per task per day.
-- A missing row is treated as "no data" by the application (neutral, excluded
-- from the score), distinct from an explicit 'no_check'.
-- ---------------------------------------------------------------------------
create table if not exists public.task_completions (
  id      uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  date    date not null,
  status  task_status not null default 'no_check',
  constraint task_completions_task_date_key unique (task_id, date)
);

create index if not exists task_completions_date_idx       on public.task_completions(date);
create index if not exists task_completions_task_id_idx    on public.task_completions(task_id);

-- ===========================================================================
-- Row Level Security
--
-- Auth model: accounts live in the APP_USERS env var (administrator-managed)
-- and gate the whole site via an iron-session cookie. The browser only ever
-- talks to our own /api routes (server-side), which use the SERVICE ROLE key
-- and therefore BYPASS RLS. The anon key is public, so we enable RLS and
-- intentionally add NO permissive policies — that way the public anon key
-- cannot read or write any data directly; only the server can.
--
-- If you later want direct browser access via the anon client, add explicit
-- policies here. By default: locked down.
-- ===========================================================================
alter table public.users             enable row level security;
alter table public.tasks             enable row level security;
alter table public.task_completions  enable row level security;
alter table public.task_notes        enable row level security;

-- ---------------------------------------------------------------------------
-- Helpful upsert function used by the API: set a task's status for a date,
-- inserting the row if it does not exist. (Equivalent to a Rust/JS upsert on
-- the (task_id, date) conflict, kept here for convenience / direct SQL use.)
-- ---------------------------------------------------------------------------
create or replace function public.set_completion(
  p_task_id uuid,
  p_date    date,
  p_status  task_status
) returns public.task_completions as $$
  insert into public.task_completions (task_id, date, status)
  values (p_task_id, p_date, p_status)
  on conflict (task_id, date) do update
    set status = excluded.status
  returning *;
$$ language sql;

-- ===========================================================================
-- Per-user settings + web push
--
-- These tables store each user's notification preferences and their
-- browser/device push subscriptions. Rows are created lazily — a missing
-- user_settings row simply means "all notifications off".
-- ===========================================================================

-- user_settings: one row per user (created on first change in /settings).
create table if not exists public.user_settings (
  user_id           uuid primary key references public.users(id) on delete cascade,
  notify_11         boolean not null default false,
  notify_17         boolean not null default false,
  notify_21         boolean not null default false,
  remind_todos       boolean not null default false,  -- morning summary of dated todos
  remind_events      boolean not null default false,  -- per-event reminders (timed + all-day)
  remind_offset_min  integer not null default 60,     -- minutes before a timed event starts (1 h / 3 h / 1 day)
  remind_day_enabled boolean not null default true,   -- master switch for the morning ping (todos + all-day events)
  remind_day_min     integer not null default 540,    -- morning time for day items (minutes from midnight)
  timezone          text,                            -- IANA name, validated server-side
  updated_at        timestamptz not null default now(),
  constraint user_settings_remind_offset_min_check check (remind_offset_min between 0 and 1440),
  constraint user_settings_remind_day_min_check    check (remind_day_min between 0 and 1439)
);

-- The same columns for databases created before reminders existed
-- (supabase/reminders.sql runs these too; kept here so a fresh + an old
-- install converge on the same shape).
alter table public.user_settings add column if not exists remind_todos       boolean not null default false;
alter table public.user_settings add column if not exists remind_events      boolean not null default false;
alter table public.user_settings add column if not exists remind_offset_min  integer not null default 60;
alter table public.user_settings add column if not exists remind_day_enabled boolean not null default true;
alter table public.user_settings add column if not exists remind_day_min     integer not null default 540;
alter table public.user_settings alter column remind_offset_min set default 60;

-- Drop-then-add so an early "0–360" constraint is replaced, not skipped.
alter table public.user_settings drop constraint if exists user_settings_remind_offset_min_check;
do $$ begin
  alter table public.user_settings
    add constraint user_settings_remind_offset_min_check
    check (remind_offset_min between 0 and 1440);
exception when duplicate_object then null; end $$;

-- The first reminders version offered minute-level offsets; anything finer
-- than the 1-hour preset snaps up to it.
update public.user_settings set remind_offset_min = 60 where remind_offset_min < 60;

do $$ begin
  alter table public.user_settings
    add constraint user_settings_remind_day_min_check
    check (remind_day_min between 0 and 1439);
exception when duplicate_object then null; end $$;

-- push_subscriptions: one row per browser/device subscription.
-- UNIQUE(endpoint) + upsert-on-conflict ⇒ re-subscribing while logged in as
-- someone else reassigns the browser to the newly logged-in user.
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

-- push_log: notification dedupe. The hourly scheduler fires each slot when a
-- user's local time has *just passed* it; UNIQUE(user_id, date, hour) makes
-- "insert on conflict do nothing" a once-per-slot claim across overlapping
-- scheduler runs.
create table if not exists public.push_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  date       date not null,
  hour       smallint not null check (hour in (11, 17, 21)),
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint push_log_user_date_hour_key unique (user_id, date, hour)
);
create index if not exists push_log_user_date_idx on public.push_log(user_id, date);

-- reminder_log: item-reminder dedupe (push_log can't be reused: its CHECK
-- pins hour to the 11/17/21 slots). One row per (user, dedupe_key); keys are
-- "todos@YYYY-MM-DD" and "event:<uuid>@YYYY-MM-DD" in the user's LOCAL date.
-- `date` exists only so retention cleanup can do `date < cutoff` without
-- parsing the key.
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

alter table public.user_settings      enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_log           enable row level security;
alter table public.reminder_log       enable row level security;
