begin;

alter table public.native_push_devices add column daily_question_epoch bigint;

create table nudge_private.native_daily_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.native_push_devices(id) on delete cascade,
  device_epoch bigint not null,
  exposure_id uuid references nudge_private.discovery_exposures(id) on delete set null,
  local_day date not null,
  deadline timestamptz not null,
  claim_token uuid,
  retry_after timestamptz not null default now(),
  attempts integer not null default 0,
  finished boolean not null default false,
  unique (user_id, local_day)
);
alter table nudge_private.native_daily_questions enable row level security;
revoke all on nudge_private.native_daily_questions from public, anon, authenticated, service_role;

create function public.enable_native_daily_questions(p_installation_id uuid, p_secret text, p_epoch bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or p_secret is null or p_secret !~ '^[a-f0-9]{64}$' then return false; end if;
  update public.native_push_devices
     set daily_question_epoch=device_epoch
   where installation_id=p_installation_id and user_id=auth.uid() and enabled
     and device_epoch=p_epoch and secret_hash=sha256(convert_to(p_secret,'UTF8'));
  return found;
end $$;

create function nudge_private.native_daily_question_eligible(q jsonb, uid uuid)
returns boolean language sql stable set search_path='' as $$
  select q->>'status'='published' and q->>'sensitivity'='ordinary' and q->>'depth'='0'
    and q->>'format'='choice' and length(q->>'prompt') between 1 and 220
    and not exists(select 1 from nudge_private.discovery_settings s where s.user_id=uid and s.muted_topics ? (q->>'domain'))
    and not exists(select 1 from jsonb_array_elements(coalesce(q->'signals','[]')) r
      join public.forgotten_knowledge_keys f on f.user_id=uid and f.key=nudge_private.discovery_rule_key(r));
$$;

create function public.claim_native_daily_questions(p_policy_version text, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  candidate record;
  exposure nudge_private.discovery_exposures%rowtype;
  question public.discovery_question_versions%rowtype;
  result jsonb;
begin
  delete from nudge_private.native_daily_questions where deadline < p_now - interval '7 days';
  for candidate in
    select p.id as uid, p.memory_generation, p.timezone,
      (p_now at time zone p.timezone)::date as day, device.id as device_id, device.device_epoch
    from public.profiles p
    join lateral (
      select d.id,d.device_epoch from public.native_push_devices d
      where d.user_id=p.id and d.enabled and d.expires_at>p_now and d.daily_question_epoch=d.device_epoch
      order by d.updated_at desc,d.id limit 1
    ) device on true
    where p.terms_version=p_policy_version
      and (p_now at time zone p.timezone)::time >= time '12:00'
      and (p_now at time zone p.timezone)::time < time '13:00'
      and not exists(select 1 from nudge_private.native_daily_questions j
                     where j.user_id=p.id and j.local_day=(p_now at time zone p.timezone)::date)
    order by p.id limit 10 for update of p skip locked
  loop
    select e.* into exposure from nudge_private.discovery_exposures e
     where e.user_id=candidate.uid and e.local_day=candidate.day and e.daily and e.state<>'changed';
    if found then
      if exposure.state<>'served' or exposure.generation<>candidate.memory_generation or not exists(
        select 1 from public.discovery_question_versions q where (q.question_id,q.version)=(exposure.question_id,exposure.question_version)
          and nudge_private.native_daily_question_eligible(q.definition,candidate.uid)
      ) then exposure.id:=null; end if;
    else
      select q.* into question from public.discovery_question_versions q
      where nudge_private.native_daily_question_eligible(q.definition,candidate.uid)
        and not exists(select 1 from public.discovery_question_versions newer where newer.question_id=q.question_id and newer.version>q.version)
        and not exists(select 1 from nudge_private.discovery_answers a where a.user_id=candidate.uid and a.question_id=q.question_id)
        and not exists(select 1 from nudge_private.discovery_exposures e where e.user_id=candidate.uid
                       and e.served_at>p_now-interval '30 days' and e.family_id=q.definition->>'familyId')
      order by md5(candidate.uid::text || candidate.day::text || q.question_id) limit 1;
      if found then
       insert into nudge_private.discovery_exposures
        (user_id,request_id,question_id,question_version,family_id,local_day,daily,served_at,reason,generation)
      values (candidate.uid,gen_random_uuid(),question.question_id,question.version,question.definition->>'familyId',
              candidate.day,true,p_now,'coverage',candidate.memory_generation) returning * into exposure;
      end if;
    end if;
    insert into nudge_private.native_daily_questions(user_id,device_id,device_epoch,exposure_id,local_day,deadline,retry_after,finished)
    values(candidate.uid,candidate.device_id,candidate.device_epoch,exposure.id,candidate.day,
           (candidate.day + time '13:00') at time zone candidate.timezone,p_now,exposure.id is null)
    on conflict(user_id,local_day) do nothing;
  end loop;

  with due as (
    select j.id from nudge_private.native_daily_questions j
    where not j.finished and j.deadline>p_now and j.retry_after<=p_now and j.attempts<3
    order by j.retry_after,j.id limit 10 for update skip locked
  ), claimed as (
    update nudge_private.native_daily_questions j
       set claim_token=gen_random_uuid(),retry_after=p_now+interval '2 minutes',attempts=j.attempts+1
      from due where j.id=due.id returning j.id,j.claim_token
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'claimToken',claim_token)),'[]') into result from claimed;
  return result;
end $$;

create function public.read_native_daily_question(p_id uuid,p_claim_token uuid,p_policy_version text,p_now timestamptz default now())
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('token',d.token,'userId',j.user_id,'questionId',q.question_id,'questionVersion',q.version,'prompt',q.definition->>'prompt')
  from nudge_private.native_daily_questions j
  join public.native_push_devices d on d.id=j.device_id and d.user_id=j.user_id
  join public.profiles p on p.id=j.user_id
  join nudge_private.discovery_exposures e on e.id=j.exposure_id and e.user_id=j.user_id
  join public.discovery_question_versions q on (q.question_id,q.version)=(e.question_id,e.question_version)
  where j.id=p_id and j.claim_token=p_claim_token and not j.finished and j.deadline>p_now and j.retry_after>p_now
    and d.enabled and d.expires_at>p_now and d.device_epoch=j.device_epoch and d.daily_question_epoch=d.device_epoch
    and e.state='served' and e.generation=p.memory_generation and p.terms_version=p_policy_version
    and j.local_day=(p_now at time zone p.timezone)::date
    and (p_now at time zone p.timezone)::time >= time '12:00'
    and (p_now at time zone p.timezone)::time < time '13:00'
    and nudge_private.native_daily_question_eligible(q.definition,j.user_id);
$$;

create function public.finish_native_daily_question(p_id uuid,p_claim_token uuid,p_retry boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update nudge_private.native_daily_questions set finished=not p_retry, claim_token=null
  where id=p_id and claim_token=p_claim_token and not finished;
  return found;
end $$;

create function nudge_private.native_daily_questions_version() returns integer language sql immutable set search_path='' as $$select 21$$;
revoke all on function nudge_private.native_daily_questions_version(),nudge_private.native_daily_question_eligible(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.enable_native_daily_questions(uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.enable_native_daily_questions(uuid,text,bigint) to authenticated;
revoke all on function public.claim_native_daily_questions(text,timestamptz),public.read_native_daily_question(uuid,uuid,text,timestamptz),public.finish_native_daily_question(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.claim_native_daily_questions(text,timestamptz),public.read_native_daily_question(uuid,uuid,text,timestamptz),public.finish_native_daily_question(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
