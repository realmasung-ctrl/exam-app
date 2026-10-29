-- =====================================================================
-- 0004_session_cap.sql — Phase 9 hardening
-- Caps the number of attempts per session (500, voided ones excluded) so someone who learns the
-- link cannot flood a session with fake participants. Everything else is identical to 0002.
-- To change the cap, edit the number 500 below and run this file again.
-- =====================================================================
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

  if (select count(*) from exam_participants
       where session_id = s.id and voided_at is null) >= 500 then
    raise exception 'SESSION_FULL';
  end if;

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
