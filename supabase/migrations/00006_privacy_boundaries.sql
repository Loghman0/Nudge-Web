-- Privacy repairs for existing and fresh installations. Apply after 00005.
begin;

-- Serialize the upgrade repair with all canonical learning/reset operations.
select id from public.profiles order by id for update;

create or replace function nudge_private.forget_knowledge_key(p_key text)
returns void language plpgsql security definer set search_path='' as $$
declare target public.knowledge_nodes%rowtype; label text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into target from public.knowledge_nodes where user_id=auth.uid() and key=lower(p_key);
  label:=lower(trim(coalesce(target.value,replace(regexp_replace(target.key,'^.*[.]',''),'-',' '))));
  insert into public.forgotten_knowledge_keys(user_id,key) values(auth.uid(),lower(p_key)) on conflict do nothing;
  update public.knowledge_nodes set status='forgotten'
    where user_id=auth.uid() and (key=lower(p_key) or
      (category_slug=target.category_slug and lower(trim(coalesce(value,replace(regexp_replace(key,'^.*[.]',''),'-',' '))))=label));
  insert into public.forgotten_knowledge_keys(user_id,key)
    select user_id,key from public.knowledge_nodes where user_id=auth.uid() and status='forgotten' on conflict do nothing;
  delete from public.preferences p using public.forgotten_knowledge_keys f
    where p.user_id=auth.uid() and f.user_id=p.user_id and f.key=p.key;
  update public.knowledge_verification_queue q set status='dismissed',answered_at=clock_timestamp()
    from public.knowledge_nodes n where q.user_id=auth.uid() and n.user_id=q.user_id
      and q.node_id=n.id and n.status='forgotten' and q.status='pending';
end $$;

-- Discover supplies no category argument. Normalize it before alias checks so
-- a new key cannot reintroduce the same forgotten label through that path.
create or replace function nudge_private.record_knowledge_signal_guarded(
  p_key text,p_value text,p_category_slug text,p_polarity public.preference_polarity,
  p_source text,p_weight real,p_kind text,p_source_decision_id uuid default null,
  p_source_question_id uuid default null,p_verified boolean default false,
  p_detail jsonb default '{}'::jsonb,p_expected_generation integer default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare generation integer; category text:=coalesce(nullif(trim(p_category_slug),''),nudge_private.category_for_key(p_key));
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select memory_generation into generation from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Profile not found'; end if;
  if p_source='ai_extracted' and p_expected_generation is null then raise exception 'AI extraction requires a memory generation'; end if;
  if p_expected_generation is not null and p_expected_generation<>generation then return null; end if;
  if exists(select 1 from public.forgotten_knowledge_keys where user_id=auth.uid() and key=lower(p_key))
    or (p_value is not null and exists(select 1 from public.knowledge_nodes n where n.user_id=auth.uid()
      and n.status='forgotten' and n.category_slug=category
      and lower(trim(coalesce(n.value,replace(regexp_replace(n.key,'^.*[.]',''),'-',' '))))=lower(trim(p_value)))) then return null; end if;
  if p_source_decision_id is not null and not exists(select 1 from public.decisions where id=p_source_decision_id and user_id=auth.uid()) then
    raise exception 'Invalid source decision'; end if;
  return nudge_private.record_knowledge_signal(p_key,p_value,category,p_polarity,p_source,p_weight,p_kind,
    p_source_decision_id,p_source_question_id,p_verified,p_detail);
end $$;

-- Repair aliases forgotten under the old exact-key implementation. Keep the
-- journal/evidence and suppression tombstones; only retire matching beliefs.
update public.knowledge_nodes n set status='forgotten'
  where n.status<>'forgotten' and exists(select 1 from public.knowledge_nodes forgotten
    where forgotten.user_id=n.user_id and forgotten.status='forgotten' and forgotten.category_slug=n.category_slug
      and lower(trim(coalesce(forgotten.value,replace(regexp_replace(forgotten.key,'^.*[.]',''),'-',' '))))=
          lower(trim(coalesce(n.value,replace(regexp_replace(n.key,'^.*[.]',''),'-',' ')))));
insert into public.forgotten_knowledge_keys(user_id,key)
  select user_id,key from public.knowledge_nodes where status='forgotten' on conflict do nothing;
delete from public.preferences p using public.forgotten_knowledge_keys f where f.user_id=p.user_id and f.key=p.key;
update public.knowledge_verification_queue q set status='dismissed',answered_at=clock_timestamp()
  from public.knowledge_nodes n where n.user_id=q.user_id and n.id=q.node_id and n.status='forgotten' and q.status='pending';
-- Invalidate comparisons/extractions that began before the privacy repair.
update public.profiles p set memory_generation=memory_generation+1
  where exists(select 1 from public.knowledge_nodes n where n.user_id=p.id and n.status='forgotten');

-- Arbitrary event JSON is not anonymous merely because its FK was nulled.
-- Existing orphan events cannot be reliably attributed or scrubbed, so remove
-- them; subsequent account deletion cascades all owned analytics records.
delete from public.analytics_events where user_id is null;
alter table public.analytics_events drop constraint analytics_events_user_id_fkey;
alter table public.analytics_events add constraint analytics_events_user_id_fkey
  foreign key(user_id) references public.profiles(id) on delete cascade;

-- A request identity survives transport retries. Keep raw user intent separate
-- from derived scores/context, which can change during a retry or memory edit.
create table nudge_private.comparison_requests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  intent jsonb not null,
  decision_id uuid not null references public.decisions(id) on delete cascade,
  primary key(user_id,request_id)
);
alter table nudge_private.comparison_requests enable row level security;
revoke all on nudge_private.comparison_requests from public,anon,authenticated;
create index comparison_requests_decision_idx on nudge_private.comparison_requests(decision_id);
create function public.create_comparison_once(
  p_request_id uuid,p_intent jsonb,p_category public.decision_category,p_title text,p_context jsonb,
  p_expected_outcome text,p_options jsonb,p_generation integer
) returns uuid language plpgsql security definer set search_path='' as $$
declare previous nudge_private.comparison_requests%rowtype; decision uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_request_id is null or jsonb_typeof(p_intent) is distinct from 'object' then raise exception 'Invalid comparison request'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into previous from nudge_private.comparison_requests where user_id=auth.uid() and request_id=p_request_id;
  if found then
    if previous.intent is distinct from p_intent then raise exception 'This comparison request has different options. Start a new comparison'; end if;
    return previous.decision_id;
  end if;
  decision:=public.create_comparison(p_category,p_title,p_context,p_expected_outcome,p_options,p_generation);
  insert into nudge_private.comparison_requests(user_id,request_id,intent,decision_id)
    values(auth.uid(),p_request_id,p_intent,decision);
  return decision;
end $$;

-- PostgreSQL's global PUBLIC function default cannot be undone by a
-- schema-local revoke. Set the global creator default, then reset the actual
-- application function ACLs and grant only the reviewed API/job allowlists.
alter default privileges revoke execute on functions from public,anon,authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
revoke execute on all functions in schema nudge_private from public,anon,authenticated;
do $$ declare fn regprocedure; begin
  for fn in select p.oid::regprocedure from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'set_updated_at','handle_new_user','user_today','touch_streak','refill_streak_freezes','set_timezone',
      'is_circle_member','join_decision_circle','circle_members','assert_selected_option_matches_decision',
      'assert_poll_vote_option_matches_poll','commit_decision_choice','project_knowledge_node_to_preference',
      'record_knowledge_signal','forget_knowledge_key','apply_knowledge_confidence_decay',
      'enqueue_due_knowledge_verifications','enqueue_due_reflection_prompts','evaluate_achievements',
      'next_unanswered_question','question_progress','erase_learned_memory','save_ai_memories',
      'submit_decision_reflection','answer_knowledge_verification','circle_vote_counts','answer_discover_question',
      'complete_onboarding','commit_choice_and_learn','abandon_decision','search_beliefs','correct_knowledge_node',
      'edit_ai_memory','create_comparison','create_comparison_once','rerank_comparison','schedule_reflection','discover_next_question',
      'refresh_my_verifications','accept_legal_terms','set_ai_enabled','reserve_ai_request','create_circle',
      'create_circle_poll','cast_circle_vote','close_circle_poll','manage_circle'])
  loop execute format('revoke execute on function %s from public,anon,authenticated',fn); end loop;
end $$;
grant execute on function public.is_circle_member(uuid),public.circle_members(uuid),public.join_decision_circle(text),
  public.circle_vote_counts(uuid),public.create_circle(text),public.create_circle_poll(uuid,text,jsonb),
  public.cast_circle_vote(uuid,uuid),public.close_circle_poll(uuid,uuid),public.manage_circle(uuid,text),
  public.record_knowledge_signal(text,text,text,public.preference_polarity,text,real,text,uuid,uuid,boolean,jsonb,integer),
  public.search_beliefs(text,integer),public.correct_knowledge_node(uuid,public.preference_polarity,text),
  public.forget_knowledge_key(text),public.erase_learned_memory(),public.save_ai_memories(jsonb,integer,uuid),
  public.edit_ai_memory(uuid,text,text,boolean),public.answer_knowledge_verification(uuid,text),
  public.refresh_my_verifications(),public.answer_discover_question(uuid,text),public.discover_next_question(text),
  public.next_unanswered_question(),public.question_progress(),public.complete_onboarding(jsonb,jsonb,integer),
  public.create_comparison(public.decision_category,text,jsonb,text,jsonb,integer),
  public.create_comparison_once(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer),
  public.rerank_comparison(uuid,integer,jsonb,jsonb,integer),public.commit_choice_and_learn(uuid,uuid,text),
  public.submit_decision_reflection(uuid,integer,boolean,boolean,boolean,boolean,text,text),public.abandon_decision(uuid),
  public.schedule_reflection(uuid,timestamptz,boolean),public.touch_streak(),public.set_timezone(text),
  public.user_today(text),public.evaluate_achievements(),public.accept_legal_terms(text,boolean),
  public.set_ai_enabled(boolean),public.reserve_ai_request(text) to authenticated;
grant execute on function public.refill_streak_freezes(),public.apply_knowledge_confidence_decay(),
  public.enqueue_due_knowledge_verifications(),public.enqueue_due_reflection_prompts() to service_role;

-- This marker also lets the standalone upgrade script detect this repair.
create function nudge_private.privacy_boundaries_version() returns integer
language sql immutable set search_path='' as $$ select 6; $$;
revoke all on function nudge_private.privacy_boundaries_version() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
