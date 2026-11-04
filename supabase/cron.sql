-- ===========================================================================
-- Notification scheduler (run once in the Supabase SQL editor)
--
-- Hourly this pings /api/cron/notify, which checks each user's local time
-- and sends: the 11:00 / 17:00 / 21:00 check-in to whoever has just passed
-- an enabled slot (60-minute window), and item reminders — a morning
-- summary of dated todos and all-day events, plus a ping 1 hour / 3 hours /
-- 1 day before each timed event. Every window is at least an hour wide, so
-- one hourly tick always lands inside. The route authenticates with the
-- CRON_SECRET.
--
-- BEFORE RUNNING: replace REPLACE_WITH_CRON_SECRET with the same value as the
-- CRON_SECRET env var in Vercel (openssl rand -hex 32).
-- ===========================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

-- Idempotent reschedule: drop any previous job (current and pre-rename
-- "accountability-notify" name), then re-create. The URL is the production
-- domain after the Vercel rename (olivesapp.vercel.app).
select cron.unschedule('accountability-notify')
 where exists (select 1 from cron.job where jobname = 'accountability-notify');

select cron.unschedule('olives-notify')
 where exists (select 1 from cron.job where jobname = 'olives-notify');

select cron.schedule(
  'olives-notify',
  '0 * * * *',
  $$
  select net.http_post(
    url      := 'https://olivesapp.vercel.app/api/cron/notify',
    headers  := jsonb_build_object(
                  'Content-Type', 'application/json',
                  'Authorization', 'Bearer ' || 'REPLACE_WITH_CRON_SECRET'
                ),
    body     := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Verify it's registered (expect one row) and that pings succeed:
--   select * from cron.job;
--   select id, status_code, error_msg from net._http_response order by id desc limit 5;
