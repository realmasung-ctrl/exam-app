-- =====================================================================
-- 0003_security_cron.sql  —  lock the database down + schedule auto-submit
--
-- Security model: the browser NEVER talks to the database directly.
-- Every request goes through our Next.js API, which verifies the admin
-- session (Supabase Auth) or the student's exam token, then calls the DB
-- with the service_role key (server-side only).  So:
--   * RLS is enabled on every table with NO policies  -> anon/authenticated see nothing
--   * table + function privileges are revoked from anon/authenticated/public
-- =====================================================================

alter table public.admin_profiles      enable row level security;
alter table public.question_sets       enable row level security;
alter table public.questions           enable row level security;
alter table public.answer_choices      enable row level security;
alter table public.exam_sessions       enable row level security;
alter table public.session_questions   enable row level security;
alter table public.session_choices     enable row level security;
alter table public.exam_participants   enable row level security;
alter table public.participant_answers enable row level security;
alter table public.exam_results        enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- anything created later is locked down by default too
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Auto-submit sweep: every minute, grade attempts whose time is up.
-- (Also done lazily by the API on every read/save, so results are never
-- stale for longer than the next request.)
-- Enable the extension first: Dashboard -> Database -> Extensions -> pg_cron.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'finalize-expired-attempts',
  '* * * * *',
  $$select public.finalize_expired()$$
);
