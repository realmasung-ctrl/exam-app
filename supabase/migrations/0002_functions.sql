-- =====================================================================
-- 0002_functions.sql  —  business rules that must be atomic & server-side
-- Every function is SECURITY DEFINER and callable ONLY by service_role
-- (see 0003_security.sql).  Errors are raised as plain codes in the
-- message (e.g. 'SESSION_CLOSED'); the API layer maps them to Thai text.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Admin helpers
-- ---------------------------------------------------------------------

-- Change the correct answer without tripping the one-correct unique index.
create or replace function public.set_correct_choice(p_question_id uuid, p_label text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from answer_choices where question_id = p_question_id and label = p_label) then
    raise exception 'CHOICE_NOT_FOUND';
  end if;
  update answer_choices set is_correct = false
   where question_id = p_question_id and label <> p_label and is_correct;
  update answer_choices set is_correct = true
   where question_id = p_question_id and label = p_label;
end $$;

-- Re-order all questions of a set in one statement (constraint is deferred).
create or replace function public.reorder_questions(p_set_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n int := coalesce(array_length(p_ordered_ids, 1), 0);
begin
  if (select count(*) from questions where set_id = p_set_id) <> v_n
     or (select count(distinct u) from unnest(p_ordered_ids) as u) <> v_n
     or exists (
          select 1 from unnest(p_ordered_ids) as u
           where not exists (select 1 from questions q where q.id = u and q.set_id = p_set_id)
        )
  then
    raise exception 'INVALID_ORDER';
  end if;

  update questions q
     set position = o.ord
    from unnest(p_ordered_ids) with ordinality as o(id, ord)
   where q.id = o.id and q.set_id = p_set_id;
end $$;

-- Returns one row per problem; zero rows = the set is ready to be opened.
create or replace function public.validate_question_set(p_set_id uuid)
returns table (question_position int, problem text)
language sql stable security definer set search_path = public, pg_temp as $$
  select 0, 'ชุดข้อสอบยังไม่มีคำถาม'
   where not exists (select 1 from questions where set_id = p_set_id)
  union all
  select q.position, 'คำถามว่างเปล่า'
    from questions q
   where q.set_id = p_set_id and length(btrim(q.body)) = 0
  union all
  select q.position, 'ตัวเลือกไม่ครบ 4 ข้อ (ก ข ค ง) หรือมีตัวเลือกที่ว่างเปล่า'
    from questions q
   where q.set_id = p_set_id
     and (select count(*) from answer_choices c
           where c.question_id = q.id and length(btrim(c.body)) > 0) <> 4
  union all
  select q.position, 'ต้องมีเฉลยที่ถูกต้องเพียง 1 ตัวเลือก'
    from questions q
   where q.set_id = p_set_id
     and (select count(*) from answer_choices c
           where c.question_id = q.id and c.is_correct) <> 1
  union all
  select q.position, 'คะแนนของข้อนี้ต้องมากกว่า 0'
    from questions q join question_sets s on s.id = q.set_id
   where q.set_id = p_set_id and s.scoring_mode = 'custom' and q.points <= 0
$$;

-- ---------------------------------------------------------------------
-- Open a session: validate + snapshot questions + generate the share code
-- Returns the public_code.
-- ---------------------------------------------------------------------
create or replace function public.open_session(p_session_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        exam_sessions;
  st       question_sets;
  v_code   text;
  v_count  int;
  v_max    numeric;
begin
  select * into s from exam_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.status <> 'draft' then raise exception 'SESSION_NOT_DRAFT'; end if;
  if s.set_id is null then raise exception 'SET_NOT_FOUND'; end if;

  select * into st from question_sets where id = s.set_id;
  if not found then raise exception 'SET_NOT_FOUND'; end if;

  if exists (select 1 from validate_question_set(s.set_id)) then
    raise exception 'INVALID_SET';
  end if;

  with src as (
    select q.id as source_id,
           row_number() over (order by q.position) as pos,
           q.body, q.explanation,
           case when st.scoring_mode = 'equal' then st.equal_points else q.points end as pts
      from questions q
     where q.set_id = s.set_id
  ),
  copied as (
    insert into session_questions (session_id, position, body, explanation, points, source_question_id)
    select s.id, src.pos, src.body, src.explanation, src.pts, src.source_id
      from src
    returning id, source_question_id
  )
  insert into session_choices (session_question_id, label, body, is_correct)
  select cp.id, c.label, c.body, c.is_correct
    from copied cp
    join answer_choices c on c.question_id = cp.source_question_id;

  select count(*), sum(points) into v_count, v_max
    from session_questions where session_id = s.id;

  -- 64 random bits from a v4 UUID: unguessable share code
  v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  update exam_sessions
     set status = 'open',
         public_code = v_code,
         snapshot_set_title = st.title,
         snapshot_instructions = st.instructions,
         question_count = v_count,
         max_points = v_max,
         opened_at = now()
   where id = s.id;

  return v_code;
end $$;

-- Admin: stop accepting new examinees (people already inside keep going).
create or replace function public.close_entry(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update exam_sessions
     set entry_closed_at = coalesce(entry_closed_at, now())
   where id = p_session_id and status in ('open','running');
  if not found then raise exception 'SESSION_NOT_OPEN'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Student: start an attempt.   The token is generated by the API; only its
-- sha256 hash is passed here and stored.
-- ---------------------------------------------------------------------
create or replace function public.start_attempt(
  p_code         text,
  p_first_name   text,
  p_last_name    text,
  p_student_code text,
  p_token_hash   text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s          exam_sessions;
  v_first    text := btrim(coalesce(p_first_name, ''));
  v_last     text := btrim(coalesce(p_last_name, ''));
  v_scode    text := nullif(btrim(coalesce(p_student_code, '')), '');
  v_now      timestamptz := now();
  v_deadline timestamptz;
  v_id       uuid;
begin
  if v_first = '' or v_last = '' then raise exception 'NAME_REQUIRED'; end if;
  if p_token_hash is null or length(p_token_hash) < 32 then raise exception 'INVALID_TOKEN'; end if;

  -- row lock serialises starts for one session (fine for ~50 people)
  select * into s from exam_sessions where public_code = p_code for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if s.status not in ('open','running') or s.entry_closed_at is not null then
    raise exception 'SESSION_CLOSED';
  end if;
  if s.opens_at is not null and v_now < s.opens_at then raise exception 'SESSION_NOT_YET_OPEN'; end if;
  if s.closes_at is not null and v_now >= s.closes_at then raise exception 'ENTRY_CLOSED'; end if;
  if s.require_student_code and v_scode is null then raise exception 'STUDENT_CODE_REQUIRED'; end if;

  v_deadline := v_now + make_interval(mins => s.duration_minutes);

  begin
    insert into exam_participants
           (session_id, first_name, last_name, student_code, token_hash, started_at, deadline_at)
    values (s.id, v_first, v_last, v_scode, p_token_hash, v_now, v_deadline)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ALREADY_STARTED';
  end;

  if s.status = 'open' then
    update exam_sessions set status = 'running' where id = s.id;
  end if;

  return jsonb_build_object(
    'participant_id', v_id,
    'started_at',     v_now,
    'deadline_at',    v_deadline,
    'server_now',     clock_timestamp()
  );
end $$;

-- ---------------------------------------------------------------------
-- Student: save (or clear) one answer.  p_client_seq lets the server ignore
-- an older request that arrives after a newer one.
-- ---------------------------------------------------------------------
create or replace function public.save_answer(
  p_token_hash          text,
  p_session_question_id uuid,
  p_choice_label        text,
  p_client_seq          bigint default 0
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p exam_participants;
begin
  select * into p from exam_participants
   where token_hash = p_token_hash and voided_at is null
   for share;                                   -- blocks a concurrent finalize
  if not found then raise exception 'INVALID_TOKEN'; end if;
  if p.status <> 'in_progress' then raise exception 'ALREADY_SUBMITTED'; end if;
  if now() >= p.deadline_at then raise exception 'EXPIRED'; end if;

  if not exists (select 1 from session_questions
                  where id = p_session_question_id and session_id = p.session_id) then
    raise exception 'INVALID_QUESTION';
  end if;

  if p_choice_label is null then
    delete from participant_answers
     where participant_id = p.id and session_question_id = p_session_question_id
       and client_seq <= p_client_seq;
  else
    if p_choice_label not in ('ก','ข','ค','ง') then raise exception 'INVALID_CHOICE'; end if;
    insert into participant_answers (participant_id, session_question_id, choice_label, client_seq)
    values (p.id, p_session_question_id, p_choice_label, p_client_seq)
    on conflict (participant_id, session_question_id) do update
       set choice_label = excluded.choice_label,
           client_seq   = excluded.client_seq,
           saved_at     = now()
     where participant_answers.client_seq <= excluded.client_seq;
  end if;

  return jsonb_build_object('saved_at', now(), 'server_now', clock_timestamp());
end $$;

-- ---------------------------------------------------------------------
-- Internal: grade + close ONE attempt.  Idempotent: does nothing unless the
-- attempt is still in_progress.  Not exposed to anyone but other functions.
-- ---------------------------------------------------------------------
create or replace function public._finalize_attempt(p_participant_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p          exam_participants;
  s          exam_sessions;
  v_sub      timestamptz;
  v_score    numeric;
  v_correct  int;
  v_unans    int;
  v_total    int;
  v_wrong    int;
  v_percent  numeric;
  v_passed   boolean;
begin
  if p_reason not in ('submitted','timed_out','closed_by_admin') then
    raise exception 'INVALID_REASON';
  end if;

  select * into p from exam_participants where id = p_participant_id for update;
  if not found or p.status <> 'in_progress' then return; end if;

  select * into s from exam_sessions where id = p.session_id;

  -- never later than the deadline, so a late/auto submit cannot show extra time
  v_sub := least(now(), p.deadline_at);

  select coalesce(sum(case when c.is_correct then q.points else 0 end), 0),
         count(*) filter (where c.is_correct),
         count(*) filter (where a.choice_label is null),
         count(*)
    into v_score, v_correct, v_unans, v_total
    from session_questions q
    left join participant_answers a
           on a.session_question_id = q.id and a.participant_id = p.id
    left join session_choices c
           on c.session_question_id = q.id and c.label = a.choice_label
   where q.session_id = p.session_id;

  v_wrong   := v_total - v_correct - v_unans;
  v_percent := case when s.max_points > 0 then round(v_score * 100 / s.max_points, 2) else 0 end;
  v_passed  := case when s.pass_percent is null then null
                    else (v_score * 100 >= s.pass_percent * s.max_points) end;

  update exam_participants
     set status = p_reason, submitted_at = v_sub
   where id = p.id;

  insert into exam_results
         (participant_id, score, max_score, percent, correct_count, wrong_count,
          unanswered_count, duration_seconds, passed, finalize_reason)
  values (p.id, v_score, coalesce(s.max_points, 0), v_percent, v_correct, v_wrong,
          v_unans, floor(extract(epoch from (v_sub - p.started_at)))::int, v_passed, p_reason);
end $$;

-- Student presses "ส่งข้อสอบ".  Safe to call twice (double click / retry).
create or replace function public.submit_attempt(p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p exam_participants;
begin
  select * into p from exam_participants
   where token_hash = p_token_hash and voided_at is null;
  if not found then raise exception 'INVALID_TOKEN'; end if;

  if p.status = 'in_progress' then
    perform _finalize_attempt(
      p.id,
      case when now() >= p.deadline_at then 'timed_out' else 'submitted' end
    );
  end if;

  select * into p from exam_participants where id = p.id;
  return jsonb_build_object('participant_id', p.id, 'status', p.status, 'submitted_at', p.submitted_at);
end $$;

-- Cron + lazy check: auto-submit every attempt whose time is up.
create or replace function public.finalize_expired()
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id from exam_participants
     where status = 'in_progress' and deadline_at <= now()
  loop
    perform _finalize_attempt(r.id, 'timed_out');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Admin ends (or disables) a session.  Everyone still in progress is graded
-- from their last saved answers.  Returns how many attempts were closed.
create or replace function public.end_session(p_session_id uuid, p_final_status text default 'ended')
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s exam_sessions;
  r record;
  n int := 0;
begin
  if p_final_status not in ('ended','disabled') then raise exception 'INVALID_STATUS'; end if;

  select * into s from exam_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.status = 'draft' and p_final_status = 'ended' then raise exception 'SESSION_NOT_OPEN'; end if;

  update exam_sessions
     set status = p_final_status, ended_at = coalesce(ended_at, now())
   where id = s.id;

  for r in
    select id, deadline_at from exam_participants
     where session_id = s.id and status = 'in_progress'
  loop
    perform _finalize_attempt(
      r.id,
      case when now() >= r.deadline_at then 'timed_out' else 'closed_by_admin' end
    );
    n := n + 1;
  end loop;
  return n;
end $$;

-- Admin explicitly allows a re-take: the old attempt is voided (kept for audit,
-- hidden from reports) and the person may start again with the same name.
create or replace function public.allow_retake(p_participant_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update exam_participants set voided_at = now()
   where id = p_participant_id and voided_at is null;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
end $$;
