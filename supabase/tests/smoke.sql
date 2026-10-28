-- =====================================================================
-- smoke.sql — end-to-end check of scoring / timing / locking rules.
-- Run in Supabase SQL Editor AFTER the 3 migrations.  Everything is rolled
-- back at the end, so it leaves no data.  Success = a NOTICE saying PASSED;
-- any failed ASSERT stops the script with an error.
-- =====================================================================
begin;

do $$
declare
  v_set uuid; v_sess uuid; v_code text; v_q uuid;
  q1 uuid; q2 uuid; q3 uuid;
  v_pid uuid; v_pid2 uuid; v_pid3 uuid;
  r record;
  v_msg text;
begin
  -- ---- master set: custom points 1 / 2 / 3 (max 6), correct answer always ก
  insert into question_sets (title, scoring_mode) values ('smoke', 'custom') returning id into v_set;
  for i in 1..3 loop
    insert into questions (set_id, position, body, points)
    values (v_set, i, 'Q' || i, i) returning id into v_q;
    insert into answer_choices (question_id, label, body, is_correct) values
      (v_q, 'ก', 'a', true), (v_q, 'ข', 'b', false), (v_q, 'ค', 'c', false), (v_q, 'ง', 'd', false);
  end loop;
  assert not exists (select 1 from validate_question_set(v_set)), 'valid set should have no problems';

  -- ---- open session (snapshot)
  insert into exam_sessions (set_id, title, duration_minutes, pass_percent)
  values (v_set, 'smoke round', 10, 50) returning id into v_sess;
  v_code := open_session(v_sess);
  assert v_code is not null and length(v_code) = 16, 'public code generated';
  assert (select max_points from exam_sessions where id = v_sess) = 6, 'max points = 6';

  -- editing the master after opening must not change the snapshot
  update questions set body = 'CHANGED' where set_id = v_set;
  assert not exists (select 1 from session_questions where session_id = v_sess and body = 'CHANGED'),
         'snapshot is isolated from master edits';

  select id into q1 from session_questions where session_id = v_sess and position = 1;
  select id into q2 from session_questions where session_id = v_sess and position = 2;
  select id into q3 from session_questions where session_id = v_sess and position = 3;

  -- ---- attempt 1: Q1 right (1pt), Q2 wrong (2pt), Q3 blank  => 1/6 = 16.67%, fail
  perform start_attempt(v_code, 'สมชาย', 'ใจดี', null, repeat('a', 64));
  select id into v_pid from exam_participants where token_hash = repeat('a', 64);
  perform save_answer(repeat('a', 64), q1, 'ก', 1);
  perform save_answer(repeat('a', 64), q2, 'ข', 2);
  perform save_answer(repeat('a', 64), q2, 'ก', 1);   -- stale retry must be ignored
  assert (select choice_label from participant_answers
           where participant_id = v_pid and session_question_id = q2) = 'ข', 'stale write ignored';

  perform submit_attempt(repeat('a', 64));
  perform submit_attempt(repeat('a', 64));            -- double submit is harmless
  select * into r from exam_results where participant_id = v_pid;
  assert r.score = 1 and r.max_score = 6, 'score 1/6';
  assert r.percent = 16.67, 'percent 16.67';
  assert r.correct_count = 1 and r.wrong_count = 1 and r.unanswered_count = 1, 'counts';
  assert r.passed = false and r.finalize_reason = 'submitted', 'failed + submitted';
  assert (select count(*) from exam_results where participant_id = v_pid) = 1, 'exactly one result';

  -- answers after submit are rejected
  begin
    perform save_answer(repeat('a', 64), q3, 'ก', 5);
    assert false, 'should have been rejected';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'ALREADY_SUBMITTED', 'save after submit -> ' || v_msg;
  end;

  -- duplicate start with the same name is rejected
  begin
    perform start_attempt(v_code, 'สมชาย', 'ใจดี', null, repeat('b', 64));
    assert false, 'should have been rejected';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'ALREADY_STARTED', 'duplicate start -> ' || v_msg;
  end;

  -- ---- attempt 2: all correct but time runs out => auto timed_out, graded from saved answers
  perform start_attempt(v_code, 'สมหญิง', 'รักเรียน', null, repeat('c', 64));
  select id into v_pid2 from exam_participants where token_hash = repeat('c', 64);
  perform save_answer(repeat('c', 64), q1, 'ก', 1);
  perform save_answer(repeat('c', 64), q2, 'ก', 2);
  perform save_answer(repeat('c', 64), q3, 'ก', 3);
  update exam_participants set deadline_at = now() - interval '1 minute' where id = v_pid2;

  begin
    perform save_answer(repeat('c', 64), q3, 'ข', 4); -- too late
    assert false, 'should have been rejected';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'EXPIRED', 'late save -> ' || v_msg;
  end;

  assert finalize_expired() >= 1, 'sweep closed the expired attempt';
  select * into r from exam_results where participant_id = v_pid2;
  assert r.score = 6 and r.percent = 100 and r.passed = true, 'perfect score kept';
  assert r.finalize_reason = 'timed_out', 'marked timed_out';
  assert (select status from exam_participants where id = v_pid2) = 'timed_out', 'status timed_out';

  -- ---- attempt 3: admin ends the session while someone is still answering
  perform start_attempt(v_code, 'มานะ', 'อดทน', null, repeat('d', 64));
  select id into v_pid3 from exam_participants where token_hash = repeat('d', 64);
  perform save_answer(repeat('d', 64), q3, 'ก', 1);
  assert end_session(v_sess) = 1, 'one in-progress attempt closed';
  select * into r from exam_results where participant_id = v_pid3;
  assert r.score = 3 and r.finalize_reason = 'closed_by_admin', 'graded from last saved answers';

  begin
    perform start_attempt(v_code, 'คนใหม่', 'มาสาย', null, repeat('e', 64));
    assert false, 'should have been rejected';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'SESSION_CLOSED', 'start after end -> ' || v_msg;
  end;

  -- ---- invalid set cannot be opened
  insert into question_sets (title) values ('empty') returning id into v_set;
  insert into exam_sessions (set_id, title, duration_minutes) values (v_set, 'x', 5) returning id into v_sess;
  begin
    perform open_session(v_sess);
    assert false, 'should have been rejected';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    assert v_msg = 'INVALID_SET', 'empty set -> ' || v_msg;
  end;

  raise notice 'SMOKE TEST PASSED';
end $$;

rollback;
