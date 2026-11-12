-- Immutable, owner-only comparison evidence and explicit reusable settings.
-- Journal entries remain intact when derived evidence/settings are purged.
begin;

create table nudge_private.comparison_evidence (
  user_id uuid not null references public.profiles(id) on delete cascade,
  decision_id uuid not null references public.decisions(id) on delete cascade,
  comparison_revision integer not null check(comparison_revision>=0),
  scoring_run_id uuid not null,
  memory_generation integer not null check(memory_generation>=0),
  snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(decision_id,comparison_revision),
  unique(user_id,scoring_run_id)
);
create index comparison_evidence_owner_idx on nudge_private.comparison_evidence(user_id,decision_id,comparison_revision);
alter table nudge_private.comparison_evidence enable row level security;
revoke all on nudge_private.comparison_evidence from public,anon,authenticated,service_role;

create table nudge_private.comparison_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  domain text not null,
  category public.decision_category not null,
  goal text not null default '',
  aliases jsonb not null default '[]'::jsonb,
  memory_generation integer not null check(memory_generation>=0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index comparison_settings_name_idx on nudge_private.comparison_settings(user_id,domain,lower(name));
alter table nudge_private.comparison_settings enable row level security;
revoke all on nudge_private.comparison_settings from public,anon,authenticated,service_role;

-- This catches erasure, forgetting, corrections, memory edits and AI consent
-- changes at the canonical generation boundary, including future callers.
create function nudge_private.purge_comparison_derivatives() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.memory_generation is distinct from old.memory_generation then
    delete from nudge_private.comparison_evidence where user_id=new.id;
    delete from nudge_private.comparison_settings where user_id=new.id;
  end if;
  return new;
end $$;
create trigger profiles_purge_comparison_derivatives after update of memory_generation on public.profiles
for each row execute function nudge_private.purge_comparison_derivatives();

-- Strict whitelists prevent arbitrary raw notes or preference payloads from
-- being added to an otherwise innocuous looking explanation snapshot.
create function nudge_private.validate_comparison_evidence(p_evidence jsonb,p_decision_id uuid,p_generation integer)
returns void language plpgsql security definer set search_path='' as $$
declare d public.decisions%rowtype; o jsonb; saved public.decision_options%rowtype; item jsonb;
  position integer:=0; config jsonb; weights jsonb; counts jsonb; sources jsonb; breakdown jsonb;
begin
  select * into d from public.decisions where id=p_decision_id and user_id=auth.uid();
  if not found then raise exception 'Comparison not found'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>131072
    or (p_evidence-array['version','scoringRunId','scoredAt','basis','engineVersion','engineConfig','confidence','coldStart','evidenceState','options'])<>'{}'::jsonb
    or p_evidence->'version' is distinct from '1'::jsonb or p_evidence->'engineVersion' is distinct from '2'::jsonb
    or jsonb_typeof(p_evidence->'scoringRunId') is distinct from 'string'
    or (p_evidence->>'scoringRunId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_evidence->'scoredAt') is distinct from 'string' or length(p_evidence->>'scoredAt')>40
    or (p_evidence->>'scoredAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.]\d{1,6})?Z$'
    or coalesce(p_evidence->>'basis','') not in ('journal','criteria')
    or coalesce(p_evidence->>'confidence','') not in ('high','medium','low')
    or jsonb_typeof(p_evidence->'coldStart') is distinct from 'boolean'
    or coalesce(p_evidence->>'evidenceState','') not in ('personal_fit','insufficient')
    or jsonb_typeof(p_evidence->'options') is distinct from 'array' then raise exception 'Invalid comparison evidence'; end if;
  if p_evidence->>'scoringRunId' is distinct from d.context->>'scoring_run_id'
    or p_evidence->>'scoredAt' is distinct from d.context->>'scored_at'
    or p_evidence->>'basis' is distinct from (case when d.context->>'comparisonBasis'='criteria' then 'criteria' else 'journal' end)
    or p_evidence->>'confidence' is distinct from d.context->>'confidence'
    or p_evidence->'coldStart' is distinct from d.context->'cold_start'
    or p_evidence->>'evidenceState' is distinct from d.context->>'evidence_state'
    or d.context->'engine_version' is distinct from '2'::jsonb
    or p_generation is distinct from (select memory_generation from public.profiles where id=auth.uid()) then
    raise exception 'Comparison evidence does not match the saved run'; end if;
  perform (p_evidence->>'scoredAt')::timestamptz;
  config:=p_evidence->'engineConfig';weights:=config->'weights';
  if jsonb_typeof(config) is distinct from 'object' or (config-array['category','version','weights'])<>'{}'::jsonb
    or jsonb_typeof(config->'category') is distinct from 'string' or length(config->>'category') not between 1 and 80
    or jsonb_typeof(config->'version') is distinct from 'number' or (config->>'version') !~ '^\d+$'
    or jsonb_typeof(weights) is distinct from 'object' or (weights-array['preferenceMatch','historySuccess','novelty'])<>'{}'::jsonb
    or config is distinct from d.context->'engine_config' then raise exception 'Invalid comparison engine evidence'; end if;
  foreach breakdown in array array[weights] loop
    if jsonb_typeof(breakdown->'preferenceMatch') is distinct from 'number' or jsonb_typeof(breakdown->'historySuccess') is distinct from 'number'
      or jsonb_typeof(breakdown->'novelty') is distinct from 'number' then raise exception 'Invalid comparison weights'; end if;
    for item in select value from jsonb_each(breakdown) loop
      if (item#>>'{}')::numeric not between 0 and 1 then raise exception 'Invalid comparison weights'; end if;
    end loop;
  end loop;
  if abs((weights->>'preferenceMatch')::numeric+(weights->>'historySuccess')::numeric+(weights->>'novelty')::numeric-1)>0.000000001 then
    raise exception 'Invalid comparison weights'; end if;
  if jsonb_array_length(p_evidence->'options') not between 2 and 8
    or jsonb_array_length(p_evidence->'options')<>(select count(*) from public.decision_options where decision_id=d.id) then
    raise exception 'Comparison evidence options do not match'; end if;
  for o in select value from jsonb_array_elements(p_evidence->'options') loop
    position:=position+1;
    if jsonb_typeof(o) is distinct from 'object' or (o-array['label','score','breakdown','reasons','warning','sourceCounts','sourceIds'])<>'{}'::jsonb
      or jsonb_typeof(o->'label') is distinct from 'string' or length(o->>'label') not between 1 and 80
      or jsonb_typeof(o->'score') is distinct from 'number' or (o->>'score')::numeric not between 0 and 1
      or jsonb_typeof(o->'warning') is distinct from 'boolean' or jsonb_typeof(o->'reasons') is distinct from 'array'
      or jsonb_array_length(o->'reasons') not between 1 and 5 then raise exception 'Invalid comparison option evidence'; end if;
    for item in select value from jsonb_array_elements(o->'reasons') loop
      if jsonb_typeof(item) is distinct from 'string' or length(item#>>'{}') not between 1 and 500 then raise exception 'Invalid comparison reason'; end if;
    end loop;
    breakdown:=o->'breakdown';
    if jsonb_typeof(breakdown) is distinct from 'object'
      or (p_evidence->>'basis'='journal' and ((breakdown-array['preferenceMatch','historySuccess','novelty'])<>'{}'::jsonb
        or not breakdown ?& array['preferenceMatch','historySuccess','novelty']))
      or (p_evidence->>'basis'='criteria' and ((breakdown-array['criteriaLow','criteriaHigh','coverage'])<>'{}'::jsonb
        or not breakdown ?& array['criteriaLow','criteriaHigh','coverage'])) then
      raise exception 'Invalid comparison score breakdown'; end if;
    for item in select value from jsonb_each(breakdown) loop
      if jsonb_typeof(item) is distinct from 'number' or (item#>>'{}')::numeric not between 0 and 1 then raise exception 'Invalid comparison score breakdown'; end if;
    end loop;
    select * into saved from public.decision_options where decision_id=d.id and rank=position;
    if not found or saved.label is distinct from o->>'label' or saved.score is distinct from (o->>'score')::real
      or saved.score_breakdown is distinct from breakdown then raise exception 'Comparison evidence options do not match'; end if;
    counts:=o->'sourceCounts';sources:=o->'sourceIds';
    if jsonb_typeof(counts) is distinct from 'object' or (counts-array['preferences','decisions','reflections'])<>'{}'::jsonb
      or jsonb_typeof(sources) is distinct from 'object' or (sources-array['preferenceIds','decisionIds'])<>'{}'::jsonb then raise exception 'Invalid comparison sources'; end if;
    foreach config in array array[counts->'preferences',counts->'decisions',counts->'reflections'] loop
      if jsonb_typeof(config) is distinct from 'number' or (config#>>'{}') !~ '^\d+$' or (config#>>'{}')::numeric>1000000 then raise exception 'Invalid comparison source count'; end if;
    end loop;
    if (counts->>'reflections')::numeric>(counts->>'decisions')::numeric then raise exception 'Invalid comparison source count'; end if;
    foreach config in array array[sources->'preferenceIds',sources->'decisionIds'] loop
      if jsonb_typeof(config) is distinct from 'array' or jsonb_array_length(config)>80 then raise exception 'Invalid comparison source ids'; end if;
      for item in select value from jsonb_array_elements(config) loop
        if jsonb_typeof(item) is distinct from 'string' or (item#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Invalid comparison source id'; end if;
      end loop;
      if (select count(distinct lower(x)) from jsonb_array_elements_text(config) x)<>jsonb_array_length(config) then raise exception 'Duplicate comparison source ids'; end if;
    end loop;
    if jsonb_array_length(sources->'preferenceIds')>(counts->>'preferences')::numeric
      or jsonb_array_length(sources->'decisionIds')>(counts->>'decisions')::numeric then raise exception 'Invalid comparison source count'; end if;
    if p_evidence->>'basis'='criteria' and (o->'warning'<>'false'::jsonb or counts<>'{"preferences":0,"decisions":0,"reflections":0}'::jsonb) then
      raise exception 'Criteria evidence cannot use personal sources'; end if;
    if exists(select 1 from jsonb_array_elements_text(sources->'preferenceIds') x where not exists(select 1 from public.preferences p where p.id=x::uuid and p.user_id=auth.uid()))
      or exists(select 1 from jsonb_array_elements_text(sources->'decisionIds') x where not exists(select 1 from public.decisions s where s.id=x::uuid and s.user_id=auth.uid())) then
      raise exception 'Invalid comparison source owner'; end if;
  end loop;
end $$;

create function public.create_comparison_with_evidence(p_request_id uuid,p_intent jsonb,p_category public.decision_category,
  p_title text,p_context jsonb,p_expected_outcome text,p_options jsonb,p_generation integer,p_evidence jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare decision uuid; replay boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Profile not found'; end if;
  replay:=exists(select 1 from nudge_private.comparison_requests where user_id=auth.uid() and request_id=p_request_id);
  decision:=public.create_comparison_once(p_request_id,p_intent,p_category,p_title,p_context,p_expected_outcome,p_options,p_generation);
  -- Transport retries return exactly the original decision/evidence. An old
  -- legacy request or a privacy-purged run must never gain new explanations.
  if replay then return decision; end if;
  perform nudge_private.validate_comparison_evidence(p_evidence,decision,p_generation);
  insert into nudge_private.comparison_evidence(user_id,decision_id,comparison_revision,scoring_run_id,memory_generation,snapshot)
    select auth.uid(),decision,comparison_revision,(p_evidence->>'scoringRunId')::uuid,p_generation,p_evidence from public.decisions where id=decision;
  return decision;
end $$;

create function public.rerank_comparison_with_evidence(p_decision_id uuid,p_revision integer,p_options jsonb,p_context jsonb,p_generation integer,p_evidence jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare d public.decisions%rowtype; generation integer; previous nudge_private.comparison_evidence%rowtype;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select memory_generation into generation from public.profiles where id=auth.uid() for update;
  if p_generation is distinct from generation then raise exception 'Your memory changed. Reload this comparison'; end if;
  select * into d from public.decisions where id=p_decision_id and user_id=auth.uid() for update;
  if not found then raise exception 'Comparison not found'; end if;
  select * into previous from nudge_private.comparison_evidence where decision_id=d.id and comparison_revision=d.comparison_revision;
  if d.status='open' and d.comparison_revision=p_revision+1 and previous.scoring_run_id::text=p_context->>'scoring_run_id' then
    if previous.snapshot is distinct from p_evidence or d.context is distinct from p_context then raise exception 'Comparison retry does not match the saved run'; end if;
    perform nudge_private.validate_comparison_evidence(p_evidence,d.id,p_generation);
    return;
  end if;
  perform public.rerank_comparison(p_decision_id,p_revision,p_options,p_context,p_generation);
  perform nudge_private.validate_comparison_evidence(p_evidence,p_decision_id,p_generation);
  insert into nudge_private.comparison_evidence(user_id,decision_id,comparison_revision,scoring_run_id,memory_generation,snapshot)
    values(auth.uid(),p_decision_id,p_revision+1,(p_evidence->>'scoringRunId')::uuid,p_generation,p_evidence);
end $$;

create function public.read_my_comparison_evidence(p_decision_id uuid)
returns table(decision_id uuid,comparison_revision integer,scoring_run_id uuid,memory_generation integer,snapshot jsonb,created_at timestamptz)
language sql stable security definer set search_path='' as $$
  select e.decision_id,e.comparison_revision,e.scoring_run_id,e.memory_generation,e.snapshot,e.created_at
  from nudge_private.comparison_evidence e join public.profiles p on p.id=e.user_id
  where e.user_id=auth.uid() and e.decision_id=p_decision_id and e.memory_generation=p.memory_generation order by e.comparison_revision;
$$;
create function public.export_my_comparison_evidence(p_offset integer default 0)
returns table(decision_id uuid,comparison_revision integer,scoring_run_id uuid,memory_generation integer,snapshot jsonb,created_at timestamptz)
language sql stable security definer set search_path='' as $$
  select e.decision_id,e.comparison_revision,e.scoring_run_id,e.memory_generation,e.snapshot,e.created_at
  from nudge_private.comparison_evidence e join public.profiles p on p.id=e.user_id
  where e.user_id=auth.uid() and e.memory_generation=p.memory_generation
  order by e.decision_id,e.comparison_revision limit 100 offset greatest(0,least(coalesce(p_offset,0),1000000));
$$;

create function public.list_comparison_settings()
returns table(id uuid,name text,domain text,category public.decision_category,goal text,aliases jsonb,memory_generation integer,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
  select s.id,s.name,s.domain,s.category,s.goal,s.aliases,s.memory_generation,s.created_at,s.updated_at
  from nudge_private.comparison_settings s join public.profiles p on p.id=s.user_id
  where s.user_id=auth.uid() and s.memory_generation=p.memory_generation order by s.created_at,s.id limit 20;
$$;
create function public.read_my_comparison_setting(p_id uuid)
returns table(id uuid,name text,domain text,category public.decision_category,goal text,aliases jsonb,memory_generation integer,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
  select * from public.list_comparison_settings() s where s.id=p_id;
$$;
create function public.get_comparison_settings_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare generation integer; settings jsonb;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select memory_generation into generation from public.profiles where id=auth.uid() for share;
  if not found then raise exception 'Profile not found'; end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at,s.id),'[]'::jsonb) into settings from public.list_comparison_settings() s;
  return jsonb_build_object('generation',generation,'settings',settings);
end $$;

create function public.save_comparison_setting(p_id uuid,p_name text,p_domain text,p_category public.decision_category,p_goal text,p_aliases jsonb,p_generation integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare generation integer; setting uuid:=p_id; alias jsonb; normalized_aliases jsonb:='[]'::jsonb;
  normalized_name text:=trim(p_name); normalized_domain text:=lower(regexp_replace(trim(p_domain),'\s+',' ','g'));
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select memory_generation into generation from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Profile not found'; end if;
  if p_generation is distinct from generation then raise exception 'Your memory changed. Enter these settings again'; end if;
  if length(coalesce(normalized_name,'')) not between 1 and 80 or length(coalesce(normalized_domain,'')) not between 1 and 100
    or p_category is null or p_goal is null or length(p_goal)>300 or p_aliases is null or jsonb_typeof(p_aliases) is distinct from 'array'
    or jsonb_array_length(p_aliases)>12 then raise exception 'Invalid comparison setting'; end if;
  for alias in select value from jsonb_array_elements(p_aliases) loop
    if jsonb_typeof(alias) is distinct from 'object' or (alias-array['term','meaning'])<>'{}'::jsonb
      or jsonb_typeof(alias->'term') is distinct from 'string' or length(trim(alias->>'term')) not between 1 and 80
      or jsonb_typeof(alias->'meaning') is distinct from 'string' or length(trim(alias->>'meaning')) not between 1 and 500 then raise exception 'Invalid setting alias'; end if;
    normalized_aliases:=normalized_aliases||jsonb_build_array(jsonb_build_object('term',regexp_replace(trim(alias->>'term'),'\s+',' ','g'),'meaning',trim(alias->>'meaning')));
  end loop;
  if (select count(distinct lower(a->>'term')) from jsonb_array_elements(normalized_aliases) a)<>jsonb_array_length(normalized_aliases) then raise exception 'Alias terms must be distinct'; end if;
  if setting is null then
    if (select count(*) from nudge_private.comparison_settings where user_id=auth.uid())>=20 then raise exception 'You can save up to 20 comparison settings'; end if;
    insert into nudge_private.comparison_settings(user_id,name,domain,category,goal,aliases,memory_generation)
      values(auth.uid(),normalized_name,normalized_domain,p_category,trim(p_goal),normalized_aliases,generation) returning id into setting;
  else
    update nudge_private.comparison_settings set name=normalized_name,domain=normalized_domain,category=p_category,goal=trim(p_goal),aliases=normalized_aliases,updated_at=clock_timestamp()
      where id=setting and user_id=auth.uid() and memory_generation=generation;
    if not found then raise exception 'Comparison setting no longer exists'; end if;
  end if;
  return setting;
end $$;
create function public.delete_comparison_setting(p_id uuid,p_generation integer) returns void
language plpgsql security definer set search_path='' as $$
declare generation integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select memory_generation into generation from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Profile not found'; end if;
  if p_generation is distinct from generation then raise exception 'Your memory changed. Reload saved settings'; end if;
  delete from nudge_private.comparison_settings where id=p_id and user_id=auth.uid();
end $$;

revoke all on function nudge_private.purge_comparison_derivatives(),nudge_private.validate_comparison_evidence(jsonb,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.create_comparison_with_evidence(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer,jsonb),
  public.rerank_comparison_with_evidence(uuid,integer,jsonb,jsonb,integer,jsonb),public.read_my_comparison_evidence(uuid),public.export_my_comparison_evidence(integer),
  public.list_comparison_settings(),public.read_my_comparison_setting(uuid),public.get_comparison_settings_state(),
  public.save_comparison_setting(uuid,text,text,public.decision_category,text,jsonb,integer),public.delete_comparison_setting(uuid,integer) from public,anon;
grant execute on function public.create_comparison_with_evidence(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer,jsonb),
  public.rerank_comparison_with_evidence(uuid,integer,jsonb,jsonb,integer,jsonb),public.read_my_comparison_evidence(uuid),public.export_my_comparison_evidence(integer),
  public.list_comparison_settings(),public.read_my_comparison_setting(uuid),public.get_comparison_settings_state(),
  public.save_comparison_setting(uuid,text,text,public.decision_category,text,jsonb,integer),public.delete_comparison_setting(uuid,integer) to authenticated;
create function nudge_private.comparison_evidence_settings_version() returns integer language sql immutable set search_path='' as $$select 11$$;
revoke all on function nudge_private.comparison_evidence_settings_version() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
