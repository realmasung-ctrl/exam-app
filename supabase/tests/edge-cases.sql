-- =====================================================================
-- edge-cases.sql — error paths and boundary rules of the exam engine.
-- Run in Supabase SQL Editor after migrations 0001-0004 (and after smoke.sql).
-- Everything is rolled back. The script ENDS WITH A RED ERROR whose text starts with  ✅  when all
-- checks passed (an error is used on purpose: it undoes the test data).  Any other message = a failed check.
-- =====================================================================
begin;

-- ---- helpers (live only for this session) -----------------------------------------------
create or replace function pg_temp.expect_err(p_sql text, p_expected text) returns void
language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> p_expected then
      raise exception 'FAIL: expected [%] but got [%] for: %', p_expected, v_msg, p_sql;
    end if;
    return;
  end;
  raise exception 'FAIL: expected error [%] but the call succeeded: %', p_expected, p_sql;
end $$;

-- creates a set (n questions, answer ก is always correct), a session from it, opens it; returns ids
create or replace function pg_temp.mk_session(
  p_questions int default 3, p_mode text default 'custom', p_points numeric default 1,
  p_pass numeric default null, p_duration int default 10
) returns jsonb language plpgsql as $$
declare v_set uuid; v_q uuid; v_sess uuid; v_code text;
begin
  insert into public.question_sets (title, scoring_mode, equal_points) values ('edge', p_mode, p_points) returning id into v_set;
  for i in 1..p_questions loop
    insert into public.questions (set_id, position, body, points) values (v_set, i, 'Q' || i, i) returning id into v_q;
    insert into public.answer_choices (question_id, label, body, is_correct) values
      (v_q, 'ก', 'a', true), (v_q, 'ข', 'b', false), (v_q, 'ค', 'c', false), (v_q, 'ง', 'd', false);
  end loop;
  insert into public.exam_sessions (set_id, title, duration_minutes, pass_percent)
  values (v_set, 'edge', p_duration, p_pass) returning id into v_sess;
  v_code := public.open_session(v_sess);
  return jsonb_build_object('set', v_set, 'sess', v_sess, 'code', v_code);
end $$;

create or replace function pg_temp.sq(p_sess uuid, p_pos int) returns uuid language sql as $$
  select id from public.session_questions where session_id = p_sess and position = p_pos $$;

do $$
declare
  a jsonb; b jsonb; c jsonb;
  v_sess uuid; v_code text; v_pid uuid; v_pid2 uuid; v_n int; r record;
  h1 text := repeat('1', 64); h2 text := repeat('2', 64); h3 text := repeat('3', 64); h4 text := repeat('4', 64);
begin
  -- ===== E1  opening twice / ending a draft / bad status ==================================
  a := pg_temp.mk_session();
  v_sess := (a->>'sess')::uuid; v_code := a->>'code';
  perform pg_temp.expect_err(format('select public.open_session(%L)', v_sess), 'SESSION_NOT_DRAFT');

  insert into public.exam_sessions (set_id, title, duration_minutes)
    values ((a->>'set')::uuid, 'draft one', 5) returning id into v_pid;     -- reuse variable for a draft id
  perform pg_temp.expect_err(format('select public.end_session(%L)', v_pid), 'SESSION_NOT_OPEN');
  perform pg_temp.expect_err(format('select public.end_session(%L, %L)', v_sess, 'weird'), 'INVALID_STATUS');

  -- ===== E2  start_attempt validation ======================================================
  perform pg_temp.expect_err(format('select public.start_attempt(%L,%L,%L,%L,%L)', 'ffffffffffffffff', 'ก', 'ข', null, h1), 'SESSION_NOT_FOUND');
  perform pg_temp.expect_err(format('select public.start_attempt(%L,%L,%L,%L,%L)', v_code, '  ', 'ข', null, h1), 'NAME_REQUIRED');
  perform pg_temp.expect_err(format('select public.start_attempt(%L,%L,%L,%L,%L)', v_code, 'ก', '', null, h1), 'NAME_REQUIRED');
  perform pg_temp.expect_err(format('select public.start_attempt(%L,%L,%L,%L,%L)', v_code, 'ก', 'ข', null, 'short'), 'INVALID_TOKEN');

  -- ===== E3  duplicate identity (case / spacing insensitive) ================================
  perform public.start_attempt(v_code, 'สมชาย', 'ใจดี', null, h1);
  perform pg_temp.expect_err(format('select public.start_attempt(%L,%L,%L,%L,%L)', v_code, '  สมชาย ', 'ใจดี', null, h2), 'ALREADY_STARTED');
  perform public.start_attempt(v_code, 'Anna', 'Lee', null, h2);
  perform pg_temp.expect_err(format('select public.start_attempt(%L,%L,%L,%L,%L)', v_code, 'ANNA', ' lee', null, h3), 'ALREADY_STARTED');

  -- ===== E4  a token can never touch another session's questions ============================
  b := pg_temp.mk_session();
  perform pg_temp.expect_err(
    format('select public.save_answer(%L,%L,%L,1)', h1, pg_temp.sq((b->>'sess')::uuid, 1), 'ก'), 'INVALID_QUESTION');
  perform pg_temp.expect_err(
    format('select public.save_answer(%L,%L,%L,1)', h1, pg_temp.sq(v_sess, 1), 'จ'), 'INVALID_CHOICE');
  perform pg_temp.expect_err(
    format('select public.save_answer(%L,%L,%L,1)', repeat('9', 64), pg_temp.sq(v_sess, 1), 'ก'), 'INVALID_TOKEN');

  -- ===== E5  entry closed: newcomers refused, people inside continue ========================
  perform public.close_entry(v_sess);
  perform pg_temp.expect_err(format('select public.start_attempt(%L,%L,%L,%L,%L)', v_code, 'ใหม่', 'มาก', null, h3), 'SESSION_CLOSED');
  perform public.save_answer(h1, pg_temp.sq(v_sess, 1), 'ก', 1);   -- still allowed for someone already inside

  -- ===== E6  scheduled entry window, required student code ==================================
  c := pg_temp.mk_session();
  update public.exam_sessions set opens_at = now() + interval '1 hour' where id = (c->>'sess')::uuid;
  perform pg_temp.expect_err(format('select public.start_attempt(%L,%L,%L,%L,%L)', c->>'code', 'ก', 'ข', null, h3), 'SESSION_NOT_YET_OPEN');
  update public.exam_sessions set opens_at = null, closes_at = now() - interval '1 minute' where id = (c->>'sess')::uuid;
  perform pg_temp.expect_err(format('select public.start_attempt(%L,%L,%L,%L,%L)', c->>'code', 'ก', 'ข', null, h3), 'ENTRY_CLOSED');
  update public.exam_sessions set closes_at = null, require_student_code = true where id = (c->>'sess')::uuid;
  perform pg_temp.expect_err(format('select public.start_attempt(%L,%L,%L,%L,%L)', c->>'code', 'ก', 'ข', '  ', h3), 'STUDENT_CODE_REQUIRED');
  perform public.start_attempt(c->>'code', 'ก', 'ข', 'S-001', h3);   -- works with a code

  -- ===== E7  time is up: submit is recorded as timed_out and never exceeds the deadline =====
  select id into v_pid from public.exam_participants where token_hash = h2;
  perform public.save_answer(h2, pg_temp.sq(v_sess, 1), 'ก', 1);
  update public.exam_participants set started_at = now() - interval '30 minutes',
         deadline_at = now() - interval '20 minutes' where id = v_pid;
  perform pg_temp.expect_err(format('select public.save_answer(%L,%L,%L,2)', h2, pg_temp.sq(v_sess, 2), 'ก'), 'EXPIRED');
  perform public.submit_attempt(h2);
  select * into r from public.exam_participants where id = v_pid;
  assert r.status = 'timed_out', 'late submit must be timed_out';
  assert r.submitted_at = r.deadline_at, 'submitted_at must be clamped to the deadline';
  select * into r from public.exam_results where participant_id = v_pid;
  assert r.duration_seconds = 600, 'duration must equal the allowed 10 minutes, not the real 30';
  assert r.score = 1 and r.unanswered_count = 2, 'graded from the saved answer only';

  -- ===== E8  results are written exactly once ===============================================
  perform public.submit_attempt(h2);
  perform public.submit_attempt(h2);
  select count(*) into v_n from public.exam_results where participant_id = v_pid;
  assert v_n = 1, 'double submit must not create a second result';
  perform pg_temp.expect_err(format('select public.save_answer(%L,%L,%L,9)', h2, pg_temp.sq(v_sess, 3), 'ก'), 'ALREADY_SUBMITTED');

  -- ===== E9  re-take: old attempt is voided, token dead, history kept ========================
  perform public.allow_retake(v_pid);
  perform pg_temp.expect_err(format('select public.save_answer(%L,%L,%L,3)', h2, pg_temp.sq(v_sess, 1), 'ก'), 'INVALID_TOKEN');
  -- entry was closed in E5, so even the voided person cannot start again until entry is reopened
  perform pg_temp.expect_err(format('select public.start_attempt(%L,%L,%L,%L,%L)', v_code, 'Anna', 'Lee', null, h4), 'SESSION_CLOSED');
end $$;

-- second block: scenarios that need an open session
do $$
declare
  a jsonb; b jsonb; v_sess uuid; v_code text; v_pid uuid; r record; v_n int;
  h1 text := repeat('a', 64); h2 text := repeat('b', 64); h3 text := repeat('c', 64);
begin
  -- ===== E10  retake end-to-end ============================================================
  a := pg_temp.mk_session();
  v_sess := (a->>'sess')::uuid; v_code := a->>'code';
  perform public.start_attempt(v_code, 'Bob', 'Ray', null, h1);
  select id into v_pid from public.exam_participants where token_hash = h1;
  perform public.save_answer(h1, pg_temp.sq(v_sess, 1), 'ก', 1);
  perform public.submit_attempt(h1);
  perform public.allow_retake(v_pid);
  perform pg_temp.expect_err(format('select public.save_answer(%L,%L,%L,2)', h1, pg_temp.sq(v_sess, 2), 'ก'), 'INVALID_TOKEN');
  perform public.start_attempt(v_code, 'Bob', 'Ray', null, h2);            -- allowed again
  select count(*) into v_n from public.exam_participants where session_id = v_sess and voided_at is null;
  assert v_n = 1, 'exactly one active attempt after a retake';
  select count(*) into v_n from public.exam_participants where session_id = v_sess;
  assert v_n = 2, 'the voided attempt is kept for audit';
  select count(*) into v_n from public.exam_results where participant_id = v_pid;
  assert v_n = 1, 'the old result is kept for audit';
  perform pg_temp.expect_err(format('select public.allow_retake(%L)', v_pid), 'PARTICIPANT_NOT_FOUND'); -- already voided

  -- ===== E11  nothing answered => zero score, everything unanswered ==========================
  b := pg_temp.mk_session(3, 'custom', 1, 50);
  perform public.start_attempt(b->>'code', 'Zed', 'Zero', null, h3);
  select id into v_pid from public.exam_participants where token_hash = h3;
  perform public.submit_attempt(h3);
  select * into r from public.exam_results where participant_id = v_pid;
  assert r.score = 0 and r.percent = 0 and r.unanswered_count = 3 and r.correct_count = 0 and r.wrong_count = 0, 'blank paper';
  assert r.passed = false, 'blank paper does not pass a 50% mark';

  -- ===== E12  scoring weights, rounding and the pass-mark boundary ===========================
  -- custom points 1,2,3 (max 6): correct Q1 only => 1/6 = 16.67 %
  a := pg_temp.mk_session(3, 'custom', 1, 16.67);
  v_sess := (a->>'sess')::uuid;
  perform public.start_attempt(a->>'code', 'Ann', 'One', null, repeat('d', 64));
  perform public.save_answer(repeat('d', 64), pg_temp.sq(v_sess, 1), 'ก', 1);
  perform public.submit_attempt(repeat('d', 64));
  select * into r from public.exam_results where participant_id = (select id from public.exam_participants where token_hash = repeat('d', 64));
  assert r.percent = 16.67, 'percent rounds to 2 decimals';
  assert r.passed = false, 'score 100/6 = 16.666.. is BELOW a 16.67 pass mark (compared unrounded)';

  a := pg_temp.mk_session(3, 'custom', 1, 16.66);
  v_sess := (a->>'sess')::uuid;
  perform public.start_attempt(a->>'code', 'Ann', 'Two', null, repeat('e', 64));
  perform public.save_answer(repeat('e', 64), pg_temp.sq(v_sess, 1), 'ก', 1);
  perform public.submit_attempt(repeat('e', 64));
  select * into r from public.exam_results where participant_id = (select id from public.exam_participants where token_hash = repeat('e', 64));
  assert r.passed = true, '16.666.. passes a 16.66 mark';

  -- equal points: 3 questions x 2.5 = 7.5
  a := pg_temp.mk_session(3, 'equal', 2.5);
  v_sess := (a->>'sess')::uuid;
  assert (select max_points from public.exam_sessions where id = v_sess) = 7.5, 'equal mode max points';
  perform public.start_attempt(a->>'code', 'Eq', 'Ual', null, repeat('f', 64));
  perform public.save_answer(repeat('f', 64), pg_temp.sq(v_sess, 1), 'ก', 1);
  perform public.save_answer(repeat('f', 64), pg_temp.sq(v_sess, 2), 'ข', 2);   -- wrong
  perform public.submit_attempt(repeat('f', 64));
  select * into r from public.exam_results where participant_id = (select id from public.exam_participants where token_hash = repeat('f', 64));
  assert r.score = 2.5 and r.correct_count = 1 and r.wrong_count = 1 and r.unanswered_count = 1, 'equal-mode grading';

  -- ===== E13  clearing an answer ============================================================
  a := pg_temp.mk_session();
  v_sess := (a->>'sess')::uuid;
  perform public.start_attempt(a->>'code', 'Clr', 'Ans', null, repeat('7', 64));
  perform public.save_answer(repeat('7', 64), pg_temp.sq(v_sess, 1), 'ก', 5);
  perform public.save_answer(repeat('7', 64), pg_temp.sq(v_sess, 1), null, 4);   -- stale clear is ignored
  assert exists (select 1 from public.participant_answers where session_question_id = pg_temp.sq(v_sess, 1)), 'stale clear ignored';
  perform public.save_answer(repeat('7', 64), pg_temp.sq(v_sess, 1), null, 6);   -- newer clear applies
  assert not exists (select 1 from public.participant_answers where session_question_id = pg_temp.sq(v_sess, 1)), 'newer clear applied';

  -- ===== E14  per-session cap =================================================================
  a := pg_temp.mk_session();
  v_sess := (a->>'sess')::uuid;
  insert into public.exam_participants (session_id, first_name, last_name, token_hash, deadline_at)
  select v_sess, 'u' || g, 'x', repeat(md5(g::text), 2), now() + interval '1 hour' from generate_series(1, 500) g;
  perform pg_temp.expect_err(format('select public.start_attempt(%L,%L,%L,%L,%L)', a->>'code', 'late', 'comer', null, repeat('8', 64)), 'SESSION_FULL');
  update public.exam_participants set voided_at = now() where session_id = v_sess and first_name = 'u1';
  perform public.start_attempt(a->>'code', 'late', 'comer', null, repeat('8', 64));  -- a voided seat is free again

  -- ===== E15  question-set editing helpers & validation =======================================
  a := pg_temp.mk_session(3);
  v_sess := (a->>'sess')::uuid;
  declare
    v_set uuid := (a->>'set')::uuid; v_ids uuid[]; v_q uuid;
  begin
    select array_agg(id order by position desc) into v_ids from public.questions where set_id = v_set;
    perform public.reorder_questions(v_set, v_ids);
    assert (select body from public.questions where set_id = v_set and position = 1) = 'Q3', 'reorder works';
    perform pg_temp.expect_err(format('select public.reorder_questions(%L, %L::uuid[])', v_set, array[v_ids[1], v_ids[1], v_ids[2]]), 'INVALID_ORDER');
    select id into v_q from public.questions where set_id = v_set and position = 1;
    perform public.set_correct_choice(v_q, 'ค');
    assert (select count(*) from public.answer_choices where question_id = v_q and is_correct) = 1, 'exactly one correct';
    assert (select label from public.answer_choices where question_id = v_q and is_correct) = 'ค', 'correct moved';
    perform pg_temp.expect_err(format('select public.set_correct_choice(%L, %L)', v_q, 'จ'), 'CHOICE_NOT_FOUND');

    -- broken question: empty text, no correct answer, one empty choice
    update public.questions set body = '' where id = v_q;
    update public.answer_choices set is_correct = false where question_id = v_q;
    update public.answer_choices set body = '' where question_id = v_q and label = 'ง';
    select count(*) into v_n from public.validate_question_set(v_set);
    assert v_n = 3, format('expected 3 validation problems, got %s', v_n);
    insert into public.exam_sessions (set_id, title, duration_minutes) values (v_set, 'bad', 5) returning id into v_sess;
    perform pg_temp.expect_err(format('select public.open_session(%L)', v_sess), 'INVALID_SET');
  end;

  raise exception '✅ ALL EDGE CASES PASSED (changes rolled back)';
end $$;

rollback;
