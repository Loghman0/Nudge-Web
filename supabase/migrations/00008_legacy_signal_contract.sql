-- Some hosted installations retained the pre-generation 11-argument public
-- function alongside the guarded 12-argument function with defaults. PostgreSQL
-- cannot choose between them for Discover's 11-argument call (42725).
begin;
-- No CASCADE: an unexpected dependency must stop this upgrade for review.
-- Existing callers still resolve to the guarded function's default generation.
drop function if exists public.record_knowledge_signal(
  text,text,text,public.preference_polarity,text,real,text,uuid,uuid,boolean,jsonb
);
create function nudge_private.signal_contract_version() returns integer
language sql immutable set search_path='' as $$ select 8; $$;
revoke all on function nudge_private.signal_contract_version() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
