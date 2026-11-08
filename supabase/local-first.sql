-- ===========================================================================
-- Productivity sections (Todos / Calendar / Notes) — local-first sync tables.
-- Run this in the Supabase SQL editor (Dashboard > SQL > New query).
-- It is idempotent: safe to re-run.
--
-- Clock conventions (important):
--   created_at / updated_at  CLIENT clock, ms epoch (bigint). updated_at is
--                            the last-write-wins arbiter — a row is only
--                            overwritten by a strictly newer updated_at.
--   synced_at                SERVER clock (timestamptz). The pull cursor
--                            high-water mark — never trust client clocks
--                            for cursors.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- todos: one to-do item. blocker_id points at another todo this one depends
-- on (single blocker ⇒ dependency tree). Deliberately NO foreign key on
-- blocker_id: last-write-wins rows can arrive in any order across devices,
-- so references are resolved client-side (missing/deleted ref ⇒ "no blocker").
-- blocker_text is the free-text alternative: a blocker that isn't a todo
-- ("waiting on the visa"). Exactly one of the two is ever set; a text
-- blocker unblocks only when cleared manually (nothing to complete).
-- priority is a UI tag: 'high' pins the todo above Current's date buckets,
-- 'low' parks it in the Low priority section, 'external' (the tag every
-- /api/v1/external/todos add carries) pins above High.
-- ---------------------------------------------------------------------------
create table if not exists public.todos (
  id           uuid primary key,
  user_id      uuid not null references public.users(id) on delete cascade,
  text         text not null default '',
  completed    boolean not null default false,
  completed_at bigint,
  date         date,
  blocker_id   uuid,
  blocker_text text,
  priority     text,                          -- 'high' | 'low' | 'external' | null
  sort_order   double precision not null default 0,
  created_at   bigint not null,
  updated_at   bigint not null,
  deleted      boolean not null default false,
  synced_at    timestamptz not null default now()
);
-- The alters cover databases created before blocker_text/priority existed.
alter table public.todos add column if not exists blocker_text text;
alter table public.todos add column if not exists priority text;
create index if not exists todos_user_synced_idx on public.todos(user_id, synced_at);

-- ---------------------------------------------------------------------------
-- events: single-day calendar events. source/external_id future-proof the
-- table for Gmail / WhatsApp / Instagram importers (out of scope for now):
-- one row per (user, source, external id) is enforced below so importers get
-- server-side dedup for free.
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id           uuid primary key,
  user_id      uuid not null references public.users(id) on delete cascade,
  title        text not null default '',
  description  text not null default '',
  date         date not null,
  all_day      boolean not null default false,
  start_min    integer,                    -- minutes from midnight, null when all_day
  end_min      integer,
  location     text,
  source       text not null default 'manual',
  external_id  text,
  created_at   bigint not null,
  updated_at   bigint not null,
  deleted      boolean not null default false,
  synced_at    timestamptz not null default now()
);
create index if not exists events_user_synced_idx on public.events(user_id, synced_at);
create unique index if not exists events_source_external_idx
  on public.events(user_id, source, external_id) where external_id is not null;

-- ---------------------------------------------------------------------------
-- folders: note groupings, nested via parent_id (a null parent = top level).
-- No FK from notes.folder_id or folders.parent_id (see todos.blocker_id) —
-- references resolve client-side so LWW rows can arrive in any order.
-- The alter covers databases created before parent_id existed.
-- ---------------------------------------------------------------------------
create table if not exists public.folders (
  id         uuid primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  name       text not null default '',
  parent_id  uuid,
  sort_order double precision not null default 0,
  created_at bigint not null,
  updated_at bigint not null,
  deleted    boolean not null default false,
  synced_at  timestamptz not null default now()
);
alter table public.folders add column if not exists parent_id uuid;
create index if not exists folders_user_synced_idx on public.folders(user_id, synced_at);
create index if not exists folders_user_parent_idx on public.folders(user_id, parent_id);

-- ---------------------------------------------------------------------------
-- notes: rich-text notes (content = Tiptap JSON document, stored as jsonb).
-- sort_order is the manual position within a folder section (0 = by recency),
-- section-scoped like todos.sort_order.
-- ---------------------------------------------------------------------------
create table if not exists public.notes (
  id         uuid primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  folder_id  uuid,
  title      text not null default '',
  content    jsonb not null default '{}'::jsonb,
  date       date,
  sort_order double precision not null default 0,
  created_at bigint not null,
  updated_at bigint not null,
  deleted    boolean not null default false,
  synced_at  timestamptz not null default now()
);
-- The alter covers databases created before sort_order existed.
alter table public.notes add column if not exists sort_order double precision not null default 0;
create index if not exists notes_user_synced_idx on public.notes(user_id, synced_at);

-- ===========================================================================
-- Row Level Security — same model as schema.sql: the browser only ever talks
-- to our own /api routes (service role, bypasses RLS); the public anon key
-- must be able to do nothing. Locked down by default.
-- ===========================================================================
alter table public.todos   enable row level security;
alter table public.events  enable row level security;
alter table public.folders enable row level security;
alter table public.notes   enable row level security;

-- ---------------------------------------------------------------------------
-- LWW push. One transaction; folders first (notes reference them), then the
-- rest. A row is applied only when the incoming client updated_at is STRICTLY
-- newer than the stored one (`where excluded.updated_at > t.updated_at` —
-- supabase-js upsert() cannot express a conditional update, hence the RPC).
-- The client-supplied userId is IGNORED — p_user_id (the session user) wins.
-- JSON keys are camelCase, matching the client record shape exactly.
-- ---------------------------------------------------------------------------
create or replace function public.sync_push_records(
  p_user_id uuid,
  p_todos   jsonb default '[]'::jsonb,
  p_events  jsonb default '[]'::jsonb,
  p_notes   jsonb default '[]'::jsonb,
  p_folders jsonb default '[]'::jsonb
) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  for r in select * from jsonb_array_elements(p_folders) loop
    insert into public.folders (id, user_id, name, parent_id, sort_order, created_at, updated_at, deleted)
    values ((r->>'id')::uuid, p_user_id, coalesce(r->>'name',''),
            nullif(r->>'parentId','')::uuid,
            coalesce((r->>'sortOrder')::double precision, 0),
            (r->>'createdAt')::bigint, (r->>'updatedAt')::bigint,
            coalesce((r->>'deleted')::boolean, false))
    on conflict (id) do update
      set name = excluded.name, parent_id = excluded.parent_id,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at, deleted = excluded.deleted,
          synced_at = now()
      where excluded.updated_at > folders.updated_at;
  end loop;

  for r in select * from jsonb_array_elements(p_todos) loop
    insert into public.todos (id, user_id, text, completed, completed_at, date, blocker_id,
                              blocker_text, priority, sort_order, created_at, updated_at, deleted)
    values ((r->>'id')::uuid, p_user_id, coalesce(r->>'text',''),
            coalesce((r->>'completed')::boolean, false),
            (r->>'completedAt')::bigint,
            nullif(r->>'date','')::date,
            nullif(r->>'blockerId','')::uuid,
            nullif(r->>'blockerText',''),
            case when r->>'priority' in ('high','low','external') then r->>'priority' end,
            coalesce((r->>'sortOrder')::double precision, 0),
            (r->>'createdAt')::bigint, (r->>'updatedAt')::bigint,
            coalesce((r->>'deleted')::boolean, false))
    on conflict (id) do update
      set text = excluded.text, completed = excluded.completed,
          completed_at = excluded.completed_at, date = excluded.date,
          blocker_id = excluded.blocker_id, sort_order = excluded.sort_order,
          -- Key-presence guard: a push from a pre-blockerText client (whose
          -- rows never carried the key) must not wipe an existing text
          -- blocker, while a push that DOES carry the key may null it out.
          blocker_text = case when r ? 'blockerText'
                              then excluded.blocker_text else todos.blocker_text end,
          -- Same guard for priority (pre-priority clients).
          priority = case when r ? 'priority'
                           then excluded.priority else todos.priority end,
          updated_at = excluded.updated_at, deleted = excluded.deleted,
          synced_at = now()
      where excluded.updated_at > todos.updated_at;
  end loop;

  for r in select * from jsonb_array_elements(p_events) loop
    insert into public.events (id, user_id, title, description, date, all_day, start_min,
                               end_min, location, source, external_id,
                               created_at, updated_at, deleted)
    values ((r->>'id')::uuid, p_user_id, coalesce(r->>'title',''), coalesce(r->>'description',''),
            nullif(r->>'date','')::date,
            coalesce((r->>'allDay')::boolean, false),
            (r->>'startMin')::int, (r->>'endMin')::int,
            nullif(r->>'location',''),
            coalesce(r->>'source','manual'), nullif(r->>'externalId',''),
            (r->>'createdAt')::bigint, (r->>'updatedAt')::bigint,
            coalesce((r->>'deleted')::boolean, false))
    on conflict (id) do update
      set title = excluded.title, description = excluded.description,
          date = excluded.date, all_day = excluded.all_day,
          start_min = excluded.start_min, end_min = excluded.end_min,
          location = excluded.location, source = excluded.source,
          external_id = excluded.external_id,
          updated_at = excluded.updated_at, deleted = excluded.deleted,
          synced_at = now()
      where excluded.updated_at > events.updated_at;
  end loop;

  for r in select * from jsonb_array_elements(p_notes) loop
    insert into public.notes (id, user_id, folder_id, title, content, date, sort_order,
                              created_at, updated_at, deleted)
    values ((r->>'id')::uuid, p_user_id, nullif(r->>'folderId','')::uuid,
            coalesce(r->>'title',''), coalesce(r->'content', '{}'::jsonb),
            nullif(r->>'date','')::date,
            coalesce((r->>'sortOrder')::double precision, 0),
            (r->>'createdAt')::bigint, (r->>'updatedAt')::bigint,
            coalesce((r->>'deleted')::boolean, false))
    on conflict (id) do update
      set folder_id = excluded.folder_id, title = excluded.title,
          content = excluded.content, date = excluded.date,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at, deleted = excluded.deleted,
          synced_at = now()
      where excluded.updated_at > notes.updated_at;
  end loop;

  return jsonb_build_object('ok', true);
end $$;

-- PostgREST exposes public functions to the anon role by default. Lock it
-- down (the browser only ever calls /api/sync/* via the service role).
revoke execute on function public.sync_push_records(uuid, jsonb, jsonb, jsonb, jsonb)
  from anon, authenticated;
