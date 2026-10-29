-- =====================================================================
-- security.sql — checks that the database is locked down.  READ-ONLY (changes nothing).
-- Run in Supabase SQL Editor after migrations 0001-0004.
-- Success = the last result shows one row:  ✅ ALL SECURITY CHECKS PASSED
-- Failure = a red error starting with FAIL: that says exactly what is wrong.
-- =====================================================================
do $$
declare
  v_bad text;
  v_n   int;
begin
  -- 1) every table in public has row level security ON
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_bad is not null then raise exception 'FAIL: RLS is OFF for table(s): %', v_bad; end if;

  -- 2) anon / authenticated (the roles the PUBLIC key can become) have NO table privileges
  select string_agg(c.relname || ' (' || r.rolname || ')', ', ') into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
     and (   has_table_privilege(r.rolname, c.oid, 'SELECT')
          or has_table_privilege(r.rolname, c.oid, 'INSERT')
          or has_table_privilege(r.rolname, c.oid, 'UPDATE')
          or has_table_privilege(r.rolname, c.oid, 'DELETE'));
  if v_bad is not null then raise exception 'FAIL: public roles can touch table(s): %', v_bad; end if;

  -- 3) anon / authenticated / PUBLIC cannot EXECUTE any function in public
  select string_agg(p.proname || ' (' || r.rolname || ')', ', ') into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
   where n.nspname = 'public' and p.prokind = 'f'
     and has_function_privilege(r.rolname, p.oid, 'EXECUTE');
  if v_bad is not null then raise exception 'FAIL: public roles can run function(s): %', v_bad; end if;

  -- 4) every function that is callable by the server is SECURITY DEFINER with a fixed search_path
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'touch_updated_at'
     and (not p.prosecdef
          or p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'));
  if v_bad is not null then raise exception 'FAIL: function(s) without SECURITY DEFINER + search_path: %', v_bad; end if;

  -- 5) the server role can still do its job
  if not has_function_privilege('service_role', 'public.save_answer(text,uuid,text,bigint)', 'EXECUTE') then
    raise exception 'FAIL: service_role cannot run save_answer';
  end if;
  if not has_table_privilege('service_role', 'public.exam_sessions', 'SELECT') then
    raise exception 'FAIL: service_role cannot read exam_sessions';
  end if;

  -- 6) the auto-submit job is scheduled
  select count(*) into v_n from cron.job where jobname = 'finalize-expired-attempts' and active;
  if v_n <> 1 then raise exception 'FAIL: pg_cron job finalize-expired-attempts is missing or inactive'; end if;

  -- 7) the cap migration (0004) is installed
  if position('SESSION_FULL' in pg_get_functiondef('public.start_attempt(text,text,text,text,text)'::regprocedure)) = 0 then
    raise exception 'FAIL: migration 0004_session_cap.sql has not been run';
  end if;
end $$;

-- 8) behave like the public key: reading a table must be refused
begin;
set local role anon;
do $$
begin
  begin
    perform 1 from public.exam_results limit 1;
    raise exception 'FAIL: anon could read exam_results';
  exception when insufficient_privilege then
    null; -- expected
  end;
  begin
    perform public.finalize_expired();
    raise exception 'FAIL: anon could run finalize_expired';
  exception when insufficient_privilege then
    null; -- expected
  end;
end $$;
rollback;

select '✅ ALL SECURITY CHECKS PASSED' as result;
