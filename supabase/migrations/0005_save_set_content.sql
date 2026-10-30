-- =====================================================================
-- 0005_save_set_content.sql — one-call saving for the one-page question editor
-- Saves the set's settings AND the whole list of questions (text, choices, correct answer, points, order)
-- in a single atomic transaction, instead of one request per question.
--   p_settings  : {"title","instructions","scoring_mode","equal_points","default_reveal_mode"}
--   p_questions : [{"id":uuid,"body","explanation","points"|null,"choices":[4 texts ก,ข,ค,ง],"correct":"ก"|null}, ...]
-- The array ORDER becomes the question order. Questions of the set that are missing from the array are deleted.
-- Ids are chosen by the browser (so new questions can be shown instantly); the function refuses ids that already
-- belong to another set.
-- =====================================================================
create or replace function public.save_set_content(p_set_id uuid, p_settings jsonb, p_questions jsonb)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n int;
begin
  perform 1 from question_sets where id = p_set_id for update;
  if not found then raise exception 'SET_NOT_FOUND'; end if;

  if jsonb_typeof(p_settings) <> 'object' or jsonb_typeof(p_questions) <> 'array' then
    raise exception 'INVALID_PAYLOAD';
  end if;
  v_n := jsonb_array_length(p_questions);
  if v_n > 500 then raise exception 'TOO_MANY_QUESTIONS'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_questions) x
     where jsonb_typeof(x -> 'choices') is distinct from 'array'
        or jsonb_array_length(x -> 'choices') <> 4
  ) then raise exception 'INVALID_PAYLOAD'; end if;

  if (select count(distinct x ->> 'id') from jsonb_array_elements(p_questions) x) <> v_n then
    raise exception 'DUPLICATE_ID';
  end if;

  if exists (
    select 1 from questions q
      join jsonb_array_elements(p_questions) x on q.id = (x ->> 'id')::uuid
     where q.set_id <> p_set_id
  ) then raise exception 'FOREIGN_QUESTION'; end if;

  -- settings (any edit turns a "ready" set back into a draft)
  update question_sets
     set title               = coalesce(nullif(btrim(p_settings ->> 'title'), ''), title),
         instructions        = coalesce(p_settings ->> 'instructions', instructions),
         scoring_mode        = coalesce(p_settings ->> 'scoring_mode', scoring_mode),
         equal_points        = coalesce(nullif(p_settings ->> 'equal_points', '')::numeric, equal_points),
         default_reveal_mode = coalesce(p_settings ->> 'default_reveal_mode', default_reveal_mode),
         status              = 'draft'
   where id = p_set_id;

  -- questions removed in the editor
  delete from questions
   where set_id = p_set_id
     and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p_questions) x);

  -- new questions
  insert into questions (id, set_id, position, body, explanation, points)
  select (x ->> 'id')::uuid, p_set_id, ord::int, coalesce(x ->> 'body', ''),
         nullif(x ->> 'explanation', ''), coalesce(nullif(x ->> 'points', '')::numeric, 1)
    from jsonb_array_elements(p_questions) with ordinality as t(x, ord)
  on conflict (id) do nothing;

  -- existing questions (also re-applies position; the unique constraint on position is deferred)
  update questions q
     set position    = s.pos,
         body        = coalesce(s.body, ''),
         explanation = nullif(s.explanation, ''),
         points      = coalesce(s.points, q.points)
    from (
      select (x ->> 'id')::uuid as id, ord::int as pos, x ->> 'body' as body,
             x ->> 'explanation' as explanation, nullif(x ->> 'points', '')::numeric as points
        from jsonb_array_elements(p_questions) with ordinality as t(x, ord)
    ) s
   where q.id = s.id and q.set_id = p_set_id;

  -- the four choices of every question; is_correct is reset here and set again below
  insert into answer_choices (question_id, label, body, is_correct)
  select s.id, (array['ก', 'ข', 'ค', 'ง'])[c.idx::int], coalesce(c.val, ''), false
    from (select (x ->> 'id')::uuid as id, x -> 'choices' as choices from jsonb_array_elements(p_questions) x) s
    cross join lateral jsonb_array_elements_text(s.choices) with ordinality as c(val, idx)
  on conflict (question_id, label) do update set body = excluded.body, is_correct = false;

  update answer_choices ac
     set is_correct = true
    from (select (x ->> 'id')::uuid as id, nullif(x ->> 'correct', '') as correct from jsonb_array_elements(p_questions) x) s
   where ac.question_id = s.id and ac.label = s.correct;

  return v_n;
end $$;

revoke all on function public.save_set_content(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_set_content(uuid, jsonb, jsonb) to service_role;
