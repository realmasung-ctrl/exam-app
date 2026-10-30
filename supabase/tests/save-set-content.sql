-- =====================================================================
-- save-set-content.sql — tests for migration 0005 (one-call saving). Everything is rolled back; success is a RED
-- error whose text starts with ✅ (any other message = a failed check).  Run after 0001-0005.
-- =====================================================================
begin;

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

do $$
declare
  v_set uuid; v_other uuid;
  i1 uuid := gen_random_uuid(); i2 uuid := gen_random_uuid(); i3 uuid := gen_random_uuid();
  s1 jsonb := '{"title":"ชุดทดสอบ","instructions":"อ่านก่อนสอบ","scoring_mode":"custom","equal_points":"1","default_reveal_mode":"hidden"}';
  v_n int; r record;
begin
  insert into question_sets (title) values ('old title') returning id into v_set;

  -- 1) first save: three NEW questions, ids chosen by the browser
  v_n := public.save_set_content(v_set, s1, jsonb_build_array(
    jsonb_build_object('id', i1, 'body', 'Q one', 'explanation', 'because', 'points', 1,
      'choices', jsonb_build_array('a','b','c','d'), 'correct', 'ข'),
    jsonb_build_object('id', i2, 'body', 'Q two', 'explanation', '', 'points', 2.5,
      'choices', jsonb_build_array('e','f','g','h'), 'correct', 'ก'),
    jsonb_build_object('id', i3, 'body', 'Q three', 'explanation', null, 'points', 3,
      'choices', jsonb_build_array('i','j','k','l'), 'correct', null)));
  assert v_n = 3, 'returns the number of questions';
  select * into r from question_sets where id = v_set;
  assert r.title = 'ชุดทดสอบ' and r.instructions = 'อ่านก่อนสอบ' and r.scoring_mode = 'custom'
     and r.default_reveal_mode = 'hidden' and r.status = 'draft', 'settings saved';
  assert (select count(*) from questions where set_id = v_set) = 3, 'three questions';
  assert (select position from questions where id = i2) = 2, 'order = array order';
  assert (select points from questions where id = i2) = 2.5, 'points saved';
  assert (select explanation from questions where id = i1) = 'because', 'explanation saved';
  assert (select explanation from questions where id = i3) is null, 'empty explanation -> null';
  assert (select count(*) from answer_choices where question_id in (i1, i2, i3)) = 12, 'four choices each';
  assert (select label from answer_choices where question_id = i1 and is_correct) = 'ข', 'correct answer saved';
  assert (select count(*) from answer_choices where question_id = i3 and is_correct) = 0, 'no correct answer chosen';
  assert (select body from answer_choices where question_id = i2 and label = 'ค') = 'g', 'choice text saved by position';

  -- 2) second save: reorder (3,1), drop question 2, change the correct answer, edit text
  v_n := public.save_set_content(v_set, s1, jsonb_build_array(
    jsonb_build_object('id', i3, 'body', 'Q three EDIT', 'explanation', '', 'points', 3,
      'choices', jsonb_build_array('i','j','k','l'), 'correct', 'ง'),
    jsonb_build_object('id', i1, 'body', 'Q one', 'explanation', 'because', 'points', 1,
      'choices', jsonb_build_array('a','b','c','d'), 'correct', 'ก')));
  assert v_n = 2, 'two left';
  assert (select count(*) from questions where set_id = v_set) = 2, 'question 2 deleted';
  assert not exists (select 1 from answer_choices where question_id = i2), 'its choices are gone too';
  assert (select position from questions where id = i3) = 1 and (select position from questions where id = i1) = 2, 'reordered';
  assert (select body from questions where id = i3) = 'Q three EDIT', 'edited';
  assert (select count(*) from answer_choices where question_id = i1 and is_correct) = 1, 'exactly one correct after change';
  assert (select label from answer_choices where question_id = i1 and is_correct) = 'ก', 'correct moved from ข to ก';
  assert (select label from answer_choices where question_id = i3 and is_correct) = 'ง', 'correct set where there was none';

  -- 3) saving the same content again changes nothing (idempotent)
  perform public.save_set_content(v_set, s1, jsonb_build_array(
    jsonb_build_object('id', i3, 'body', 'Q three EDIT', 'explanation', '', 'points', 3,
      'choices', jsonb_build_array('i','j','k','l'), 'correct', 'ง'),
    jsonb_build_object('id', i1, 'body', 'Q one', 'explanation', 'because', 'points', 1,
      'choices', jsonb_build_array('a','b','c','d'), 'correct', 'ก')));
  assert (select count(*) from answer_choices where question_id in (i1, i3)) = 8, 'no duplicate choice rows';

  -- 4) a question that has been given to another set cannot be hijacked
  insert into question_sets (title) values ('other') returning id into v_other;
  perform public.save_set_content(v_other, s1, jsonb_build_array(
    jsonb_build_object('id', i2, 'body', 'mine', 'explanation', '', 'points', 1,
      'choices', jsonb_build_array('1','2','3','4'), 'correct', 'ก')));
  perform pg_temp.expect_err(format($f$select public.save_set_content(%L, %L::jsonb, %L::jsonb)$f$, v_set, s1,
    jsonb_build_array(jsonb_build_object('id', i2, 'body', 'steal', 'explanation', '', 'points', 1,
      'choices', jsonb_build_array('x','x','x','x'), 'correct', 'ก'))), 'FOREIGN_QUESTION');
  assert (select body from questions where id = i2) = 'mine', 'the other set is untouched';

  -- 5) bad payloads
  perform pg_temp.expect_err(format($f$select public.save_set_content(%L, %L::jsonb, %L::jsonb)$f$, v_set, s1,
    jsonb_build_array(jsonb_build_object('id', i1, 'body', 'a', 'choices', jsonb_build_array('1','2','3')))), 'INVALID_PAYLOAD');
  perform pg_temp.expect_err(format($f$select public.save_set_content(%L, %L::jsonb, %L::jsonb)$f$, v_set, s1, '{"a":1}'), 'INVALID_PAYLOAD');
  perform pg_temp.expect_err(format($f$select public.save_set_content(%L, %L::jsonb, %L::jsonb)$f$, v_set, s1,
    jsonb_build_array(
      jsonb_build_object('id', i1, 'body', 'a', 'choices', jsonb_build_array('1','2','3','4')),
      jsonb_build_object('id', i1, 'body', 'b', 'choices', jsonb_build_array('1','2','3','4')))), 'DUPLICATE_ID');
  perform pg_temp.expect_err(format($f$select public.save_set_content(%L, %L::jsonb, %L::jsonb)$f$, gen_random_uuid(), s1, '[]'), 'SET_NOT_FOUND');

  -- 6) an empty list removes everything; settings still apply
  perform public.save_set_content(v_set, '{"title":"empty now","scoring_mode":"equal","equal_points":"2.5","default_reveal_mode":"immediate","instructions":""}', '[]');
  assert (select count(*) from questions where set_id = v_set) = 0, 'all questions removed';
  select * into r from question_sets where id = v_set;
  assert r.title = 'empty now' and r.scoring_mode = 'equal' and r.equal_points = 2.5 and r.default_reveal_mode = 'immediate', 'settings after empty save';

  -- 7) a saved set passes validation when complete and opens correctly
  perform public.save_set_content(v_set, s1, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'body', 'Q1', 'explanation', '', 'points', 1,
      'choices', jsonb_build_array('a','b','c','d'), 'correct', 'ค'),
    jsonb_build_object('id', gen_random_uuid(), 'body', 'Q2', 'explanation', '', 'points', 2,
      'choices', jsonb_build_array('a','b','c','d'), 'correct', 'ง')));
  assert not exists (select 1 from public.validate_question_set(v_set)), 'complete set validates';

  raise exception '✅ ALL SAVE-SET-CONTENT CHECKS PASSED (changes rolled back)';
end $$;

rollback;
