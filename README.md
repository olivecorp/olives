# Olives

A multi-user **personal productivity app** — todos, calendar, notes, and a
daily tracker with weekly / monthly / yearly summaries. Each person signs in
with their own username/password (accounts are admin-managed via an
environment variable), and optional push reminders: daily check-ins and
reminders for calendar todos/events.

Built with **Next.js (App Router) · TypeScript · Tailwind CSS · iron-session ·
Supabase · date-fns · Web Push**.

---

## Quick start

### 1. Install & configure env

```bash
npm install
cp .env.example .env.local   # then fill in real values
```

`.env.local` variables (never commit this file):

| Var | Purpose |
| --- | --- |
| `APP_USERS` | JSON array of accounts: `[{"username":"oliver","password":"…","name":"Oliver"}]`. The `name` maps to the user's row in the DB (created automatically on first login). |
| `SESSION_SECRET` | ≥32 chars; encrypts the iron-session cookie (`openssl rand -hex 32`). |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (browser-safe). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key (browser-safe). |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service-role** key (SERVER ONLY — never expose). |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keys (`npx web-push generate-vapid-keys`). |
| `VAPID_SUBJECT` | Contact for push services, e.g. `mailto:you@example.com`. |
| `CRON_SECRET` | Shared secret the notification scheduler sends to `/api/cron/notify` (`openssl rand -hex 32`). |

### 2. Create the database schema

Open your Supabase project → **SQL Editor → New query**, paste the contents of
[`supabase/schema.sql`](supabase/schema.sql), and **Run**. It is idempotent
(safe to re-run). This creates `users`, `tasks`, `task_completions`,
`task_notes`, `user_settings`, `push_subscriptions`, `push_log`,
`reminder_log`, enables RLS
(no public policies — only the server, via the service-role key, can read or
write), and adds a `set_completion()` helper.

If the project predates calendar/todo reminders, also run
[`supabase/reminders.sql`](supabase/reminders.sql) — it adds the reminder
settings columns and the `reminder_log` dedupe table. Re-running it after an
earlier reminders version is safe: it widens the offset range to a full day
and snaps sub-hour offsets up to 1 hour.

### 3. Run

```bash
npm run dev
```

Open http://localhost:3000 → you're redirected to `/login`. Sign in with an
account from `APP_USERS`.

---

## How it works

### Accounts & auth

- Accounts live in **`APP_USERS`** (admin-managed — edit it in Vercel →
  Settings → Environment Variables, then redeploy). Adding or changing a
  password is a config change; there is no in-app account management.
- **Reads are filtered to `APP_USERS`**: only accounts present in the env
  var are shown anywhere (dashboard, summaries, user list) — one row per
  account, provisioned automatically if missing, in configured order. A
  person with no tasks yet shows a blank slate (and can add tasks when
  logged in as the matching account). Removing an account hides their data
  everywhere but **deletes nothing** — the rows stay in Supabase. To
  permanently delete a user and their details, run a manual SQL delete (the
  FKs cascade), e.g. in the Supabase SQL editor:
  `delete from users where name = 'Anna';`
- [`middleware.ts`](middleware.ts) gates every route (API routes get `401`
  JSON; pages redirect to `/login`) except `/login`, `/api/login`,
  `/api/logout`, and `/api/cron/*` (which authenticates with `CRON_SECRET`).

### Data model

- **`users`** — `{ id, name (unique), created_at }` (one row per person)
- **`tasks`** — `{ id, user_id→users, title, created_at }` (recurring task owned by a user)
- **`task_completions`** — `{ id, task_id→tasks, date (YYYY-MM-DD), status }`
  with `UNIQUE(task_id, date)`. `status` ∈ `check | no_check | exempt`.
  **A missing row = no data** (excluded from the score).
- **`task_notes`** — a free-text note per task per day.
- **`user_settings`** — per-user notification toggles + timezone (daily slots,
  calendar/todo reminder switches and timing).
- **`push_subscriptions`** — one row per device/browser (Web Push).
- **`push_log`** — dedupe table so each daily slot fires exactly once.
- **`reminder_log`** — dedupe table so each item reminder fires exactly once
  (`todos@<date>` / `event:<id>@<event's date>` per user).

### Scoring (blanks stay blank; averages count them as missed)

Handled centrally in [`lib/scoring.ts`](lib/scoring.ts). A missing row is
**never written over** — the 3-way toggle only ever sets what you clicked:

- An untouched day (or exempt-only) is **no data** (—).
- Once a user has graded *anything* on a day (a check or an explicit miss),
  their remaining blanks **count as missed in averages only**. Per user, per
  day.
- Exempt is always excluded from the denominator.

So "1 checked, 1 blank, 1 exempt" = 1/2 = **50%**; "all blank" = **—**.

### Ownership

Each user can only mutate **their own** tasks, completions, and notes (enforced
server-side in every mutation route — other users' task ids return 404). On the
Daily page your card sorts first and is the only editable one; everyone else is
read-only (status glyph instead of the toggle). Users are never deleted
in-app — accounts live entirely in `APP_USERS`.

### Push notifications

One flow, two engines. Each user toggles **11:00 / 17:00 / 21:00** daily
check-ins and **calendar & todo reminders** (todos, events, a 1 h / 3 h / 1 day
lead time for timed events, and the morning time for day items) together in
**/settings** (all times are in their own timezone — the browser reports it
automatically). Delivery:

1. A **pg_cron** job in Supabase ([`supabase/cron.sql`](supabase/cron.sql),
   run it once in the SQL editor) pings `/api/cron/notify` with `CRON_SECRET`
   hourly.
2. The route computes each user's local time and runs two engines:
   - **Daily slots**: anyone who has **just passed** an enabled slot (within
     the last 60 minutes) gets the check-in. `push_log` guarantees one send
     per user per day per slot.
   - **Item reminders**, computed from the server-side mirror of the
     local-first tables: one morning summary of dated todos plus all-day
     events (fires any time in the 2 hours after the morning time), and one
     reminder per timed event — 1 hour, 3 hours, or 1 day before the start
     (the 1-day one lands the previous day). Each reminder is delivered
     within a 60-minute window, which the hourly tick always lands inside;
     since the smallest lead is an hour, delivery always precedes the start.
     A reminder missed for longer than its window is dropped, never
     delivered long after the fact. `reminder_log`
     (`todos@<date>` / `event:<id>@<event's date>`) guarantees exactly-once.
3. Nothing is claimed while the user has no subscribed device, so enabling
   reminders and subscribing afterwards still delivers within the window.
4. On iPhone/iPad, notifications require the app to be **installed to the Home
   Screen** (Share → Add to Home Screen) — the Settings page explains this.

### Architecture

- **Data access:** all DB calls are server-side through
  [`lib/db.ts`](lib/db.ts) (service-role client, bypasses RLS). The browser
  client ([`lib/supabase.ts`](lib/supabase.ts)) is RLS-locked and unused for data.
- **Mutations** go through route handlers under `app/api/` with optimistic UI
  ([`lib/swr-mutations.ts`](lib/swr-mutations.ts) — the frontend cache is the
  source of truth for the session; saves are debounced and only reconciled on
  failure).

### Pages

| Route | Purpose |
| --- | --- |
| `/login` | Per-account sign-in. |
| `/` (Daily) | Edit any day; 3-way toggles; notes; add/rename/delete **your** tasks (others read-only, your card first). |
| `/week` | Task × 7-day matrix (`?mode=rolling` last-7 vs `calendar` Mon–Sun). |
| `/month` | Calendar density grid with per-user dots (`rolling` 30 vs calendar month). |
| `/year` | Concentric-rings SVG heatmap (`Q` toggles a quarter-quadrant view). |
| `/settings` | Notification toggles + subscribe/unsubscribe-all/test push. |

All summary pages support `?date=YYYY-MM-DD` (and `?mode=`) deep-links.

---

## Scripts

```bash
npm run dev     # local dev
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
```

---

## Deploy to Vercel

1. Push this folder to a Git repository (GitHub/GitLab/Bitbucket).
2. Import the repo in Vercel.
3. Add all the env vars above in **Project → Settings → Environment
   Variables** and deploy. Ensure the Supabase schema has been run.
4. In the Supabase SQL editor, run [`supabase/cron.sql`](supabase/cron.sql)
   with your real `CRON_SECRET` (and production URL) to schedule the hourly
   notification tick. Verify with `select * from cron.job;`
   and `select * from net._http_response order by id desc limit 5;`.

### Managing accounts

- **Add a person:** append `{username, password, name}` to `APP_USERS` in
  Vercel → redeploy. Their card appears immediately (the row is provisioned
  on first read) with a blank slate; they add their own tasks when logged in.
- **Remove a person:** delete their entry from `APP_USERS` → redeploy. Their
  data is hidden from the app immediately (reads filter to configured
  accounts) but **kept in the database**. To purge it, run a manual SQL delete
  in the Supabase SQL editor (`delete from users where name = '…';` — tasks,
  history, settings, and subscriptions cascade).

## Security notes

- `.env.local` and the service-role key are gitignored — never commit them.
- Rotate any credential that has been shared in plaintext.
- `APP_USERS` holds plain-text passwords; treat the env var with the same care
  as the service-role key (only admins can read Vercel env vars).
- `/api/cron/notify` requires `Authorization: Bearer <CRON_SECRET>` and is
  disabled (404) when the secret isn't configured.
