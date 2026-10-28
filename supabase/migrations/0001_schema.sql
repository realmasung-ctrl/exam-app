-- =====================================================================
-- 0001_schema.sql  —  Online Exam App : tables, constraints, indexes
-- Target: Supabase (PostgreSQL 15+).  Run files in numeric order.
-- All timestamps are timestamptz (UTC); the UI renders Asia/Bangkok.
-- =====================================================================

-- ---------- Admin users ------------------------------------------------
-- An auth.users row alone does NOT make someone an admin.
-- Only rows in admin_profiles count (created by the invite API / first-admin script).
create table public.admin_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) > 0),
  created_at   timestamptz not null default now()
);

-- ---------- Question sets (editable "master" copies) -------------------
create table public.question_sets (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null check (length(btrim(title)) > 0),
  instructions        text not null default '',
  scoring_mode        text not null default 'equal' check (scoring_mode in ('equal','custom')),
  equal_points        numeric(6,2) not null default 1 check (equal_points > 0),
  default_reveal_mode text not null default 'after_close'
                        check (default_reveal_mode in ('immediate','after_close','hidden')),
  status              text not null default 'draft' check (status in ('draft','ready')),
  created_by          uuid references public.admin_profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.questions (
  id          uuid primary key default gen_random_uuid(),
  set_id      uuid not null references public.question_sets(id) on delete cascade,
  position    int  not null check (position > 0),
  body        text not null default '',
  explanation text,
  points      numeric(6,2) not null default 1 check (points > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- deferred so a whole set can be re-ordered in one UPDATE
  constraint questions_set_position_uniq unique (set_id, position) deferrable initially deferred
);

create table public.answer_choices (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  label       text not null check (label in ('ก','ข','ค','ง')),
  body        text not null default '',
  is_correct  boolean not null default false,
  unique (question_id, label)
);
-- at most one correct choice per question (exactly one is enforced by validate_question_set)
create unique index answer_choices_one_correct
  on public.answer_choices (question_id) where is_correct;

-- ---------- Exam sessions (รอบสอบ) --------------------------------------
-- status: draft -> open (รับผู้เข้าสอบ) -> running (มีผู้เริ่มสอบแล้ว) -> ended | disabled
create table public.exam_sessions (
  id                    uuid primary key default gen_random_uuid(),
  set_id                uuid references public.question_sets(id) on delete set null,
  title                 text not null check (length(btrim(title)) > 0),
  duration_minutes      int  not null check (duration_minutes between 1 and 600),
  opens_at              timestamptz,               -- optional: entry opens
  closes_at             timestamptz,               -- optional: entry closes (NOT the exam deadline)
  entry_closed_at       timestamptz,               -- set when admin presses "ปิดรับผู้เข้าสอบ"
  pass_percent          numeric(5,2) check (pass_percent is null or (pass_percent between 0 and 100)),
  reveal_mode           text not null default 'after_close'
                          check (reveal_mode in ('immediate','after_close','hidden')),
  require_student_code  boolean not null default false,
  expected_participants int check (expected_participants is null or expected_participants >= 0),
  status                text not null default 'draft'
                          check (status in ('draft','open','running','ended','disabled')),
  public_code           text unique,               -- random code used in the share link
  -- snapshot metadata (filled by open_session)
  snapshot_set_title    text,
  snapshot_instructions text,
  question_count        int,
  max_points            numeric(8,2),
  opened_at             timestamptz,
  ended_at              timestamptz,
  created_by            uuid references public.admin_profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (opens_at is null or closes_at is null or closes_at > opens_at)
);

-- Snapshot of the questions at the moment the session is opened.
-- Editing/deleting the master set later never changes these rows.
create table public.session_questions (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.exam_sessions(id) on delete cascade,
  position           int  not null check (position > 0),
  body               text not null,
  explanation        text,
  points             numeric(6,2) not null check (points > 0),
  source_question_id uuid,   -- informational only (no FK: master may be deleted)
  unique (session_id, position)
);

create table public.session_choices (
  id                  uuid primary key default gen_random_uuid(),
  session_question_id uuid not null references public.session_questions(id) on delete cascade,
  label               text not null check (label in ('ก','ข','ค','ง')),
  body                text not null,
  is_correct          boolean not null default false,
  unique (session_question_id, label)
);
create unique index session_choices_one_correct
  on public.session_choices (session_question_id) where is_correct;

-- ---------- Participants, answers, results ------------------------------
create table public.exam_participants (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.exam_sessions(id) on delete cascade,
  first_name   text not null check (length(btrim(first_name)) > 0),
  last_name    text not null check (length(btrim(last_name)) > 0),
  student_code text,
  token_hash   text not null unique,      -- sha256 of the exam token (token itself is never stored)
  status       text not null default 'in_progress'
                 check (status in ('in_progress','submitted','timed_out','closed_by_admin')),
  started_at   timestamptz not null default now(),
  deadline_at  timestamptz not null,      -- decided by the server at start: started_at + duration
  submitted_at timestamptz,
  voided_at    timestamptz,               -- set when admin allows a re-take
  created_at   timestamptz not null default now(),
  check (status = 'in_progress' or submitted_at is not null)
);
-- one active attempt per person per session (re-take = void the old one)
create unique index exam_participants_identity
  on public.exam_participants (
    session_id,
    lower(btrim(first_name)),
    lower(btrim(last_name)),
    coalesce(lower(btrim(student_code)), '')
  ) where voided_at is null;
create index exam_participants_session_status on public.exam_participants (session_id, status);
create index exam_participants_due on public.exam_participants (deadline_at) where status = 'in_progress';

create table public.participant_answers (
  participant_id      uuid not null references public.exam_participants(id) on delete cascade,
  session_question_id uuid not null references public.session_questions(id) on delete cascade,
  choice_label        text not null check (choice_label in ('ก','ข','ค','ง')),
  client_seq          bigint not null default 0,   -- ignores stale retries from flaky networks
  saved_at            timestamptz not null default now(),
  primary key (participant_id, session_question_id)
);

create table public.exam_results (
  participant_id   uuid primary key references public.exam_participants(id) on delete cascade,
  score            numeric(8,2) not null,
  max_score        numeric(8,2) not null,
  percent          numeric(5,2) not null,
  correct_count    int not null,
  wrong_count      int not null,
  unanswered_count int not null,
  duration_seconds int not null,
  passed           boolean,                         -- null when the session has no pass mark
  finalize_reason  text not null check (finalize_reason in ('submitted','timed_out','closed_by_admin')),
  finalized_at     timestamptz not null default now()
);

-- ---------- updated_at maintenance --------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_question_sets_touch before update on public.question_sets
  for each row execute function public.touch_updated_at();
create trigger trg_questions_touch before update on public.questions
  for each row execute function public.touch_updated_at();
create trigger trg_exam_sessions_touch before update on public.exam_sessions
  for each row execute function public.touch_updated_at();
