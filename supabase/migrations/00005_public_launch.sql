-- Public launch controls. Apply after 00004; existing journal data is retained.
begin;
alter table public.profiles add column ai_enabled boolean not null default false,
  add column ai_consent_updated_at timestamptz,
  add column terms_version text,
  add column terms_accepted_at timestamptz,
  add column privacy_notice_version text;

create function public.accept_legal_terms(p_version text,p_age_eligible boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_version is distinct from '2026-10-12' or p_age_eligible is distinct from true then raise exception 'Confirm eligibility and current terms'; end if;
  update public.profiles set terms_version=p_version,privacy_notice_version=p_version,terms_accepted_at=clock_timestamp()
    where id=auth.uid() and terms_version is distinct from p_version;
end $$;
create function public.set_ai_enabled(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_enabled is null then raise exception 'Invalid AI preference'; end if;
  perform 1 from public.profiles where id=auth.uid() and terms_version='2026-10-12' for update;
  if not found then raise exception 'Accept the current terms first'; end if;
  update public.profiles set ai_enabled=p_enabled,ai_consent_updated_at=clock_timestamp(),memory_generation=memory_generation+1
    where id=auth.uid() and ai_enabled is distinct from p_enabled;
end $$;

-- Onboarding and skips do not complete the daily Discover target.
create or replace function public.discover_next_question(p_topic text default null)
returns setof public.questions language sql stable security definer set search_path='' as $$
  with recent as (
    select a.question_id,a.answer from public.question_answers a where a.user_id=auth.uid()
    order by a.created_at desc,a.id desc limit 1
  ), counts as (
    select q.context->>'topic' as topic,count(*) as answered from public.question_answers a
    join public.questions q on q.id=a.question_id where a.user_id=auth.uid() group by q.context->>'topic'
  )
  select q.id,q.category_id,q.kind,q.prompt,q.option_a,q.option_b,q.maps_to_key_a,q.maps_to_key_b,
    case when branch.child_question_id is null then q.context else q.context||jsonb_build_object('connection',
      'Because you chose “'||case branch.parent_choice when 'a' then parent.option_a else parent.option_b end||'”. Let’s explore what that means for you.') end,
    q.is_onboarding,q.is_active,q.sort_order,q.created_at
  from public.questions q
  left join public.question_branches branch on branch.child_question_id=q.id
  left join public.questions parent on parent.id=branch.parent_question_id
  left join counts c on c.topic=q.context->>'topic'
  where auth.uid() is not null and q.is_active and not q.is_onboarding and q.option_a is not null and q.option_b is not null
    and (p_topic is null or q.context->>'topic'=p_topic)
    and not exists(select 1 from public.question_answers a where a.user_id=auth.uid() and a.question_id=q.id)
    and (branch.child_question_id is null or exists(select 1 from public.question_answers a
      where a.user_id=auth.uid() and a.question_id=branch.parent_question_id and a.answer=branch.parent_choice))
  order by case when exists(select 1 from recent r where r.question_id=branch.parent_question_id and r.answer=branch.parent_choice) then 0 else 1 end,
    coalesce(c.answered,0),q.sort_order,q.id limit 1;
$$;
create or replace function public.next_unanswered_question()
returns setof public.questions language sql stable security definer set search_path='' as $$
  select * from public.discover_next_question(null);
$$;

-- Count accessible questions, including answered ones, rather than locked paths.
create or replace function public.question_progress()
returns table(total_questions integer,total_answered integer,answered_today integer)
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); tz text;
begin
  if uid is null then return query select 0,0,0; return; end if;
  select coalesce(nullif(trim(p.timezone),''),'UTC') into tz from public.profiles p where p.id=uid;
  if tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then tz:='UTC'; end if;
  return query select
    (select count(*)::integer from public.questions q left join public.question_branches b on b.child_question_id=q.id
      where q.is_active and not q.is_onboarding and (b.child_question_id is null or exists(select 1 from public.question_answers a
        where a.user_id=uid and a.question_id=b.parent_question_id and a.answer=b.parent_choice))),
    (select count(*)::integer from public.question_answers a join public.questions q on q.id=a.question_id where a.user_id=uid and q.is_active and not q.is_onboarding),
    (select count(*)::integer from public.question_answers a join public.questions q on q.id=a.question_id where a.user_id=uid and not a.skipped and not q.is_onboarding
      and (a.created_at at time zone tz)::date=(now() at time zone tz)::date);
end $$;


-- Server-side quota persists across deployment instances. Counters expire after 48 hours.
create table nudge_private.ai_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null, bucket timestamptz not null, calls integer not null,
  primary key(user_id,action,bucket)
);
revoke all on nudge_private.ai_usage from public,anon,authenticated;
create function public.reserve_ai_request(p_action text) returns boolean
language plpgsql security definer set search_path='' as $$
declare window_start timestamptz; per_user_limit integer; used integer;
begin
  if auth.uid() is null or p_action is null or p_action not in ('extract','explain','recap') then return false; end if;
  perform 1 from public.profiles where id=auth.uid() and ai_enabled and terms_version='2026-10-12' for update;
  if not found then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(68432109);
  window_start:=case when p_action='explain' then pg_catalog.to_timestamp(floor(extract(epoch from now())/600)*600)
    else date_trunc('hour',now()) end;
  per_user_limit:=case p_action when 'explain' then 30 when 'recap' then 5 else 10 end;
  if (select coalesce(sum(calls),0) from nudge_private.ai_usage where bucket>=date_trunc('hour',now()))>=1000 then return false; end if;
  select calls into used from nudge_private.ai_usage where user_id=auth.uid() and action=p_action and bucket=window_start;
  if coalesce(used,0)>=per_user_limit then return false; end if;
  insert into nudge_private.ai_usage(user_id,action,bucket,calls) values(auth.uid(),p_action,window_start,1)
    on conflict(user_id,action,bucket) do update set calls=nudge_private.ai_usage.calls+1;
  delete from nudge_private.ai_usage where bucket<now()-interval '48 hours';
  return true;
end $$;
alter function public.complete_onboarding(jsonb,jsonb,integer) set schema nudge_private;
create function public.complete_onboarding(p_profile jsonb,p_answers jsonb,p_expected_generation integer) returns integer
language plpgsql security definer set search_path='' as $$
begin
  if nullif(p_profile->>'age','') is not null and (p_profile->>'age')::integer<16 then raise exception 'Nudge is for users aged 16 and older'; end if;
  return nudge_private.complete_onboarding(p_profile,p_answers,p_expected_generation);
end $$;
revoke all on function nudge_private.complete_onboarding(jsonb,jsonb,integer) from public,anon,authenticated;
revoke all on function public.complete_onboarding(jsonb,jsonb,integer),public.reserve_ai_request(text) from public,anon;
grant execute on function public.complete_onboarding(jsonb,jsonb,integer),public.reserve_ai_request(text) to authenticated;

-- Repair owner membership left missing by legacy two-step creation.
insert into public.decision_group_members(group_id,user_id,role)
  select id,owner_id,'owner' from public.decision_groups
  on conflict(group_id,user_id) do update set role='owner';

-- Atomic circle creation avoids an orphaned circle when membership creation fails.
create function public.create_circle(p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Enter a circle name of 1 to 80 characters'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  if (select count(*) from public.decision_groups where owner_id=auth.uid())>=20 then raise exception 'You can own up to 20 circles'; end if;
  insert into public.decision_groups(owner_id,name) values(auth.uid(),trim(p_name)) returning id into gid;
  insert into public.decision_group_members(group_id,user_id,role) values(gid,auth.uid(),'owner');
  return gid;
end $$;
create or replace function public.join_decision_circle(code text) returns uuid
language plpgsql security definer set search_path='' as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if code is null or length(trim(code))<>18 then raise exception 'This invitation is no longer valid'; end if;
  select id into gid from public.decision_groups where invite_code=lower(trim(code)) for update;
  if gid is null then raise exception 'This invitation is no longer valid'; end if;
  if exists(select 1 from public.decision_group_members where group_id=gid and user_id=auth.uid()) then return gid; end if;
  if (select count(*) from public.decision_group_members where group_id=gid)>=100 then raise exception 'This circle is full'; end if;
  insert into public.decision_group_members(group_id,user_id,role) values(gid,auth.uid(),'member');return gid;
end $$;
create function public.create_circle_poll(p_group_id uuid,p_question text,p_options jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid; option text; pos integer:=0;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.decision_groups where id=p_group_id for update;
  if not found or not public.is_circle_member(p_group_id) then raise exception 'Circle not found'; end if;
  if p_question is null or length(trim(p_question)) not between 1 and 200 or p_options is null
    or jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options) not between 2 and 5 then raise exception 'Add a question and two to five options'; end if;
  if exists(select 1 from jsonb_array_elements(p_options) v where jsonb_typeof(v)<>'string') then raise exception 'Invalid poll option'; end if;
  if (select count(distinct lower(trim(v))) from jsonb_array_elements_text(p_options) v)<>jsonb_array_length(p_options) then raise exception 'Poll options must be distinct'; end if;
  if (select count(*) from public.group_polls where group_id=p_group_id and status='open')>=50 then raise exception 'Close an existing vote before opening another'; end if;
  insert into public.group_polls(group_id,created_by,question) values(p_group_id,auth.uid(),trim(p_question)) returning id into pid;
  for option in select value from jsonb_array_elements_text(p_options) loop
    if length(trim(option)) not between 1 and 100 then raise exception 'Poll options must have 1 to 100 characters'; end if;
    insert into public.group_poll_options(poll_id,label,sort_order) values(pid,trim(option),pos);pos:=pos+1;
  end loop;
  return pid;
end $$;
create function public.cast_circle_vote(p_poll_id uuid,p_option_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select group_id into gid from public.group_polls where id=p_poll_id;
  if gid is null then raise exception 'This vote is closed or unavailable'; end if;
  -- Match leave/delete/create lock order so a departing member cannot race a vote.
  perform 1 from public.decision_groups where id=gid for update;
  if not found or not public.is_circle_member(gid) then raise exception 'This vote is closed or unavailable'; end if;
  perform 1 from public.group_polls where id=p_poll_id and group_id=gid and status='open' for update;
  if not found then raise exception 'This vote is closed or unavailable'; end if;
  if not exists(select 1 from public.group_poll_options where id=p_option_id and poll_id=p_poll_id) then raise exception 'Invalid vote option'; end if;
  insert into public.group_poll_votes(poll_id,option_id,user_id) values(p_poll_id,p_option_id,auth.uid())
    on conflict(poll_id,user_id) do update set option_id=excluded.option_id,created_at=clock_timestamp();
end $$;
create function public.close_circle_poll(p_group_id uuid,p_poll_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.decision_groups where id=p_group_id for update;
  if not found then raise exception 'You cannot close this vote'; end if;
  perform 1 from public.group_polls p join public.decision_groups g on g.id=p.group_id
    where p.id=p_poll_id and p.group_id=p_group_id and (p.created_by=auth.uid() or g.owner_id=auth.uid())
      and public.is_circle_member(p_group_id) for update of p;
  if not found then raise exception 'You cannot close this vote'; end if;
  update public.group_polls set status='closed' where id=p_poll_id;
end $$;
-- Use pgcrypto's schema in both SQL-editor installs (public) and Supabase (extensions).
-- gen_random_bytes is resolved once here into an internal helper with a pinned path.
create function nudge_private.new_invite_code() returns text language sql volatile set search_path=public,extensions as $$
  select encode(gen_random_bytes(9),'hex');
$$;
create or replace function public.manage_circle(p_group_id uuid,p_action text) returns text
language plpgsql security definer set search_path='' as $$
declare owner uuid; code text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select owner_id into owner from public.decision_groups where id=p_group_id for update;
  if not found then raise exception 'Circle not found'; end if;
  if p_action='leave' then
    if owner=auth.uid() then raise exception 'Owners must delete the circle instead of leaving'; end if;
    delete from public.group_poll_votes v using public.group_polls p where v.poll_id=p.id and p.group_id=p_group_id and v.user_id=auth.uid();
    delete from public.decision_group_members where group_id=p_group_id and user_id=auth.uid();
  elsif owner=auth.uid() and p_action='delete' then delete from public.decision_groups where id=p_group_id;
  elsif owner=auth.uid() and p_action='rotate_invite' then
    code:=nudge_private.new_invite_code();update public.decision_groups set invite_code=code where id=p_group_id;return code;
  else raise exception 'You cannot manage this circle'; end if;
  return null;
end $$;
revoke all on function nudge_private.new_invite_code() from public,anon,authenticated;
revoke insert,update,delete on public.decision_groups,public.decision_group_members,public.group_polls,public.group_poll_options,public.group_poll_votes from authenticated;
revoke all on function public.accept_legal_terms(text,boolean),public.set_ai_enabled(boolean),public.create_circle(text),
  public.create_circle_poll(uuid,text,jsonb),public.cast_circle_vote(uuid,uuid),public.close_circle_poll(uuid,uuid),public.manage_circle(uuid,text) from public,anon;
grant execute on function public.accept_legal_terms(text,boolean),public.set_ai_enabled(boolean),public.create_circle(text),
  public.create_circle_poll(uuid,text,jsonb),public.cast_circle_vote(uuid,uuid),public.close_circle_poll(uuid,uuid),public.manage_circle(uuid,text) to authenticated;
-- Do not retain broken reminder links after deleting journal history.
create function nudge_private.remove_decision_notifications() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.notifications where user_id=old.user_id and payload->>'decision_id'=old.id::text;
  return old;
end $$;
revoke all on function nudge_private.remove_decision_notifications() from public,anon,authenticated;
create trigger decision_notification_cleanup before delete on public.decisions
  for each row execute function nudge_private.remove_decision_notifications();
notify pgrst,'reload schema';
commit;
