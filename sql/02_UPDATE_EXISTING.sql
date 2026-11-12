-- EXISTING NUDGE INSTALLATIONS: run only this file. Back up first.
-- Detects and applies missing 00002..00022 updates in order. Does not replay baseline or erase journal data.
-- 00006 removes orphan analytics events and retires aliases of forgotten beliefs.
-- 00017 removes orphan discovery sources and gates unreviewed formats.
-- You can delete obsolete saved SQL-editor tabs after keeping this file; do not delete tables/schemas.
begin;
do $update$
begin
  if to_regclass('public.profiles') is null or to_regclass('public.knowledge_nodes') is null or to_regclass('public.questions') is null then
    raise exception 'This is not a supported baseline. Use 01_FRESH_DATABASE.sql for a fresh project.';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='memory_generation') then
    execute $migration_2$
-- Apply after 00001_baseline (or the matching complete-setup snapshot).
-- All access changes and new functions become visible together.

create schema if not exists nudge_private;
revoke all on schema nudge_private from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Make grants independent of hosted default privileges.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke execute on all functions in schema public from public, anon, authenticated;

alter table public.profiles add column if not exists memory_generation integer not null default 0;
alter table public.profiles add column if not exists memory_reset_at timestamptz;
create table public.forgotten_knowledge_keys (
  user_id uuid not null references public.profiles(id) on delete cascade,
  key text not null,
  primary key (user_id, key)
);
alter table public.forgotten_knowledge_keys enable row level security;
create policy "read own forgotten keys" on public.forgotten_knowledge_keys for select to authenticated using (user_id = auth.uid());
grant select on public.forgotten_knowledge_keys to authenticated;
grant all on public.forgotten_knowledge_keys to service_role;

-- A derived projection cannot be edited independently of its source graph.
revoke insert, update, delete on public.preferences, public.knowledge_nodes,
  public.knowledge_edges, public.knowledge_evidence, public.forgotten_knowledge_keys,
  public.decision_reflections from authenticated;
revoke insert, update on public.ai_memories from authenticated;
revoke update on public.profiles from authenticated;
grant update (full_name, country, language, occupation, avatar_url, age,
  onboarded_at, decision_style, weekly_goal, timezone) on public.profiles to authenticated;
revoke insert, update, delete on public.user_achievements from authenticated;

-- Enforce owner consistency even inside a definer RPC or a service-role write.
create function nudge_private.assert_link_ownership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name in ('decision_reflections', 'ai_memories', 'knowledge_evidence') then
    if tg_table_name = 'decision_reflections' then
      if not exists (select 1 from public.decisions d where d.id = new.decision_id and d.user_id = new.user_id) then
        raise exception 'Invalid decision owner';
      end if;
    elsif new.source_decision_id is not null and not exists (
      select 1 from public.decisions d where d.id = new.source_decision_id and d.user_id = new.user_id
    ) then raise exception 'Invalid source decision owner'; end if;
  end if;
  if tg_table_name in ('knowledge_evidence', 'knowledge_verification_queue') then
    if not exists (select 1 from public.knowledge_nodes n where n.id = new.node_id and n.user_id = new.user_id) then
      raise exception 'Invalid knowledge node owner';
    end if;
  elsif tg_table_name = 'knowledge_edges' then
    if not exists (select 1 from public.knowledge_nodes n where n.id = new.from_node_id and n.user_id = new.user_id)
       or not exists (select 1 from public.knowledge_nodes n where n.id = new.to_node_id and n.user_id = new.user_id) then
      raise exception 'Invalid knowledge edge owner';
    end if;
  end if;
  return new;
end $$;
create trigger reflection_owner before insert or update on public.decision_reflections for each row execute function nudge_private.assert_link_ownership();
create trigger ai_memory_owner before insert or update on public.ai_memories for each row execute function nudge_private.assert_link_ownership();
create trigger knowledge_evidence_owner before insert or update on public.knowledge_evidence for each row execute function nudge_private.assert_link_ownership();
create trigger verification_owner before insert or update on public.knowledge_verification_queue for each row execute function nudge_private.assert_link_ownership();
create trigger knowledge_edge_owner before insert or update on public.knowledge_edges for each row execute function nudge_private.assert_link_ownership();

create function nudge_private.category_for_key(k text) returns text
language sql immutable set search_path = '' as $$
  select case split_part(k,'.',1)
    when 'food' then 'food' when 'cuisine' then 'food' when 'drink' then 'food' when 'taste' then 'food' when 'diet' then 'food' when 'nutrition' then 'food' when 'condiment' then 'food'
    when 'watch' then 'movies' when 'genre' then 'movies' when 'music' then 'movies' when 'media' then 'movies' when 'culture' then 'movies' when 'entertainment' then 'movies'
    when 'travel' then 'travel' when 'destination' then 'travel' when 'transport' then 'travel' when 'accommodation' then 'travel'
    when 'shopping' then 'shopping' when 'product' then 'shopping' when 'brand' then 'shopping' when 'gift' then 'shopping' when 'tech' then 'shopping' when 'property' then 'shopping'
    when 'health' then 'health' when 'fitness' then 'health' when 'wellness' then 'health' when 'sleep' then 'health' when 'body' then 'health' when 'sport' then 'health'
    when 'career' then 'career' when 'work' then 'career' when 'learning' then 'career' when 'skill' then 'career' when 'focus' then 'career'
    when 'money' then 'finance' when 'spend' then 'finance' when 'finance' then 'finance' when 'invest' then 'finance' when 'save' then 'finance' when 'budget' then 'finance'
    when 'social' then 'relationships' when 'family' then 'relationships' when 'relationship' then 'relationships' when 'people' then 'relationships' when 'pet' then 'relationships'
    when 'hobby' then 'hobbies' when 'craft' then 'hobbies' when 'play' then 'hobbies' when 'creative' then 'hobbies' when 'game' then 'hobbies'
    else 'lifestyle' end;
$$;

-- The accumulation implementation stays internal. Public writes lock the
-- profile to serialize against reset and validate ownership/generation first.
alter function public.record_knowledge_signal(text,text,text,public.preference_polarity,text,real,text,uuid,uuid,boolean,jsonb) set schema nudge_private;
create function public.record_knowledge_signal(
  p_key text, p_value text, p_category_slug text, p_polarity public.preference_polarity,
  p_source text, p_weight real, p_kind text,
  p_source_decision_id uuid default null, p_source_question_id uuid default null,
  p_verified boolean default false, p_detail jsonb default '{}'::jsonb,
  p_expected_generation integer default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare generation integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select memory_generation into generation from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Profile not found'; end if;
  if p_source='ai_extracted' and p_expected_generation is null then raise exception 'AI extraction requires a memory generation'; end if;
  if p_expected_generation is not null and p_expected_generation <> generation then return null; end if;
  if exists (select 1 from public.forgotten_knowledge_keys where user_id = auth.uid() and key = lower(p_key))
     or (p_value is not null and exists (select 1 from public.knowledge_nodes n where n.user_id=auth.uid()
       and n.status='forgotten' and n.category_slug=p_category_slug
       and lower(coalesce(n.value,replace(regexp_replace(n.key,'^.*[.]',''),'-',' ')))=lower(trim(p_value)))) then return null; end if;
  if p_source_decision_id is not null and not exists (select 1 from public.decisions where id = p_source_decision_id and user_id = auth.uid()) then
    raise exception 'Invalid source decision';
  end if;
  return nudge_private.record_knowledge_signal(p_key,p_value,coalesce(p_category_slug,nudge_private.category_for_key(p_key)),p_polarity,p_source,p_weight,p_kind,
    p_source_decision_id,p_source_question_id,p_verified,p_detail);
end $$;

create or replace function public.project_knowledge_node_to_preference()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cat uuid;
begin
  if tg_op = 'DELETE' then delete from public.preferences where user_id = old.user_id and key = old.key; return old; end if;
  if new.status <> 'active' then delete from public.preferences where user_id = new.user_id and key = new.key; return new; end if;
  select id into cat from public.preference_categories where slug = new.category_slug;
  insert into public.preferences (user_id,category_id,key,value,polarity,strength,source,evidence_count,last_reinforced_at)
  values (new.user_id,cat,new.key,new.value,new.polarity,
    case when new.polarity = 'neutral' then 0 else least(1,abs(new.belief_score)*new.confidence) end,
    case when new.source in ('explicit','reflected','inferred') then new.source else 'inferred' end,
    greatest(1,new.evidence_count),new.last_reinforced_at)
  on conflict (user_id,key) do update set category_id=excluded.category_id,value=excluded.value,
    polarity=excluded.polarity,strength=excluded.strength,source=excluded.source,
    evidence_count=excluded.evidence_count,last_reinforced_at=excluded.last_reinforced_at;
  return new;
end $$;
-- Project legacy category metadata without replacing any evidence.
update public.knowledge_nodes set category_slug = category_slug;

create or replace function public.forget_knowledge_key(p_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.profiles where id = auth.uid() for update;
  insert into public.forgotten_knowledge_keys values(auth.uid(),lower(p_key)) on conflict do nothing;
  update public.knowledge_nodes set status='forgotten' where user_id=auth.uid() and key=lower(p_key);
  delete from public.preferences where user_id=auth.uid() and key=lower(p_key);
  update public.knowledge_verification_queue set status='dismissed',answered_at=now()
    where user_id=auth.uid() and status='pending' and node_id in (
      select id from public.knowledge_nodes where user_id=auth.uid() and key=lower(p_key));
end $$;
create function public.erase_learned_memory() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  delete from public.knowledge_verification_queue where user_id=auth.uid();
  delete from public.knowledge_edges where user_id=auth.uid();
  delete from public.knowledge_evidence where user_id=auth.uid();
  delete from public.knowledge_nodes where user_id=auth.uid();
  delete from public.preferences where user_id=auth.uid();
  delete from public.ai_memories where user_id=auth.uid();
  delete from public.question_answers where user_id=auth.uid();
  delete from public.forgotten_knowledge_keys where user_id=auth.uid();
  delete from public.notifications where user_id=auth.uid() and kind='reflection_prompt';
  update public.profiles set memory_generation=memory_generation+1,memory_reset_at=clock_timestamp() where id=auth.uid();
end $$;

create function public.save_ai_memories(p_memories jsonb,p_expected_generation integer,p_decision_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare generation integer; inserted integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select memory_generation into generation from public.profiles where id=auth.uid() for update;
  if p_expected_generation is null or generation <> p_expected_generation then return 0; end if;
  if p_decision_id is not null and not exists (select 1 from public.decisions where id=p_decision_id and user_id=auth.uid()) then
    raise exception 'Invalid source decision';
  end if;
  if jsonb_typeof(p_memories) <> 'array' or jsonb_array_length(p_memories)>6 then raise exception 'Invalid memories'; end if;
  insert into public.ai_memories(user_id,kind,content,confidence,source_decision_id)
  select auth.uid(),m->>'kind',left(trim(m->>'content'),300),(m->>'confidence')::real,p_decision_id
  from jsonb_array_elements(p_memories) m
  where m->>'kind' in ('fact','goal','habit','constraint') and length(trim(m->>'content'))>0
    and (m->>'confidence')::real between 0.5 and 0.95;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

-- An identical feedback retry is a no-op. Editing an existing reflection is
-- deliberately rejected until revision-aware editing is implemented.
create function public.submit_decision_reflection(
  p_decision_id uuid,p_rating integer,p_would_repeat boolean,p_has_regrets boolean,
  p_would_recommend boolean,p_would_choose_again boolean,p_notes text,p_key text
) returns table(saved boolean,memory_generation integer)
language plpgsql security definer set search_path = '' as $$
declare d public.decisions%rowtype; r public.decision_reflections%rowtype;
  label text; delta real; weight real; generation integer; slug text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select p.memory_generation into generation from public.profiles p where p.id=auth.uid() for update;
  select * into d from public.decisions where id=p_decision_id and user_id=auth.uid() for update;
  if not found or d.status not in ('decided','reflected') then raise exception 'Choose an option before reflecting'; end if;
  if p_rating is null or p_rating not between 1 and 5 or length(coalesce(p_notes,''))>500 then raise exception 'Invalid reflection'; end if;
  select * into r from public.decision_reflections where decision_id=d.id;
  if found then
    if r.rating is distinct from p_rating or r.would_repeat is distinct from p_would_repeat
      or r.has_regrets is distinct from p_has_regrets or r.would_recommend is distinct from p_would_recommend
      or r.would_choose_again is distinct from p_would_choose_again or r.notes is distinct from nullif(trim(p_notes),'') then
      raise exception 'This decision already has a reflection';
    end if;
    return query select false,generation; return;
  end if;
  select o.label into label from public.decision_options o where o.id=d.selected_option_id and o.decision_id=d.id;
  if label is null then raise exception 'Selected option is missing'; end if;
  if p_key not like ('learned.'||d.category::text||'.%') then raise exception 'Invalid learned key'; end if;
  insert into public.decision_reflections(decision_id,user_id,rating,would_repeat,has_regrets,would_recommend,would_choose_again,notes)
  values(d.id,auth.uid(),p_rating,p_would_repeat,p_has_regrets,p_would_recommend,p_would_choose_again,nullif(trim(p_notes),''));
  update public.decisions set status='reflected' where id=d.id;
  delta := (p_rating-3)*0.06;
  if p_would_repeat is true then delta:=delta+0.04; end if;
  if p_would_repeat is false then delta:=delta-0.06; end if;
  if p_has_regrets is true then delta:=delta-0.05; end if;
  if p_would_choose_again is false then delta:=least(delta,-0.1); end if;
  delta:=greatest(-0.2,least(0.2,delta));
  slug:=case d.category::text when 'entertainment' then 'movies' when 'work' then 'career' when 'social' then 'relationships' when 'other' then 'lifestyle' else d.category::text end;
  if abs(delta)>0.00001 then
    weight:=least(1,abs(delta)*3+0.15+case when p_would_choose_again is false then 0.25 else 0 end);
    perform public.record_knowledge_signal(p_key,label,slug,
      case when delta<0 then 'dislike'::public.preference_polarity else 'like'::public.preference_polarity end,
      'reflected',weight,'reflection',d.id,null,true,
      jsonb_build_object('rating',p_rating,'would_repeat',p_would_repeat,'would_choose_again',p_would_choose_again,'has_regrets',p_has_regrets),generation);
  end if;
  return query select true,generation;
end $$;

create function public.answer_knowledge_verification(p_queue_id uuid,p_answer text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.knowledge_verification_queue%rowtype; n public.knowledge_nodes%rowtype; pol public.preference_polarity;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_answer is null or p_answer not in ('still_true','not_anymore','forget') then raise exception 'Invalid answer'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into q from public.knowledge_verification_queue where id=p_queue_id and user_id=auth.uid() for update;
  if not found then raise exception 'Verification not found'; end if;
  if q.status <> 'pending' then return; end if;
  select * into n from public.knowledge_nodes where id=q.node_id and user_id=auth.uid();
  if not found or n.status <> 'active' then raise exception 'Belief is no longer active'; end if;
  if p_answer='forget' then perform public.forget_knowledge_key(n.key);
  else
    if n.polarity='neutral' then raise exception 'Neutral beliefs need a new explicit preference'; end if;
    pol:=case when p_answer='still_true' then n.polarity
      when n.polarity='like' then 'dislike'::public.preference_polarity else 'like'::public.preference_polarity end;
    perform public.record_knowledge_signal(n.key,n.value,n.category_slug,pol,'explicit',
      case when p_answer='still_true' then 0.6 else 0.5 end,'confirmation',null,null,true,
      jsonb_build_object('verification',p_answer,'queue_id',q.id));
  end if;
  update public.knowledge_verification_queue set status=case when p_answer='forget' then 'dismissed' else 'answered' end,
    answered_at=now() where id=q.id;
end $$;

-- Circle members see counts and their own vote, never another voter's ID.
drop policy "members read votes" on public.group_poll_votes;
drop policy "members vote" on public.group_poll_votes;
create policy "read own vote" on public.group_poll_votes for select to authenticated using (
  user_id=auth.uid() and exists(select 1 from public.group_polls p where p.id=poll_id and public.is_circle_member(p.group_id)));
create policy "write own vote" on public.group_poll_votes for insert to authenticated with check (
  user_id=auth.uid() and exists(select 1 from public.group_polls p where p.id=poll_id and p.status='open' and public.is_circle_member(p.group_id)));
create policy "change own vote" on public.group_poll_votes for update to authenticated using (user_id=auth.uid()) with check (
  user_id=auth.uid() and exists(select 1 from public.group_polls p where p.id=poll_id and p.status='open' and public.is_circle_member(p.group_id)));
create function public.circle_vote_counts(gid uuid) returns table(poll_id uuid,option_id uuid,votes bigint)
language sql stable security definer set search_path = '' as $$
  select o.poll_id,o.id,count(v.user_id) from public.group_poll_options o
  join public.group_polls p on p.id=o.poll_id
  left join public.group_poll_votes v on v.poll_id=p.id and v.option_id=o.id
  where p.group_id=gid and auth.uid() is not null and public.is_circle_member(gid)
  group by o.poll_id,o.id;
$$;

create or replace function public.enqueue_due_reflection_prompts() returns integer
language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
  insert into public.notifications(user_id,kind,title,body,payload)
  select d.user_id,'reflection_prompt','How did it go?',
    'You chose '||coalesce(o.label,d.question)||'. Was it the right call?',jsonb_build_object('decision_id',d.id)
  from public.decisions d join public.profiles p on p.id=d.user_id
  left join public.decision_options o on o.id=d.selected_option_id
  where d.status='decided' and d.decided_at<now()-interval '24 hours' and d.decided_at>now()-interval '30 days'
    and (p.memory_reset_at is null or d.decided_at>p.memory_reset_at)
    and not exists(select 1 from public.decision_reflections r where r.decision_id=d.id)
    and not exists(select 1 from public.notifications n where n.user_id=d.user_id and n.kind='reflection_prompt' and n.payload->>'decision_id'=d.id::text)
  limit 500;
  get diagnostics inserted=row_count; return inserted;
end $$;

-- Answers are recorded once per question. Relative choice does not assert
-- dislike of the unchosen alternative. Replays cannot inflate evidence.
create function public.answer_discover_question(p_question_id uuid,p_choice text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare q public.questions%rowtype; previous text; picked text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_choice is null or p_choice not in ('a','b','skip') then raise exception 'Invalid answer'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into q from public.questions where id=p_question_id and is_active;
  if not found then raise exception 'Question not found'; end if;
  select answer into previous from public.question_answers where user_id=auth.uid() and question_id=p_question_id;
  if found then
    if previous<>p_choice then raise exception 'This question was already answered'; end if;
    return false;
  end if;
  insert into public.question_answers(user_id,question_id,answer,skipped) values(auth.uid(),q.id,p_choice,p_choice='skip');
  if p_choice<>'skip' then
    picked:=case when p_choice='a' then q.maps_to_key_a else q.maps_to_key_b end;
    if picked is not null then
      perform public.record_knowledge_signal(picked,null,null,'like','explicit',0.5,'discover_answer',null,q.id,true,jsonb_build_object('chose',p_choice));
    end if;
    perform public.touch_streak();
  end if;
  return true;
end $$;

create function public.complete_onboarding(p_profile jsonb,p_answers jsonb,p_expected_generation integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare generation integer; answer jsonb; age_value integer; q public.questions%rowtype; picked text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select memory_generation into generation from public.profiles where id=auth.uid() for update;
  if not found or generation is distinct from p_expected_generation then raise exception 'Memory changed. Please reload onboarding'; end if;
  if jsonb_typeof(p_answers)<>'array' or jsonb_array_length(p_answers)>20 then raise exception 'Invalid onboarding answers'; end if;
  age_value:=nullif(p_profile->>'age','')::integer;
  if age_value is not null and age_value not between 13 and 120 then raise exception 'Invalid age'; end if;
  for answer in select value from jsonb_array_elements(p_answers) loop
    select * into q from public.questions where id=(answer->>'questionId')::uuid and is_active and is_onboarding;
    if not found then raise exception 'Invalid onboarding question'; end if;
    if answer->>'answer' not in ('a','b','skip') then raise exception 'Invalid onboarding answer'; end if;
    if not exists(select 1 from public.question_answers where user_id=auth.uid() and question_id=q.id) then
      insert into public.question_answers(user_id,question_id,answer,skipped)
        values(auth.uid(),q.id,answer->>'answer',answer->>'answer'='skip');
      picked:=case answer->>'answer' when 'a' then q.maps_to_key_a when 'b' then q.maps_to_key_b else null end;
      if picked is not null then perform public.record_knowledge_signal(picked,null,null,'like','explicit',0.55,'onboarding_answer',null,q.id,true,jsonb_build_object('chose',answer->>'answer')); end if;
    end if;
  end loop;
  update public.profiles set full_name=nullif(left(trim(p_profile->>'fullName'),80),''),
    country=nullif(left(trim(p_profile->>'country'),60),''),language=coalesce(nullif(left(trim(p_profile->>'language'),40),''),'en'),
    age=age_value,occupation=nullif(left(trim(p_profile->>'occupation'),80),''),onboarded_at=coalesce(onboarded_at,now())
    where id=auth.uid();
  return generation;
end $$;
revoke insert,update,delete on public.question_answers from authenticated;

update public.questions set is_onboarding=true where id in (
  select id from public.questions where is_active order by sort_order,id limit 6
) and not exists(select 1 from public.questions where is_onboarding and is_active);

create function public.commit_choice_and_learn(p_decision_id uuid,p_option_id uuid,p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.decisions%rowtype; label text; generation integer; slug text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select memory_generation into generation from public.profiles where id=auth.uid() for update;
  select * into d from public.decisions where id=p_decision_id and user_id=auth.uid() for update;
  if not found then raise exception 'Decision not found'; end if;
  select o.label into label from public.decision_options o where o.id=p_option_id and o.decision_id=d.id;
  if label is null or p_key not like ('learned.'||d.category::text||'.%') then raise exception 'Invalid option'; end if;
  if d.status<>'open' then
    if d.status in ('decided','reflected') and d.selected_option_id=p_option_id then return; end if;
    raise exception 'Decision is no longer open';
  end if;
  perform public.commit_decision_choice(d.id,p_option_id);
  -- Use operation time after acquiring the reset lock, not transaction-start
  -- time: a transaction may have waited behind a memory reset.
  update public.decisions set decided_at=clock_timestamp() where id=d.id;
  slug:=case d.category::text when 'entertainment' then 'movies' when 'work' then 'career' when 'social' then 'relationships' when 'other' then 'lifestyle' else d.category::text end;
  perform public.record_knowledge_signal(p_key,label,slug,'like','inferred',0.2,'decision',d.id,null,false,jsonb_build_object('event','chose_option'),generation);
end $$;
create function public.abandon_decision(p_decision_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  update public.decisions set status='abandoned' where id=p_decision_id and user_id=auth.uid() and status='open';
end $$;
revoke update on public.decisions from authenticated;
drop policy "own decisions" on public.decisions;
create policy "read own decisions" on public.decisions for select to authenticated using(user_id=auth.uid());
create policy "create own open decisions" on public.decisions for insert to authenticated with check(user_id=auth.uid() and status='open' and selected_option_id is null and decided_at is null);
create policy "delete own decisions" on public.decisions for delete to authenticated using(user_id=auth.uid());

insert into public.forgotten_knowledge_keys(user_id,key) select user_id,key from public.knowledge_nodes where status='forgotten' on conflict do nothing;

-- Explicit RPC allowlist. Trigger implementations are never API entry points.
grant execute on function public.is_circle_member(uuid),public.circle_members(uuid),public.join_decision_circle(text),
  public.commit_choice_and_learn(uuid,uuid,text),public.abandon_decision(uuid),public.touch_streak(),public.set_timezone(text),public.evaluate_achievements(),
  public.next_unanswered_question(),public.question_progress(),public.forget_knowledge_key(text),public.erase_learned_memory(),
  public.record_knowledge_signal(text,text,text,public.preference_polarity,text,real,text,uuid,uuid,boolean,jsonb,integer),
  public.save_ai_memories(jsonb,integer,uuid),
  public.submit_decision_reflection(uuid,integer,boolean,boolean,boolean,boolean,text,text),
  public.answer_knowledge_verification(uuid,text),public.circle_vote_counts(uuid),
  public.complete_onboarding(jsonb,jsonb,integer),public.answer_discover_question(uuid,text) to authenticated;
grant execute on function public.user_today(text) to authenticated;
grant execute on function public.apply_knowledge_confidence_decay(),public.enqueue_due_knowledge_verifications(),
  public.enqueue_due_reflection_prompts(),public.refill_streak_freezes() to service_role;

$migration_2$;
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='decisions' and column_name='comparison_revision') then
    execute $migration_3$
-- New features after 00001 + 00002. Apply once before deploying this source.

-- 1. Canonical corrections with explicit user overrides and an evidence trail.
alter function public.record_knowledge_signal(text,text,text,public.preference_polarity,text,real,text,uuid,uuid,boolean,jsonb,integer) set schema nudge_private;
alter function nudge_private.record_knowledge_signal(text,text,text,public.preference_polarity,text,real,text,uuid,uuid,boolean,jsonb,integer) rename to record_knowledge_signal_guarded;
revoke execute on function nudge_private.record_knowledge_signal_guarded(text,text,text,public.preference_polarity,text,real,text,uuid,uuid,boolean,jsonb,integer) from public,anon,authenticated;
create function public.record_knowledge_signal(
  p_key text,p_value text,p_category_slug text,p_polarity public.preference_polarity,p_source text,p_weight real,p_kind text,
  p_source_decision_id uuid default null,p_source_question_id uuid default null,p_verified boolean default false,
  p_detail jsonb default '{}'::jsonb,p_expected_generation integer default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare node uuid; corrected public.knowledge_nodes%rowtype; final_key text:=p_key;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into corrected from public.knowledge_nodes n where n.user_id=auth.uid() and n.status='active'
    and n.metadata->>'manual_polarity' in ('like','dislike','neutral')
    and (n.key=p_key or (p_value is not null and n.category_slug=p_category_slug
      and lower(coalesce(n.value,replace(regexp_replace(n.key,'^.*[.]',''),'-',' ')))=lower(trim(p_value))))
    order by n.updated_at desc limit 1;
  if found then final_key:=corrected.key; end if;
  node:=nudge_private.record_knowledge_signal_guarded(final_key,p_value,p_category_slug,p_polarity,p_source,p_weight,p_kind,
    p_source_decision_id,p_source_question_id,p_verified,p_detail,p_expected_generation);
  if node is not null and corrected.id is not null then
    update public.knowledge_nodes set polarity=(corrected.metadata->>'manual_polarity')::public.preference_polarity,
      belief_score=case corrected.metadata->>'manual_polarity' when 'like' then 1 when 'dislike' then -1 else 0 end,
      confidence=1,source='explicit' where id=node;
  end if;
  return node;
end $$;
create function public.search_beliefs(p_search text default '',p_offset integer default 0)
returns setof public.knowledge_nodes language sql stable security invoker set search_path='' as $$
  select n.* from public.knowledge_nodes n where n.user_id=auth.uid() and n.status='active'
    and position(lower(left(coalesce(p_search,''),80)) in lower(coalesce(n.value,n.key)||' '||n.category_slug))>0
  order by n.updated_at desc,n.id limit 20 offset greatest(0,least(coalesce(p_offset,0),100000));
$$;
create function public.correct_knowledge_node(p_node_id uuid,p_polarity public.preference_polarity,p_note text default '') returns void
language plpgsql security definer set search_path='' as $$
declare n public.knowledge_nodes%rowtype; label text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_polarity is null or length(coalesce(p_note,''))>300 then raise exception 'Invalid correction'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into n from public.knowledge_nodes where id=p_node_id and user_id=auth.uid() and status='active' for update;
  if not found then raise exception 'Belief not found'; end if;
  label:=lower(coalesce(n.value,replace(regexp_replace(n.key,'^.*[.]',''),'-',' ')));
  insert into public.knowledge_evidence(user_id,node_id,kind,direction,weight,detail)
    values(auth.uid(),n.id,'manual',case when p_polarity='dislike' then -1 else 1 end,1,
      jsonb_build_object('event','user_correction','polarity',p_polarity,'note',coalesce(p_note,'')));
  update public.knowledge_nodes set polarity=p_polarity,
    belief_score=case p_polarity when 'like' then 1 when 'dislike' then -1 else 0 end,
    confidence=1,source='explicit',last_verified_at=clock_timestamp(),last_reinforced_at=clock_timestamp(),
    verification_due_at=clock_timestamp()+interval '60 days',
    metadata=metadata||jsonb_build_object('manual_polarity',p_polarity,'correction_note',coalesce(p_note,'')),
    evidence_count=evidence_count+case when id=n.id then 1 else 0 end
    where user_id=auth.uid() and status='active' and (id=n.id or
      (category_slug=n.category_slug and lower(coalesce(value,replace(regexp_replace(key,'^.*[.]',''),'-',' ')))=label));
  update public.knowledge_verification_queue set status='answered',answered_at=now() where user_id=auth.uid()
    and node_id=n.id and status='pending';
  update public.profiles set memory_generation=memory_generation+1 where id=auth.uid();
end $$;
alter function public.forget_knowledge_key(text) set schema nudge_private;
create function public.forget_knowledge_key(p_key text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform nudge_private.forget_knowledge_key(p_key);
  update public.profiles set memory_generation=memory_generation+1 where id=auth.uid();
end $$;
revoke execute on function nudge_private.forget_knowledge_key(text) from public,anon,authenticated;

create function public.edit_ai_memory(p_memory_id uuid,p_content text,p_kind text,p_delete boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  perform 1 from public.ai_memories where id=p_memory_id and user_id=auth.uid() for update;
  if not found then raise exception 'Memory not found'; end if;
  if p_delete then delete from public.ai_memories where id=p_memory_id and user_id=auth.uid();
  else
    if p_kind is null or p_kind not in ('fact','goal','habit','constraint') or p_content is null
      or length(trim(p_content)) not between 1 and 300 then raise exception 'Invalid memory'; end if;
    update public.ai_memories set content=trim(p_content),kind=p_kind,confidence=1 where id=p_memory_id and user_id=auth.uid();
  end if;
  update public.profiles set memory_generation=memory_generation+1 where id=auth.uid();
end $$;
revoke delete on public.ai_memories from authenticated;

create or replace function public.answer_knowledge_verification(p_queue_id uuid,p_answer text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.knowledge_verification_queue%rowtype; n public.knowledge_nodes%rowtype; pol public.preference_polarity;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_answer is null or p_answer not in ('still_true','not_anymore','forget') then raise exception 'Invalid answer'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into q from public.knowledge_verification_queue where id=p_queue_id and user_id=auth.uid() for update;
  if not found then raise exception 'Verification not found'; end if;
  if q.status <> 'pending' then return; end if;
  select * into n from public.knowledge_nodes where id=q.node_id and user_id=auth.uid();
  if not found or n.status <> 'active' then raise exception 'Belief is no longer active'; end if;
  if p_answer='forget' then perform public.forget_knowledge_key(n.key);
  else
    if n.polarity='neutral' then raise exception 'Neutral beliefs need a new explicit preference'; end if;
    pol:=case when p_answer='still_true' then n.polarity
      when n.polarity='like' then 'dislike'::public.preference_polarity else 'like'::public.preference_polarity end;
    if n.metadata ? 'manual_polarity' then
      perform public.correct_knowledge_node(n.id,pol,'Updated through a verification check');
    else
    perform public.record_knowledge_signal(n.key,n.value,n.category_slug,pol,'explicit',
      case when p_answer='still_true' then 0.6 else 0.5 end,'confirmation',null,null,true,
      jsonb_build_object('verification',p_answer,'queue_id',q.id));
    end if;
  end if;
  update public.knowledge_verification_queue set status=case when p_answer='forget' then 'dismissed' else 'answered' end,
    answered_at=now() where id=q.id;
end $$;


create or replace function public.enqueue_due_knowledge_verifications()
returns integer language plpgsql security definer set search_path = public as $$
declare inserted integer;
begin
  insert into public.knowledge_verification_queue (user_id, node_id, prompt)
  select n.user_id, n.id, 'Nudge learned that ' || coalesce(n.value, replace(n.key, '.', ' ')) || '. Does that still feel true?'
  from public.knowledge_nodes n
  where n.status = 'active' and n.polarity <> 'neutral' and n.confidence < 0.72
    and coalesce(n.verification_due_at, n.last_reinforced_at + interval '60 days') <= now()
    and not exists (select 1 from public.knowledge_verification_queue q where q.user_id = n.user_id and q.node_id = n.id and q.status = 'pending')
  order by n.verification_due_at nulls first limit 500;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

update public.knowledge_verification_queue q set status='dismissed',answered_at=now() from public.knowledge_nodes n
  where q.node_id=n.id and q.user_id=n.user_id and q.status='pending' and n.polarity='neutral';

-- 2. Atomic comparison creation/re-ranking is the foundation for resume.
alter table public.decisions add column comparison_revision integer not null default 0;
create function nudge_private.validate_comparison(p_options jsonb) returns void
language plpgsql set search_path='' as $$
declare o jsonb;
begin
  if p_options is null or jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options) not between 2 and 8 then raise exception 'Compare two to eight options'; end if;
  if (select count(distinct lower(trim(x->>'label'))) from jsonb_array_elements(p_options) x)<>jsonb_array_length(p_options) then raise exception 'Options must be distinct'; end if;
  for o in select value from jsonb_array_elements(p_options) loop
    if o->>'label' is null or length(trim(o->>'label')) not between 1 and 80
      or o->>'score' is null or (o->>'score')::numeric not between 0 and 1
      or jsonb_typeof(o->'breakdown') is distinct from 'object' then raise exception 'Invalid scored option'; end if;
  end loop;
end $$;
create function public.create_comparison(p_category public.decision_category,p_title text,p_context jsonb,p_expected_outcome text,
  p_options jsonb,p_generation integer) returns uuid language plpgsql security definer set search_path='' as $$
declare generation integer; decision uuid; o jsonb; position integer:=0;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select memory_generation into generation from public.profiles where id=auth.uid() for update;
  if p_generation is distinct from generation then raise exception 'Your memory changed. Compare again'; end if;
  perform nudge_private.validate_comparison(p_options);
  if p_title is null or length(trim(p_title)) not between 1 and 120 or jsonb_typeof(p_context) is distinct from 'object'
    or length(coalesce(p_expected_outcome,''))>300 then raise exception 'Invalid comparison'; end if;
  insert into public.decisions(user_id,category,question,context,expected_outcome) values(auth.uid(),p_category,trim(p_title),p_context,nullif(trim(p_expected_outcome),'')) returning id into decision;
  for o in select value from jsonb_array_elements(p_options) loop
    position:=position+1;
    insert into public.decision_options(decision_id,label,score,score_breakdown,rank)
      values(decision,trim(o->>'label'),(o->>'score')::real,o->'breakdown',position);
  end loop;
  return decision;
end $$;
create function public.rerank_comparison(p_decision_id uuid,p_revision integer,p_options jsonb,p_context jsonb,p_generation integer) returns void
language plpgsql security definer set search_path='' as $$
declare d public.decisions%rowtype; generation integer; o jsonb; position integer:=0; existing_count integer; new_count integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select memory_generation into generation from public.profiles where id=auth.uid() for update;
  if p_generation is distinct from generation then raise exception 'Your memory changed. Reload this comparison'; end if;
  select * into d from public.decisions where id=p_decision_id and user_id=auth.uid() for update;
  if not found or d.status<>'open' then raise exception 'Comparison is no longer open'; end if;
  if d.comparison_revision is distinct from p_revision then raise exception 'Comparison changed in another tab. Reload it'; end if;
  perform nudge_private.validate_comparison(p_options);
  select count(*) into existing_count from public.decision_options where decision_id=d.id;
  select count(*) into new_count from jsonb_array_elements(p_options) x where x->>'id' is null;
  if new_count>1 or jsonb_array_length(p_options)<>existing_count+new_count then raise exception 'All existing options must be retained'; end if;
  if exists(select 1 from public.decision_options old where old.decision_id=d.id and not exists(
    select 1 from jsonb_array_elements(p_options) x where x->>'id'=old.id::text and x->>'label'=old.label)) then raise exception 'Invalid existing option'; end if;
  if jsonb_typeof(p_context) is distinct from 'object' then raise exception 'Invalid comparison context'; end if;
  for o in select value from jsonb_array_elements(p_options) loop
    position:=position+1;
    if o->>'id' is null then insert into public.decision_options(decision_id,label,score,score_breakdown,rank)
      values(d.id,trim(o->>'label'),(o->>'score')::real,o->'breakdown',position);
    else update public.decision_options set score=(o->>'score')::real,score_breakdown=o->'breakdown',rank=position
      where id=(o->>'id')::uuid and decision_id=d.id;
    end if;
  end loop;
  update public.decisions set context=p_context,comparison_revision=comparison_revision+1 where id=d.id;
end $$;
revoke insert,update,delete on public.decision_options from authenticated;
revoke insert on public.decisions from authenticated;

-- 3. User-controlled outcome timing, with versioned notification dedupe.
alter table public.decisions add column reflection_due_at timestamptz;
alter table public.decisions add column reminder_requested_at timestamptz;
alter table public.decisions add column reminder_enabled boolean not null default true;
alter table public.decisions add column reminder_version integer not null default 0;
update public.decisions set reflection_due_at=decided_at+interval '24 hours' where status='decided' and decided_at>now()-interval '30 days';
update public.decisions set reminder_enabled=false where status='decided' and decided_at<=now()-interval '30 days';
create index decisions_reflection_due_idx on public.decisions(reflection_due_at) where status='decided' and reminder_enabled;
create function nudge_private.default_reflection_due() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='decided' and new.reminder_enabled and (old.status='open' or new.decided_at is distinct from old.decided_at) then
    new.reflection_due_at:=new.decided_at+interval '24 hours';
  elsif new.status in ('reflected','abandoned') then new.reflection_due_at:=null;
  end if;
  return new;
end $$;
create trigger default_reflection_due before update of status,decided_at on public.decisions for each row execute function nudge_private.default_reflection_due();
create function public.schedule_reflection(p_decision_id uuid,p_due_at timestamptz,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_enabled is null or (p_enabled and (p_due_at is null or p_due_at<clock_timestamp() or p_due_at>clock_timestamp()+interval '365 days')) then raise exception 'Choose a future time within one year'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  perform 1 from public.decisions where id=p_decision_id and user_id=auth.uid() and status='decided' for update;
  if not found then raise exception 'This decision is not waiting for reflection'; end if;
  update public.decisions set reflection_due_at=case when p_enabled then p_due_at else null end,
    reminder_enabled=p_enabled,reminder_requested_at=clock_timestamp(),reminder_version=reminder_version+1 where id=p_decision_id;
  update public.notifications set read_at=coalesce(read_at,now()) where user_id=auth.uid() and kind='reflection_prompt' and payload->>'decision_id'=p_decision_id::text;
end $$;
-- Existing duplicate rows remain as read-only history; only new versioned
-- notifications use the unique key, so upgrading never destroys old records.
create unique index notifications_reminder_version_unique on public.notifications(user_id,(payload->>'decision_id'),(payload->>'reminder_version'))
  where kind='reflection_prompt' and payload ? 'reminder_version';
create or replace function public.enqueue_due_reflection_prompts() returns integer
language plpgsql security definer set search_path='' as $$
declare inserted integer;
begin
  insert into public.notifications(user_id,kind,title,body,payload)
  select d.user_id,'reflection_prompt','How did it go?','You chose '||coalesce(o.label,d.question)||'. Was it the right call?',
    jsonb_build_object('decision_id',d.id,'reminder_version',d.reminder_version)
  from public.decisions d join public.profiles p on p.id=d.user_id left join public.decision_options o on o.id=d.selected_option_id
  where d.status='decided' and d.reminder_enabled and d.reflection_due_at<=clock_timestamp()
    and (p.memory_reset_at is null or d.decided_at>p.memory_reset_at or d.reminder_requested_at>p.memory_reset_at)
    and not exists(select 1 from public.decision_reflections r where r.decision_id=d.id)
    and not exists(select 1 from public.notifications n where n.user_id=d.user_id and n.kind='reflection_prompt'
      and n.payload->>'decision_id'=d.id::text and coalesce(n.payload->>'reminder_version','0')=d.reminder_version::text)
  order by d.reflection_due_at limit 500 on conflict do nothing;
  get diagnostics inserted=row_count; return inserted;
end $$;
create function nudge_private.reset_reflection_reminders() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.memory_reset_at is distinct from old.memory_reset_at then
    update public.decisions set reminder_enabled=false,reflection_due_at=null,reminder_version=reminder_version+1
      where user_id=new.id and status='decided' and decided_at<=new.memory_reset_at;
  end if;
  return new;
end $$;
create trigger reset_reflection_reminders after update of memory_reset_at on public.profiles for each row execute function nudge_private.reset_reflection_reminders();
create function nudge_private.close_reflection_notifications() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='reflected' and old.status<>'reflected' then
    update public.notifications set read_at=coalesce(read_at,now()) where user_id=new.user_id and kind='reflection_prompt' and payload->>'decision_id'=new.id::text;
  end if;
  return new;
end $$;
create trigger close_reflection_notifications after update of status on public.decisions for each row execute function nudge_private.close_reflection_notifications();
revoke execute on function public.enqueue_due_reflection_prompts() from public,anon,authenticated;
grant execute on function public.enqueue_due_reflection_prompts() to service_role;
grant execute on function public.record_knowledge_signal(text,text,text,public.preference_polarity,text,real,text,uuid,uuid,boolean,jsonb,integer),
  public.search_beliefs(text,integer),public.forget_knowledge_key(text),public.correct_knowledge_node(uuid,public.preference_polarity,text),public.edit_ai_memory(uuid,text,text,boolean),
  public.create_comparison(public.decision_category,text,jsonb,text,jsonb,integer),public.rerank_comparison(uuid,integer,jsonb,jsonb,integer),
  public.schedule_reflection(uuid,timestamptz,boolean) to authenticated;

$migration_3$;
  end if;
  if to_regclass('public.question_branches') is null then
    execute $migration_4$
-- Apply after 00003. Keeps existing answers and evidence intact.

create table public.question_branches (
  child_question_id uuid primary key references public.questions(id) on delete cascade,
  parent_question_id uuid not null references public.questions(id) on delete cascade,
  parent_choice text not null check (parent_choice in ('a','b')),
  check (child_question_id <> parent_question_id)
);
create index question_branches_parent_idx on public.question_branches(parent_question_id,parent_choice);
alter table public.question_branches enable row level security;
create policy "read question connections" on public.question_branches for select to authenticated using (true);
grant select on public.question_branches to authenticated;
revoke all on public.question_branches from anon;

-- Tag the existing bank so topic filters also include older unanswered questions.
update public.questions q set context=context||jsonb_build_object('topic',
  case split_part(coalesce(q.maps_to_key_a,q.maps_to_key_b,''),'.',1)
    when 'music' then 'music' when 'home' then 'home' when 'property' then 'home'
    when 'learning' then 'learning' when 'skill' then 'learning'
    when 'tech' then 'digital' when 'values' then 'values' when 'style' then 'values'
    when 'rhythm' then 'time' when 'habit' then 'time' when 'focus' then 'time'
    when 'creative' then 'creativity' when 'rest' then 'wellbeing' when 'sleep' then 'wellbeing'
    else nudge_private.category_for_key(coalesce(q.maps_to_key_a,q.maps_to_key_b,'')) end)
where q.context->>'topic' is null;

create function public.discover_next_question(p_topic text default null)
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
  where auth.uid() is not null and q.is_active and q.option_a is not null and q.option_b is not null
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
      where q.is_active and (b.child_question_id is null or exists(select 1 from public.question_answers a
        where a.user_id=uid and a.question_id=b.parent_question_id and a.answer=b.parent_choice))),
    (select count(*)::integer from public.question_answers a join public.questions q on q.id=a.question_id where a.user_id=uid and q.is_active),
    (select count(*)::integer from public.question_answers a where a.user_id=uid
      and (a.created_at at time zone tz)::date=(now() at time zone tz)::date);
end $$;

create or replace function public.answer_discover_question(p_question_id uuid,p_choice text) returns boolean
language plpgsql security definer set search_path='' as $$
declare q public.questions%rowtype; previous text; picked text; label text; node uuid; parent_node uuid;
  b public.question_branches%rowtype; parent_key text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_choice is null or p_choice not in ('a','b','skip') then raise exception 'Invalid answer'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into q from public.questions where id=p_question_id and is_active;
  if not found then raise exception 'Question not found'; end if;
  select answer into previous from public.question_answers where user_id=auth.uid() and question_id=p_question_id;
  if found then
    if previous<>p_choice then raise exception 'This question was already answered'; end if;
    return false;
  end if;
  select * into b from public.question_branches where child_question_id=q.id;
  if found and not exists(select 1 from public.question_answers a where a.user_id=auth.uid()
    and a.question_id=b.parent_question_id and a.answer=b.parent_choice) then raise exception 'This follow-up is not available yet'; end if;
  insert into public.question_answers(user_id,question_id,answer,skipped,created_at)
    values(auth.uid(),q.id,p_choice,p_choice='skip',clock_timestamp());
  if p_choice<>'skip' then
    picked:=case when p_choice='a' then q.maps_to_key_a else q.maps_to_key_b end;
    label:=case when p_choice='a' then q.option_a else q.option_b end;
    if picked is not null then
      node:=public.record_knowledge_signal(picked,label,null,'like','explicit',0.5,'discover_answer',null,q.id,true,
        jsonb_build_object('chose',p_choice,'topic',q.context->>'topic','prompt',q.prompt));
      -- Contextualize only two actually chosen beliefs, never infer a dislike.
      if b.child_question_id is not null and node is not null then
        select case b.parent_choice when 'a' then p.maps_to_key_a else p.maps_to_key_b end into parent_key
          from public.questions p where p.id=b.parent_question_id;
        select n.id into parent_node from public.knowledge_nodes n where n.user_id=auth.uid() and n.key=parent_key and n.status='active';
        if parent_node is not null and parent_node<>node then
          insert into public.knowledge_edges(user_id,from_node_id,to_node_id,relation,confidence,source)
            values(auth.uid(),node,parent_node,'contextualizes',0.8,'discover') on conflict do nothing;
        end if;
      end if;
    end if;
    perform public.touch_streak();
  end if;
  return true;
end $$;

-- Stale/neutral/forgotten queue entries are dismissed, not left as dead controls.
create or replace function public.answer_knowledge_verification(p_queue_id uuid,p_answer text) returns void
language plpgsql security definer set search_path='' as $$
declare q public.knowledge_verification_queue%rowtype; n public.knowledge_nodes%rowtype;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_answer is null or p_answer not in ('still_true','not_anymore','forget') then raise exception 'Invalid answer'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into q from public.knowledge_verification_queue where id=p_queue_id and user_id=auth.uid() for update;
  if not found then raise exception 'Verification not found'; end if;
  if q.status<>'pending' then return; end if;
  select * into n from public.knowledge_nodes where id=q.node_id and user_id=auth.uid();
  if not found or n.status<>'active' or n.polarity='neutral' then
    update public.knowledge_verification_queue set status='dismissed',answered_at=now() where id=q.id;
    return;
  end if;
  if p_answer='forget' then perform public.forget_knowledge_key(n.key);
  elsif p_answer='not_anymore' then
    perform public.correct_knowledge_node(n.id,'neutral','No longer true: updated in Discover');
  else
    if n.metadata ? 'manual_polarity' then perform public.correct_knowledge_node(n.id,n.polarity,'Confirmed in Discover');
    else perform public.record_knowledge_signal(n.key,n.value,n.category_slug,n.polarity,'explicit',0.6,'confirmation',null,null,true,
      jsonb_build_object('verification_answer',p_answer)); end if;
  end if;
  update public.knowledge_verification_queue set status=case when p_answer='forget' then 'dismissed' else 'answered' end,answered_at=now() where id=q.id;
end $$;

-- Owner-scoped, bounded enqueue removes the page's dependency on a cron job.
create function public.refresh_my_verifications() returns integer
language plpgsql security definer set search_path='' as $$
declare inserted integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  update public.knowledge_verification_queue q set status='dismissed',answered_at=now()
    from public.knowledge_nodes n where q.user_id=auth.uid() and n.user_id=auth.uid() and q.node_id=n.id
      and q.status='pending' and (n.status<>'active' or n.polarity='neutral');
  insert into public.knowledge_verification_queue(user_id,node_id,prompt)
    select n.user_id,n.id,'Does this preference still fit you?' from public.knowledge_nodes n
    where n.user_id=auth.uid() and n.status='active' and n.polarity<>'neutral'
      and coalesce(n.verification_due_at,n.last_reinforced_at+interval '60 days')<=now()
      and not exists(select 1 from public.knowledge_verification_queue q where q.user_id=auth.uid() and q.node_id=n.id and q.status='pending')
    order by n.verification_due_at nulls first,n.id limit 3 on conflict do nothing;
  get diagnostics inserted=row_count; return inserted;
end $$;
revoke all on function public.discover_next_question(text),public.refresh_my_verifications() from public,anon;
grant execute on function public.discover_next_question(text),public.refresh_my_verifications() to authenticated;

-- Curated topic trees follow; generated reproducibly from data/discover-trees.txt.
insert into public.questions(id,category_id,kind,prompt,option_a,option_b,maps_to_key_a,maps_to_key_b,context,sort_order) values
('864e15d5-2a30-4c82-a70c-56c31096d62a'::uuid,(select id from public.preference_categories where slug='food'),'this_or_that','When dinner feels repetitive, what would improve it most?','Try a new cuisine','Perfect a familiar favourite','food.try-a-new-cuisine','food.perfect-a-familiar-favourite','{"topic":"food","depth":0,"tree":"food","edition":1}'::jsonb,-1000),
('f0d94c8f-72ee-48af-a785-d4733380b359'::uuid,(select id from public.preference_categories where slug='food'),'this_or_that','For a new cuisine, how would you like to start?','Follow a simple recipe','Taste it at a restaurant','food.follow-a-simple-recipe','food.taste-it-at-a-restaurant','{"topic":"food","depth":1,"tree":"food","edition":1,"connection":"A follow-up on food."}'::jsonb,-999),
('e60502ee-0eed-409a-accd-c2bbd427638c'::uuid,(select id from public.preference_categories where slug='food'),'this_or_that','When improving a familiar meal, what matters more?','Better flavour','Less preparation','food.better-flavour','food.less-preparation','{"topic":"food","depth":1,"tree":"food","edition":1,"connection":"A follow-up on food."}'::jsonb,-998),
('9e9e62a0-004e-45bc-a0d5-a5897d652864'::uuid,(select id from public.preference_categories where slug='food'),'this_or_that','A new recipe has an unfamiliar ingredient. What helps you try it?','An easy substitution','A small trial batch','food.an-easy-substitution','food.a-small-trial-batch','{"topic":"food","depth":2,"tree":"food","edition":1,"connection":"A follow-up on food."}'::jsonb,-997),
('e72bdb3b-229f-4ab0-aeff-6a9f23ed92bf'::uuid,(select id from public.preference_categories where slug='food'),'this_or_that','What makes a restaurant food adventure enjoyable?','A trusted recommendation','Choosing something on impulse','food.a-trusted-recommendation','food.choosing-something-on-impulse','{"topic":"food","depth":2,"tree":"food","edition":1,"connection":"A follow-up on food."}'::jsonb,-996),
('6bb9fbce-b6c8-4d21-a25f-ce9ed10577c8'::uuid,(select id from public.preference_categories where slug='food'),'this_or_that','What would you change first in your favourite meal?','Seasoning and texture','Ingredient quality','food.seasoning-and-texture','food.ingredient-quality','{"topic":"food","depth":2,"tree":"food","edition":1,"connection":"A follow-up on food."}'::jsonb,-995),
('fef5f8c0-f85a-475d-ae8c-f233fe1b814a'::uuid,(select id from public.preference_categories where slug='food'),'this_or_that','For an easier familiar meal, which shortcut suits you?','Prepare components ahead','Cook everything in one pan','food.prepare-components-ahead','food.cook-everything-in-one-pan','{"topic":"food","depth":2,"tree":"food","edition":1,"connection":"A follow-up on food."}'::jsonb,-994),
('60e4f098-cd74-468b-ac8f-c00bcb8097c3'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','You have an evening free for a film. What are you looking for?','A comforting story','Something that surprises me','watch.a-comforting-story','watch.something-that-surprises-me','{"topic":"movies","depth":0,"tree":"movies","edition":1}'::jsonb,-992),
('e02a474b-f9f0-404d-aae5-7eb9036229a1'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','What makes a comforting film worth rewatching?','Characters I care about','A familiar atmosphere','watch.characters-i-care-about','watch.a-familiar-atmosphere','{"topic":"movies","depth":1,"tree":"movies","edition":1,"connection":"A follow-up on movies."}'::jsonb,-991),
('6f2ebe83-fed4-4ebd-a16c-13aa5e335071'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','What kind of surprise makes a film memorable?','An unexpected idea','A clever plot turn','watch.an-unexpected-idea','watch.a-clever-plot-turn','{"topic":"movies","depth":1,"tree":"movies","edition":1,"connection":"A follow-up on movies."}'::jsonb,-990),
('c2104831-f92e-4aa9-a67b-9961677eb210'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','For character-driven films, what holds your attention?','Honest conversation','People changing over time','watch.honest-conversation','watch.people-changing-over-time','{"topic":"movies","depth":2,"tree":"movies","edition":1,"connection":"A follow-up on movies."}'::jsonb,-989),
('2d9bfe3d-019a-4d81-a175-0eb4774b40f5'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','Which familiar film atmosphere helps you unwind?','Gentle humour','A warm sense of place','watch.gentle-humour','watch.a-warm-sense-of-place','{"topic":"movies","depth":2,"tree":"movies","edition":1,"connection":"A follow-up on movies."}'::jsonb,-988),
('8c66cbb2-25bf-4f41-aa45-b22b00fe20e6'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','After a thought-provoking film, what do you enjoy?','Discussing the ideas','Reflecting on my own','watch.discussing-the-ideas','watch.reflecting-on-my-own','{"topic":"movies","depth":2,"tree":"movies","edition":1,"connection":"A follow-up on movies."}'::jsonb,-987),
('9a8fcf43-2864-497f-a986-52cb4c641bed'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','With a twisty film, what feels most satisfying?','Working out the clues','Being surprised at the end','watch.working-out-the-clues','watch.being-surprised-at-the-end','{"topic":"movies","depth":2,"tree":"movies","edition":1,"connection":"A follow-up on movies."}'::jsonb,-986),
('9ac813f3-3a77-477c-af2e-bf8032c0160d'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','When you put on music, what do you usually want it to do?','Match how I feel','Change my energy','music.match-how-i-feel','music.change-my-energy','{"topic":"music","depth":0,"tree":"music","edition":1}'::jsonb,-984),
('a68d12d4-4810-460a-a191-d9837101f6cc'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','What draws you into music that matches your mood?','The words','The sound and texture','music.the-words','music.the-sound-and-texture','{"topic":"music","depth":1,"tree":"music","edition":1,"connection":"A follow-up on music."}'::jsonb,-983),
('31fbdc44-eb50-4e10-a802-97dafcce1aee'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','To change your energy, which kind of listening helps?','An upbeat playlist','A calm instrumental track','music.an-upbeat-playlist','music.a-calm-instrumental-track','{"topic":"music","depth":1,"tree":"music","edition":1,"connection":"A follow-up on music."}'::jsonb,-982),
('a7c90dfd-1d50-49c7-a3bb-244eda6bc6ec'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','With meaningful lyrics, what connects most?','A story close to my life','A new perspective','music.a-story-close-to-my-life','music.a-new-perspective','{"topic":"music","depth":2,"tree":"music","edition":1,"connection":"A follow-up on music."}'::jsonb,-981),
('f93ddbe4-6c8e-4f28-ad64-8ab6af71a3e9'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','For mood-matching sound, what do you reach for?','Acoustic and intimate','Layered and atmospheric','music.acoustic-and-intimate','music.layered-and-atmospheric','{"topic":"music","depth":2,"tree":"music","edition":1,"connection":"A follow-up on music."}'::jsonb,-980),
('e9be15d0-fb6f-4982-a3f1-e1e7da825b8c'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','For an energy boost, how do you choose tracks?','Familiar favourites','Fresh discoveries','music.familiar-favourites','music.fresh-discoveries','{"topic":"music","depth":2,"tree":"music","edition":1,"connection":"A follow-up on music."}'::jsonb,-979),
('2a7b3655-0676-4fe3-ad35-1486f5875423'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','For calmer listening, what helps you settle?','One album without interruptions','A gentle mix of different artists','music.one-album-without-interruptions','music.a-gentle-mix-of-different-artists','{"topic":"music","depth":2,"tree":"music","edition":1,"connection":"A follow-up on music."}'::jsonb,-978),
('b803e67e-ddd1-4189-ac16-a1eb44fc367f'::uuid,(select id from public.preference_categories where slug='travel'),'this_or_that','On a short trip, what would make the time feel well spent?','Explore a place deeply','See several different places','travel.explore-a-place-deeply','travel.see-several-different-places','{"topic":"travel","depth":0,"tree":"travel","edition":1}'::jsonb,-976),
('4985720f-e24d-4b1a-a04f-c754af566250'::uuid,(select id from public.preference_categories where slug='travel'),'this_or_that','To explore one place deeply, what would you prioritise?','Local everyday life','Its history and landmarks','travel.local-everyday-life','travel.its-history-and-landmarks','{"topic":"travel","depth":1,"tree":"travel","edition":1,"connection":"A follow-up on travel."}'::jsonb,-975),
('7e68cdd1-c4b2-4542-aac2-e9ba8aae0b7b'::uuid,(select id from public.preference_categories where slug='travel'),'this_or_that','For a trip with several stops, what matters most?','Smooth transport','Room for spontaneous detours','travel.smooth-transport','travel.room-for-spontaneous-detours','{"topic":"travel","depth":1,"tree":"travel","edition":1,"connection":"A follow-up on travel."}'::jsonb,-974),
('caa1cd5f-e6fc-4a57-aa22-9bd58ea2cc29'::uuid,(select id from public.preference_categories where slug='travel'),'this_or_that','How would you get closer to local everyday life?','Visit neighbourhood markets','Join a small local activity','travel.visit-neighbourhood-markets','travel.join-a-small-local-activity','{"topic":"travel","depth":2,"tree":"travel","edition":1,"connection":"A follow-up on travel."}'::jsonb,-973),
('c96f7b50-c267-46d1-a4ac-9fa7426201fc'::uuid,(select id from public.preference_categories where slug='travel'),'this_or_that','At a historic site, how would you like to learn?','A guide who tells stories','Explore at my own pace','travel.a-guide-who-tells-stories','travel.explore-at-my-own-pace','{"topic":"travel","depth":2,"tree":"travel","edition":1,"connection":"A follow-up on travel."}'::jsonb,-972),
('1f2b6ad9-82f5-4896-a087-9d1c21814d20'::uuid,(select id from public.preference_categories where slug='travel'),'this_or_that','For easier travel between stops, what would you choose?','A direct route','A scenic route with extra time','travel.a-direct-route','travel.a-scenic-route-with-extra-time','{"topic":"travel","depth":2,"tree":"travel","edition":1,"connection":"A follow-up on travel."}'::jsonb,-971),
('b9d93119-3517-48bc-af01-b576187efa6f'::uuid,(select id from public.preference_categories where slug='travel'),'this_or_that','When making a spontaneous detour, what appeals most?','An unexpected natural spot','A town I know little about','travel.an-unexpected-natural-spot','travel.a-town-i-know-little-about','{"topic":"travel","depth":2,"tree":"travel","edition":1,"connection":"A follow-up on travel."}'::jsonb,-970),
('53755e43-807f-430e-a589-abeec5b41d69'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','For something you will use often, where do you put your effort?','Research before buying','Try it in person','shopping.research-before-buying','shopping.try-it-in-person','{"topic":"shopping","depth":0,"tree":"shopping","edition":1}'::jsonb,-968),
('1658d72b-f3a5-4cd1-a872-f4fd945ac31b'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','What kind of research helps you decide?','Long-term user experiences','A clear feature comparison','shopping.long-term-user-experiences','shopping.a-clear-feature-comparison','{"topic":"shopping","depth":1,"tree":"shopping","edition":1,"connection":"A follow-up on shopping."}'::jsonb,-967),
('557436f5-32be-40a4-a96d-bf15ad3a1a27'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','When trying a product in person, what matters most?','How comfortable it feels','How easily it fits my routine','shopping.how-comfortable-it-feels','shopping.how-easily-it-fits-my-routine','{"topic":"shopping","depth":1,"tree":"shopping","edition":1,"connection":"A follow-up on shopping."}'::jsonb,-966),
('574b289c-ab64-44e4-a361-a4a833202ffe'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','What convinces you in long-term product reviews?','Reliable use over time','Helpful support when something breaks','shopping.reliable-use-over-time','shopping.helpful-support-when-something-breaks','{"topic":"shopping","depth":2,"tree":"shopping","edition":1,"connection":"A follow-up on shopping."}'::jsonb,-965),
('f50bf3b4-3dd3-49f5-ac6f-ff06b3bb347d'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','When features compete, what is your priority?','The few functions I need','Flexibility for future needs','shopping.the-few-functions-i-need','shopping.flexibility-for-future-needs','{"topic":"shopping","depth":2,"tree":"shopping","edition":1,"connection":"A follow-up on shopping."}'::jsonb,-964),
('bdf95ae8-dbd9-44c1-ac0e-69c337b7d308'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','When judging comfort, what would you rather do?','Spend more time testing','Use a familiar brand as a starting point','shopping.spend-more-time-testing','shopping.use-a-familiar-brand-as-a-starting-point','{"topic":"shopping","depth":2,"tree":"shopping","edition":1,"connection":"A follow-up on shopping."}'::jsonb,-963),
('a9834e4a-f689-4aeb-a5a2-43c3531d5825'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','What makes a product fit your routine?','It works with what I already own','It replaces several separate things','shopping.it-works-with-what-i-already-own','shopping.it-replaces-several-separate-things','{"topic":"shopping","depth":2,"tree":"shopping","edition":1,"connection":"A follow-up on shopping."}'::jsonb,-962),
('be0950ff-cd35-47bc-acef-6a41aa20868b'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','What would make movement easier to fit into an ordinary week?','A regular planned session','Small bursts throughout the day','fitness.a-regular-planned-session','fitness.small-bursts-throughout-the-day','{"topic":"health","depth":0,"tree":"health","edition":1}'::jsonb,-960),
('7d97175b-1f64-4994-ae2c-7aa67bc53760'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','For planned movement, what helps you return?','A class at a fixed time','A flexible solo routine','fitness.a-class-at-a-fixed-time','fitness.a-flexible-solo-routine','{"topic":"health","depth":1,"tree":"health","edition":1,"connection":"A follow-up on health."}'::jsonb,-959),
('39951854-249a-41fa-a9e1-569696a7d3ec'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','For small bursts of movement, what sounds practical?','Walk during an existing break','Move between tasks at home','fitness.walk-during-an-existing-break','fitness.move-between-tasks-at-home','{"topic":"health","depth":1,"tree":"health","edition":1,"connection":"A follow-up on health."}'::jsonb,-958),
('7f12789c-201f-43e9-af06-1bdb2a6c8764'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','What makes a class feel inviting?','A supportive instructor','A friend joining me','fitness.a-supportive-instructor','fitness.a-friend-joining-me','{"topic":"health","depth":2,"tree":"health","edition":1,"connection":"A follow-up on health."}'::jsonb,-957),
('4a942f18-ae33-4bac-a11c-7c9d2eb5003c'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','For a solo routine, what keeps it manageable?','Repeat a simple sequence','Vary activities by how I feel','fitness.repeat-a-simple-sequence','fitness.vary-activities-by-how-i-feel','{"topic":"health","depth":2,"tree":"health","edition":1,"connection":"A follow-up on health."}'::jsonb,-956),
('48093515-e5eb-443e-a3d6-338b50c69f21'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','What would improve a regular walking break?','A pleasant outdoor route','A short errand with a purpose','fitness.a-pleasant-outdoor-route','fitness.a-short-errand-with-a-purpose','{"topic":"health","depth":2,"tree":"health","edition":1,"connection":"A follow-up on health."}'::jsonb,-955),
('0bc4bc2f-d9ae-4c0e-abec-eb9d032e2953'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','For movement at home, what is easier to sustain?','A reminder at a regular time','A cue from finishing another task','fitness.a-reminder-at-a-regular-time','fitness.a-cue-from-finishing-another-task','{"topic":"health","depth":2,"tree":"health","edition":1,"connection":"A follow-up on health."}'::jsonb,-954),
('d464f1b5-996e-44b0-ae93-4a0023d30cb5'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','In a good working week, what would you like more of?','Deep uninterrupted work','Useful collaboration','work.deep-uninterrupted-work','work.useful-collaboration','{"topic":"career","depth":0,"tree":"career","edition":1}'::jsonb,-952),
('7376526f-840d-4d8d-aba9-dcde9bd9aae0'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','What helps you protect focused work?','A predictable focus block','Control over where I work','work.a-predictable-focus-block','work.control-over-where-i-work','{"topic":"career","depth":1,"tree":"career","edition":1,"connection":"A follow-up on career."}'::jsonb,-951),
('8ca66b69-c324-4883-a3bc-b3b478733414'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','What makes collaboration useful for you?','Thinking through ideas together','Clear ownership and hand-offs','work.thinking-through-ideas-together','work.clear-ownership-and-hand-offs','{"topic":"career","depth":1,"tree":"career","edition":1,"connection":"A follow-up on career."}'::jsonb,-950),
('2e01115c-6e2a-4b2a-a2eb-980b6f58acaf'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','For a focus block, what would you change first?','Reduce notifications','Agree on quieter meeting hours','work.reduce-notifications','work.agree-on-quieter-meeting-hours','{"topic":"career","depth":2,"tree":"career","edition":1,"connection":"A follow-up on career."}'::jsonb,-949),
('41764682-aacd-4828-a98c-6630b1d9b969'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','Which working setting helps you concentrate?','A quiet private space','A low-key shared workspace','work.a-quiet-private-space','work.a-low-key-shared-workspace','{"topic":"career","depth":2,"tree":"career","edition":1,"connection":"A follow-up on career."}'::jsonb,-948),
('c33f2827-1f6f-4e51-ab24-2704bdebb209'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','When discussing ideas, what helps you contribute?','Time to prepare my thoughts','A lively conversation in the moment','work.time-to-prepare-my-thoughts','work.a-lively-conversation-in-the-moment','{"topic":"career","depth":2,"tree":"career","edition":1,"connection":"A follow-up on career."}'::jsonb,-947),
('7d4d43dc-b6b7-4467-a3bb-51cf9a520fb6'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','For a hand-off, which form of clarity helps most?','A concise written brief','A short live walkthrough','work.a-concise-written-brief','work.a-short-live-walkthrough','{"topic":"career","depth":2,"tree":"career","edition":1,"connection":"A follow-up on career."}'::jsonb,-946),
('9c1e153e-649b-4d55-aa0e-c5a8f2feb558'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','After a busy week, what kind of connection feels best?','Time with one close person','A small group gathering','social.time-with-one-close-person','social.a-small-group-gathering','{"topic":"relationships","depth":0,"tree":"relationships","edition":1}'::jsonb,-944),
('68c3790e-bcea-474f-a2cc-433db66ad7e2'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','During one-to-one time, what would you enjoy?','An unhurried conversation','Doing an activity together','social.an-unhurried-conversation','social.doing-an-activity-together','{"topic":"relationships","depth":1,"tree":"relationships","edition":1,"connection":"A follow-up on relationships."}'::jsonb,-943),
('060da961-a700-49a0-a4fb-599dd5bccc28'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','For a small gathering, what makes it comfortable?','A plan everyone knows','A relaxed open-ended evening','social.a-plan-everyone-knows','social.a-relaxed-open-ended-evening','{"topic":"relationships","depth":1,"tree":"relationships","edition":1,"connection":"A follow-up on relationships."}'::jsonb,-942),
('9dc256be-1b66-426d-a4bb-5f83bb407126'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','For a meaningful conversation, what helps you open up?','A quiet private setting','A shared walk','social.a-quiet-private-setting','social.a-shared-walk','{"topic":"relationships","depth":2,"tree":"relationships","edition":1,"connection":"A follow-up on relationships."}'::jsonb,-941),
('1bd8c32d-11e4-43c9-a719-257682462f8e'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','Which shared activity makes connection easier?','Cook or make something','Go somewhere new together','social.cook-or-make-something','social.go-somewhere-new-together','{"topic":"relationships","depth":2,"tree":"relationships","edition":1,"connection":"A follow-up on relationships."}'::jsonb,-940),
('43ade0b8-2140-46f6-a64f-34720dbc6c7f'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','When arranging a group plan, what matters more?','Give people plenty of notice','Keep the plan simple to join','social.give-people-plenty-of-notice','social.keep-the-plan-simple-to-join','{"topic":"relationships","depth":2,"tree":"relationships","edition":1,"connection":"A follow-up on relationships."}'::jsonb,-939),
('c44bceaf-ab82-43be-a1bd-56a6aceafa5f'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','In an open-ended evening, what feels welcoming?','Someone gently includes everyone','People can dip in and out','social.someone-gently-includes-everyone','social.people-can-dip-in-and-out','{"topic":"relationships","depth":2,"tree":"relationships","edition":1,"connection":"A follow-up on relationships."}'::jsonb,-938),
('0190119c-9b54-4f29-a980-e6284c7bdc6e'::uuid,(select id from public.preference_categories where slug='finance'),'this_or_that','For everyday spending, which habit would feel easier to maintain?','Set a simple monthly limit','Check spending a little at a time','finance.set-a-simple-monthly-limit','finance.check-spending-a-little-at-a-time','{"topic":"finance","depth":0,"tree":"finance","edition":1}'::jsonb,-936),
('deb76ef4-7263-4e54-a0c5-447d670f9886'::uuid,(select id from public.preference_categories where slug='finance'),'this_or_that','What would make a monthly limit useful?','Separate essential and optional spending','One flexible overall target','finance.separate-essential-and-optional-spending','finance.one-flexible-overall-target','{"topic":"finance","depth":1,"tree":"finance","edition":1,"connection":"A follow-up on finance."}'::jsonb,-935),
('624c7edc-3e18-46aa-a0ea-a7bebf9a79a3'::uuid,(select id from public.preference_categories where slug='finance'),'this_or_that','For small spending check-ins, what would you choose?','A weekly review','A quick check before bigger purchases','finance.a-weekly-review','finance.a-quick-check-before-bigger-purchases','{"topic":"finance","depth":1,"tree":"finance","edition":1,"connection":"A follow-up on finance."}'::jsonb,-934),
('26c574af-e1bf-45ac-a97f-bcadbb43f3b4'::uuid,(select id from public.preference_categories where slug='finance'),'this_or_that','Within optional spending, what would you rather protect?','Experiences with people','Things I use often','finance.experiences-with-people','finance.things-i-use-often','{"topic":"finance","depth":2,"tree":"finance","edition":1,"connection":"A follow-up on finance."}'::jsonb,-933),
('6833c4d6-912e-45bd-a6d6-94b032a8937f'::uuid,(select id from public.preference_categories where slug='finance'),'this_or_that','When an overall target needs changing, what helps?','A buffer for unexpected costs','Adjust it to that month''s plans','finance.a-buffer-for-unexpected-costs','finance.adjust-it-to-that-month-s-plans','{"topic":"finance","depth":2,"tree":"finance","edition":1,"connection":"A follow-up on finance."}'::jsonb,-932),
('a0f4f03c-074a-4374-a0cb-6785d5dde4a4'::uuid,(select id from public.preference_categories where slug='finance'),'this_or_that','During a weekly spending review, what would be useful?','See a few clear categories','See only the total and trend','finance.see-a-few-clear-categories','finance.see-only-the-total-and-trend','{"topic":"finance","depth":2,"tree":"finance","edition":1,"connection":"A follow-up on finance."}'::jsonb,-931),
('96f5709e-e190-4342-ac74-9dee06d41e43'::uuid,(select id from public.preference_categories where slug='finance'),'this_or_that','Before a bigger purchase, what helps you pause?','Wait a day before deciding','Compare it with another priority','finance.wait-a-day-before-deciding','finance.compare-it-with-another-priority','{"topic":"finance","depth":2,"tree":"finance","edition":1,"connection":"A follow-up on finance."}'::jsonb,-930),
('f60c3509-3704-4707-a0a3-8349956a8d5f'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','What would make a hobby feel worthwhile right now?','Build a skill over time','Enjoy it without a goal','hobby.build-a-skill-over-time','hobby.enjoy-it-without-a-goal','{"topic":"hobbies","depth":0,"tree":"hobbies","edition":1}'::jsonb,-928),
('bae334be-3f16-42e4-a32f-bd79fa0f348e'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For a hobby skill, what motivates you?','A small project I can finish','A clear next technique to learn','hobby.a-small-project-i-can-finish','hobby.a-clear-next-technique-to-learn','{"topic":"hobbies","depth":1,"tree":"hobbies","edition":1,"connection":"A follow-up on hobbies."}'::jsonb,-927),
('aa67f8ad-8906-47fa-a415-4745f425ba53'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For a hobby without a goal, what matters most?','A restful familiar activity','Playful experimentation','hobby.a-restful-familiar-activity','hobby.playful-experimentation','{"topic":"hobbies","depth":1,"tree":"hobbies","edition":1,"connection":"A follow-up on hobbies."}'::jsonb,-926),
('4ea3500a-3eb7-4f45-a343-d2a0e382054a'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For a small project, what finish line feels satisfying?','Make something useful','Make something I can share','hobby.make-something-useful','hobby.make-something-i-can-share','{"topic":"hobbies","depth":2,"tree":"hobbies","edition":1,"connection":"A follow-up on hobbies."}'::jsonb,-925),
('81d0405b-c9bf-4863-a6ec-35019d9f5c65'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','To learn a technique, what would you prefer?','A step-by-step demonstration','Try it and work out the details','hobby.a-step-by-step-demonstration','hobby.try-it-and-work-out-the-details','{"topic":"hobbies","depth":2,"tree":"hobbies","edition":1,"connection":"A follow-up on hobbies."}'::jsonb,-924),
('b416dd4c-3f9e-4bf2-a3cb-8a2d83c85f7f'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For a restful hobby, what helps you settle?','A familiar rhythm','An activity away from screens','hobby.a-familiar-rhythm','hobby.an-activity-away-from-screens','{"topic":"hobbies","depth":2,"tree":"hobbies","edition":1,"connection":"A follow-up on hobbies."}'::jsonb,-923),
('c387b972-2213-4de6-a176-448691787b4a'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For playful experimentation, what makes it easier?','Low-cost materials','Company that enjoys trying things','hobby.low-cost-materials','hobby.company-that-enjoys-trying-things','{"topic":"hobbies","depth":2,"tree":"hobbies","edition":1,"connection":"A follow-up on hobbies."}'::jsonb,-922),
('e4d6be5e-dba1-41b8-aa65-9a818bd01672'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','What would make your home feel better on an ordinary day?','Less visual clutter','More personal warmth','home.less-visual-clutter','home.more-personal-warmth','{"topic":"home","depth":0,"tree":"home","edition":1}'::jsonb,-920),
('d455c74d-6eac-4cc4-aa21-621726d032e2'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','When reducing clutter, what would help first?','Fewer things on visible surfaces','A clear place for everyday items','home.fewer-things-on-visible-surfaces','home.a-clear-place-for-everyday-items','{"topic":"home","depth":1,"tree":"home","edition":1,"connection":"A follow-up on home."}'::jsonb,-919),
('fed7cfb8-0575-4c34-a90e-efa0f26020ba'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For more personal warmth, what appeals?','Lighting and textures','Objects with a story','home.lighting-and-textures','home.objects-with-a-story','{"topic":"home","depth":1,"tree":"home","edition":1,"connection":"A follow-up on home."}'::jsonb,-918),
('7b8ae40a-f593-4c49-ace0-fc01df55c4bc'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','With visible surfaces, which approach feels manageable?','Clear one area at a time','Keep only the essentials out','home.clear-one-area-at-a-time','home.keep-only-the-essentials-out','{"topic":"home","depth":2,"tree":"home","edition":1,"connection":"A follow-up on home."}'::jsonb,-917),
('ae5014d8-1000-445b-a8b1-86088f528b66'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For everyday storage, what matters more?','Everything easy to reach','Everything tucked out of sight','home.everything-easy-to-reach','home.everything-tucked-out-of-sight','{"topic":"home","depth":2,"tree":"home","edition":1,"connection":"A follow-up on home."}'::jsonb,-916),
('a2cfc050-0a06-4783-acd5-fa8a014a5a4a'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','Which change in lighting would you enjoy?','Soft evening lamps','More natural daylight','home.soft-evening-lamps','home.more-natural-daylight','{"topic":"home","depth":2,"tree":"home","edition":1,"connection":"A follow-up on home."}'::jsonb,-915),
('9b9a2301-f031-440d-acce-3e96e7f8dcdd'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For objects with a story, what would you display?','Memories from people and places','Things I made myself','home.memories-from-people-and-places','home.things-i-made-myself','{"topic":"home","depth":2,"tree":"home","edition":1,"connection":"A follow-up on home."}'::jsonb,-914),
('8adb0cca-66d5-4e1e-adc4-e98962a02051'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','When learning something new, how would you like to begin?','Understand the main idea','Try a small real task','learning.understand-the-main-idea','learning.try-a-small-real-task','{"topic":"learning","depth":0,"tree":"learning","edition":1}'::jsonb,-912),
('b15859ed-fd86-474a-a304-d51d8017a233'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','For understanding a new idea, what helps most?','A clear example','A visual explanation','learning.a-clear-example','learning.a-visual-explanation','{"topic":"learning","depth":1,"tree":"learning","edition":1,"connection":"A follow-up on learning."}'::jsonb,-911),
('680f28d9-b9ce-4709-a3dc-260846f9a9ae'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','For a first real task, what feels useful?','A guided exercise','A problem from my own life','learning.a-guided-exercise','learning.a-problem-from-my-own-life','{"topic":"learning","depth":1,"tree":"learning","edition":1,"connection":"A follow-up on learning."}'::jsonb,-910),
('0ec36f73-8edb-4568-a733-26758ed0de01'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','With an example, what helps the idea stick?','Compare two different cases','Explain it back in my own words','learning.compare-two-different-cases','learning.explain-it-back-in-my-own-words','{"topic":"learning","depth":2,"tree":"learning","edition":1,"connection":"A follow-up on learning."}'::jsonb,-909),
('5f543128-3b2a-45e8-ac3c-3958226e304f'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','With a visual explanation, what would you choose?','A simple diagram','A demonstration in motion','learning.a-simple-diagram','learning.a-demonstration-in-motion','{"topic":"learning","depth":2,"tree":"learning","edition":1,"connection":"A follow-up on learning."}'::jsonb,-908),
('60603175-2ccf-4253-afed-d37f424dcf9f'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','In a guided exercise, what support helps?','Feedback after each step','A complete worked solution afterward','learning.feedback-after-each-step','learning.a-complete-worked-solution-afterward','{"topic":"learning","depth":2,"tree":"learning","edition":1,"connection":"A follow-up on learning."}'::jsonb,-907),
('3ffb9d49-5515-42df-a4d9-f0c69f44604b'::uuid,(select id from public.preference_categories where slug='career'),'this_or_that','For a problem from your life, what keeps you going?','An immediately useful result','The chance to explore freely','learning.an-immediately-useful-result','learning.the-chance-to-explore-freely','{"topic":"learning","depth":2,"tree":"learning","edition":1,"connection":"A follow-up on learning."}'::jsonb,-906),
('07a0b8aa-8307-48b6-abc5-62deb4ccd3d0'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','What would improve your everyday use of technology?','Fewer distractions','Less friction in common tasks','tech.fewer-distractions','tech.less-friction-in-common-tasks','{"topic":"digital","depth":0,"tree":"digital","edition":1}'::jsonb,-904),
('202aaf29-85c2-4f50-af84-87039927b422'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','For fewer distractions, where would you start?','Control notifications','Create time away from feeds','tech.control-notifications','tech.create-time-away-from-feeds','{"topic":"digital","depth":1,"tree":"digital","edition":1,"connection":"A follow-up on digital."}'::jsonb,-903),
('6326d4cf-dc62-4bf8-a538-2e26e2e303c5'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','To simplify common tasks, what would help?','Use fewer apps','Connect tools I already use','tech.use-fewer-apps','tech.connect-tools-i-already-use','{"topic":"digital","depth":1,"tree":"digital","edition":1,"connection":"A follow-up on digital."}'::jsonb,-902),
('0d2a658e-458d-41a0-abd1-addf57caa711'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','For notifications, which rule feels practical?','Only people can interrupt','Check everything at chosen times','tech.only-people-can-interrupt','tech.check-everything-at-chosen-times','{"topic":"digital","depth":2,"tree":"digital","edition":1,"connection":"A follow-up on digital."}'::jsonb,-901),
('4212f143-d5ba-4cb6-a9c9-d928f8886d5b'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','For time away from feeds, what helps more?','Keep the phone out of reach','Replace scrolling with another activity','tech.keep-the-phone-out-of-reach','tech.replace-scrolling-with-another-activity','{"topic":"digital","depth":2,"tree":"digital","edition":1,"connection":"A follow-up on digital."}'::jsonb,-900),
('db88f6eb-09dd-44d7-a7de-e94c66ef33df'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','When choosing fewer apps, what matters most?','A simple tool that does the basics','One tool covering several needs','tech.a-simple-tool-that-does-the-basics','tech.one-tool-covering-several-needs','{"topic":"digital","depth":2,"tree":"digital","edition":1,"connection":"A follow-up on digital."}'::jsonb,-899),
('ad8f4097-7a58-4cbc-ae7a-f92d999c3b83'::uuid,(select id from public.preference_categories where slug='shopping'),'this_or_that','When connecting tools, what would you prioritise?','Saving repetitive effort','Keeping control over shared data','tech.saving-repetitive-effort','tech.keeping-control-over-shared-data','{"topic":"digital","depth":2,"tree":"digital","edition":1,"connection":"A follow-up on digital."}'::jsonb,-898),
('6b3bb51a-d58c-4d7e-a3df-447ab412ee78'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','When two good opportunities compete, what would you protect first?','Time for people who matter','Room for personal growth','values.time-for-people-who-matter','values.room-for-personal-growth','{"topic":"values","depth":0,"tree":"values","edition":1}'::jsonb,-896),
('1c4db4a9-bcd5-44b7-ab5d-e417f8b4532d'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','When protecting time for people, what matters most?','Be reliable in everyday life','Make room for important moments','values.be-reliable-in-everyday-life','values.make-room-for-important-moments','{"topic":"values","depth":1,"tree":"values","edition":1,"connection":"A follow-up on values."}'::jsonb,-895),
('d07f4fe1-182b-4605-af07-520eb3029828'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For personal growth, which opportunity appeals?','Deepen an existing strength','Explore an unfamiliar direction','values.deepen-an-existing-strength','values.explore-an-unfamiliar-direction','{"topic":"values","depth":1,"tree":"values","edition":1,"connection":"A follow-up on values."}'::jsonb,-894),
('121f6752-9917-4fa9-aaeb-531ed81749fe'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For everyday reliability, what would you prefer?','A few commitments I can keep','Flexibility to respond when needed','values.a-few-commitments-i-can-keep','values.flexibility-to-respond-when-needed','{"topic":"values","depth":2,"tree":"values","edition":1,"connection":"A follow-up on values."}'::jsonb,-893),
('e981f10a-d8c0-4e55-a8d1-793586ed64b3'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For important moments, what helps you show up?','Plan ahead around them','Leave room in my schedule','values.plan-ahead-around-them','values.leave-room-in-my-schedule','{"topic":"values","depth":2,"tree":"values","edition":1,"connection":"A follow-up on values."}'::jsonb,-892),
('0cffda53-6ad0-410c-a9e9-c114799821cd'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','To deepen a strength, what feels rewarding?','Become more capable independently','Use it to help someone else','values.become-more-capable-independently','values.use-it-to-help-someone-else','{"topic":"values","depth":2,"tree":"values","edition":1,"connection":"A follow-up on values."}'::jsonb,-891),
('c4704fc5-d3ac-42b4-a543-16cb1bcd67d7'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','To explore a new direction, what would help?','A low-stakes experiment','Encouragement from someone I trust','values.a-low-stakes-experiment','values.encouragement-from-someone-i-trust','{"topic":"values","depth":2,"tree":"values","edition":1,"connection":"A follow-up on values."}'::jsonb,-890),
('8e3b58c3-e56e-4bfc-a141-22e7654297ba'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','What would make a busy day feel more manageable?','A clear plan at the start','Space to adjust as it unfolds','rhythm.a-clear-plan-at-the-start','rhythm.space-to-adjust-as-it-unfolds','{"topic":"time","depth":0,"tree":"time","edition":1}'::jsonb,-888),
('a457a92d-2f68-447d-a0b2-fa8793ee57c1'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For a clear daily plan, what helps you?','Choose three priorities','Give tasks specific time blocks','rhythm.choose-three-priorities','rhythm.give-tasks-specific-time-blocks','{"topic":"time","depth":1,"tree":"time","edition":1,"connection":"A follow-up on time."}'::jsonb,-887),
('af602539-2611-4075-af87-c4b49875a69b'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','When adjusting through the day, what keeps you grounded?','A short mid-day reset','A clear rule for what can wait','rhythm.a-short-mid-day-reset','rhythm.a-clear-rule-for-what-can-wait','{"topic":"time","depth":1,"tree":"time","edition":1,"connection":"A follow-up on time."}'::jsonb,-886),
('12557726-ef42-47c4-a1ee-f62d5f825335'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For three priorities, what would you choose first?','The most meaningful task','The task blocking other things','rhythm.the-most-meaningful-task','rhythm.the-task-blocking-other-things','{"topic":"time","depth":2,"tree":"time","edition":1,"connection":"A follow-up on time."}'::jsonb,-885),
('ea74ffd8-ce29-4d8e-a191-4fda15a47f41'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For time blocks, how much structure feels useful?','Predictable recurring blocks','A fresh schedule for each day','rhythm.predictable-recurring-blocks','rhythm.a-fresh-schedule-for-each-day','{"topic":"time","depth":2,"tree":"time","edition":1,"connection":"A follow-up on time."}'::jsonb,-884),
('cd90fe8d-7ded-445f-a204-c5a34da3e932'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','At a mid-day reset, what would help?','Review what is still realistic','Take a break before deciding','rhythm.review-what-is-still-realistic','rhythm.take-a-break-before-deciding','{"topic":"time","depth":2,"tree":"time","edition":1,"connection":"A follow-up on time."}'::jsonb,-883),
('796dfc49-6b9a-43f4-afe8-b7d97a2d8987'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','When deciding what can wait, what guides you?','The deadline and consequence','My available energy','rhythm.the-deadline-and-consequence','rhythm.my-available-energy','{"topic":"time","depth":2,"tree":"time","edition":1,"connection":"A follow-up on time."}'::jsonb,-882),
('c8fb753c-41a3-4127-a952-6ffcdcaaf408'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','When making something creative, what starts the process for you?','A clear idea to bring to life','Exploring until an idea appears','creative.a-clear-idea-to-bring-to-life','creative.exploring-until-an-idea-appears','{"topic":"creativity","depth":0,"tree":"creativity","edition":1}'::jsonb,-880),
('b24dcc5d-17f1-4be3-a639-80b2ce9d1463'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','With a clear idea, what helps you begin?','A rough outline','A quick first version','creative.a-rough-outline','creative.a-quick-first-version','{"topic":"creativity","depth":1,"tree":"creativity","edition":1,"connection":"A follow-up on creativity."}'::jsonb,-879),
('dfe66509-76e0-482a-aa07-96254f7165dc'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','When exploring creatively, what sparks you?','An interesting material or tool','A prompt or constraint','creative.an-interesting-material-or-tool','creative.a-prompt-or-constraint','{"topic":"creativity","depth":1,"tree":"creativity","edition":1,"connection":"A follow-up on creativity."}'::jsonb,-878),
('1ee4888a-1ff4-428b-a89c-9b3ff770f75e'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For a rough outline, what feels useful?','Map the overall shape','Collect a few strong references','creative.map-the-overall-shape','creative.collect-a-few-strong-references','{"topic":"creativity","depth":2,"tree":"creativity","edition":1,"connection":"A follow-up on creativity."}'::jsonb,-877),
('3e892b14-9d86-4522-a631-cad5cafeba89'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','With a first version, what would you rather do?','Finish quickly then revise','Develop one section carefully','creative.finish-quickly-then-revise','creative.develop-one-section-carefully','{"topic":"creativity","depth":2,"tree":"creativity","edition":1,"connection":"A follow-up on creativity."}'::jsonb,-876),
('d28765f1-8953-430b-a85f-50dbaa695240'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','When a material sparks an idea, how do you explore?','Experiment freely with its possibilities','Learn one technique first','creative.experiment-freely-with-its-possibilities','creative.learn-one-technique-first','{"topic":"creativity","depth":2,"tree":"creativity","edition":1,"connection":"A follow-up on creativity."}'::jsonb,-875),
('fa7f4d47-3dd5-4eb6-aff8-5f9d5fb7f35f'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','With a creative constraint, what appeals?','A tight time limit','A simple theme to interpret','creative.a-tight-time-limit','creative.a-simple-theme-to-interpret','{"topic":"creativity","depth":2,"tree":"creativity","edition":1,"connection":"A follow-up on creativity."}'::jsonb,-874),
('7d924496-d043-43d1-a38b-80bba2142478'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For reducing everyday waste, which change seems easier?','Use what I own for longer','Buy fewer disposable items','habit.use-what-i-own-for-longer','habit.buy-fewer-disposable-items','{"topic":"sustainability","depth":0,"tree":"sustainability","edition":1}'::jsonb,-872),
('c0dc739a-4efe-4914-a079-6b168e116fba'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','To keep something useful longer, what would help?','Simple repair skills','Better care and maintenance','habit.simple-repair-skills','habit.better-care-and-maintenance','{"topic":"sustainability","depth":1,"tree":"sustainability","edition":1,"connection":"A follow-up on sustainability."}'::jsonb,-871),
('a211abb3-e8e1-4575-ae31-f82a9bf4084b'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For fewer disposable items, what would you try?','A reusable item I can carry','A refill option near home','habit.a-reusable-item-i-can-carry','habit.a-refill-option-near-home','{"topic":"sustainability","depth":1,"tree":"sustainability","edition":1,"connection":"A follow-up on sustainability."}'::jsonb,-870),
('f2140c63-c773-49d4-abad-5534825e42bb'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For simple repairs, how would you learn?','Fix one item with guidance','Attend a practical workshop','habit.fix-one-item-with-guidance','habit.attend-a-practical-workshop','{"topic":"sustainability","depth":2,"tree":"sustainability","edition":1,"connection":"A follow-up on sustainability."}'::jsonb,-869),
('27376b00-da10-4ce8-ad35-919df401c3f6'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For better maintenance, what works for you?','A small regular routine','Care instructions when I need them','habit.a-small-regular-routine','habit.care-instructions-when-i-need-them','{"topic":"sustainability","depth":2,"tree":"sustainability","edition":1,"connection":"A follow-up on sustainability."}'::jsonb,-868),
('8f5b118c-53fa-4893-a76b-bfbd9258dd7a'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','For a reusable item, what matters most?','Convenience to carry','Easy cleaning after use','habit.convenience-to-carry','habit.easy-cleaning-after-use','{"topic":"sustainability","depth":2,"tree":"sustainability","edition":1,"connection":"A follow-up on sustainability."}'::jsonb,-867),
('44be8d76-2f67-49cd-aff9-ac86e29d9e22'::uuid,(select id from public.preference_categories where slug='lifestyle'),'this_or_that','With refills, what would make the habit practical?','Add it to an existing errand','Buy enough to reduce trips','habit.add-it-to-an-existing-errand','habit.buy-enough-to-reduce-trips','{"topic":"sustainability","depth":2,"tree":"sustainability","edition":1,"connection":"A follow-up on sustainability."}'::jsonb,-866),
('3d1408b1-c088-4e4b-ac13-052c680c395c'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','After an overstimulating day, what helps you recover?','Quiet time on my own','Gentle company','rest.quiet-time-on-my-own','rest.gentle-company','{"topic":"wellbeing","depth":0,"tree":"wellbeing","edition":1}'::jsonb,-864),
('0cfcedb6-392c-482f-af29-febc0743c6e3'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','For quiet recovery, what would feel best?','An activity without screens','Doing very little for a while','rest.an-activity-without-screens','rest.doing-very-little-for-a-while','{"topic":"wellbeing","depth":1,"tree":"wellbeing","edition":1,"connection":"A follow-up on rest and wellbeing."}'::jsonb,-863),
('1888cf57-52b3-4e1d-a2fd-fae87cb94306'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','For gentle company, what would you enjoy?','A familiar person nearby','A low-key shared activity','rest.a-familiar-person-nearby','rest.a-low-key-shared-activity','{"topic":"wellbeing","depth":1,"tree":"wellbeing","edition":1,"connection":"A follow-up on rest and wellbeing."}'::jsonb,-862),
('881a576b-832f-4ea3-ad0b-dcbe68b540c3'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','For screen-free recovery, what helps you unwind?','A short walk outdoors','A small hands-on task','rest.a-short-walk-outdoors','rest.a-small-hands-on-task','{"topic":"wellbeing","depth":2,"tree":"wellbeing","edition":1,"connection":"A follow-up on rest and wellbeing."}'::jsonb,-861),
('015dd204-9632-45fb-ac1a-38cd84d43867'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','When doing very little, what makes it easier?','A clear break with no obligations','A comfortable place to rest','rest.a-clear-break-with-no-obligations','rest.a-comfortable-place-to-rest','{"topic":"wellbeing","depth":2,"tree":"wellbeing","edition":1,"connection":"A follow-up on rest and wellbeing."}'::jsonb,-860),
('8e87798c-30c2-4a3b-a40a-033c342d919e'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','With someone familiar nearby, what feels supportive?','Talking a little about the day','Being together without needing to talk','rest.talking-a-little-about-the-day','rest.being-together-without-needing-to-talk','{"topic":"wellbeing","depth":2,"tree":"wellbeing","edition":1,"connection":"A follow-up on rest and wellbeing."}'::jsonb,-859),
('79c70f87-5adf-4bef-aae2-bbd36181f7a7'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','For a low-key activity with company, what would you choose?','Prepare an easy meal','Watch something familiar','rest.prepare-an-easy-meal','rest.watch-something-familiar','{"topic":"wellbeing","depth":2,"tree":"wellbeing","edition":1,"connection":"A follow-up on rest and wellbeing."}'::jsonb,-858);

insert into public.question_branches(child_question_id,parent_question_id,parent_choice) values
('f0d94c8f-72ee-48af-a785-d4733380b359'::uuid,'864e15d5-2a30-4c82-a70c-56c31096d62a'::uuid,'a'),
('e60502ee-0eed-409a-accd-c2bbd427638c'::uuid,'864e15d5-2a30-4c82-a70c-56c31096d62a'::uuid,'b'),
('9e9e62a0-004e-45bc-a0d5-a5897d652864'::uuid,'f0d94c8f-72ee-48af-a785-d4733380b359'::uuid,'a'),
('e72bdb3b-229f-4ab0-aeff-6a9f23ed92bf'::uuid,'f0d94c8f-72ee-48af-a785-d4733380b359'::uuid,'b'),
('6bb9fbce-b6c8-4d21-a25f-ce9ed10577c8'::uuid,'e60502ee-0eed-409a-accd-c2bbd427638c'::uuid,'a'),
('fef5f8c0-f85a-475d-ae8c-f233fe1b814a'::uuid,'e60502ee-0eed-409a-accd-c2bbd427638c'::uuid,'b'),
('e02a474b-f9f0-404d-aae5-7eb9036229a1'::uuid,'60e4f098-cd74-468b-ac8f-c00bcb8097c3'::uuid,'a'),
('6f2ebe83-fed4-4ebd-a16c-13aa5e335071'::uuid,'60e4f098-cd74-468b-ac8f-c00bcb8097c3'::uuid,'b'),
('c2104831-f92e-4aa9-a67b-9961677eb210'::uuid,'e02a474b-f9f0-404d-aae5-7eb9036229a1'::uuid,'a'),
('2d9bfe3d-019a-4d81-a175-0eb4774b40f5'::uuid,'e02a474b-f9f0-404d-aae5-7eb9036229a1'::uuid,'b'),
('8c66cbb2-25bf-4f41-aa45-b22b00fe20e6'::uuid,'6f2ebe83-fed4-4ebd-a16c-13aa5e335071'::uuid,'a'),
('9a8fcf43-2864-497f-a986-52cb4c641bed'::uuid,'6f2ebe83-fed4-4ebd-a16c-13aa5e335071'::uuid,'b'),
('a68d12d4-4810-460a-a191-d9837101f6cc'::uuid,'9ac813f3-3a77-477c-af2e-bf8032c0160d'::uuid,'a'),
('31fbdc44-eb50-4e10-a802-97dafcce1aee'::uuid,'9ac813f3-3a77-477c-af2e-bf8032c0160d'::uuid,'b'),
('a7c90dfd-1d50-49c7-a3bb-244eda6bc6ec'::uuid,'a68d12d4-4810-460a-a191-d9837101f6cc'::uuid,'a'),
('f93ddbe4-6c8e-4f28-ad64-8ab6af71a3e9'::uuid,'a68d12d4-4810-460a-a191-d9837101f6cc'::uuid,'b'),
('e9be15d0-fb6f-4982-a3f1-e1e7da825b8c'::uuid,'31fbdc44-eb50-4e10-a802-97dafcce1aee'::uuid,'a'),
('2a7b3655-0676-4fe3-ad35-1486f5875423'::uuid,'31fbdc44-eb50-4e10-a802-97dafcce1aee'::uuid,'b'),
('4985720f-e24d-4b1a-a04f-c754af566250'::uuid,'b803e67e-ddd1-4189-ac16-a1eb44fc367f'::uuid,'a'),
('7e68cdd1-c4b2-4542-aac2-e9ba8aae0b7b'::uuid,'b803e67e-ddd1-4189-ac16-a1eb44fc367f'::uuid,'b'),
('caa1cd5f-e6fc-4a57-aa22-9bd58ea2cc29'::uuid,'4985720f-e24d-4b1a-a04f-c754af566250'::uuid,'a'),
('c96f7b50-c267-46d1-a4ac-9fa7426201fc'::uuid,'4985720f-e24d-4b1a-a04f-c754af566250'::uuid,'b'),
('1f2b6ad9-82f5-4896-a087-9d1c21814d20'::uuid,'7e68cdd1-c4b2-4542-aac2-e9ba8aae0b7b'::uuid,'a'),
('b9d93119-3517-48bc-af01-b576187efa6f'::uuid,'7e68cdd1-c4b2-4542-aac2-e9ba8aae0b7b'::uuid,'b'),
('1658d72b-f3a5-4cd1-a872-f4fd945ac31b'::uuid,'53755e43-807f-430e-a589-abeec5b41d69'::uuid,'a'),
('557436f5-32be-40a4-a96d-bf15ad3a1a27'::uuid,'53755e43-807f-430e-a589-abeec5b41d69'::uuid,'b'),
('574b289c-ab64-44e4-a361-a4a833202ffe'::uuid,'1658d72b-f3a5-4cd1-a872-f4fd945ac31b'::uuid,'a'),
('f50bf3b4-3dd3-49f5-ac6f-ff06b3bb347d'::uuid,'1658d72b-f3a5-4cd1-a872-f4fd945ac31b'::uuid,'b'),
('bdf95ae8-dbd9-44c1-ac0e-69c337b7d308'::uuid,'557436f5-32be-40a4-a96d-bf15ad3a1a27'::uuid,'a'),
('a9834e4a-f689-4aeb-a5a2-43c3531d5825'::uuid,'557436f5-32be-40a4-a96d-bf15ad3a1a27'::uuid,'b'),
('7d97175b-1f64-4994-ae2c-7aa67bc53760'::uuid,'be0950ff-cd35-47bc-acef-6a41aa20868b'::uuid,'a'),
('39951854-249a-41fa-a9e1-569696a7d3ec'::uuid,'be0950ff-cd35-47bc-acef-6a41aa20868b'::uuid,'b'),
('7f12789c-201f-43e9-af06-1bdb2a6c8764'::uuid,'7d97175b-1f64-4994-ae2c-7aa67bc53760'::uuid,'a'),
('4a942f18-ae33-4bac-a11c-7c9d2eb5003c'::uuid,'7d97175b-1f64-4994-ae2c-7aa67bc53760'::uuid,'b'),
('48093515-e5eb-443e-a3d6-338b50c69f21'::uuid,'39951854-249a-41fa-a9e1-569696a7d3ec'::uuid,'a'),
('0bc4bc2f-d9ae-4c0e-abec-eb9d032e2953'::uuid,'39951854-249a-41fa-a9e1-569696a7d3ec'::uuid,'b'),
('7376526f-840d-4d8d-aba9-dcde9bd9aae0'::uuid,'d464f1b5-996e-44b0-ae93-4a0023d30cb5'::uuid,'a'),
('8ca66b69-c324-4883-a3bc-b3b478733414'::uuid,'d464f1b5-996e-44b0-ae93-4a0023d30cb5'::uuid,'b'),
('2e01115c-6e2a-4b2a-a2eb-980b6f58acaf'::uuid,'7376526f-840d-4d8d-aba9-dcde9bd9aae0'::uuid,'a'),
('41764682-aacd-4828-a98c-6630b1d9b969'::uuid,'7376526f-840d-4d8d-aba9-dcde9bd9aae0'::uuid,'b'),
('c33f2827-1f6f-4e51-ab24-2704bdebb209'::uuid,'8ca66b69-c324-4883-a3bc-b3b478733414'::uuid,'a'),
('7d4d43dc-b6b7-4467-a3bb-51cf9a520fb6'::uuid,'8ca66b69-c324-4883-a3bc-b3b478733414'::uuid,'b'),
('68c3790e-bcea-474f-a2cc-433db66ad7e2'::uuid,'9c1e153e-649b-4d55-aa0e-c5a8f2feb558'::uuid,'a'),
('060da961-a700-49a0-a4fb-599dd5bccc28'::uuid,'9c1e153e-649b-4d55-aa0e-c5a8f2feb558'::uuid,'b'),
('9dc256be-1b66-426d-a4bb-5f83bb407126'::uuid,'68c3790e-bcea-474f-a2cc-433db66ad7e2'::uuid,'a'),
('1bd8c32d-11e4-43c9-a719-257682462f8e'::uuid,'68c3790e-bcea-474f-a2cc-433db66ad7e2'::uuid,'b'),
('43ade0b8-2140-46f6-a64f-34720dbc6c7f'::uuid,'060da961-a700-49a0-a4fb-599dd5bccc28'::uuid,'a'),
('c44bceaf-ab82-43be-a1bd-56a6aceafa5f'::uuid,'060da961-a700-49a0-a4fb-599dd5bccc28'::uuid,'b'),
('deb76ef4-7263-4e54-a0c5-447d670f9886'::uuid,'0190119c-9b54-4f29-a980-e6284c7bdc6e'::uuid,'a'),
('624c7edc-3e18-46aa-a0ea-a7bebf9a79a3'::uuid,'0190119c-9b54-4f29-a980-e6284c7bdc6e'::uuid,'b'),
('26c574af-e1bf-45ac-a97f-bcadbb43f3b4'::uuid,'deb76ef4-7263-4e54-a0c5-447d670f9886'::uuid,'a'),
('6833c4d6-912e-45bd-a6d6-94b032a8937f'::uuid,'deb76ef4-7263-4e54-a0c5-447d670f9886'::uuid,'b'),
('a0f4f03c-074a-4374-a0cb-6785d5dde4a4'::uuid,'624c7edc-3e18-46aa-a0ea-a7bebf9a79a3'::uuid,'a'),
('96f5709e-e190-4342-ac74-9dee06d41e43'::uuid,'624c7edc-3e18-46aa-a0ea-a7bebf9a79a3'::uuid,'b'),
('bae334be-3f16-42e4-a32f-bd79fa0f348e'::uuid,'f60c3509-3704-4707-a0a3-8349956a8d5f'::uuid,'a'),
('aa67f8ad-8906-47fa-a415-4745f425ba53'::uuid,'f60c3509-3704-4707-a0a3-8349956a8d5f'::uuid,'b'),
('4ea3500a-3eb7-4f45-a343-d2a0e382054a'::uuid,'bae334be-3f16-42e4-a32f-bd79fa0f348e'::uuid,'a'),
('81d0405b-c9bf-4863-a6ec-35019d9f5c65'::uuid,'bae334be-3f16-42e4-a32f-bd79fa0f348e'::uuid,'b'),
('b416dd4c-3f9e-4bf2-a3cb-8a2d83c85f7f'::uuid,'aa67f8ad-8906-47fa-a415-4745f425ba53'::uuid,'a'),
('c387b972-2213-4de6-a176-448691787b4a'::uuid,'aa67f8ad-8906-47fa-a415-4745f425ba53'::uuid,'b'),
('d455c74d-6eac-4cc4-aa21-621726d032e2'::uuid,'e4d6be5e-dba1-41b8-aa65-9a818bd01672'::uuid,'a'),
('fed7cfb8-0575-4c34-a90e-efa0f26020ba'::uuid,'e4d6be5e-dba1-41b8-aa65-9a818bd01672'::uuid,'b'),
('7b8ae40a-f593-4c49-ace0-fc01df55c4bc'::uuid,'d455c74d-6eac-4cc4-aa21-621726d032e2'::uuid,'a'),
('ae5014d8-1000-445b-a8b1-86088f528b66'::uuid,'d455c74d-6eac-4cc4-aa21-621726d032e2'::uuid,'b'),
('a2cfc050-0a06-4783-acd5-fa8a014a5a4a'::uuid,'fed7cfb8-0575-4c34-a90e-efa0f26020ba'::uuid,'a'),
('9b9a2301-f031-440d-acce-3e96e7f8dcdd'::uuid,'fed7cfb8-0575-4c34-a90e-efa0f26020ba'::uuid,'b'),
('b15859ed-fd86-474a-a304-d51d8017a233'::uuid,'8adb0cca-66d5-4e1e-adc4-e98962a02051'::uuid,'a'),
('680f28d9-b9ce-4709-a3dc-260846f9a9ae'::uuid,'8adb0cca-66d5-4e1e-adc4-e98962a02051'::uuid,'b'),
('0ec36f73-8edb-4568-a733-26758ed0de01'::uuid,'b15859ed-fd86-474a-a304-d51d8017a233'::uuid,'a'),
('5f543128-3b2a-45e8-ac3c-3958226e304f'::uuid,'b15859ed-fd86-474a-a304-d51d8017a233'::uuid,'b'),
('60603175-2ccf-4253-afed-d37f424dcf9f'::uuid,'680f28d9-b9ce-4709-a3dc-260846f9a9ae'::uuid,'a'),
('3ffb9d49-5515-42df-a4d9-f0c69f44604b'::uuid,'680f28d9-b9ce-4709-a3dc-260846f9a9ae'::uuid,'b'),
('202aaf29-85c2-4f50-af84-87039927b422'::uuid,'07a0b8aa-8307-48b6-abc5-62deb4ccd3d0'::uuid,'a'),
('6326d4cf-dc62-4bf8-a538-2e26e2e303c5'::uuid,'07a0b8aa-8307-48b6-abc5-62deb4ccd3d0'::uuid,'b'),
('0d2a658e-458d-41a0-abd1-addf57caa711'::uuid,'202aaf29-85c2-4f50-af84-87039927b422'::uuid,'a'),
('4212f143-d5ba-4cb6-a9c9-d928f8886d5b'::uuid,'202aaf29-85c2-4f50-af84-87039927b422'::uuid,'b'),
('db88f6eb-09dd-44d7-a7de-e94c66ef33df'::uuid,'6326d4cf-dc62-4bf8-a538-2e26e2e303c5'::uuid,'a'),
('ad8f4097-7a58-4cbc-ae7a-f92d999c3b83'::uuid,'6326d4cf-dc62-4bf8-a538-2e26e2e303c5'::uuid,'b'),
('1c4db4a9-bcd5-44b7-ab5d-e417f8b4532d'::uuid,'6b3bb51a-d58c-4d7e-a3df-447ab412ee78'::uuid,'a'),
('d07f4fe1-182b-4605-af07-520eb3029828'::uuid,'6b3bb51a-d58c-4d7e-a3df-447ab412ee78'::uuid,'b'),
('121f6752-9917-4fa9-aaeb-531ed81749fe'::uuid,'1c4db4a9-bcd5-44b7-ab5d-e417f8b4532d'::uuid,'a'),
('e981f10a-d8c0-4e55-a8d1-793586ed64b3'::uuid,'1c4db4a9-bcd5-44b7-ab5d-e417f8b4532d'::uuid,'b'),
('0cffda53-6ad0-410c-a9e9-c114799821cd'::uuid,'d07f4fe1-182b-4605-af07-520eb3029828'::uuid,'a'),
('c4704fc5-d3ac-42b4-a543-16cb1bcd67d7'::uuid,'d07f4fe1-182b-4605-af07-520eb3029828'::uuid,'b'),
('a457a92d-2f68-447d-a0b2-fa8793ee57c1'::uuid,'8e3b58c3-e56e-4bfc-a141-22e7654297ba'::uuid,'a'),
('af602539-2611-4075-af87-c4b49875a69b'::uuid,'8e3b58c3-e56e-4bfc-a141-22e7654297ba'::uuid,'b'),
('12557726-ef42-47c4-a1ee-f62d5f825335'::uuid,'a457a92d-2f68-447d-a0b2-fa8793ee57c1'::uuid,'a'),
('ea74ffd8-ce29-4d8e-a191-4fda15a47f41'::uuid,'a457a92d-2f68-447d-a0b2-fa8793ee57c1'::uuid,'b'),
('cd90fe8d-7ded-445f-a204-c5a34da3e932'::uuid,'af602539-2611-4075-af87-c4b49875a69b'::uuid,'a'),
('796dfc49-6b9a-43f4-afe8-b7d97a2d8987'::uuid,'af602539-2611-4075-af87-c4b49875a69b'::uuid,'b'),
('b24dcc5d-17f1-4be3-a639-80b2ce9d1463'::uuid,'c8fb753c-41a3-4127-a952-6ffcdcaaf408'::uuid,'a'),
('dfe66509-76e0-482a-aa07-96254f7165dc'::uuid,'c8fb753c-41a3-4127-a952-6ffcdcaaf408'::uuid,'b'),
('1ee4888a-1ff4-428b-a89c-9b3ff770f75e'::uuid,'b24dcc5d-17f1-4be3-a639-80b2ce9d1463'::uuid,'a'),
('3e892b14-9d86-4522-a631-cad5cafeba89'::uuid,'b24dcc5d-17f1-4be3-a639-80b2ce9d1463'::uuid,'b'),
('d28765f1-8953-430b-a85f-50dbaa695240'::uuid,'dfe66509-76e0-482a-aa07-96254f7165dc'::uuid,'a'),
('fa7f4d47-3dd5-4eb6-aff8-5f9d5fb7f35f'::uuid,'dfe66509-76e0-482a-aa07-96254f7165dc'::uuid,'b'),
('c0dc739a-4efe-4914-a079-6b168e116fba'::uuid,'7d924496-d043-43d1-a38b-80bba2142478'::uuid,'a'),
('a211abb3-e8e1-4575-ae31-f82a9bf4084b'::uuid,'7d924496-d043-43d1-a38b-80bba2142478'::uuid,'b'),
('f2140c63-c773-49d4-abad-5534825e42bb'::uuid,'c0dc739a-4efe-4914-a079-6b168e116fba'::uuid,'a'),
('27376b00-da10-4ce8-ad35-919df401c3f6'::uuid,'c0dc739a-4efe-4914-a079-6b168e116fba'::uuid,'b'),
('8f5b118c-53fa-4893-a76b-bfbd9258dd7a'::uuid,'a211abb3-e8e1-4575-ae31-f82a9bf4084b'::uuid,'a'),
('44be8d76-2f67-49cd-aff9-ac86e29d9e22'::uuid,'a211abb3-e8e1-4575-ae31-f82a9bf4084b'::uuid,'b'),
('0cfcedb6-392c-482f-af29-febc0743c6e3'::uuid,'3d1408b1-c088-4e4b-ac13-052c680c395c'::uuid,'a'),
('1888cf57-52b3-4e1d-a2fd-fae87cb94306'::uuid,'3d1408b1-c088-4e4b-ac13-052c680c395c'::uuid,'b'),
('881a576b-832f-4ea3-ad0b-dcbe68b540c3'::uuid,'0cfcedb6-392c-482f-af29-febc0743c6e3'::uuid,'a'),
('015dd204-9632-45fb-ac1a-38cd84d43867'::uuid,'0cfcedb6-392c-482f-af29-febc0743c6e3'::uuid,'b'),
('8e87798c-30c2-4a3b-a40a-033c342d919e'::uuid,'1888cf57-52b3-4e1d-a2fd-fae87cb94306'::uuid,'a'),
('79c70f87-5adf-4bef-aae2-bbd36181f7a7'::uuid,'1888cf57-52b3-4e1d-a2fd-fae87cb94306'::uuid,'b');


$migration_4$;
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='ai_enabled') then
    execute $migration_5$
-- Public launch controls. Apply after 00004; existing journal data is retained.

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

$migration_5$;
  end if;
  if to_regprocedure('nudge_private.privacy_boundaries_version()') is null then
    execute $migration_6$
-- Privacy repairs for existing and fresh installations. Apply after 00005.

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

$migration_6$;
  end if;
  if to_regprocedure('nudge_private.push_delivery_version()') is null then
    execute $migration_7$
-- Durable per-device delivery. Provider success followed by a crash before ACK
-- can still duplicate a send: Web Push has no transactional exactly-once API.

create table nudge_private.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed','expired')),
  attempts integer not null default 0 check (attempts between 0 and 6),
  next_attempt_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  lease_until timestamptz,
  claim_token uuid,
  delivered_at timestamptz,
  last_status integer,
  constraint push_delivery_identity unique(notification_id,subscription_id)
);
create index push_deliveries_ready on nudge_private.push_deliveries(next_attempt_at,id) where status in ('pending','processing');
create index push_deliveries_notification on nudge_private.push_deliveries(notification_id);
create index push_deliveries_subscription on nudge_private.push_deliveries(subscription_id);
alter table nudge_private.push_deliveries enable row level security;
revoke all on nudge_private.push_deliveries from public,anon,authenticated,service_role;

create function public.claim_push_deliveries(p_limit integer default 25)
returns table(delivery_id uuid,claim_token uuid,notification_id uuid,subscription_id uuid,endpoint text,p256dh text,auth text,title text,body text)
language plpgsql security definer set search_path='' as $$
begin
  -- Mark read/snoozed/expired prompts terminal, including crashed last attempts.
  update nudge_private.push_deliveries d set status='expired',lease_until=null,claim_token=null
    where d.status in ('pending','processing') and
      (d.deadline_at<=now() or (d.attempts>=6 and coalesce(d.lease_until,'-infinity'::timestamptz)<=now())
       or exists(select 1 from public.notifications n where n.id=d.notification_id and n.read_at is not null));

  -- No one-hour cutoff. Seed a bounded oldest-first backlog and skip identities
  -- already present so completed devices cannot starve later notifications.
  insert into nudge_private.push_deliveries(notification_id,subscription_id,next_attempt_at,deadline_at)
    select n.id,s.id,n.created_at,n.created_at+interval '7 days'
    from public.notifications n join public.push_subscriptions s on s.user_id=n.user_id
    where n.kind='reflection_prompt' and n.read_at is null and n.created_at>now()-interval '7 days'
      and not exists(select 1 from nudge_private.push_deliveries d where d.notification_id=n.id and d.subscription_id=s.id)
    order by n.created_at,n.id,s.id limit 250
    on conflict on constraint push_delivery_identity do nothing;

  return query
    with ready as (
      select d.id from nudge_private.push_deliveries d
      where d.status in ('pending','processing') and d.next_attempt_at<=now()
        and (d.lease_until is null or d.lease_until<=now()) and d.deadline_at>now() and d.attempts<6
      order by d.next_attempt_at,d.id
      for update skip locked limit greatest(1,least(coalesce(p_limit,25),50))
    ), claimed as (
      update nudge_private.push_deliveries d set status='processing',attempts=d.attempts+1,
        lease_until=now()+interval '5 minutes',claim_token=gen_random_uuid()
      from ready where d.id=ready.id returning d.*
    )
    select d.id,d.claim_token,n.id,s.id,s.endpoint,s.p256dh,s.auth,n.title,n.body
    from claimed d join public.notifications n on n.id=d.notification_id
      join public.push_subscriptions s on s.id=d.subscription_id;
end $$;

create function public.finish_push_delivery(p_delivery_id uuid,p_claim_token uuid,p_outcome text,p_status integer default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare delivery nudge_private.push_deliveries%rowtype;
begin
  if p_outcome not in ('delivered','retry','failed','gone') or p_outcome is null then raise exception 'Invalid delivery outcome'; end if;
  select * into delivery from nudge_private.push_deliveries d where d.id=p_delivery_id and d.status='processing'
    and d.claim_token=p_claim_token and d.lease_until>now() for update;
  if not found then return false; end if;
  if p_outcome='gone' then
    if p_status not in (404,410) or p_status is null then raise exception 'Invalid subscription expiry status'; end if;
    delete from public.push_subscriptions where id=delivery.subscription_id;
    return true;
  end if;
  update nudge_private.push_deliveries d set
    status=case when p_outcome='delivered' then 'delivered'
      when p_outcome='failed' then 'failed'
      when d.attempts>=6 or d.deadline_at<=now() then 'expired' else 'pending' end,
    next_attempt_at=case when p_outcome='retry' then now()+least(3600,60*power(2,d.attempts-1))::integer*interval '1 second' else d.next_attempt_at end,
    delivered_at=case when p_outcome='delivered' then now() else null end,
    last_status=case when p_status between 100 and 599 then p_status else null end,
    lease_until=null,claim_token=null
    where d.id=delivery.id;
  return true;
end $$;

revoke all on function public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,uuid,text,integer) to service_role;
create function nudge_private.push_delivery_version() returns integer language sql immutable set search_path='' as $$ select 7; $$;
revoke all on function nudge_private.push_delivery_version() from public,anon,authenticated;
notify pgrst,'reload schema';

$migration_7$;
  end if;
  if to_regprocedure('nudge_private.signal_contract_version()') is null then
    execute $migration_8$
-- Some hosted installations retained the pre-generation 11-argument public
-- function alongside the guarded 12-argument function with defaults. PostgreSQL
-- cannot choose between them for Discover's 11-argument call (42725).

-- No CASCADE: an unexpected dependency must stop this upgrade for review.
-- Existing callers still resolve to the guarded function's default generation.
drop function if exists public.record_knowledge_signal(
  text,text,text,public.preference_polarity,text,real,text,uuid,uuid,boolean,jsonb
);
create function nudge_private.signal_contract_version() returns integer
language sql immutable set search_path='' as $$ select 8; $$;
revoke all on function nudge_private.signal_contract_version() from public,anon,authenticated;
notify pgrst,'reload schema';

$migration_8$;
  end if;
  if to_regprocedure('nudge_private.decision_meaning_topics_version()') is null then
    execute $migration_9$
-- Additive upgrade after 00008. No existing questions, answers or decisions are removed.

create or replace function nudge_private.category_for_key(k text) returns text
language sql immutable set search_path='' as $$
  select case
    when split_part(k,'.',1) in ('food','cuisine','drink','taste','diet','nutrition','condiment') then 'food'
    when split_part(k,'.',1) in ('watch','genre','music','media','culture','entertainment','reading') then 'movies'
    when split_part(k,'.',1) in ('travel','destination','transport','accommodation') then 'travel'
    when split_part(k,'.',1) in ('shopping','product','brand','gift','tech','property') then 'shopping'
    when split_part(k,'.',1) in ('health','fitness','wellness','sleep','body','sport') then 'health'
    when split_part(k,'.',1) in ('career','work','learning','skill','focus') then 'career'
    when split_part(k,'.',1) in ('money','spend','finance','invest','save','budget') then 'finance'
    when split_part(k,'.',1) in ('social','family','relationship','people','pet','community') then 'relationships'
    when split_part(k,'.',1) in ('hobby','craft','play','creative','game','outdoor') then 'hobbies'
    else 'lifestyle' end;
$$;

-- A read-only queue operation: no fake answers, preferences or daily progress.
create function public.discover_other_topic(p_current_topic text default null)
returns setof public.questions language sql stable security definer set search_path='' as $$
  select q.*
  from (select distinct context->>'topic' topic from public.questions where is_active and not is_onboarding) t
  cross join lateral public.discover_next_question(t.topic) q
  where auth.uid() is not null and t.topic is not null and t.topic is distinct from p_current_topic
  order by (select count(*) from public.question_answers a join public.questions answered on answered.id=a.question_id
    where a.user_id=auth.uid() and answered.context->>'topic'=t.topic), q.sort_order,q.id
  limit 1;
$$;
revoke all on function public.discover_other_topic(text) from public,anon;
grant execute on function public.discover_other_topic(text) to authenticated;

-- Keep old RPC signatures. Both learning paths derive their scope from the
-- owned decision, so a caller cannot accidentally flatten game/project memory.
alter function public.commit_choice_and_learn(uuid,uuid,text) set schema nudge_private;
alter function nudge_private.commit_choice_and_learn(uuid,uuid,text) rename to commit_choice_unscoped;
alter function public.submit_decision_reflection(uuid,integer,boolean,boolean,boolean,boolean,text,text) set schema nudge_private;
alter function nudge_private.submit_decision_reflection(uuid,integer,boolean,boolean,boolean,boolean,text,text) rename to submit_reflection_unscoped;
revoke all on function nudge_private.commit_choice_unscoped(uuid,uuid,text),
  nudge_private.submit_reflection_unscoped(uuid,integer,boolean,boolean,boolean,boolean,text,text) from public,anon,authenticated;

-- Alias handling must respect the setting too: a correction/erasure for an
-- activity in one world must not change an unrelated same-named activity.
create function nudge_private.knowledge_scope(p_key text) returns text
language sql immutable set search_path='' as $$
  select coalesce(substring(lower(p_key) from '^learned[.][a-z]+[.]scope[.]([a-f0-9]{32})[.]'),'everyday');
$$;
create or replace function nudge_private.forget_knowledge_key(p_key text) returns void
language plpgsql security definer set search_path='' as $$
declare target public.knowledge_nodes%rowtype; label text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into target from public.knowledge_nodes where user_id=auth.uid() and key=lower(p_key);
  label:=lower(trim(coalesce(target.value,replace(regexp_replace(target.key,'^.*[.]',''),'-',' '))));
  insert into public.forgotten_knowledge_keys(user_id,key) values(auth.uid(),lower(p_key)) on conflict do nothing;
  update public.knowledge_nodes set status='forgotten' where user_id=auth.uid() and
    (key=lower(p_key) or (category_slug=target.category_slug
      and nudge_private.knowledge_scope(key)=nudge_private.knowledge_scope(p_key)
      and lower(trim(coalesce(value,replace(regexp_replace(key,'^.*[.]',''),'-',' '))))=label));
  insert into public.forgotten_knowledge_keys(user_id,key)
    select user_id,key from public.knowledge_nodes where user_id=auth.uid() and status='forgotten' on conflict do nothing;
  delete from public.preferences p using public.forgotten_knowledge_keys f where p.user_id=auth.uid() and f.user_id=p.user_id and f.key=p.key;
  update public.knowledge_verification_queue q set status='dismissed',answered_at=clock_timestamp() from public.knowledge_nodes n
    where q.user_id=auth.uid() and n.user_id=q.user_id and q.node_id=n.id and n.status='forgotten' and q.status='pending';
end $$;
create or replace function nudge_private.record_knowledge_signal_guarded(
  p_key text,p_value text,p_category_slug text,p_polarity public.preference_polarity,p_source text,p_weight real,p_kind text,
  p_source_decision_id uuid default null,p_source_question_id uuid default null,p_verified boolean default false,
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
    or (p_value is not null and exists(select 1 from public.knowledge_nodes n where n.user_id=auth.uid() and n.status='forgotten'
      and n.category_slug=category and nudge_private.knowledge_scope(n.key)=nudge_private.knowledge_scope(p_key)
      and lower(trim(coalesce(n.value,replace(regexp_replace(n.key,'^.*[.]',''),'-',' '))))=lower(trim(p_value)))) then return null; end if;
  if p_source_decision_id is not null and not exists(select 1 from public.decisions where id=p_source_decision_id and user_id=auth.uid()) then raise exception 'Invalid source decision'; end if;
  return nudge_private.record_knowledge_signal(p_key,p_value,category,p_polarity,p_source,p_weight,p_kind,
    p_source_decision_id,p_source_question_id,p_verified,p_detail);
end $$;
create or replace function public.record_knowledge_signal(
  p_key text,p_value text,p_category_slug text,p_polarity public.preference_polarity,p_source text,p_weight real,p_kind text,
  p_source_decision_id uuid default null,p_source_question_id uuid default null,p_verified boolean default false,
  p_detail jsonb default '{}'::jsonb,p_expected_generation integer default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare node uuid; corrected public.knowledge_nodes%rowtype; final_key text:=p_key;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into corrected from public.knowledge_nodes n where n.user_id=auth.uid() and n.status='active'
    and n.metadata->>'manual_polarity' in ('like','dislike','neutral')
    and (n.key=p_key or (p_value is not null and n.category_slug=p_category_slug
      and nudge_private.knowledge_scope(n.key)=nudge_private.knowledge_scope(p_key)
      and lower(coalesce(n.value,replace(regexp_replace(n.key,'^.*[.]',''),'-',' ')))=lower(trim(p_value))))
    order by n.updated_at desc limit 1;
  if found then final_key:=corrected.key; end if;
  node:=nudge_private.record_knowledge_signal_guarded(final_key,p_value,p_category_slug,p_polarity,p_source,p_weight,p_kind,
    p_source_decision_id,p_source_question_id,p_verified,p_detail,p_expected_generation);
  if node is not null and corrected.id is not null then
    update public.knowledge_nodes set polarity=(corrected.metadata->>'manual_polarity')::public.preference_polarity,
      belief_score=case corrected.metadata->>'manual_polarity' when 'like' then 1 when 'dislike' then -1 else 0 end,
      confidence=1,source='explicit' where id=node;
  end if;
  return node;
end $$;
create or replace function public.correct_knowledge_node(p_node_id uuid,p_polarity public.preference_polarity,p_note text default '') returns void
language plpgsql security definer set search_path='' as $$
declare n public.knowledge_nodes%rowtype; label text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_polarity is null or length(coalesce(p_note,''))>300 then raise exception 'Invalid correction'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into n from public.knowledge_nodes where id=p_node_id and user_id=auth.uid() and status='active' for update;
  if not found then raise exception 'Belief not found'; end if;
  label:=lower(coalesce(n.value,replace(regexp_replace(n.key,'^.*[.]',''),'-',' ')));
  insert into public.knowledge_evidence(user_id,node_id,kind,direction,weight,detail)
    values(auth.uid(),n.id,'manual',case when p_polarity='dislike' then -1 else 1 end,1,
      jsonb_build_object('event','user_correction','polarity',p_polarity,'note',coalesce(p_note,'')));
  update public.knowledge_nodes set polarity=p_polarity,
    belief_score=case p_polarity when 'like' then 1 when 'dislike' then -1 else 0 end,
    confidence=1,source='explicit',last_verified_at=clock_timestamp(),last_reinforced_at=clock_timestamp(),
    verification_due_at=clock_timestamp()+interval '60 days',
    metadata=metadata||jsonb_build_object('manual_polarity',p_polarity,'correction_note',coalesce(p_note,'')),
    evidence_count=evidence_count+case when id=n.id then 1 else 0 end
    where user_id=auth.uid() and status='active' and (id=n.id or
      (category_slug=n.category_slug and nudge_private.knowledge_scope(key)=nudge_private.knowledge_scope(n.key)
       and lower(coalesce(value,replace(regexp_replace(key,'^.*[.]',''),'-',' ')))=label));
  update public.knowledge_verification_queue set status='answered',answered_at=now() where user_id=auth.uid() and node_id=n.id and status='pending';
  update public.profiles set memory_generation=memory_generation+1 where id=auth.uid();
end $$;
create or replace function public.search_beliefs(p_search text default '',p_offset integer default 0)
returns setof public.knowledge_nodes language sql stable security invoker set search_path='' as $$
  select n.* from public.knowledge_nodes n where n.user_id=auth.uid() and n.status='active'
    and position(lower(left(coalesce(p_search,''),80)) in lower(coalesce(n.value,n.key)||' '||n.category_slug||' '||coalesce(n.metadata->>'decision_domain','')))>0
  order by n.updated_at desc,n.id limit 20 offset greatest(0,least(coalesce(p_offset,0),100000));
$$;

create function nudge_private.domain_learning_key(p_domain text,p_category public.decision_category,p_key text)
returns text language plpgsql immutable set search_path='' as $$
declare prefix text:='learned.'||p_category::text||'.';
begin
  if p_key is null or p_key not like prefix||'%' then raise exception 'Invalid learned key'; end if;
  if coalesce(p_domain,'') in ('','everyday life') then return p_key; end if;
  return prefix||'scope.'||pg_catalog.md5(p_domain)||'.'||substr(p_key,length(prefix)+1);
end $$;

create function public.commit_choice_and_learn(p_decision_id uuid,p_option_id uuid,p_key text) returns void
language plpgsql security definer set search_path='' as $$
declare d public.decisions%rowtype; scoped_key text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into d from public.decisions where id=p_decision_id and user_id=auth.uid() for update;
  if not found then raise exception 'Decision not found'; end if;
  scoped_key:=nudge_private.domain_learning_key(d.context->>'domain',d.category,p_key);
  perform nudge_private.commit_choice_unscoped(p_decision_id,p_option_id,scoped_key);
  if coalesce(d.context->>'domain','') not in ('','everyday life') then
    update public.knowledge_nodes set metadata=metadata||jsonb_build_object('decision_domain',d.context->>'domain')
      where user_id=auth.uid() and key=scoped_key;
  end if;
end $$;
create function public.submit_decision_reflection(p_decision_id uuid,p_rating integer,p_would_repeat boolean,p_has_regrets boolean,
  p_would_recommend boolean,p_would_choose_again boolean,p_notes text,p_key text)
returns table(saved boolean,memory_generation integer)
language plpgsql security definer set search_path='' as $$
declare d public.decisions%rowtype;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into d from public.decisions where id=p_decision_id and user_id=auth.uid() for update;
  if not found then raise exception 'Decision not found'; end if;
  return query select * from nudge_private.submit_reflection_unscoped(p_decision_id,p_rating,p_would_repeat,p_has_regrets,
    p_would_recommend,p_would_choose_again,p_notes,nudge_private.domain_learning_key(d.context->>'domain',d.category,p_key));
end $$;
revoke all on function public.commit_choice_and_learn(uuid,uuid,text),
  public.submit_decision_reflection(uuid,integer,boolean,boolean,boolean,boolean,text,text) from public,anon;
grant execute on function public.commit_choice_and_learn(uuid,uuid,text),
  public.submit_decision_reflection(uuid,integer,boolean,boolean,boolean,boolean,text,text) to authenticated;

-- Bound optional meaning metadata even for direct RPC callers. Historical
-- records remain valid; the trigger does not rewrite their original context.
create function nudge_private.validate_decision_meaning() returns trigger
language plpgsql set search_path='' as $$
declare detail record;
begin
  if new.context ? 'domain' then
    if jsonb_typeof(new.context->'domain') is distinct from 'string' or length(trim(new.context->>'domain')) not between 1 and 100
      or new.context->'meaningConfirmed' is distinct from 'true'::jsonb
      or (new.context ? 'goal' and (jsonb_typeof(new.context->'goal') is distinct from 'string' or length(new.context->>'goal')>300)) then
      raise exception 'Confirm a valid decision setting'; end if;
    new.context:=jsonb_set(new.context,'{domain}',to_jsonb(lower(regexp_replace(trim(new.context->>'domain'),'\s+',' ','g'))));
    if new.context ? 'optionDetails' then
      if jsonb_typeof(new.context->'optionDetails') is distinct from 'object' then raise exception 'Invalid option details'; end if;
      if (select count(*) from jsonb_object_keys(new.context->'optionDetails'))>8 then raise exception 'Too many option details'; end if;
      for detail in select key,value from jsonb_each(new.context->'optionDetails') loop
        if length(detail.key) not between 1 and 80 or jsonb_typeof(detail.value) is distinct from 'string' or length(detail.value#>>'{}')>500 then
          raise exception 'Invalid option details'; end if;
      end loop;
    end if;
  end if;
  return new;
end $$;
create trigger decisions_meaning_bounds before insert or update of context on public.decisions
for each row execute function nudge_private.validate_decision_meaning();

-- Same durable global cap and consent/terms checks; interpretation has its own
-- ten-per-hour budget and never bypasses the existing provider deadline.
create or replace function public.reserve_ai_request(p_action text) returns boolean
language plpgsql security definer set search_path='' as $$
declare window_start timestamptz; per_user_limit integer; used integer;
begin
  if auth.uid() is null or p_action is null or p_action not in ('extract','explain','recap','interpret') then return false; end if;
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

create function nudge_private.decision_meaning_topics_version() returns integer language sql immutable set search_path='' as $$select 9$$;
revoke all on function nudge_private.domain_learning_key(text,public.decision_category,text),
  nudge_private.knowledge_scope(text),nudge_private.validate_decision_meaning(),nudge_private.decision_meaning_topics_version() from public,anon,authenticated;
notify pgrst,'reload schema';

-- Context-aware Discover expansion; generated from data/discover-expansion.txt.
insert into public.questions(id,category_id,kind,prompt,option_a,option_b,maps_to_key_a,maps_to_key_b,context,sort_order) values
('312e44b7-fa35-40dd-aaa4-c5f597cf7be7'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','What makes a game session satisfying for you?','Work toward a clear objective','Explore without a fixed plan','game.work-toward-a-clear-objective','game.explore-without-a-fixed-plan','{"topic":"gaming","tree":"gaming","depth":0,"edition":2}'::jsonb,-800),
('9e5b1d47-dda5-4a50-a199-422c0ef71af4'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','When pursuing a game objective, what do you enjoy most?','Improve a strategy','Build something over time','game.improve-a-strategy','game.build-something-over-time','{"topic":"gaming","tree":"gaming","depth":1,"edition":2,"connection":"A follow-up on gaming."}'::jsonb,-799),
('8c1fb538-bfb1-401b-a0c0-9c38464fc194'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','When exploring a game, what draws you onward?','Discover unfamiliar places','Try unexpected interactions','game.discover-unfamiliar-places','game.try-unexpected-interactions','{"topic":"gaming","tree":"gaming","depth":1,"edition":2,"connection":"A follow-up on gaming."}'::jsonb,-798),
('2e87a637-f514-44ef-a5a8-d9f64a57cf1d'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For improving a strategy, what feels rewarding?','Experiment and learn from attempts','Study the rules before trying','game.experiment-and-learn-from-attempts','game.study-the-rules-before-trying','{"topic":"gaming","tree":"gaming","depth":2,"edition":2,"connection":"A follow-up on gaming."}'::jsonb,-797),
('c5e25cce-04c0-4d57-a43c-9bc46e60ed0d'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For a long game project, what keeps you interested?','Visible progress each session','Freedom to change the design','game.visible-progress-each-session','game.freedom-to-change-the-design','{"topic":"gaming","tree":"gaming","depth":2,"edition":2,"connection":"A follow-up on gaming."}'::jsonb,-796),
('a11d504e-26fb-4d06-aebe-90b99bbc8237'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','While discovering a game world, what would you prefer?','Explore at my own pace','Share discoveries with friends','game.explore-at-my-own-pace','game.share-discoveries-with-friends','{"topic":"gaming","tree":"gaming","depth":2,"edition":2,"connection":"A follow-up on gaming."}'::jsonb,-795),
('c987420a-a9b5-4aaa-aef3-15b66dae66cf'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','When testing game interactions, what sounds fun?','Solve a puzzle within the rules','Make up a personal challenge','game.solve-a-puzzle-within-the-rules','game.make-up-a-personal-challenge','{"topic":"gaming","tree":"gaming","depth":2,"edition":2,"connection":"A follow-up on gaming."}'::jsonb,-794),
('4514ef6a-7793-4b3d-a399-a1f1feef229e'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For time outdoors, what would you enjoy more?','Follow a familiar route','Explore a new place','outdoor.follow-a-familiar-route','outdoor.explore-a-new-place','{"topic":"outdoors","tree":"outdoors","depth":0,"edition":2}'::jsonb,-792),
('a3f1a63f-4408-4879-ace7-eef5ad009b74'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','On a familiar outdoor route, what makes it enjoyable?','Notice small seasonal changes','Keep a comfortable steady rhythm','outdoor.notice-small-seasonal-changes','outdoor.keep-a-comfortable-steady-rhythm','{"topic":"outdoors","tree":"outdoors","depth":1,"edition":2,"connection":"A follow-up on outdoors."}'::jsonb,-791),
('c8abd586-bdbc-4174-a82f-a7640e2d79f2'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','When exploring somewhere new outdoors, what helps you enjoy it?','A clear route planned in advance','A short flexible outing','outdoor.a-clear-route-planned-in-advance','outdoor.a-short-flexible-outing','{"topic":"outdoors","tree":"outdoors","depth":1,"edition":2,"connection":"A follow-up on outdoors."}'::jsonb,-790),
('53616163-f293-41ee-a361-ce24bf98acff'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For noticing seasonal changes, what would you bring?','A camera or sketchbook','Only time to look around','outdoor.a-camera-or-sketchbook','outdoor.only-time-to-look-around','{"topic":"outdoors","tree":"outdoors","depth":2,"edition":2,"connection":"A follow-up on outdoors."}'::jsonb,-789),
('5073047a-e4c0-4376-a054-6957aac18d8a'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For a comfortable outdoor rhythm, what would you choose?','A quiet solo outing','Someone who enjoys the same pace','outdoor.a-quiet-solo-outing','outdoor.someone-who-enjoys-the-same-pace','{"topic":"outdoors","tree":"outdoors","depth":2,"edition":2,"connection":"A follow-up on outdoors."}'::jsonb,-788),
('3fb7f1d0-f00c-4c3c-a3bc-28f463f96a41'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For planning a new route, what would you prefer?','Check the terrain and conditions','Start with a well-described short route','outdoor.check-the-terrain-and-conditions','outdoor.start-with-a-well-described-short-route','{"topic":"outdoors","tree":"outdoors","depth":2,"edition":2,"connection":"A follow-up on outdoors."}'::jsonb,-787),
('f0eab96c-4359-470f-a243-46ed795eb9ed'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For a flexible outdoor outing, what would you prioritise?','Time to stop and observe','A few places close together','outdoor.time-to-stop-and-observe','outdoor.a-few-places-close-together','{"topic":"outdoors","tree":"outdoors","depth":2,"edition":2,"connection":"A follow-up on outdoors."}'::jsonb,-786),
('27579385-03e1-4688-a784-bea42ded0921'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','What draws you to your next book?','A world to become immersed in','An idea I want to understand','reading.a-world-to-become-immersed-in','reading.an-idea-i-want-to-understand','{"topic":"reading","tree":"reading","depth":0,"edition":2}'::jsonb,-784),
('e720ccfa-a359-43a8-abdb-e4d8fac102f3'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','For an immersive book, what holds your attention?','Characters with inner depth','A setting full of discoveries','reading.characters-with-inner-depth','reading.a-setting-full-of-discoveries','{"topic":"reading","tree":"reading","depth":1,"edition":2,"connection":"A follow-up on reading."}'::jsonb,-783),
('522584f7-6f7d-4472-a20c-e5c2d859e8d7'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','When reading about an idea, what helps you engage?','Concrete examples and stories','A clear structured argument','reading.concrete-examples-and-stories','reading.a-clear-structured-argument','{"topic":"reading","tree":"reading","depth":1,"edition":2,"connection":"A follow-up on reading."}'::jsonb,-782),
('5eb48343-4cf3-43f2-a7b9-f4bcbf486624'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','With complex characters, what do you enjoy?','Gradual changes in relationships','A surprising personal perspective','reading.gradual-changes-in-relationships','reading.a-surprising-personal-perspective','{"topic":"reading","tree":"reading","depth":2,"edition":2,"connection":"A follow-up on reading."}'::jsonb,-781),
('96e266c1-7a6a-42e7-a458-3ce5f815fa48'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','For a richly imagined setting, what appeals most?','Everyday details of its world','A large unfolding mystery','reading.everyday-details-of-its-world','reading.a-large-unfolding-mystery','{"topic":"reading","tree":"reading","depth":2,"edition":2,"connection":"A follow-up on reading."}'::jsonb,-780),
('5bcd0543-6aeb-42b1-aa9f-634e00153fbd'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','When examples explain an idea, what do you prefer?','Follow one case in depth','Compare several different cases','reading.follow-one-case-in-depth','reading.compare-several-different-cases','{"topic":"reading","tree":"reading","depth":2,"edition":2,"connection":"A follow-up on reading."}'::jsonb,-779),
('4298a783-d654-4636-a8dc-0b02e13c7057'::uuid,(select id from public.preference_categories where slug='movies'),'this_or_that','For a structured argument, what would you do?','Take notes as I read','Discuss it after finishing','reading.take-notes-as-i-read','reading.discuss-it-after-finishing','{"topic":"reading","tree":"reading","depth":2,"edition":2,"connection":"A follow-up on reading."}'::jsonb,-778),
('3e7a1481-893f-4ff9-a9f5-213ea17f5942'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For a hands-on project, what sounds rewarding?','Repair something I already own','Make something new','craft.repair-something-i-already-own','craft.make-something-new','{"topic":"making","tree":"making","depth":0,"edition":2}'::jsonb,-776),
('cf2dffec-1c0b-4bc9-a39e-393924cf2a16'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','When repairing something, how would you begin?','Understand why it stopped working','Follow a trusted repair guide','craft.understand-why-it-stopped-working','craft.follow-a-trusted-repair-guide','{"topic":"making","tree":"making","depth":1,"edition":2,"connection":"A follow-up on making."}'::jsonb,-775),
('b139aa2e-fd46-4100-ab65-868718261ee3'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For making something new, what inspires you?','A practical need','An interesting material','craft.a-practical-need','craft.an-interesting-material','{"topic":"making","tree":"making","depth":1,"edition":2,"connection":"A follow-up on making."}'::jsonb,-774),
('76beda41-c1e9-47b6-ac55-1bbc4dd4eea0'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','When understanding a fault, what helps you?','A diagram of the parts','A careful step-by-step inspection','craft.a-diagram-of-the-parts','craft.a-careful-step-by-step-inspection','{"topic":"making","tree":"making","depth":2,"edition":2,"connection":"A follow-up on making."}'::jsonb,-773),
('cbcc3154-976b-44b6-a982-f7baff64df32'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','With a repair guide, what would you prefer?','Clear written instructions','A close-up demonstration','craft.clear-written-instructions','craft.a-close-up-demonstration','{"topic":"making","tree":"making","depth":2,"edition":2,"connection":"A follow-up on making."}'::jsonb,-772),
('9331426a-c3c4-4828-a587-21e6b9f80a9d'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','For a practical project, what matters most?','A reliable simple result','A design tailored to my routine','craft.a-reliable-simple-result','craft.a-design-tailored-to-my-routine','{"topic":"making","tree":"making","depth":2,"edition":2,"connection":"A follow-up on making."}'::jsonb,-771),
('16ddf4f9-ce6e-4d7f-a69c-a8939d13b36b'::uuid,(select id from public.preference_categories where slug='hobbies'),'this_or_that','When exploring a material, how would you start?','Make a small sample','Adapt a familiar technique','craft.make-a-small-sample','craft.adapt-a-familiar-technique','{"topic":"making","tree":"making","depth":2,"edition":2,"connection":"A follow-up on making."}'::jsonb,-770),
('acca8259-5cfe-4573-aa1d-5a34e5608a2c'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','How would you like to contribute to a community?','Help with a practical task','Share a skill I know','community.help-with-a-practical-task','community.share-a-skill-i-know','{"topic":"community","tree":"community","depth":0,"edition":2}'::jsonb,-768),
('82c6e72d-4777-49f9-aa23-6ab60bc0570d'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','For a practical community task, what suits you?','A regular small commitment','An occasional focused event','community.a-regular-small-commitment','community.an-occasional-focused-event','{"topic":"community","tree":"community","depth":1,"edition":2,"connection":"A follow-up on community."}'::jsonb,-767),
('4971eb2a-b42f-4f0c-ab62-214ea376d46b'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','When sharing a skill, what feels comfortable?','Help one person at a time','Join a small learning group','community.help-one-person-at-a-time','community.join-a-small-learning-group','{"topic":"community","tree":"community","depth":1,"edition":2,"connection":"A follow-up on community."}'::jsonb,-766),
('042ce582-c831-443a-a5b4-a83d25b75449'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','For a regular commitment, what would help?','A predictable role','A team I get to know','community.a-predictable-role','community.a-team-i-get-to-know','{"topic":"community","tree":"community","depth":2,"edition":2,"connection":"A follow-up on community."}'::jsonb,-765),
('9bee74fa-0ba9-4798-ad75-0232f1edb64b'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','For an occasional event, what draws you in?','A clear useful outcome','The chance to meet local people','community.a-clear-useful-outcome','community.the-chance-to-meet-local-people','{"topic":"community","tree":"community","depth":2,"edition":2,"connection":"A follow-up on community."}'::jsonb,-764),
('3a9025a5-55a6-441d-ac06-9d7fcdc02bcf'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','For helping someone learn, what do you enjoy?','Show a worked example','Help them work through a question','community.show-a-worked-example','community.help-them-work-through-a-question','{"topic":"community","tree":"community","depth":2,"edition":2,"connection":"A follow-up on community."}'::jsonb,-763),
('01a740c4-cba5-4fc2-a983-e6bc32ba4806'::uuid,(select id from public.preference_categories where slug='relationships'),'this_or_that','In a community learning group, what appeals most?','Exchange different experiences','Make something useful together','community.exchange-different-experiences','community.make-something-useful-together','{"topic":"community","tree":"community","depth":2,"edition":2,"connection":"A follow-up on community."}'::jsonb,-762),
('294fba20-4545-49b6-afa0-995473567851'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','For a recreational sport, what would you enjoy most?','Practise a skill on my own','Play with other people','sport.practise-a-skill-on-my-own','sport.play-with-other-people','{"topic":"sports","tree":"sports","depth":0,"edition":2}'::jsonb,-760),
('c4a608df-d3bd-4205-a3da-be763dea5d07'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','When practising a sport skill, what keeps it enjoyable?','Track small improvements','Vary the challenges I try','sport.track-small-improvements','sport.vary-the-challenges-i-try','{"topic":"sports","tree":"sports","depth":1,"edition":2,"connection":"A follow-up on sports."}'::jsonb,-759),
('04f3aacb-5a78-4863-a2a3-d2c238faeb3b'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','When playing sport with others, what atmosphere suits you?','Friendly cooperation','A close but respectful contest','sport.friendly-cooperation','sport.a-close-but-respectful-contest','{"topic":"sports","tree":"sports","depth":1,"edition":2,"connection":"A follow-up on sports."}'::jsonb,-758),
('4d50e715-dab3-4499-af7c-090f8f6435bd'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','For tracking a skill, what would you prefer?','One simple personal target','Feedback on my technique','sport.one-simple-personal-target','sport.feedback-on-my-technique','{"topic":"sports","tree":"sports","depth":2,"edition":2,"connection":"A follow-up on sports."}'::jsonb,-757),
('5d69a0b3-7b1e-4361-a83f-c3189f4b236b'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','For varied sport challenges, what sounds fun?','Try a different drill','Adapt a familiar game','sport.try-a-different-drill','sport.adapt-a-familiar-game','{"topic":"sports","tree":"sports","depth":2,"edition":2,"connection":"A follow-up on sports."}'::jsonb,-756),
('11ece21b-5217-4bf7-a7da-0377c136e70e'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','In cooperative play, what feels rewarding?','Include people of different abilities','Build a familiar team rhythm','sport.include-people-of-different-abilities','sport.build-a-familiar-team-rhythm','{"topic":"sports","tree":"sports","depth":2,"edition":2,"connection":"A follow-up on sports."}'::jsonb,-755),
('866a3ce9-4bda-4674-a928-c75d430af83f'::uuid,(select id from public.preference_categories where slug='health'),'this_or_that','In a friendly contest, what matters most?','A fair well-matched game','Learning something from the other player','sport.a-fair-well-matched-game','sport.learning-something-from-the-other-player','{"topic":"sports","tree":"sports","depth":2,"edition":2,"connection":"A follow-up on sports."}'::jsonb,-754);

insert into public.question_branches(child_question_id,parent_question_id,parent_choice) values
('9e5b1d47-dda5-4a50-a199-422c0ef71af4'::uuid,'312e44b7-fa35-40dd-aaa4-c5f597cf7be7'::uuid,'a'),
('8c1fb538-bfb1-401b-a0c0-9c38464fc194'::uuid,'312e44b7-fa35-40dd-aaa4-c5f597cf7be7'::uuid,'b'),
('2e87a637-f514-44ef-a5a8-d9f64a57cf1d'::uuid,'9e5b1d47-dda5-4a50-a199-422c0ef71af4'::uuid,'a'),
('c5e25cce-04c0-4d57-a43c-9bc46e60ed0d'::uuid,'9e5b1d47-dda5-4a50-a199-422c0ef71af4'::uuid,'b'),
('a11d504e-26fb-4d06-aebe-90b99bbc8237'::uuid,'8c1fb538-bfb1-401b-a0c0-9c38464fc194'::uuid,'a'),
('c987420a-a9b5-4aaa-aef3-15b66dae66cf'::uuid,'8c1fb538-bfb1-401b-a0c0-9c38464fc194'::uuid,'b'),
('a3f1a63f-4408-4879-ace7-eef5ad009b74'::uuid,'4514ef6a-7793-4b3d-a399-a1f1feef229e'::uuid,'a'),
('c8abd586-bdbc-4174-a82f-a7640e2d79f2'::uuid,'4514ef6a-7793-4b3d-a399-a1f1feef229e'::uuid,'b'),
('53616163-f293-41ee-a361-ce24bf98acff'::uuid,'a3f1a63f-4408-4879-ace7-eef5ad009b74'::uuid,'a'),
('5073047a-e4c0-4376-a054-6957aac18d8a'::uuid,'a3f1a63f-4408-4879-ace7-eef5ad009b74'::uuid,'b'),
('3fb7f1d0-f00c-4c3c-a3bc-28f463f96a41'::uuid,'c8abd586-bdbc-4174-a82f-a7640e2d79f2'::uuid,'a'),
('f0eab96c-4359-470f-a243-46ed795eb9ed'::uuid,'c8abd586-bdbc-4174-a82f-a7640e2d79f2'::uuid,'b'),
('e720ccfa-a359-43a8-abdb-e4d8fac102f3'::uuid,'27579385-03e1-4688-a784-bea42ded0921'::uuid,'a'),
('522584f7-6f7d-4472-a20c-e5c2d859e8d7'::uuid,'27579385-03e1-4688-a784-bea42ded0921'::uuid,'b'),
('5eb48343-4cf3-43f2-a7b9-f4bcbf486624'::uuid,'e720ccfa-a359-43a8-abdb-e4d8fac102f3'::uuid,'a'),
('96e266c1-7a6a-42e7-a458-3ce5f815fa48'::uuid,'e720ccfa-a359-43a8-abdb-e4d8fac102f3'::uuid,'b'),
('5bcd0543-6aeb-42b1-aa9f-634e00153fbd'::uuid,'522584f7-6f7d-4472-a20c-e5c2d859e8d7'::uuid,'a'),
('4298a783-d654-4636-a8dc-0b02e13c7057'::uuid,'522584f7-6f7d-4472-a20c-e5c2d859e8d7'::uuid,'b'),
('cf2dffec-1c0b-4bc9-a39e-393924cf2a16'::uuid,'3e7a1481-893f-4ff9-a9f5-213ea17f5942'::uuid,'a'),
('b139aa2e-fd46-4100-ab65-868718261ee3'::uuid,'3e7a1481-893f-4ff9-a9f5-213ea17f5942'::uuid,'b'),
('76beda41-c1e9-47b6-ac55-1bbc4dd4eea0'::uuid,'cf2dffec-1c0b-4bc9-a39e-393924cf2a16'::uuid,'a'),
('cbcc3154-976b-44b6-a982-f7baff64df32'::uuid,'cf2dffec-1c0b-4bc9-a39e-393924cf2a16'::uuid,'b'),
('9331426a-c3c4-4828-a587-21e6b9f80a9d'::uuid,'b139aa2e-fd46-4100-ab65-868718261ee3'::uuid,'a'),
('16ddf4f9-ce6e-4d7f-a69c-a8939d13b36b'::uuid,'b139aa2e-fd46-4100-ab65-868718261ee3'::uuid,'b'),
('82c6e72d-4777-49f9-aa23-6ab60bc0570d'::uuid,'acca8259-5cfe-4573-aa1d-5a34e5608a2c'::uuid,'a'),
('4971eb2a-b42f-4f0c-ab62-214ea376d46b'::uuid,'acca8259-5cfe-4573-aa1d-5a34e5608a2c'::uuid,'b'),
('042ce582-c831-443a-a5b4-a83d25b75449'::uuid,'82c6e72d-4777-49f9-aa23-6ab60bc0570d'::uuid,'a'),
('9bee74fa-0ba9-4798-ad75-0232f1edb64b'::uuid,'82c6e72d-4777-49f9-aa23-6ab60bc0570d'::uuid,'b'),
('3a9025a5-55a6-441d-ac06-9d7fcdc02bcf'::uuid,'4971eb2a-b42f-4f0c-ab62-214ea376d46b'::uuid,'a'),
('01a740c4-cba5-4fc2-a983-e6bc32ba4806'::uuid,'4971eb2a-b42f-4f0c-ab62-214ea376d46b'::uuid,'b'),
('c4a608df-d3bd-4205-a3da-be763dea5d07'::uuid,'294fba20-4545-49b6-afa0-995473567851'::uuid,'a'),
('04f3aacb-5a78-4863-a2a3-d2c238faeb3b'::uuid,'294fba20-4545-49b6-afa0-995473567851'::uuid,'b'),
('4d50e715-dab3-4499-af7c-090f8f6435bd'::uuid,'c4a608df-d3bd-4205-a3da-be763dea5d07'::uuid,'a'),
('5d69a0b3-7b1e-4361-a83f-c3189f4b236b'::uuid,'c4a608df-d3bd-4205-a3da-be763dea5d07'::uuid,'b'),
('11ece21b-5217-4bf7-a7da-0377c136e70e'::uuid,'04f3aacb-5a78-4863-a2a3-d2c238faeb3b'::uuid,'a'),
('866a3ce9-4bda-4674-a928-c75d430af83f'::uuid,'04f3aacb-5a78-4863-a2a3-d2c238faeb3b'::uuid,'b');


$migration_9$;
  end if;
  if to_regprocedure('nudge_private.ai_usage_ledger_version()') is null then
    execute $migration_10$
-- Short-lived operational accounting for paid AI requests. Never stores input,
-- output, credentials, URLs, or provider error bodies. Server-side credentials
-- are required to reserve/finish; authenticated users can only export their own.

create table nudge_private.ai_usage_attempts (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('extract','explain','recap','interpret')),
  provider text not null check (provider ~ '^[a-z0-9:_-]{1,80}$'),
  model text not null check (length(model) between 1 and 160 and model !~ '[[:cntrl:]]'),
  memory_generation integer not null check (memory_generation >= 0),
  usage_day date not null,
  status text not null default 'reserved' check (status in ('reserved','unknown','settled')),
  outcome text check (outcome in ('succeeded','failed','unknown')),
  reserved_cost_micros bigint not null check (reserved_cost_micros > 0),
  charged_cost_micros bigint not null check (charged_cost_micros >= 0),
  actual_cost_micros bigint check (actual_cost_micros >= 0),
  input_tokens bigint check (input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  constraint ai_usage_known_cost check (
    (status='settled' and actual_cost_micros is not null and input_tokens is not null
      and output_tokens is not null and charged_cost_micros=actual_cost_micros and outcome is not null and outcome in ('succeeded','failed'))
    or (status in ('reserved','unknown') and actual_cost_micros is null
      and charged_cost_micros=reserved_cost_micros)
  )
);
create index ai_usage_attempts_user_day on nudge_private.ai_usage_attempts(user_id,usage_day);
create index ai_usage_attempts_retention on nudge_private.ai_usage_attempts(created_at);

-- No owner identifier: deletion removes owned attempts but must not refund
-- incurred costs from the shared daily budget. These totals are also temporary.
create table nudge_private.ai_usage_daily_totals (
  usage_day date primary key,
  charged_cost_micros bigint not null default 0 check (charged_cost_micros >= 0)
);
alter table nudge_private.ai_usage_attempts enable row level security;
alter table nudge_private.ai_usage_daily_totals enable row level security;
revoke all on nudge_private.ai_usage_attempts,nudge_private.ai_usage_daily_totals from public,anon,authenticated,service_role;

create function public.reserve_ai_usage_attempt(
  p_user_id uuid,p_request_id uuid,p_action text,p_provider text,p_model text,p_memory_generation integer,
  p_max_cost_micros bigint,p_user_daily_budget_micros bigint,p_global_daily_budget_micros bigint
)
returns table(reserved boolean,reason text)
language plpgsql security definer set search_path='' as $$
declare
  v_day date := (clock_timestamp() at time zone 'UTC')::date;
  v_global bigint;
  v_user bigint;
  v_inserted uuid;
begin
  if p_user_id is null or p_request_id is null or p_action is null
    or p_action not in ('extract','explain','recap','interpret')
    or p_provider is null or p_provider !~ '^[a-z0-9:_-]{1,80}$'
    or p_model is null or length(p_model) not between 1 and 160 or p_model ~ '[[:cntrl:]]'
    or p_memory_generation is null or p_memory_generation<0
    or p_max_cost_micros is null or p_max_cost_micros not between 1 and 1000000000000
    or p_user_daily_budget_micros is null or p_user_daily_budget_micros not between 1 and 1000000000000000
    or p_global_daily_budget_micros is null or p_global_daily_budget_micros not between 1 and 1000000000000000
  then raise exception 'Invalid AI usage reservation'; end if;

  -- Lock the same consent/generation row used by privacy changes. The captured
  -- generation must still be current at the point the server reserves a call.
  perform 1 from public.profiles p where p.id=p_user_id and p.ai_enabled
    and p.terms_version='2026-10-12' and p.memory_generation=p_memory_generation for update;
  if not found then return query select false,'consent_or_generation'::text; return; end if;

  -- Opportunistic bounded retention. SKIP LOCKED does not interrupt a concurrent
  -- reconciliation. No current or previous UTC date is eligible for totals
  -- cleanup, and a day with a retained attempt is never removed.
  with expired as (
    select a.request_id from nudge_private.ai_usage_attempts a
    where a.created_at<clock_timestamp()-interval '48 hours'
    order by a.created_at,a.request_id for update skip locked limit 1000
  ) delete from nudge_private.ai_usage_attempts a using expired where a.request_id=expired.request_id;
  with expired_days as (
    select d.usage_day from nudge_private.ai_usage_daily_totals d
    where d.usage_day<v_day-1
      and not exists(select 1 from nudge_private.ai_usage_attempts a where a.usage_day=d.usage_day)
    for update skip locked
  ) delete from nudge_private.ai_usage_daily_totals d using expired_days where d.usage_day=expired_days.usage_day;

  insert into nudge_private.ai_usage_daily_totals(usage_day) values(v_day) on conflict do nothing;
  -- Every reservation and reconciliation for a UTC day serializes on this row.
  -- Checking and charging both budgets therefore happens in one transaction.
  select d.charged_cost_micros into v_global from nudge_private.ai_usage_daily_totals d
    where d.usage_day=v_day for update;
  if exists(select 1 from nudge_private.ai_usage_attempts a where a.request_id=p_request_id) then
    return query select false,'duplicate'::text; return;
  end if;
  select coalesce(sum(a.charged_cost_micros),0)::bigint into v_user
    from nudge_private.ai_usage_attempts a where a.user_id=p_user_id and a.usage_day=v_day;
  if p_max_cost_micros>p_user_daily_budget_micros-v_user then
    return query select false,'user_budget'::text; return;
  end if;
  if p_max_cost_micros>p_global_daily_budget_micros-v_global then
    return query select false,'global_budget'::text; return;
  end if;
  insert into nudge_private.ai_usage_attempts(request_id,user_id,action,provider,model,memory_generation,
    usage_day,reserved_cost_micros,charged_cost_micros)
    values(p_request_id,p_user_id,p_action,p_provider,p_model,p_memory_generation,v_day,p_max_cost_micros,p_max_cost_micros)
    on conflict do nothing returning request_id into v_inserted;
  -- Also handles the extremely narrow same-UUID race across a UTC day boundary.
  if v_inserted is null then return query select false,'duplicate'::text; return; end if;
  update nudge_private.ai_usage_daily_totals d set charged_cost_micros=d.charged_cost_micros+p_max_cost_micros
    where d.usage_day=v_day;
  return query select true,'reserved'::text;
end $$;

create function public.finish_ai_usage_attempt(
  p_user_id uuid,p_request_id uuid,p_outcome text,p_input_tokens bigint default null,
  p_output_tokens bigint default null,p_actual_cost_micros bigint default null
)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_day date; v_attempt nudge_private.ai_usage_attempts%rowtype; v_known boolean;
begin
  if p_user_id is null or p_request_id is null or p_outcome is null or p_outcome not in ('succeeded','failed','unknown')
    or (p_input_tokens is not null and p_input_tokens not between 0 and 1000000000000)
    or (p_output_tokens is not null and p_output_tokens not between 0 and 1000000000000)
    or (p_actual_cost_micros is not null and p_actual_cost_micros not between 0 and 1000000000000)
  then raise exception 'Invalid AI usage reconciliation'; end if;
  v_known := p_input_tokens is not null and p_output_tokens is not null and p_actual_cost_micros is not null
    and p_outcome in ('succeeded','failed');
  -- Lock order matches reservation: global day before attempt. Unknown usage
  -- (timeouts, dropped connections, malformed usage) always keeps the reserve.
  select a.usage_day into v_day from nudge_private.ai_usage_attempts a
    where a.request_id=p_request_id and a.user_id=p_user_id;
  if not found then return false; end if;
  perform 1 from nudge_private.ai_usage_daily_totals d where d.usage_day=v_day for update;
  if not found then return false; end if;
  select * into v_attempt from nudge_private.ai_usage_attempts a
    where a.request_id=p_request_id and a.user_id=p_user_id for update;
  if not found then return false; end if;
  if v_attempt.status='settled' then
    if not v_known then return true; end if; -- late timeout cannot erase known usage
    if v_attempt.input_tokens=p_input_tokens and v_attempt.output_tokens=p_output_tokens
      and v_attempt.actual_cost_micros=p_actual_cost_micros and v_attempt.outcome=p_outcome then return true; end if;
    raise exception 'Conflicting AI usage reconciliation';
  end if;
  if not v_known then
    update nudge_private.ai_usage_attempts a set status='unknown',outcome=p_outcome,
      input_tokens=p_input_tokens,output_tokens=p_output_tokens,finished_at=clock_timestamp()
      where a.request_id=p_request_id;
    return true;
  end if;
  -- A provider can report more than the reservation. Charge all observed cost;
  -- later reservations will then fail closed against the exceeded budget.
  update nudge_private.ai_usage_daily_totals d set
    charged_cost_micros=d.charged_cost_micros-v_attempt.charged_cost_micros+p_actual_cost_micros
    where d.usage_day=v_day;
  update nudge_private.ai_usage_attempts a set status='settled',outcome=p_outcome,
    input_tokens=p_input_tokens,output_tokens=p_output_tokens,actual_cost_micros=p_actual_cost_micros,
    charged_cost_micros=p_actual_cost_micros,finished_at=clock_timestamp() where a.request_id=p_request_id;
  return true;
end $$;

create function public.export_my_ai_usage()
returns table(request_id uuid,action text,provider text,model text,status text,outcome text,input_tokens bigint,
  output_tokens bigint,reserved_cost_micros bigint,actual_cost_micros bigint,created_at timestamptz,finished_at timestamptz)
language sql stable security definer set search_path='' as $$
  select a.request_id,a.action,a.provider,a.model,a.status,a.outcome,a.input_tokens,a.output_tokens,
    a.reserved_cost_micros,a.actual_cost_micros,a.created_at,a.finished_at
  from nudge_private.ai_usage_attempts a where a.user_id=auth.uid() and a.created_at>=now()-interval '48 hours'
  order by a.created_at desc,a.request_id asc;
$$;

revoke all on function public.reserve_ai_usage_attempt(uuid,uuid,text,text,text,integer,bigint,bigint,bigint),
  public.finish_ai_usage_attempt(uuid,uuid,text,bigint,bigint,bigint),public.export_my_ai_usage() from public,anon,authenticated;
grant execute on function public.reserve_ai_usage_attempt(uuid,uuid,text,text,text,integer,bigint,bigint,bigint),
  public.finish_ai_usage_attempt(uuid,uuid,text,bigint,bigint,bigint) to service_role;
grant execute on function public.export_my_ai_usage() to authenticated;
create function nudge_private.ai_usage_ledger_version() returns integer language sql immutable set search_path='' as $$ select 10; $$;
revoke all on function nudge_private.ai_usage_ledger_version() from public,anon,authenticated;
notify pgrst,'reload schema';

$migration_10$;
  end if;
  if to_regprocedure('nudge_private.comparison_evidence_settings_version()') is null then
    execute $migration_11$
-- Immutable, owner-only comparison evidence and explicit reusable settings.
-- Journal entries remain intact when derived evidence/settings are purged.

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

$migration_11$;
  end if;
  if to_regprocedure('nudge_private.foundation_questions_version()') is null then
    execute $migration_12$
-- Six contextual starter questions. Existing catalog rows, flags, answers and
-- journal records are retained. The UI selects foundationEdition=1 explicitly.

insert into public.questions(id,category_id,kind,prompt,option_a,option_b,maps_to_key_a,maps_to_key_b,context,is_onboarding,is_active,sort_order)
select seed.id::uuid,c.id,'this_or_that',seed.prompt,seed.option_a,seed.option_b,seed.key_a,seed.key_b,
  jsonb_build_object('foundationEdition','1','topic',seed.topic,'domain','everyday life',
    'starterRationale',seed.rationale,'answerPolicy','single_preference_or_skip'),true,true,seed.position
from (values
  ('12000000-0000-4000-8000-000000000001','food','food',1,
    'On an ordinary evening, when both are practical, which meal option usually appeals more?',
    'Cook at home','Order in','food.foundation.meal.cook-at-home','food.foundation.meal.order-in',
    'This helps with similar everyday meal choices. It does not assume a diet, budget or cooking ability.'),
  ('12000000-0000-4000-8000-000000000002','entertainment','reading',2,
    'For a relaxed free hour at home, which would you usually rather do?',
    'Read a book','Watch a film','reading.foundation.free-hour.book','watch.foundation.free-hour.film',
    'This records a preference between these two leisure options, without guessing genres or interests.'),
  ('12000000-0000-4000-8000-000000000003','relationships','community',3,
    'For a short break, when both are available, which usually appeals more?',
    'Quiet time alone','Chat with someone I know','social.foundation.break.quiet-time','social.foundation.break.familiar-chat',
    'This helps with similar break choices. It is not a personality label or a claim about your relationships.'),
  ('12000000-0000-4000-8000-000000000004','career','learning',4,
    'When learning a non-urgent everyday skill, how would you usually prefer to start?',
    'Try a small example','Follow a step-by-step guide','learning.foundation.skill.try-example','learning.foundation.skill.follow-guide',
    'This records how you prefer to begin this kind of task, not your ability, education or occupation.'),
  ('12000000-0000-4000-8000-000000000005','hobbies','making',5,
    'With an hour for a hobby, when both are practical, which would you usually pick?',
    'Make something','Explore outdoors','hobby.foundation.free-hour.making','outdoor.foundation.free-hour.exploring',
    'This gives a starting point for similar hobby choices. It does not assume tools, mobility or experience.'),
  ('12000000-0000-4000-8000-000000000006','shopping','shopping',6,
    'When two everyday products meet your needs and cost the same, which approach usually appeals more?',
    'Pick a familiar product','Try a new option','shopping.foundation.equal-options.familiar','shopping.foundation.equal-options.new',
    'This applies to equally suitable, equally priced products. It does not infer your finances or risk tolerance.')
) as seed(id,category,topic,position,prompt,option_a,option_b,key_a,key_b,rationale)
join public.preference_categories c on c.slug=seed.category
on conflict(id) do nothing;

do $$ begin
  if (select count(*) from public.questions where id in (
    '12000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000004','12000000-0000-4000-8000-000000000005','12000000-0000-4000-8000-000000000006')
    and context->>'foundationEdition'='1' and is_onboarding and is_active)<>6 then
    raise exception 'Foundation catalog is incomplete. Review the category seed and question identities'; end if;
end $$;

-- Keep the public signature, age gate and authenticated ACL. Accepting explicit
-- skip covers Both/depends/neither without inventing a single preference.
create or replace function nudge_private.complete_onboarding(p_profile jsonb,p_answers jsonb,p_expected_generation integer)
returns integer language plpgsql security definer set search_path='' as $$
declare generation integer; answer jsonb; age_value integer; q public.questions%rowtype;
  picked text; picked_label text; picked_category text; previous text; field text; limit_length integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select memory_generation into generation from public.profiles where id=auth.uid() for update;
  if not found or generation is distinct from p_expected_generation then raise exception 'Memory changed. Please reload onboarding'; end if;
  if p_profile is null or jsonb_typeof(p_profile) is distinct from 'object'
    or (p_profile-array['fullName','country','language','age','occupation'])<>'{}'::jsonb then raise exception 'Invalid onboarding profile'; end if;
  foreach field in array array['fullName','country','language','age','occupation'] loop
    limit_length:=case field when 'fullName' then 80 when 'country' then 60 when 'language' then 40 when 'age' then 3 else 80 end;
    if p_profile ? field and (jsonb_typeof(p_profile->field) not in ('string','null') or length(coalesce(p_profile->>field,''))>limit_length) then
      raise exception 'Invalid onboarding profile'; end if;
  end loop;
  age_value:=nullif(trim(p_profile->>'age'),'')::integer;
  if age_value is not null and age_value not between 16 and 120 then raise exception 'Invalid age'; end if;
  if p_answers is null or jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers)>20 then raise exception 'Invalid onboarding answers'; end if;
  for answer in select value from jsonb_array_elements(p_answers) loop
    if jsonb_typeof(answer) is distinct from 'object' or (answer-array['questionId','answer'])<>'{}'::jsonb
      or jsonb_typeof(answer->'questionId') is distinct from 'string'
      or (answer->>'questionId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(answer->'answer') is distinct from 'string' or coalesce(answer->>'answer','') not in ('a','b','skip') then
      raise exception 'Invalid onboarding answers'; end if;
  end loop;
  if (select count(distinct lower(a->>'questionId')) from jsonb_array_elements(p_answers) a)<>jsonb_array_length(p_answers) then
    raise exception 'Answer each starter question only once'; end if;
  for answer in select value from jsonb_array_elements(p_answers) loop
    select * into q from public.questions where id=(answer->>'questionId')::uuid and is_active and is_onboarding;
    if not found then raise exception 'Invalid onboarding question'; end if;
    select a.answer into previous from public.question_answers a where a.user_id=auth.uid() and a.question_id=q.id;
    if found then
      if previous is distinct from answer->>'answer' then raise exception 'This starter question already has a saved answer. Reload setup'; end if;
      continue;
    end if;
    insert into public.question_answers(user_id,question_id,answer,skipped,created_at)
      values(auth.uid(),q.id,answer->>'answer',answer->>'answer'='skip',clock_timestamp());
    picked:=case answer->>'answer' when 'a' then q.maps_to_key_a when 'b' then q.maps_to_key_b else null end;
    if picked is not null then
      if q.context->>'foundationEdition'='1' then
        picked_label:=case answer->>'answer' when 'a' then q.option_a else q.option_b end;
        select case slug when 'entertainment' then 'movies' else slug end into picked_category from public.preference_categories where id=q.category_id;
        perform public.record_knowledge_signal(picked,picked_label,picked_category,'like','explicit',0.55,'onboarding_answer',null,q.id,true,
          jsonb_build_object('chose',answer->>'answer','foundation_edition','1','domain','everyday life','topic',q.context->>'topic','prompt',q.prompt),generation);
      else
        -- Historical clients/questions retain their existing learning semantics.
        perform public.record_knowledge_signal(picked,null,null,'like','explicit',0.55,'onboarding_answer',null,q.id,false,
          jsonb_build_object('chose',answer->>'answer'),generation);
      end if;
    end if;
  end loop;
  update public.profiles set
    full_name=case when p_profile ? 'fullName' then nullif(trim(p_profile->>'fullName'),'') else full_name end,
    country=case when p_profile ? 'country' then nullif(trim(p_profile->>'country'),'') else country end,
    language=case when p_profile ? 'language' then coalesce(nullif(trim(p_profile->>'language'),''),'en') else language end,
    age=case when p_profile ? 'age' then age_value else age end,
    occupation=case when p_profile ? 'occupation' then nullif(trim(p_profile->>'occupation'),'') else occupation end,
    onboarded_at=coalesce(onboarded_at,clock_timestamp()) where id=auth.uid();
  return generation;
end $$;
revoke all on function nudge_private.complete_onboarding(jsonb,jsonb,integer) from public,anon,authenticated,service_role;

create function nudge_private.foundation_questions_version() returns integer language sql immutable set search_path='' as $$select 12$$;
revoke all on function nudge_private.foundation_questions_version() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';

$migration_12$;
  end if;
  if to_regprocedure('nudge_private.reviewed_memories_version()') is null then
    execute $migration_13$
-- Only explicitly reviewed statements become new durable extracted memories.

alter table public.ai_memories add column reviewed_at timestamptz;
comment on column public.ai_memories.reviewed_at is 'Explicit user confirmation time. NULL for legacy, unreviewed records; not external factual verification.';

create table nudge_private.reviewed_memory_requests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  memory_generation integer not null check(memory_generation>=0),
  payload_hash text not null,
  inserted_count integer not null check(inserted_count between 1 and 6),
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,request_id)
);
alter table nudge_private.reviewed_memory_requests enable row level security;
revoke all on nudge_private.reviewed_memory_requests from public,anon,authenticated,service_role;

create function nudge_private.purge_memory_review_requests() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.memory_generation is distinct from old.memory_generation then
    delete from nudge_private.reviewed_memory_requests where user_id=new.id;
  end if;
  return new;
end $$;
create trigger profiles_purge_memory_reviews after update of memory_generation on public.profiles
for each row execute function nudge_private.purge_memory_review_requests();
revoke all on function nudge_private.purge_memory_review_requests() from public,anon,authenticated,service_role;

create function public.save_reviewed_memories(p_request_id uuid,p_memories jsonb,p_generation integer)
returns integer language plpgsql security definer set search_path='' as $$
declare profile public.profiles%rowtype; item jsonb; normalized jsonb:='[]'::jsonb;
  payload_hash text; previous nudge_private.reviewed_memory_requests%rowtype; inserted integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into profile from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Profile not found'; end if;
  if p_generation is distinct from profile.memory_generation or not profile.ai_enabled or profile.terms_version is distinct from '2026-10-12' then
    raise exception using errcode='40001',message='Your memory or AI consent changed. Review new suggestions before saving';
  end if;
  if p_request_id is null or p_memories is null or jsonb_typeof(p_memories) is distinct from 'array'
    or jsonb_array_length(p_memories) not between 1 and 6 or octet_length(p_memories::text)>16384 then
    raise exception 'Review one to six bounded memories';
  end if;
  for item in select value from jsonb_array_elements(p_memories) loop
    if jsonb_typeof(item) is distinct from 'object' or (item-array['kind','content'])<>'{}'::jsonb
      or jsonb_typeof(item->'kind') is distinct from 'string' or coalesce(item->>'kind','') not in ('fact','goal','habit','constraint')
      or jsonb_typeof(item->'content') is distinct from 'string' or length(regexp_replace(item->>'content','^\s+|\s+$','','g')) not between 1 and 300 then
      raise exception 'Invalid reviewed memory';
    end if;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('kind',item->>'kind','content',regexp_replace(item->>'content','^\s+|\s+$','','g')));
  end loop;
  if (select count(distinct (m->>'kind',lower(m->>'content'))) from jsonb_array_elements(normalized) m)<>jsonb_array_length(normalized) then
    raise exception 'Review each statement only once';
  end if;
  -- Hash the normalized reviewed intent; this ledger never stores source notes.
  payload_hash:=encode(sha256(convert_to(normalized::text,'UTF8')),'hex');
  select * into previous from nudge_private.reviewed_memory_requests where user_id=auth.uid() and request_id=p_request_id;
  if found then
    if previous.memory_generation is distinct from p_generation or previous.payload_hash is distinct from payload_hash then
      raise exception 'This review request already saved different statements';
    end if;
    return previous.inserted_count;
  end if;
  -- The legacy nonnullable confidence field is a conservative compatibility
  -- value, not a model estimate or a probability that the statement is true.
  insert into public.ai_memories(user_id,kind,content,confidence,reviewed_at)
    select auth.uid(),m->>'kind',m->>'content',0.5,clock_timestamp() from jsonb_array_elements(normalized) m;
  get diagnostics inserted=row_count;
  insert into nudge_private.reviewed_memory_requests(user_id,request_id,memory_generation,payload_hash,inserted_count)
    values(auth.uid(),p_request_id,p_generation,payload_hash,inserted);
  return inserted;
end $$;
revoke all on function public.save_reviewed_memories(uuid,jsonb,integer) from public,anon;
grant execute on function public.save_reviewed_memories(uuid,jsonb,integer) to authenticated;
-- Older automatic extraction clients must upgrade to the review flow. Keep
-- the old function for migrations/history, with no client execution privilege.
revoke all on function public.save_ai_memories(jsonb,integer,uuid) from public,anon,authenticated,service_role;
create function nudge_private.reviewed_memories_version() returns integer language sql immutable set search_path='' as $$select 13$$;
revoke all on function nudge_private.reviewed_memories_version() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';

$migration_13$;
  end if;
  if to_regprocedure('nudge_private.reviewed_memory_conflicts_version()') is null then
    execute $migration_14$
-- A privacy/consent validation conflict must not trigger serialization retries.
-- PostgREST maps PT409 to HTTP 409 without retrying the transaction.

create or replace function public.save_reviewed_memories(p_request_id uuid,p_memories jsonb,p_generation integer)
returns integer language plpgsql security definer set search_path='' as $$
declare profile public.profiles%rowtype; item jsonb; normalized jsonb:='[]'::jsonb;
  payload_hash text; previous nudge_private.reviewed_memory_requests%rowtype; inserted integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into profile from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Profile not found'; end if;
  if p_generation is distinct from profile.memory_generation or not profile.ai_enabled or profile.terms_version is distinct from '2026-10-12' then
    raise exception using errcode='PT409',message='Your memory or AI consent changed. Review new suggestions before saving';
  end if;
  if p_request_id is null or p_memories is null or jsonb_typeof(p_memories) is distinct from 'array'
    or jsonb_array_length(p_memories) not between 1 and 6 or octet_length(p_memories::text)>16384 then
    raise exception 'Review one to six bounded memories';
  end if;
  for item in select value from jsonb_array_elements(p_memories) loop
    if jsonb_typeof(item) is distinct from 'object' or (item-array['kind','content'])<>'{}'::jsonb
      or jsonb_typeof(item->'kind') is distinct from 'string' or coalesce(item->>'kind','') not in ('fact','goal','habit','constraint')
      or jsonb_typeof(item->'content') is distinct from 'string' or length(regexp_replace(item->>'content','^\s+|\s+$','','g')) not between 1 and 300 then
      raise exception 'Invalid reviewed memory';
    end if;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('kind',item->>'kind','content',regexp_replace(item->>'content','^\s+|\s+$','','g')));
  end loop;
  if (select count(distinct (m->>'kind',lower(m->>'content'))) from jsonb_array_elements(normalized) m)<>jsonb_array_length(normalized) then
    raise exception 'Review each statement only once';
  end if;
  -- Hash the normalized reviewed intent; this ledger never stores source notes.
  payload_hash:=encode(sha256(convert_to(normalized::text,'UTF8')),'hex');
  select * into previous from nudge_private.reviewed_memory_requests where user_id=auth.uid() and request_id=p_request_id;
  if found then
    if previous.memory_generation is distinct from p_generation or previous.payload_hash is distinct from payload_hash then
      raise exception 'This review request already saved different statements';
    end if;
    return previous.inserted_count;
  end if;
  -- The legacy nonnullable confidence field is a conservative compatibility
  -- value, not a model estimate or a probability that the statement is true.
  insert into public.ai_memories(user_id,kind,content,confidence,reviewed_at)
    select auth.uid(),m->>'kind',m->>'content',0.5,clock_timestamp() from jsonb_array_elements(normalized) m;
  get diagnostics inserted=row_count;
  insert into nudge_private.reviewed_memory_requests(user_id,request_id,memory_generation,payload_hash,inserted_count)
    values(auth.uid(),p_request_id,p_generation,payload_hash,inserted);
  return inserted;
end $$;
revoke all on function public.save_reviewed_memories(uuid,jsonb,integer) from public,anon,service_role;
grant execute on function public.save_reviewed_memories(uuid,jsonb,integer) to authenticated;
create function nudge_private.reviewed_memory_conflicts_version() returns integer language sql immutable set search_path='' as $$select 14$$;
revoke all on function nudge_private.reviewed_memory_conflicts_version() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';

$migration_14$;
  end if;
  if to_regprocedure('nudge_private.self_discovery_version()') is null then
    execute $migration_15$
-- Additive self-discovery storage. Existing decisions and question answers remain intact.

create table public.discovery_question_versions (
  question_id text not null check(length(question_id) between 1 and 96),
  version integer not null check(version>0),
  definition jsonb not null check(jsonb_typeof(definition)='object'),
  primary key(question_id,version)
);
alter table public.discovery_question_versions enable row level security;
create policy discovery_published_catalog on public.discovery_question_versions for select
  using(definition->>'status'='published');
revoke all on public.discovery_question_versions from public,anon,authenticated;
grant select on public.discovery_question_versions to anon,authenticated;
grant all on public.discovery_question_versions to service_role;

create table nudge_private.discovery_answers (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  question_id text not null, question_version integer not null,
  response jsonb not null, revision integer not null default 0, active boolean not null default true,
  source text not null check(source in ('preview','daily')), answered_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key(question_id,question_version) references public.discovery_question_versions(question_id,version),
  unique(user_id,question_id,question_version)
);
create table nudge_private.discovery_answer_revisions (
  answer_id uuid not null references nudge_private.discovery_answers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade, revision integer not null,
  response jsonb not null, active boolean not null, created_at timestamptz not null default clock_timestamp(),
  primary key(answer_id,revision)
);
create table nudge_private.discovery_exposures (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null, question_id text not null, question_version integer not null, family_id text not null,
  local_day date not null, daily boolean not null default false, state text not null default 'served' check(state in ('served','answered','skipped','changed')),
  served_at timestamptz not null default clock_timestamp(), reason text not null, generation integer not null,
  foreign key(question_id,question_version) references public.discovery_question_versions(question_id,version),unique(user_id,request_id)
);
create unique index discovery_one_daily on nudge_private.discovery_exposures(user_id,local_day) where daily and state<>'changed';
create index discovery_exposure_history on nudge_private.discovery_exposures(user_id,served_at);
create table nudge_private.discovery_requests (
  user_id uuid not null references public.profiles(id) on delete cascade, request_id uuid not null,
  expected_generation integer not null, result_generation integer not null, intent_hash text not null, result jsonb not null,
  created_at timestamptz not null default clock_timestamp(), primary key(user_id,request_id)
);
create table nudge_private.discovery_feedback (
  user_id uuid not null references public.profiles(id) on delete cascade, insight_id text not null check(length(insight_id)<=1000),
  feedback text not null check(feedback in ('fits','sometimes','not_me')), updated_at timestamptz not null default clock_timestamp(),
  primary key(user_id,insight_id)
);
create table nudge_private.discovery_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  muted_topics jsonb not null default '[]', optional_topics boolean not null default false,
  max_depth integer not null default 0 check(max_depth between 0 and 2), written_answers boolean not null default false,
  metrics_enabled boolean not null default false, updated_at timestamptz not null default clock_timestamp()
);
create table nudge_private.discovery_metrics (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null check(event in ('answer_submitted','claim_succeeded','reflection_feedback','topic_changed','suggestion_used')),
  created_at timestamptz not null default clock_timestamp()
);
do $$ declare t text; begin
  foreach t in array array['discovery_answers','discovery_answer_revisions','discovery_exposures','discovery_requests','discovery_feedback','discovery_settings','discovery_metrics'] loop
    execute format('alter table nudge_private.%I enable row level security',t);
    execute format('revoke all on nudge_private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create function nudge_private.discovery_rule_key(rule jsonb) returns text language sql immutable set search_path='' as $$
 select 'discovery.'||md5(coalesce(rule->>'attributeKey','')||'|'||coalesce(rule->>'scope','')||'|'||coalesce(rule->>'value',''));
$$;
create function nudge_private.validate_discovery_response(q jsonb,r jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text:=r->>'kind'; ids jsonb; n integer; v numeric; s jsonb;
begin
 if jsonb_typeof(r) is distinct from 'object' or length(r::text)>2048 then return false; end if;
 if k in ('both','depends','neither','skip') then
   if not coalesce(q->'allowedResponses' ? k,false) or exists(select 1 from jsonb_object_keys(r) x where x not in ('kind','context')) then return false; end if;
   return not(r ? 'context') or (k='depends' and jsonb_typeof(r->'context')='string' and length(r->>'context')<=140);
 end if;
 if k is distinct from q->>'format' then return false; end if;
 if k='choice' then
   return not exists(select 1 from jsonb_object_keys(r) x where x not in ('kind','optionId'))
     and jsonb_typeof(r->'optionId')='string' and exists(select 1 from jsonb_array_elements(q->'choices') c where c->>'id'=r->>'optionId');
 elsif k='scale' then
   if exists(select 1 from jsonb_object_keys(r) x where x not in ('kind','value')) or jsonb_typeof(r->'value') is distinct from 'number' then return false; end if;
   v:=(r->>'value')::numeric;s:=q->'scale';
   return v between (s->>'min')::numeric and (s->>'max')::numeric and mod(v-(s->>'min')::numeric,(s->>'step')::numeric)=0;
 elsif k='ranking' then
   if exists(select 1 from jsonb_object_keys(r) x where x not in ('kind','groups')) or jsonb_typeof(r->'groups') is distinct from 'array' then return false; end if;
   if exists(select 1 from jsonb_array_elements(r->'groups') g where jsonb_typeof(g)<>'array') then return false; end if;
   if exists(select 1 from jsonb_array_elements(r->'groups') g where jsonb_array_length(g)=0 or (coalesce((q->'ranking'->>'allowTies')::boolean,false)=false and jsonb_array_length(g)<>1)) then return false; end if;
   select coalesce(jsonb_agg(i),'[]') into ids from jsonb_array_elements(r->'groups') g cross join lateral jsonb_array_elements(g) i;
   n:=jsonb_array_length(ids);
   return n between (q->'ranking'->>'min')::integer and (q->'ranking'->>'max')::integer
     and (select count(distinct i::text)=n from jsonb_array_elements(ids) i)
     and not exists(select 1 from jsonb_array_elements(ids) i where jsonb_typeof(i)<>'string' or not exists(select 1 from jsonb_array_elements(q->'choices') c where c->'id'=i));
 elsif k='text' then
   return not exists(select 1 from jsonb_object_keys(r) x where x not in ('kind','text')) and jsonb_typeof(r->'text')='string' and length(trim(r->>'text')) between 1 and 140;
 end if;
 return false;
exception when others then return false;
end $$;

create function nudge_private.rebuild_discovery_evidence() returns void language plpgsql security definer set search_path='' as $$
declare a record; rule jsonb; picked jsonb; v_generation integer; ignored uuid;
begin
 select memory_generation into v_generation from public.profiles where id=auth.uid() for update;
 -- Discovery-derived nodes are a projection with exact answer lineage. Never touch other learning sources.
 delete from public.knowledge_nodes where user_id=auth.uid() and key like 'discovery.%' and status<>'forgotten';
 for a in select saved.*,q.definition from nudge_private.discovery_answers saved join public.discovery_question_versions q on q.question_id=saved.question_id and q.version=saved.question_version
   where saved.user_id=auth.uid() and saved.active and q.definition->>'purpose'='evidence' loop
   picked:=case a.response->>'kind' when 'choice' then jsonb_build_array(a.response->>'optionId') when 'ranking' then coalesce(a.response->'groups'->0,'[]') else '[]' end;
   for rule in select value from jsonb_array_elements(coalesce(a.definition->'signals','[]')) loop
     if rule ? 'optionId' and picked ? (rule->>'optionId') then
       ignored:=nudge_private.record_knowledge_signal_guarded(nudge_private.discovery_rule_key(rule),rule->>'statement','lifestyle','like','explicit',0.25,'discover_answer',null,null,false,
         jsonb_build_object('discoveryAnswerId',a.id,'questionId',a.question_id,'questionVersion',a.question_version,'revision',a.revision,'attributeKey',rule->>'attributeKey','scope',rule->>'scope','familyId',a.definition->>'familyId','value',rule->>'value'),v_generation);
     end if;
   end loop;
 end loop;
end $$;

create function nudge_private.purge_discovery_on_privacy_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.memory_generation is distinct from old.memory_generation then
   delete from nudge_private.discovery_requests where user_id=new.id;
   delete from nudge_private.discovery_feedback where user_id=new.id;
   delete from nudge_private.discovery_exposures where user_id=new.id;
 end if;
 if new.memory_reset_at is distinct from old.memory_reset_at then
   delete from nudge_private.discovery_answers where user_id=new.id;
   delete from nudge_private.discovery_settings where user_id=new.id;
   delete from nudge_private.discovery_metrics where user_id=new.id;
 end if;
 return new;
end $$;
create trigger profiles_purge_discovery after update of memory_generation,memory_reset_at on public.profiles for each row execute function nudge_private.purge_discovery_on_privacy_change();

create function nudge_private.withdraw_forgotten_discovery_answer() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.key like 'discovery.%' and (new.status='forgotten' or new.polarity is distinct from old.polarity) then
   update nudge_private.discovery_answers a set active=false,updated_at=clock_timestamp()
   where a.user_id=new.user_id and a.id in(select (e.detail->>'discoveryAnswerId')::uuid from public.knowledge_evidence e where e.node_id=new.id and e.detail ? 'discoveryAnswerId');
   delete from nudge_private.discovery_feedback where user_id=new.user_id;
 end if;
 return new;
end $$;
create trigger discovery_respects_knowledge_correction after update of status,polarity on public.knowledge_nodes for each row execute function nudge_private.withdraw_forgotten_discovery_answer();

create function public.read_discovery_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_generation integer; result jsonb;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 select memory_generation into v_generation from public.profiles where id=auth.uid();
 if not found then raise exception 'Profile not found'; end if;
 select jsonb_build_object('generation',v_generation,'available',true,'today',(select public.user_today(timezone) from public.profiles where id=auth.uid()),
   'answers',coalesce((select jsonb_agg(to_jsonb(a) order by a.answered_at,a.id) from nudge_private.discovery_answers a where a.user_id=auth.uid()),'[]'),
   'exposures',coalesce((select jsonb_agg(to_jsonb(e) order by e.served_at,e.id) from nudge_private.discovery_exposures e where e.user_id=auth.uid() and e.served_at>clock_timestamp()-interval '30 days'),'[]'),
   'feedback',coalesce((select jsonb_agg(to_jsonb(f)) from nudge_private.discovery_feedback f where f.user_id=auth.uid()),'[]'),
   'settings',coalesce((select to_jsonb(s) from nudge_private.discovery_settings s where s.user_id=auth.uid()),'{}')) into result;
 return result;
end $$;

create function public.save_discovery_answers(p_request_id uuid,p_generation integer,p_answers jsonb,p_source text default 'daily') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_generation integer; previous nudge_private.discovery_requests%rowtype; digest text; item jsonb; q jsonb; a nudge_private.discovery_answers%rowtype; ids jsonb:='[]'; result jsonb;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 select memory_generation into v_generation from public.profiles where id=auth.uid() for update;
 if not found or p_request_id is null or p_generation is null or p_source not in ('preview','daily') or jsonb_typeof(p_answers) is distinct from 'array' then raise exception 'Invalid discovery request'; end if;
 if jsonb_array_length(p_answers) not between 1 and 20 or length(p_answers::text)>16000 then raise exception 'Invalid discovery answers'; end if;
 digest:=md5(p_source||p_answers::text);
 select * into previous from nudge_private.discovery_requests where user_id=auth.uid() and request_id=p_request_id;
 if found then
   if previous.intent_hash<>digest or previous.expected_generation<>p_generation or previous.result_generation<>v_generation then raise sqlstate 'PT409' using message='This request no longer matches'; end if;
   return previous.result;
 end if;
 if p_generation<>v_generation then raise sqlstate 'PT409' using message='Your memory changed. Review your answers again.'; end if;
 if (select count(distinct entry.value->>'questionId') from jsonb_array_elements(p_answers) entry)<>jsonb_array_length(p_answers) then raise exception 'Repeated question'; end if;
 if (select count(*) from nudge_private.discovery_requests where user_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=60 then raise sqlstate 'PT429' using message='Take a moment before saving more answers'; end if;
 for item in select value from jsonb_array_elements(p_answers) loop
   if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('questionId','questionVersion','response')) then raise exception 'Invalid answer fields'; end if;
   select definition into q from public.discovery_question_versions where question_id=item->>'questionId' and version=(item->>'questionVersion')::integer and definition->>'status'='published';
   if q is null or nudge_private.validate_discovery_response(q,item->'response') is distinct from true or (p_source='preview' and coalesce((q->>'preview')::boolean,false)=false) then raise exception 'Invalid or unavailable question'; end if;
   if item->'response'->>'kind'='text' and not exists(select 1 from nudge_private.discovery_settings where user_id=auth.uid() and written_answers) then raise exception 'Written answers are turned off'; end if;
   if p_source='daily' and not exists(select 1 from nudge_private.discovery_exposures e where e.user_id=auth.uid() and e.question_id=item->>'questionId' and e.question_version=(item->>'questionVersion')::integer and e.generation=v_generation) then raise exception 'Open this question before answering'; end if;
   select * into a from nudge_private.discovery_answers where user_id=auth.uid() and question_id=item->>'questionId' and question_version=(item->>'questionVersion')::integer;
   if found then
     if a.response is distinct from item->'response' then raise sqlstate 'PT409' using message='This question already has an answer. Edit the saved answer.'; end if;
   else
     insert into nudge_private.discovery_answers(user_id,question_id,question_version,response,source) values(auth.uid(),item->>'questionId',(item->>'questionVersion')::integer,item->'response',p_source) returning * into a;
     insert into nudge_private.discovery_answer_revisions(answer_id,user_id,revision,response,active) values(a.id,auth.uid(),a.revision,a.response,a.active);
   end if;
   ids:=ids||jsonb_build_array(a.id);
   update nudge_private.discovery_exposures set state=case when item->'response'->>'kind'='skip' then 'skipped' else 'answered' end
     where user_id=auth.uid() and question_id=a.question_id and question_version=a.question_version and generation=p_generation and state='served';
 end loop;
 perform nudge_private.rebuild_discovery_evidence();
 if p_source='preview' then update public.profiles set onboarded_at=coalesce(onboarded_at,clock_timestamp()) where id=auth.uid(); end if;
 result:=jsonb_build_object('saved',true,'generation',v_generation,'answerIds',ids);
 insert into nudge_private.discovery_requests values(auth.uid(),p_request_id,p_generation,v_generation,digest,result,clock_timestamp());
 if exists(select 1 from nudge_private.discovery_settings where user_id=auth.uid() and metrics_enabled) then
   insert into nudge_private.discovery_metrics(user_id,event) values(auth.uid(),case when p_source='preview' then 'claim_succeeded' else 'answer_submitted' end);
 end if;
 return result;
end $$;

create function public.edit_discovery_answer(p_request_id uuid,p_generation integer,p_answer_id uuid,p_revision integer,p_response jsonb default null,p_active boolean default null,p_delete boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_generation integer; previous nudge_private.discovery_requests%rowtype; digest text; a nudge_private.discovery_answers%rowtype; q jsonb; result jsonb;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 select memory_generation into v_generation from public.profiles where id=auth.uid() for update;
 digest:=md5(jsonb_build_array('edit',p_answer_id,p_revision,p_response,p_active,p_delete)::text);
 select * into previous from nudge_private.discovery_requests where user_id=auth.uid() and request_id=p_request_id;
 if found then
   if previous.intent_hash<>digest or previous.expected_generation<>p_generation or previous.result_generation<>v_generation then raise sqlstate 'PT409' using message='This edit no longer matches'; end if;
   return previous.result;
 end if;
 if p_request_id is null or p_generation is distinct from v_generation then raise sqlstate 'PT409' using message='Your memory changed. Reload before editing.'; end if;
 select * into a from nudge_private.discovery_answers where id=p_answer_id and user_id=auth.uid();
 if not found then raise sqlstate 'PT404' using message='Answer not found'; end if;
 if a.revision is distinct from p_revision then raise sqlstate 'PT409' using message='This answer changed. Reload it.'; end if;
 select definition into q from public.discovery_question_versions where question_id=a.question_id and version=a.question_version;
 if p_response is not null and nudge_private.validate_discovery_response(q,p_response) is distinct from true then raise exception 'Invalid edited answer'; end if;
 if p_delete then delete from nudge_private.discovery_answers where id=a.id;
 else
   update nudge_private.discovery_answers set response=coalesce(p_response,response),active=coalesce(p_active,active),revision=revision+1,updated_at=clock_timestamp() where id=a.id returning * into a;
   insert into nudge_private.discovery_answer_revisions(answer_id,user_id,revision,response,active) values(a.id,auth.uid(),a.revision,a.response,a.active);
 end if;
 update public.profiles set memory_generation=memory_generation+1 where id=auth.uid() returning memory_generation into v_generation;
 perform nudge_private.rebuild_discovery_evidence();
 result:=jsonb_build_object('saved',true,'generation',v_generation);
 insert into nudge_private.discovery_requests values(auth.uid(),p_request_id,p_generation,v_generation,digest,result,clock_timestamp());
 return result;
end $$;

create function public.reserve_discovery_question(p_request_id uuid,p_generation integer,p_question_id text,p_version integer,p_daily boolean default false,p_change boolean default false,p_reason text default 'coverage') returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.profiles%rowtype; existing nudge_private.discovery_exposures%rowtype; q jsonb; today date;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 select * into profile from public.profiles where id=auth.uid() for update;
 if p_generation is distinct from profile.memory_generation or p_request_id is null then raise sqlstate 'PT409' using message='Your memory changed. Reload questions.'; end if;
 today:=public.user_today(profile.timezone);
 select * into existing from nudge_private.discovery_exposures where user_id=auth.uid() and request_id=p_request_id;
 if found then return to_jsonb(existing); end if;
 if p_daily and not p_change then
   select * into existing from nudge_private.discovery_exposures where user_id=auth.uid() and local_day=today and daily and state<>'changed';
   if found then return to_jsonb(existing); end if;
 end if;
 if (select count(*) from nudge_private.discovery_exposures where user_id=auth.uid() and served_at>clock_timestamp()-interval '1 minute')>=60 then raise sqlstate 'PT429' using message='Take a moment before opening more questions'; end if;
 select definition into q from public.discovery_question_versions where question_id=p_question_id and version=p_version and definition->>'status'='published';
 if q is null or p_reason is null or p_reason not in ('coverage','explore','relevant') or p_daily is null or p_change is null then raise exception 'Unavailable question'; end if;
 if exists(select 1 from nudge_private.discovery_settings s where s.user_id=auth.uid() and (s.muted_topics ? (q->>'domain') or s.max_depth<(q->>'depth')::integer or (q->>'sensitivity'='optional' and not s.optional_topics) or (q->>'format'='text' and not s.written_answers)))
   or (not exists(select 1 from nudge_private.discovery_settings s where s.user_id=auth.uid()) and (q->>'sensitivity'='optional' or q->>'format'='text' or (q->>'depth')::integer>0)) then raise exception 'Question outside your selected settings'; end if;
 if p_change then update nudge_private.discovery_exposures set state='changed' where user_id=auth.uid() and local_day=today and daily and state<>'changed'; end if;
 insert into nudge_private.discovery_exposures(user_id,request_id,question_id,question_version,family_id,local_day,daily,reason,generation)
   values(auth.uid(),p_request_id,p_question_id,p_version,q->>'familyId',today,p_daily,p_reason,p_generation) returning * into existing;
 delete from nudge_private.discovery_exposures where user_id=auth.uid() and served_at<clock_timestamp()-interval '30 days';
 return to_jsonb(existing);
end $$;

create function public.save_discovery_preferences(p_generation integer,p_muted jsonb,p_optional boolean,p_depth integer,p_written boolean,p_metrics boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_generation integer;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 select memory_generation into v_generation from public.profiles where id=auth.uid() for update;
 if p_generation is distinct from v_generation then raise sqlstate 'PT409' using message='Your memory changed. Reload settings.'; end if;
 if jsonb_typeof(p_muted) is distinct from 'array' or jsonb_array_length(p_muted)>18 or exists(select 1 from jsonb_array_elements_text(p_muted) x where x not in ('rest','time','values','relationships','work','learning','money','food','culture','play','creativity','childhood','uncertainty','community','places','movement','digital','future')) or p_depth is null or p_depth not between 0 and 2 or p_optional is null or p_written is null or p_metrics is null then raise exception 'Invalid discovery settings'; end if;
 insert into nudge_private.discovery_settings(user_id,muted_topics,optional_topics,max_depth,written_answers,metrics_enabled) values(auth.uid(),p_muted,p_optional,p_depth,p_written,p_metrics)
 on conflict(user_id) do update set muted_topics=excluded.muted_topics,optional_topics=excluded.optional_topics,max_depth=excluded.max_depth,written_answers=excluded.written_answers,metrics_enabled=excluded.metrics_enabled,updated_at=clock_timestamp();
 if not p_metrics then delete from nudge_private.discovery_metrics where user_id=auth.uid(); end if;
 update nudge_private.discovery_exposures e set state='changed' from public.discovery_question_versions q
 where e.user_id=auth.uid() and e.state='served' and q.question_id=e.question_id and q.version=e.question_version
 and (p_muted ? (q.definition->>'domain') or (q.definition->>'depth')::integer>p_depth or (q.definition->>'sensitivity'='optional' and not p_optional) or (q.definition->>'format'='text' and not p_written));
end $$;

create function public.save_discovery_feedback(p_request_id uuid,p_generation integer,p_insight_id text,p_feedback text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_generation integer; prior nudge_private.discovery_requests%rowtype; digest text; result jsonb;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 select memory_generation into v_generation from public.profiles where id=auth.uid() for update;
 digest:=md5(jsonb_build_array('feedback',p_insight_id,p_feedback)::text);
 select * into prior from nudge_private.discovery_requests where user_id=auth.uid() and request_id=p_request_id;
 if found then
   if prior.intent_hash<>digest or prior.result_generation<>v_generation or prior.expected_generation<>p_generation then raise sqlstate 'PT409' using message='This feedback no longer matches'; end if;
   return prior.result;
 end if;
 if p_generation is distinct from v_generation or p_request_id is null then raise sqlstate 'PT409' using message='Your memory changed. Reload the reflection.'; end if;
 if p_feedback is null or p_feedback not in ('fits','sometimes','not_me') or p_insight_id is null or length(p_insight_id) not between 1 and 1000 then raise exception 'Invalid feedback'; end if;
 insert into nudge_private.discovery_feedback values(auth.uid(),p_insight_id,p_feedback,clock_timestamp()) on conflict(user_id,insight_id) do update set feedback=excluded.feedback,updated_at=excluded.updated_at;
 result:=jsonb_build_object('saved',true,'generation',v_generation);
 insert into nudge_private.discovery_requests values(auth.uid(),p_request_id,p_generation,v_generation,digest,result,clock_timestamp());
 if exists(select 1 from nudge_private.discovery_settings where user_id=auth.uid() and metrics_enabled) then insert into nudge_private.discovery_metrics(user_id,event) values(auth.uid(),'reflection_feedback'); end if;
 return result;
end $$;

create function public.export_discovery_data(p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 if p_offset<0 or p_offset>1000000 then raise exception 'Invalid export offset'; end if;
 return jsonb_build_object(
 'answers',coalesce((select jsonb_agg(to_jsonb(t)) from(select * from nudge_private.discovery_answers where user_id=auth.uid() order by id limit 200 offset p_offset)t),'[]'),
 'revisions',coalesce((select jsonb_agg(to_jsonb(t)) from(select * from nudge_private.discovery_answer_revisions where user_id=auth.uid() order by answer_id,revision limit 200 offset p_offset)t),'[]'),
 'exposures',coalesce((select jsonb_agg(to_jsonb(t)) from(select * from nudge_private.discovery_exposures where user_id=auth.uid() order by id limit 200 offset p_offset)t),'[]'),
 'feedback',coalesce((select jsonb_agg(to_jsonb(t)) from(select * from nudge_private.discovery_feedback where user_id=auth.uid() order by insight_id limit 200 offset p_offset)t),'[]'),
 'settings',coalesce((select jsonb_agg(to_jsonb(t)) from(select * from nudge_private.discovery_settings where user_id=auth.uid() order by user_id limit 200 offset p_offset)t),'[]'),
 'metrics',coalesce((select jsonb_agg(to_jsonb(t)) from(select * from nudge_private.discovery_metrics where user_id=auth.uid() order by id limit 200 offset p_offset)t),'[]'));
end $$;
create function public.prune_discovery_activity() returns void language plpgsql security definer set search_path='' as $$
begin
 delete from nudge_private.discovery_exposures where served_at<clock_timestamp()-interval '30 days';
 delete from nudge_private.discovery_metrics where created_at<clock_timestamp()-interval '30 days';
 delete from nudge_private.discovery_requests where created_at<clock_timestamp()-interval '30 days';
end $$;
revoke all on function public.prune_discovery_activity() from public,anon,authenticated;
grant execute on function public.prune_discovery_activity() to service_role;
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   perform cron.schedule('nudge-discovery-retention','45 3 * * *','select public.prune_discovery_activity();');
 end if;
end $$;
do $$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
   (n.nspname='nudge_private' and p.proname in ('discovery_rule_key','validate_discovery_response','rebuild_discovery_evidence','purge_discovery_on_privacy_change','withdraw_forgotten_discovery_answer')) or
   (n.nspname='public' and p.proname in ('read_discovery_state','save_discovery_answers','edit_discovery_answer','reserve_discovery_question','save_discovery_preferences','save_discovery_feedback','export_discovery_data')) loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
   if f::text not like 'nudge_private.%' then execute format('grant execute on function %s to authenticated',f); end if;
 end loop;
end $$;
create function nudge_private.self_discovery_version() returns integer language sql immutable as $$ select 1 $$;
revoke all on function nudge_private.self_discovery_version() from public,anon,authenticated;

$migration_15$;
  end if;
  if to_regprocedure('nudge_private.discovery_catalog_version()') is null then
    execute $migration_16$
-- Generated by discovery-build-seed.mjs. Immutable, versioned question definitions.

insert into public.discovery_question_versions(question_id,version,definition) values
('rest-break',1,'{"id":"rest-break","version":1,"familyId":"rest-break","domain":"rest","subdomain":"breaks","prompt":"A busy day gives you 20 minutes back. What sounds best?","format":"choice","choices":[{"id":"a","label":"Quiet music"},{"id":"b","label":"A chat with someone familiar"},{"id":"c","label":"A tiny hands-on project"},{"id":"d","label":"A little fresh air"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"preview":true,"signals":[{"optionId":"a","attributeKey":"rest.break.setting","value":"quiet_music","statement":"You chose quiet music for a break after a busy day.","scope":"a short break after a busy day","kind":"preference","strength":"direct"},{"optionId":"c","attributeKey":"rest.break.setting","value":"hands_on","statement":"You chose a tiny hands-on project for a break.","scope":"a short break after a busy day","kind":"preference","strength":"direct"}]}'::jsonb),
('rest-evening',1,'{"id":"rest-evening","version":1,"familyId":"rest-evening","domain":"rest","subdomain":"stimulation","prompt":"For a relaxed evening, where is your sweet spot?","format":"scale","purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":15,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"scale":{"min":1,"max":5,"step":1,"minLabel":"Very little going on","maxLabel":"A little buzz around me"}}'::jsonb),
('time-free-day',1,'{"id":"time-free-day","version":1,"familyId":"time-free-day","domain":"time","subdomain":"planning","prompt":"Tomorrow is unexpectedly free. Pick your kind of plan.","format":"choice","choices":[{"id":"a","label":"One thing to look forward to, rest open"},{"id":"b","label":"A few things lined up"},{"id":"c","label":"Decide when I wake up"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"preview":true,"signals":[{"optionId":"a","attributeKey":"time.free_day.plan","value":"one_anchor","statement":"You chose one planned activity with room around it.","scope":"an unexpectedly free day","kind":"preference","strength":"direct","criterion":{"label":"Flexibility","decisionDomains":["travel","lifestyle","hobbies"]}},{"optionId":"b","attributeKey":"time.free_day.plan","value":"several_plans","statement":"You chose a few things lined up for a free day.","scope":"an unexpectedly free day","kind":"preference","strength":"direct"},{"optionId":"c","attributeKey":"time.free_day.plan","value":"spontaneous","statement":"You chose to decide when the free day starts.","scope":"an unexpectedly free day","kind":"preference","strength":"direct","criterion":{"label":"Flexibility","decisionDomains":["travel","lifestyle","hobbies"]}}]}'::jsonb),
('time-afternoon',1,'{"id":"time-afternoon","version":1,"familyId":"time-afternoon","domain":"time","subdomain":"priorities","prompt":"What would make a free afternoon feel well used? Rank up to two.","format":"ranking","choices":[{"id":"a","label":"Rest"},{"id":"b","label":"Finish one lingering task"},{"id":"c","label":"Spend time with someone"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":25,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"ranking":{"min":1,"max":2,"allowTies":true}}'::jsonb),
('values-upgrade',1,'{"id":"values-upgrade","version":1,"familyId":"values-upgrade","domain":"values","subdomain":"tradeoffs","prompt":"A service you use offers one free upgrade. Which would you take?","format":"choice","choices":[{"id":"a","label":"Less waiting"},{"id":"b","label":"More choice"},{"id":"c","label":"More dependable results"},{"id":"d","label":"Easier help when something goes wrong"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"service.priority","value":"less_waiting","statement":"You chose less waiting as a service upgrade.","scope":"a service upgrade","kind":"preference","strength":"direct","criterion":{"label":"Waiting time","decisionDomains":["shopping","travel"]}},{"optionId":"c","attributeKey":"service.priority","value":"dependability","statement":"You chose more dependable results as a service upgrade.","scope":"a service upgrade","kind":"preference","strength":"direct","criterion":{"label":"Dependability","decisionDomains":["shopping","work"]}}]}'::jsonb),
('values-friction',1,'{"id":"values-friction","version":1,"familyId":"values-friction","domain":"values","subdomain":"friction","prompt":"What tiny inconvenience are you surprisingly unwilling to put up with?","format":"text","purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":30,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('relationships-support',1,'{"id":"relationships-support","version":1,"familyId":"relationships-support","domain":"relationships","subdomain":"support","prompt":"A friend says, “Today was a lot.” What would you offer first?","format":"choice","choices":[{"id":"a","label":"Listen"},{"id":"b","label":"A practical hand"},{"id":"c","label":"A distraction"},{"id":"d","label":"Ask what would help"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('relationships-notice',1,'{"id":"relationships-notice","version":1,"familyId":"relationships-notice","domain":"relationships","subdomain":"scheduling","prompt":"For a casual catch-up, how much advance notice feels good?","format":"scale","purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":15,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"scale":{"min":1,"max":5,"step":1,"minLabel":"Same-day is fine","maxLabel":"A few days ahead"}}'::jsonb),
('learning-puzzle',1,'{"id":"learning-puzzle","version":1,"familyId":"learning-puzzle","domain":"learning","subdomain":"starting","prompt":"You find a puzzle box with no obvious opening. Your first move?","format":"choice","choices":[{"id":"a","label":"Try one small thing"},{"id":"b","label":"Look for an example"},{"id":"c","label":"Ask for a hint"},{"id":"d","label":"Study it for a moment"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"preview":true,"signals":[{"optionId":"a","attributeKey":"learning.starting.method","value":"small_experiment","statement":"You chose a small first attempt with the unfamiliar puzzle.","scope":"an unfamiliar low-stakes puzzle","kind":"preference","strength":"direct","criterion":{"label":"Chance to try a small example","decisionDomains":["learning","hobbies"]}},{"optionId":"b","attributeKey":"learning.starting.method","value":"example","statement":"You chose to look for an example before opening the puzzle.","scope":"an unfamiliar low-stakes puzzle","kind":"preference","strength":"direct","criterion":{"label":"Worked examples","decisionDomains":["learning"]}},{"optionId":"c","attributeKey":"learning.starting.method","value":"hint","statement":"You chose to ask for a hint with an unfamiliar puzzle.","scope":"an unfamiliar low-stakes puzzle","kind":"preference","strength":"direct"},{"optionId":"d","attributeKey":"learning.starting.method","value":"study","statement":"You chose to study the puzzle before trying it.","scope":"an unfamiliar low-stakes puzzle","kind":"preference","strength":"direct"}]}'::jsonb),
('work-focus',1,'{"id":"work-focus","version":1,"familyId":"work-focus","domain":"work","subdomain":"focus","prompt":"For an hour of work or study, rank the two things that help most.","format":"ranking","choices":[{"id":"a","label":"Quiet"},{"id":"b","label":"A clear brief"},{"id":"c","label":"Someone to ask"},{"id":"d","label":"Control over the pace"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":25,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"work.focus.support","value":"quiet","statement":"You ranked quiet among your first priorities for focused work.","scope":"focused work or study","kind":"preference","strength":"direct","criterion":{"label":"Quiet surroundings","decisionDomains":["work","career","learning"]}},{"optionId":"b","attributeKey":"work.focus.support","value":"clear_brief","statement":"You ranked a clear brief among your first priorities for focused work.","scope":"focused work or study","kind":"preference","strength":"direct","criterion":{"label":"Clear expectations","decisionDomains":["work","career","learning"]}},{"optionId":"d","attributeKey":"work.focus.support","value":"pace","statement":"You ranked control over the pace among your first priorities.","scope":"focused work or study","kind":"preference","strength":"direct","criterion":{"label":"Control over the pace","decisionDomains":["work","career","learning"]}}],"ranking":{"min":1,"max":2,"allowTies":true}}'::jsonb),
('work-before-group',1,'{"id":"work-before-group","version":1,"familyId":"work-before-group","domain":"work","subdomain":"collaboration","prompt":"What makes a group task feel easier before anyone even starts?","format":"text","purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":30,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('money-broken-item',1,'{"id":"money-broken-item","version":1,"familyId":"money-broken-item","domain":"money","subdomain":"purchasing","prompt":"An everyday item breaks. If each option is practical, which would you explore first?","format":"choice","choices":[{"id":"a","label":"Repair"},{"id":"b","label":"Borrow"},{"id":"c","label":"Buy used"},{"id":"d","label":"Buy new"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"shopping.replacement.approach","value":"repair","statement":"You chose to explore repair first when an everyday item breaks.","scope":"replacing a broken everyday item","kind":"preference","strength":"direct","criterion":{"label":"Repairability","decisionDomains":["shopping"]}},{"optionId":"c","attributeKey":"shopping.replacement.approach","value":"used","statement":"You chose to explore buying used first.","scope":"replacing a broken everyday item","kind":"preference","strength":"direct","criterion":{"label":"Availability used","decisionDomains":["shopping"]}}]}'::jsonb),
('food-snack',1,'{"id":"food-snack","version":1,"familyId":"food-snack","domain":"food","subdomain":"novelty","prompt":"A café offers two equally appealing snacks. Which gets your vote?","format":"choice","choices":[{"id":"a","label":"My favorite, made really well"},{"id":"b","label":"A combination I have never tried"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["both","depends","neither","skip"],"review":{"type":"authored_seed","version":1},"preview":true,"signals":[{"optionId":"a","attributeKey":"food.snack.familiarity","value":"familiar","statement":"You chose a familiar favorite for the café snack.","scope":"two equally appealing café snacks","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"food.snack.familiarity","value":"new","statement":"You chose a new combination for the café snack.","scope":"two equally appealing café snacks","kind":"preference","strength":"direct"}]}'::jsonb),
('food-texture',1,'{"id":"food-texture","version":1,"familyId":"food-texture","domain":"food","subdomain":"texture","prompt":"Pick the texture you are in the mood for.","format":"scale","purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":15,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"scale":{"min":1,"max":5,"step":1,"minLabel":"Smooth and soft","maxLabel":"Crisp and crunchy"}}'::jsonb),
('culture-spare-hour',1,'{"id":"culture-spare-hour","version":1,"familyId":"culture-spare-hour","domain":"culture","subdomain":"exploration","prompt":"You have a spare hour somewhere unfamiliar. What would you look for?","format":"choice","choices":[{"id":"a","label":"Local music"},{"id":"b","label":"A food market"},{"id":"c","label":"A small museum"},{"id":"d","label":"Ordinary streets and shops"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('culture-tradition',1,'{"id":"culture-tradition","version":1,"familyId":"culture-tradition","domain":"culture","subdomain":"traditions","prompt":"Is there a small tradition you enjoy keeping—or inventing? “None” is fine.","format":"text","purpose":"evidence","depth":0,"sensitivity":"optional","estimatedSeconds":30,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('play-humor',1,'{"id":"play-humor","version":1,"familyId":"play-humor","domain":"play","subdomain":"humor","prompt":"Which joke is more likely to get you?","format":"choice","choices":[{"id":"a","label":"A painfully good pun"},{"id":"b","label":"A completely absurd situation"}],"purpose":"playful","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["both","depends","neither","skip"],"review":{"type":"authored_seed","version":1},"preview":true}'::jsonb),
('play-group-game',1,'{"id":"play-group-game","version":1,"familyId":"play-group-game","domain":"play","subdomain":"cooperation","prompt":"Your group is choosing a game. Which promise sounds better tonight?","format":"choice","choices":[{"id":"a","label":"We solve something together"},{"id":"b","label":"We try to outsmart each other"},{"id":"c","label":"We make something ridiculous"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('creativity-postcard',1,'{"id":"creativity-postcard","version":1,"familyId":"creativity-postcard","domain":"creativity","subdomain":"starting","prompt":"You are making a postcard for fun. Where do you start?","format":"choice","choices":[{"id":"a","label":"A messy sketch"},{"id":"b","label":"A color I like"},{"id":"c","label":"A reference to borrow from"},{"id":"d","label":"A message to build around"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"preview":true,"signals":[{"optionId":"a","attributeKey":"creativity.starting.method","value":"rough_attempt","statement":"You chose a messy sketch to begin the postcard.","scope":"starting a playful postcard","kind":"preference","strength":"direct","criterion":{"label":"Room for a rough first attempt","decisionDomains":["hobbies","learning"]}},{"optionId":"b","attributeKey":"creativity.starting.method","value":"color","statement":"You chose a color as the starting point for the postcard.","scope":"starting a playful postcard","kind":"preference","strength":"direct"},{"optionId":"c","attributeKey":"creativity.starting.method","value":"reference","statement":"You chose a reference as the starting point for the postcard.","scope":"starting a playful postcard","kind":"preference","strength":"direct"},{"optionId":"d","attributeKey":"creativity.starting.method","value":"message","statement":"You chose a message as the starting point for the postcard.","scope":"starting a playful postcard","kind":"preference","strength":"direct"}]}'::jsonb),
('creativity-box',1,'{"id":"creativity-box","version":1,"familyId":"creativity-box","domain":"creativity","subdomain":"making","prompt":"Give an ordinary cardboard box a second career. What does it become?","format":"text","purpose":"playful","depth":0,"sensitivity":"ordinary","estimatedSeconds":30,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('childhood-interest',1,'{"id":"childhood-interest","version":1,"familyId":"childhood-interest","domain":"childhood","subdomain":"interests","prompt":"What ordinary thing did you enjoy as a child that still sounds fun?","format":"text","purpose":"evidence","depth":1,"sensitivity":"optional","estimatedSeconds":30,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('childhood-revisit',1,'{"id":"childhood-revisit","version":1,"familyId":"childhood-revisit","domain":"childhood","subdomain":"change","prompt":"If you revisited an old hobby, what would appeal most?","format":"choice","choices":[{"id":"a","label":"The familiar feeling"},{"id":"b","label":"Seeing how I have changed"},{"id":"c","label":"Trying it a new way"},{"id":"d","label":"I would rather choose something new"}],"purpose":"evidence","depth":1,"sensitivity":"optional","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('uncertainty-first-step',1,'{"id":"uncertainty-first-step","version":1,"familyId":"uncertainty-first-step","domain":"uncertainty","subdomain":"support","prompt":"Trying an unfamiliar activity just for fun: what would make the first step easier?","format":"choice","choices":[{"id":"a","label":"A tiny practice run"},{"id":"b","label":"A familiar person"},{"id":"c","label":"Watching once"},{"id":"d","label":"Clear instructions"}],"purpose":"evidence","depth":0,"sensitivity":"optional","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"learning.unfamiliar.support","value":"practice","statement":"You chose a tiny practice run to begin an unfamiliar activity.","scope":"trying an unfamiliar activity for fun","kind":"preference","strength":"direct","criterion":{"label":"A low-stakes trial","decisionDomains":["hobbies","learning"]}},{"optionId":"d","attributeKey":"learning.unfamiliar.support","value":"instructions","statement":"You chose clear instructions to begin an unfamiliar activity.","scope":"trying an unfamiliar activity for fun","kind":"preference","strength":"direct","criterion":{"label":"Clear instructions","decisionDomains":["hobbies","learning"]}}]}'::jsonb),
('uncertainty-day-out',1,'{"id":"uncertainty-day-out","version":1,"familyId":"uncertainty-day-out","domain":"uncertainty","subdomain":"surprise","prompt":"For a low-stakes day out, how much surprise is welcome?","format":"scale","purpose":"evidence","depth":0,"sensitivity":"optional","estimatedSeconds":15,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"scale":{"min":1,"max":5,"step":1,"minLabel":"Tell me the plan","maxLabel":"Leave plenty to discover"}}'::jsonb),
('community-quiet-seat',1,'{"id":"community-quiet-seat","version":1,"familyId":"community-quiet-seat","domain":"community","subdomain":"fairness","prompt":"Three friends want the one quiet seat on a trip. What seems like the best starting rule?","format":"choice","choices":[{"id":"a","label":"Take turns"},{"id":"b","label":"Draw lots"},{"id":"c","label":"Ask who needs it most"},{"id":"d","label":"Talk it through"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('community-role',1,'{"id":"community-role","version":1,"familyId":"community-role","domain":"community","subdomain":"contribution","prompt":"At a friendly event, which small role would you enjoy?","format":"choice","choices":[{"id":"a","label":"Welcome people"},{"id":"b","label":"Set things up"},{"id":"c","label":"Show someone how something works"},{"id":"d","label":"Help quietly in the background"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('places-afternoon',1,'{"id":"places-afternoon","version":1,"familyId":"places-afternoon","domain":"places","subdomain":"comfort","prompt":"For a place to spend an afternoon, rank your top two.","format":"ranking","choices":[{"id":"a","label":"Quiet"},{"id":"b","label":"Easy to reach"},{"id":"c","label":"Interesting things nearby"},{"id":"d","label":"Comfortable seating"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":25,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"places.afternoon.priority","value":"quiet","statement":"You ranked quiet among your first priorities for an afternoon place.","scope":"choosing an afternoon place","kind":"preference","strength":"direct","criterion":{"label":"Quiet surroundings","decisionDomains":["travel","lifestyle"]}},{"optionId":"b","attributeKey":"places.afternoon.priority","value":"access","statement":"You ranked easy access among your first priorities for an afternoon place.","scope":"choosing an afternoon place","kind":"preference","strength":"direct","criterion":{"label":"Ease of getting there","decisionDomains":["travel","lifestyle"]}},{"optionId":"d","attributeKey":"places.afternoon.priority","value":"seating","statement":"You ranked comfortable seating among your first priorities.","scope":"choosing an afternoon place","kind":"preference","strength":"direct","criterion":{"label":"Comfortable seating","decisionDomains":["travel","lifestyle"]}}],"ranking":{"min":1,"max":2,"allowTies":true}}'::jsonb),
('movement-change',1,'{"id":"movement-change","version":1,"familyId":"movement-change","domain":"movement","subdomain":"comfort","prompt":"For a short change of pace, what sounds comfortable today?","format":"choice","choices":[{"id":"a","label":"A gentle stretch"},{"id":"b","label":"A short walk if practical"},{"id":"c","label":"Moving to some music"},{"id":"d","label":"Staying still and resting"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('digital-quiet-minutes',1,'{"id":"digital-quiet-minutes","version":1,"familyId":"digital-quiet-minutes","domain":"digital","subdomain":"attention","prompt":"You get 40 notification-free minutes. How would you like to keep them?","format":"choice","choices":[{"id":"a","label":"Silence everything"},{"id":"b","label":"Let chosen people through"},{"id":"c","label":"Check once halfway"},{"id":"d","label":"I do not need that today"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('future-room',1,'{"id":"future-room","version":1,"familyId":"future-room","domain":"future","subdomain":"goals","prompt":"What would you like to make a little more room for next month?","format":"text","purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":30,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('future-small-progress',1,'{"id":"future-small-progress","version":1,"familyId":"future-small-progress","domain":"future","subdomain":"progress","prompt":"A personal project is moving slowly. What would count as a good next step?","format":"choice","choices":[{"id":"a","label":"Try a tiny version"},{"id":"b","label":"Set aside a regular slot"},{"id":"c","label":"Ask one useful question"},{"id":"d","label":"Decide whether I still want it"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('future-experiment',1,'{"id":"future-experiment","version":1,"familyId":"future-experiment","domain":"future","subdomain":"experiments","prompt":"You have an idea for a new hobby. What would you try before making a bigger commitment?","format":"choice","choices":[{"id":"a","label":"Borrow the equipment"},{"id":"b","label":"Join one beginner session"},{"id":"c","label":"Watch someone do it"},{"id":"d","label":"Set up a short experiment at home"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1}}'::jsonb),
('existing-food-root',1,'{"id":"existing-food-root","version":1,"familyId":"existing-food-root","domain":"food","subdomain":"food","prompt":"When dinner feels repetitive, what would improve it most?","format":"choice","choices":[{"id":"a","label":"Try a new cuisine"},{"id":"b","label":"Perfect a familiar favourite"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:food"],"legacyQuestionId":"864e15d5-2a30-4c82-a70c-56c31096d62a","signals":[{"optionId":"a","attributeKey":"discovery.food.root","value":"a","statement":"For “When dinner feels repetitive, what would improve it most?”, you chose “Try a new cuisine”.","scope":"When dinner feels repetitive, what would improve it most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.food.root","value":"b","statement":"For “When dinner feels repetitive, what would improve it most?”, you chose “Perfect a familiar favourite”.","scope":"When dinner feels repetitive, what would improve it most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-food-a',1,'{"id":"existing-food-a","version":1,"familyId":"existing-food-a","domain":"food","subdomain":"food","prompt":"For a new cuisine, how would you like to start?","format":"choice","choices":[{"id":"a","label":"Follow a simple recipe"},{"id":"b","label":"Taste it at a restaurant"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:food"],"legacyQuestionId":"f0d94c8f-72ee-48af-a785-d4733380b359","signals":[{"optionId":"a","attributeKey":"discovery.food.a","value":"a","statement":"For “For a new cuisine, how would you like to start?”, you chose “Follow a simple recipe”.","scope":"For a new cuisine, how would you like to start?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.food.a","value":"b","statement":"For “For a new cuisine, how would you like to start?”, you chose “Taste it at a restaurant”.","scope":"For a new cuisine, how would you like to start?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-food-b',1,'{"id":"existing-food-b","version":1,"familyId":"existing-food-b","domain":"food","subdomain":"food","prompt":"When improving a familiar meal, what matters more?","format":"choice","choices":[{"id":"a","label":"Better flavour"},{"id":"b","label":"Less preparation"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:food"],"legacyQuestionId":"e60502ee-0eed-409a-accd-c2bbd427638c","signals":[{"optionId":"a","attributeKey":"discovery.food.b","value":"a","statement":"For “When improving a familiar meal, what matters more?”, you chose “Better flavour”.","scope":"When improving a familiar meal, what matters more?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.food.b","value":"b","statement":"For “When improving a familiar meal, what matters more?”, you chose “Less preparation”.","scope":"When improving a familiar meal, what matters more?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-food-aa',1,'{"id":"existing-food-aa","version":1,"familyId":"existing-food-aa","domain":"food","subdomain":"food","prompt":"A new recipe has an unfamiliar ingredient. What helps you try it?","format":"choice","choices":[{"id":"a","label":"An easy substitution"},{"id":"b","label":"A small trial batch"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:food"],"legacyQuestionId":"9e9e62a0-004e-45bc-a0d5-a5897d652864","signals":[{"optionId":"a","attributeKey":"discovery.food.aa","value":"a","statement":"For “A new recipe has an unfamiliar ingredient. What helps you try it?”, you chose “An easy substitution”.","scope":"A new recipe has an unfamiliar ingredient. What helps you try it?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.food.aa","value":"b","statement":"For “A new recipe has an unfamiliar ingredient. What helps you try it?”, you chose “A small trial batch”.","scope":"A new recipe has an unfamiliar ingredient. What helps you try it?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-food-ab',1,'{"id":"existing-food-ab","version":1,"familyId":"existing-food-ab","domain":"food","subdomain":"food","prompt":"What makes a restaurant food adventure enjoyable?","format":"choice","choices":[{"id":"a","label":"A trusted recommendation"},{"id":"b","label":"Choosing something on impulse"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:food"],"legacyQuestionId":"e72bdb3b-229f-4ab0-aeff-6a9f23ed92bf","signals":[{"optionId":"a","attributeKey":"discovery.food.ab","value":"a","statement":"For “What makes a restaurant food adventure enjoyable?”, you chose “A trusted recommendation”.","scope":"What makes a restaurant food adventure enjoyable?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.food.ab","value":"b","statement":"For “What makes a restaurant food adventure enjoyable?”, you chose “Choosing something on impulse”.","scope":"What makes a restaurant food adventure enjoyable?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-food-ba',1,'{"id":"existing-food-ba","version":1,"familyId":"existing-food-ba","domain":"food","subdomain":"food","prompt":"What would you change first in your favourite meal?","format":"choice","choices":[{"id":"a","label":"Seasoning and texture"},{"id":"b","label":"Ingredient quality"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:food"],"legacyQuestionId":"6bb9fbce-b6c8-4d21-a25f-ce9ed10577c8","signals":[{"optionId":"a","attributeKey":"discovery.food.ba","value":"a","statement":"For “What would you change first in your favourite meal?”, you chose “Seasoning and texture”.","scope":"What would you change first in your favourite meal?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.food.ba","value":"b","statement":"For “What would you change first in your favourite meal?”, you chose “Ingredient quality”.","scope":"What would you change first in your favourite meal?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-food-bb',1,'{"id":"existing-food-bb","version":1,"familyId":"existing-food-bb","domain":"food","subdomain":"food","prompt":"For an easier familiar meal, which shortcut suits you?","format":"choice","choices":[{"id":"a","label":"Prepare components ahead"},{"id":"b","label":"Cook everything in one pan"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:food"],"legacyQuestionId":"fef5f8c0-f85a-475d-ae8c-f233fe1b814a","signals":[{"optionId":"a","attributeKey":"discovery.food.bb","value":"a","statement":"For “For an easier familiar meal, which shortcut suits you?”, you chose “Prepare components ahead”.","scope":"For an easier familiar meal, which shortcut suits you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.food.bb","value":"b","statement":"For “For an easier familiar meal, which shortcut suits you?”, you chose “Cook everything in one pan”.","scope":"For an easier familiar meal, which shortcut suits you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-movies-root',1,'{"id":"existing-movies-root","version":1,"familyId":"existing-movies-root","domain":"culture","subdomain":"movies","prompt":"You have an evening free for a film. What are you looking for?","format":"choice","choices":[{"id":"a","label":"A comforting story"},{"id":"b","label":"Something that surprises me"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:movies"],"legacyQuestionId":"60e4f098-cd74-468b-ac8f-c00bcb8097c3","signals":[{"optionId":"a","attributeKey":"discovery.movies.root","value":"a","statement":"For “You have an evening free for a film. What are you looking for?”, you chose “A comforting story”.","scope":"You have an evening free for a film. What are you looking for?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.movies.root","value":"b","statement":"For “You have an evening free for a film. What are you looking for?”, you chose “Something that surprises me”.","scope":"You have an evening free for a film. What are you looking for?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-movies-a',1,'{"id":"existing-movies-a","version":1,"familyId":"existing-movies-a","domain":"culture","subdomain":"movies","prompt":"What makes a comforting film worth rewatching?","format":"choice","choices":[{"id":"a","label":"Characters I care about"},{"id":"b","label":"A familiar atmosphere"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:movies"],"legacyQuestionId":"e02a474b-f9f0-404d-aae5-7eb9036229a1","signals":[{"optionId":"a","attributeKey":"discovery.movies.a","value":"a","statement":"For “What makes a comforting film worth rewatching?”, you chose “Characters I care about”.","scope":"What makes a comforting film worth rewatching?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.movies.a","value":"b","statement":"For “What makes a comforting film worth rewatching?”, you chose “A familiar atmosphere”.","scope":"What makes a comforting film worth rewatching?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-movies-b',1,'{"id":"existing-movies-b","version":1,"familyId":"existing-movies-b","domain":"culture","subdomain":"movies","prompt":"What kind of surprise makes a film memorable?","format":"choice","choices":[{"id":"a","label":"An unexpected idea"},{"id":"b","label":"A clever plot turn"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:movies"],"legacyQuestionId":"6f2ebe83-fed4-4ebd-a16c-13aa5e335071","signals":[{"optionId":"a","attributeKey":"discovery.movies.b","value":"a","statement":"For “What kind of surprise makes a film memorable?”, you chose “An unexpected idea”.","scope":"What kind of surprise makes a film memorable?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.movies.b","value":"b","statement":"For “What kind of surprise makes a film memorable?”, you chose “A clever plot turn”.","scope":"What kind of surprise makes a film memorable?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-movies-aa',1,'{"id":"existing-movies-aa","version":1,"familyId":"existing-movies-aa","domain":"culture","subdomain":"movies","prompt":"For character-driven films, what holds your attention?","format":"choice","choices":[{"id":"a","label":"Honest conversation"},{"id":"b","label":"People changing over time"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:movies"],"legacyQuestionId":"c2104831-f92e-4aa9-a67b-9961677eb210","signals":[{"optionId":"a","attributeKey":"discovery.movies.aa","value":"a","statement":"For “For character-driven films, what holds your attention?”, you chose “Honest conversation”.","scope":"For character-driven films, what holds your attention?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.movies.aa","value":"b","statement":"For “For character-driven films, what holds your attention?”, you chose “People changing over time”.","scope":"For character-driven films, what holds your attention?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-movies-ab',1,'{"id":"existing-movies-ab","version":1,"familyId":"existing-movies-ab","domain":"culture","subdomain":"movies","prompt":"Which familiar film atmosphere helps you unwind?","format":"choice","choices":[{"id":"a","label":"Gentle humour"},{"id":"b","label":"A warm sense of place"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:movies"],"legacyQuestionId":"2d9bfe3d-019a-4d81-a175-0eb4774b40f5","signals":[{"optionId":"a","attributeKey":"discovery.movies.ab","value":"a","statement":"For “Which familiar film atmosphere helps you unwind?”, you chose “Gentle humour”.","scope":"Which familiar film atmosphere helps you unwind?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.movies.ab","value":"b","statement":"For “Which familiar film atmosphere helps you unwind?”, you chose “A warm sense of place”.","scope":"Which familiar film atmosphere helps you unwind?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-movies-ba',1,'{"id":"existing-movies-ba","version":1,"familyId":"existing-movies-ba","domain":"culture","subdomain":"movies","prompt":"After a thought-provoking film, what do you enjoy?","format":"choice","choices":[{"id":"a","label":"Discussing the ideas"},{"id":"b","label":"Reflecting on my own"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:movies"],"legacyQuestionId":"8c66cbb2-25bf-4f41-aa45-b22b00fe20e6","signals":[{"optionId":"a","attributeKey":"discovery.movies.ba","value":"a","statement":"For “After a thought-provoking film, what do you enjoy?”, you chose “Discussing the ideas”.","scope":"After a thought-provoking film, what do you enjoy?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.movies.ba","value":"b","statement":"For “After a thought-provoking film, what do you enjoy?”, you chose “Reflecting on my own”.","scope":"After a thought-provoking film, what do you enjoy?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-movies-bb',1,'{"id":"existing-movies-bb","version":1,"familyId":"existing-movies-bb","domain":"culture","subdomain":"movies","prompt":"With a twisty film, what feels most satisfying?","format":"choice","choices":[{"id":"a","label":"Working out the clues"},{"id":"b","label":"Being surprised at the end"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:movies"],"legacyQuestionId":"9a8fcf43-2864-497f-a986-52cb4c641bed","signals":[{"optionId":"a","attributeKey":"discovery.movies.bb","value":"a","statement":"For “With a twisty film, what feels most satisfying?”, you chose “Working out the clues”.","scope":"With a twisty film, what feels most satisfying?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.movies.bb","value":"b","statement":"For “With a twisty film, what feels most satisfying?”, you chose “Being surprised at the end”.","scope":"With a twisty film, what feels most satisfying?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-music-root',1,'{"id":"existing-music-root","version":1,"familyId":"existing-music-root","domain":"culture","subdomain":"music","prompt":"When you put on music, what do you usually want it to do?","format":"choice","choices":[{"id":"a","label":"Match how I feel"},{"id":"b","label":"Change my energy"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:music"],"legacyQuestionId":"9ac813f3-3a77-477c-af2e-bf8032c0160d","signals":[{"optionId":"a","attributeKey":"discovery.music.root","value":"a","statement":"For “When you put on music, what do you usually want it to do?”, you chose “Match how I feel”.","scope":"When you put on music, what do you usually want it to do?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.music.root","value":"b","statement":"For “When you put on music, what do you usually want it to do?”, you chose “Change my energy”.","scope":"When you put on music, what do you usually want it to do?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-music-a',1,'{"id":"existing-music-a","version":1,"familyId":"existing-music-a","domain":"culture","subdomain":"music","prompt":"What draws you into music that matches your mood?","format":"choice","choices":[{"id":"a","label":"The words"},{"id":"b","label":"The sound and texture"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:music"],"legacyQuestionId":"a68d12d4-4810-460a-a191-d9837101f6cc","signals":[{"optionId":"a","attributeKey":"discovery.music.a","value":"a","statement":"For “What draws you into music that matches your mood?”, you chose “The words”.","scope":"What draws you into music that matches your mood?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.music.a","value":"b","statement":"For “What draws you into music that matches your mood?”, you chose “The sound and texture”.","scope":"What draws you into music that matches your mood?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-music-b',1,'{"id":"existing-music-b","version":1,"familyId":"existing-music-b","domain":"culture","subdomain":"music","prompt":"To change your energy, which kind of listening helps?","format":"choice","choices":[{"id":"a","label":"An upbeat playlist"},{"id":"b","label":"A calm instrumental track"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:music"],"legacyQuestionId":"31fbdc44-eb50-4e10-a802-97dafcce1aee","signals":[{"optionId":"a","attributeKey":"discovery.music.b","value":"a","statement":"For “To change your energy, which kind of listening helps?”, you chose “An upbeat playlist”.","scope":"To change your energy, which kind of listening helps?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.music.b","value":"b","statement":"For “To change your energy, which kind of listening helps?”, you chose “A calm instrumental track”.","scope":"To change your energy, which kind of listening helps?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-music-aa',1,'{"id":"existing-music-aa","version":1,"familyId":"existing-music-aa","domain":"culture","subdomain":"music","prompt":"With meaningful lyrics, what connects most?","format":"choice","choices":[{"id":"a","label":"A story close to my life"},{"id":"b","label":"A new perspective"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:music"],"legacyQuestionId":"a7c90dfd-1d50-49c7-a3bb-244eda6bc6ec","signals":[{"optionId":"a","attributeKey":"discovery.music.aa","value":"a","statement":"For “With meaningful lyrics, what connects most?”, you chose “A story close to my life”.","scope":"With meaningful lyrics, what connects most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.music.aa","value":"b","statement":"For “With meaningful lyrics, what connects most?”, you chose “A new perspective”.","scope":"With meaningful lyrics, what connects most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-music-ab',1,'{"id":"existing-music-ab","version":1,"familyId":"existing-music-ab","domain":"culture","subdomain":"music","prompt":"For mood-matching sound, what do you reach for?","format":"choice","choices":[{"id":"a","label":"Acoustic and intimate"},{"id":"b","label":"Layered and atmospheric"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:music"],"legacyQuestionId":"f93ddbe4-6c8e-4f28-ad64-8ab6af71a3e9","signals":[{"optionId":"a","attributeKey":"discovery.music.ab","value":"a","statement":"For “For mood-matching sound, what do you reach for?”, you chose “Acoustic and intimate”.","scope":"For mood-matching sound, what do you reach for?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.music.ab","value":"b","statement":"For “For mood-matching sound, what do you reach for?”, you chose “Layered and atmospheric”.","scope":"For mood-matching sound, what do you reach for?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-music-ba',1,'{"id":"existing-music-ba","version":1,"familyId":"existing-music-ba","domain":"culture","subdomain":"music","prompt":"For an energy boost, how do you choose tracks?","format":"choice","choices":[{"id":"a","label":"Familiar favourites"},{"id":"b","label":"Fresh discoveries"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:music"],"legacyQuestionId":"e9be15d0-fb6f-4982-a3f1-e1e7da825b8c","signals":[{"optionId":"a","attributeKey":"discovery.music.ba","value":"a","statement":"For “For an energy boost, how do you choose tracks?”, you chose “Familiar favourites”.","scope":"For an energy boost, how do you choose tracks?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.music.ba","value":"b","statement":"For “For an energy boost, how do you choose tracks?”, you chose “Fresh discoveries”.","scope":"For an energy boost, how do you choose tracks?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-music-bb',1,'{"id":"existing-music-bb","version":1,"familyId":"existing-music-bb","domain":"culture","subdomain":"music","prompt":"For calmer listening, what helps you settle?","format":"choice","choices":[{"id":"a","label":"One album without interruptions"},{"id":"b","label":"A gentle mix of different artists"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:music"],"legacyQuestionId":"2a7b3655-0676-4fe3-ad35-1486f5875423","signals":[{"optionId":"a","attributeKey":"discovery.music.bb","value":"a","statement":"For “For calmer listening, what helps you settle?”, you chose “One album without interruptions”.","scope":"For calmer listening, what helps you settle?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.music.bb","value":"b","statement":"For “For calmer listening, what helps you settle?”, you chose “A gentle mix of different artists”.","scope":"For calmer listening, what helps you settle?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-travel-root',1,'{"id":"existing-travel-root","version":1,"familyId":"existing-travel-root","domain":"places","subdomain":"travel","prompt":"On a short trip, what would make the time feel well spent?","format":"choice","choices":[{"id":"a","label":"Explore a place deeply"},{"id":"b","label":"See several different places"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:travel"],"legacyQuestionId":"b803e67e-ddd1-4189-ac16-a1eb44fc367f","signals":[{"optionId":"a","attributeKey":"discovery.travel.root","value":"a","statement":"For “On a short trip, what would make the time feel well spent?”, you chose “Explore a place deeply”.","scope":"On a short trip, what would make the time feel well spent?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.travel.root","value":"b","statement":"For “On a short trip, what would make the time feel well spent?”, you chose “See several different places”.","scope":"On a short trip, what would make the time feel well spent?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-travel-a',1,'{"id":"existing-travel-a","version":1,"familyId":"existing-travel-a","domain":"places","subdomain":"travel","prompt":"To explore one place deeply, what would you prioritise?","format":"choice","choices":[{"id":"a","label":"Local everyday life"},{"id":"b","label":"Its history and landmarks"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:travel"],"legacyQuestionId":"4985720f-e24d-4b1a-a04f-c754af566250","signals":[{"optionId":"a","attributeKey":"discovery.travel.a","value":"a","statement":"For “To explore one place deeply, what would you prioritise?”, you chose “Local everyday life”.","scope":"To explore one place deeply, what would you prioritise?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.travel.a","value":"b","statement":"For “To explore one place deeply, what would you prioritise?”, you chose “Its history and landmarks”.","scope":"To explore one place deeply, what would you prioritise?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-travel-b',1,'{"id":"existing-travel-b","version":1,"familyId":"existing-travel-b","domain":"places","subdomain":"travel","prompt":"For a trip with several stops, what matters most?","format":"choice","choices":[{"id":"a","label":"Smooth transport"},{"id":"b","label":"Room for spontaneous detours"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:travel"],"legacyQuestionId":"7e68cdd1-c4b2-4542-aac2-e9ba8aae0b7b","signals":[{"optionId":"a","attributeKey":"discovery.travel.b","value":"a","statement":"For “For a trip with several stops, what matters most?”, you chose “Smooth transport”.","scope":"For a trip with several stops, what matters most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.travel.b","value":"b","statement":"For “For a trip with several stops, what matters most?”, you chose “Room for spontaneous detours”.","scope":"For a trip with several stops, what matters most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-travel-aa',1,'{"id":"existing-travel-aa","version":1,"familyId":"existing-travel-aa","domain":"places","subdomain":"travel","prompt":"How would you get closer to local everyday life?","format":"choice","choices":[{"id":"a","label":"Visit neighbourhood markets"},{"id":"b","label":"Join a small local activity"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:travel"],"legacyQuestionId":"caa1cd5f-e6fc-4a57-aa22-9bd58ea2cc29","signals":[{"optionId":"a","attributeKey":"discovery.travel.aa","value":"a","statement":"For “How would you get closer to local everyday life?”, you chose “Visit neighbourhood markets”.","scope":"How would you get closer to local everyday life?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.travel.aa","value":"b","statement":"For “How would you get closer to local everyday life?”, you chose “Join a small local activity”.","scope":"How would you get closer to local everyday life?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-travel-ab',1,'{"id":"existing-travel-ab","version":1,"familyId":"existing-travel-ab","domain":"places","subdomain":"travel","prompt":"At a historic site, how would you like to learn?","format":"choice","choices":[{"id":"a","label":"A guide who tells stories"},{"id":"b","label":"Explore at my own pace"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:travel"],"legacyQuestionId":"c96f7b50-c267-46d1-a4ac-9fa7426201fc","signals":[{"optionId":"a","attributeKey":"discovery.travel.ab","value":"a","statement":"For “At a historic site, how would you like to learn?”, you chose “A guide who tells stories”.","scope":"At a historic site, how would you like to learn?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.travel.ab","value":"b","statement":"For “At a historic site, how would you like to learn?”, you chose “Explore at my own pace”.","scope":"At a historic site, how would you like to learn?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-travel-ba',1,'{"id":"existing-travel-ba","version":1,"familyId":"existing-travel-ba","domain":"places","subdomain":"travel","prompt":"For easier travel between stops, what would you choose?","format":"choice","choices":[{"id":"a","label":"A direct route"},{"id":"b","label":"A scenic route with extra time"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:travel"],"legacyQuestionId":"1f2b6ad9-82f5-4896-a087-9d1c21814d20","signals":[{"optionId":"a","attributeKey":"discovery.travel.ba","value":"a","statement":"For “For easier travel between stops, what would you choose?”, you chose “A direct route”.","scope":"For easier travel between stops, what would you choose?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.travel.ba","value":"b","statement":"For “For easier travel between stops, what would you choose?”, you chose “A scenic route with extra time”.","scope":"For easier travel between stops, what would you choose?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-travel-bb',1,'{"id":"existing-travel-bb","version":1,"familyId":"existing-travel-bb","domain":"places","subdomain":"travel","prompt":"When making a spontaneous detour, what appeals most?","format":"choice","choices":[{"id":"a","label":"An unexpected natural spot"},{"id":"b","label":"A town I know little about"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:travel"],"legacyQuestionId":"b9d93119-3517-48bc-af01-b576187efa6f","signals":[{"optionId":"a","attributeKey":"discovery.travel.bb","value":"a","statement":"For “When making a spontaneous detour, what appeals most?”, you chose “An unexpected natural spot”.","scope":"When making a spontaneous detour, what appeals most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.travel.bb","value":"b","statement":"For “When making a spontaneous detour, what appeals most?”, you chose “A town I know little about”.","scope":"When making a spontaneous detour, what appeals most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-shopping-root',1,'{"id":"existing-shopping-root","version":1,"familyId":"existing-shopping-root","domain":"money","subdomain":"shopping","prompt":"For something you will use often, where do you put your effort?","format":"choice","choices":[{"id":"a","label":"Research before buying"},{"id":"b","label":"Try it in person"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:shopping"],"legacyQuestionId":"53755e43-807f-430e-a589-abeec5b41d69","signals":[{"optionId":"a","attributeKey":"discovery.shopping.root","value":"a","statement":"For “For something you will use often, where do you put your effort?”, you chose “Research before buying”.","scope":"For something you will use often, where do you put your effort?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.shopping.root","value":"b","statement":"For “For something you will use often, where do you put your effort?”, you chose “Try it in person”.","scope":"For something you will use often, where do you put your effort?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-shopping-a',1,'{"id":"existing-shopping-a","version":1,"familyId":"existing-shopping-a","domain":"money","subdomain":"shopping","prompt":"What kind of research helps you decide?","format":"choice","choices":[{"id":"a","label":"Long-term user experiences"},{"id":"b","label":"A clear feature comparison"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:shopping"],"legacyQuestionId":"1658d72b-f3a5-4cd1-a872-f4fd945ac31b","signals":[{"optionId":"a","attributeKey":"discovery.shopping.a","value":"a","statement":"For “What kind of research helps you decide?”, you chose “Long-term user experiences”.","scope":"What kind of research helps you decide?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.shopping.a","value":"b","statement":"For “What kind of research helps you decide?”, you chose “A clear feature comparison”.","scope":"What kind of research helps you decide?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-shopping-b',1,'{"id":"existing-shopping-b","version":1,"familyId":"existing-shopping-b","domain":"money","subdomain":"shopping","prompt":"When trying a product in person, what matters most?","format":"choice","choices":[{"id":"a","label":"How comfortable it feels"},{"id":"b","label":"How easily it fits my routine"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:shopping"],"legacyQuestionId":"557436f5-32be-40a4-a96d-bf15ad3a1a27","signals":[{"optionId":"a","attributeKey":"discovery.shopping.b","value":"a","statement":"For “When trying a product in person, what matters most?”, you chose “How comfortable it feels”.","scope":"When trying a product in person, what matters most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.shopping.b","value":"b","statement":"For “When trying a product in person, what matters most?”, you chose “How easily it fits my routine”.","scope":"When trying a product in person, what matters most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-shopping-aa',1,'{"id":"existing-shopping-aa","version":1,"familyId":"existing-shopping-aa","domain":"money","subdomain":"shopping","prompt":"What convinces you in long-term product reviews?","format":"choice","choices":[{"id":"a","label":"Reliable use over time"},{"id":"b","label":"Helpful support when something breaks"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:shopping"],"legacyQuestionId":"574b289c-ab64-44e4-a361-a4a833202ffe","signals":[{"optionId":"a","attributeKey":"discovery.shopping.aa","value":"a","statement":"For “What convinces you in long-term product reviews?”, you chose “Reliable use over time”.","scope":"What convinces you in long-term product reviews?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.shopping.aa","value":"b","statement":"For “What convinces you in long-term product reviews?”, you chose “Helpful support when something breaks”.","scope":"What convinces you in long-term product reviews?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-shopping-ab',1,'{"id":"existing-shopping-ab","version":1,"familyId":"existing-shopping-ab","domain":"money","subdomain":"shopping","prompt":"When features compete, what is your priority?","format":"choice","choices":[{"id":"a","label":"The few functions I need"},{"id":"b","label":"Flexibility for future needs"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:shopping"],"legacyQuestionId":"f50bf3b4-3dd3-49f5-ac6f-ff06b3bb347d","signals":[{"optionId":"a","attributeKey":"discovery.shopping.ab","value":"a","statement":"For “When features compete, what is your priority?”, you chose “The few functions I need”.","scope":"When features compete, what is your priority?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.shopping.ab","value":"b","statement":"For “When features compete, what is your priority?”, you chose “Flexibility for future needs”.","scope":"When features compete, what is your priority?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-shopping-ba',1,'{"id":"existing-shopping-ba","version":1,"familyId":"existing-shopping-ba","domain":"money","subdomain":"shopping","prompt":"When judging comfort, what would you rather do?","format":"choice","choices":[{"id":"a","label":"Spend more time testing"},{"id":"b","label":"Use a familiar brand as a starting point"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:shopping"],"legacyQuestionId":"bdf95ae8-dbd9-44c1-ac0e-69c337b7d308","signals":[{"optionId":"a","attributeKey":"discovery.shopping.ba","value":"a","statement":"For “When judging comfort, what would you rather do?”, you chose “Spend more time testing”.","scope":"When judging comfort, what would you rather do?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.shopping.ba","value":"b","statement":"For “When judging comfort, what would you rather do?”, you chose “Use a familiar brand as a starting point”.","scope":"When judging comfort, what would you rather do?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-shopping-bb',1,'{"id":"existing-shopping-bb","version":1,"familyId":"existing-shopping-bb","domain":"money","subdomain":"shopping","prompt":"What makes a product fit your routine?","format":"choice","choices":[{"id":"a","label":"It works with what I already own"},{"id":"b","label":"It replaces several separate things"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:shopping"],"legacyQuestionId":"a9834e4a-f689-4aeb-a5a2-43c3531d5825","signals":[{"optionId":"a","attributeKey":"discovery.shopping.bb","value":"a","statement":"For “What makes a product fit your routine?”, you chose “It works with what I already own”.","scope":"What makes a product fit your routine?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.shopping.bb","value":"b","statement":"For “What makes a product fit your routine?”, you chose “It replaces several separate things”.","scope":"What makes a product fit your routine?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-health-root',1,'{"id":"existing-health-root","version":1,"familyId":"existing-health-root","domain":"movement","subdomain":"health","prompt":"What would make movement easier to fit into an ordinary week?","format":"choice","choices":[{"id":"a","label":"A regular planned session"},{"id":"b","label":"Small bursts throughout the day"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:health"],"legacyQuestionId":"be0950ff-cd35-47bc-acef-6a41aa20868b","signals":[{"optionId":"a","attributeKey":"discovery.health.root","value":"a","statement":"For “What would make movement easier to fit into an ordinary week?”, you chose “A regular planned session”.","scope":"What would make movement easier to fit into an ordinary week?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.health.root","value":"b","statement":"For “What would make movement easier to fit into an ordinary week?”, you chose “Small bursts throughout the day”.","scope":"What would make movement easier to fit into an ordinary week?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-health-a',1,'{"id":"existing-health-a","version":1,"familyId":"existing-health-a","domain":"movement","subdomain":"health","prompt":"For planned movement, what helps you return?","format":"choice","choices":[{"id":"a","label":"A class at a fixed time"},{"id":"b","label":"A flexible solo routine"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:health"],"legacyQuestionId":"7d97175b-1f64-4994-ae2c-7aa67bc53760","signals":[{"optionId":"a","attributeKey":"discovery.health.a","value":"a","statement":"For “For planned movement, what helps you return?”, you chose “A class at a fixed time”.","scope":"For planned movement, what helps you return?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.health.a","value":"b","statement":"For “For planned movement, what helps you return?”, you chose “A flexible solo routine”.","scope":"For planned movement, what helps you return?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-health-b',1,'{"id":"existing-health-b","version":1,"familyId":"existing-health-b","domain":"movement","subdomain":"health","prompt":"For small bursts of movement, what sounds practical?","format":"choice","choices":[{"id":"a","label":"Walk during an existing break"},{"id":"b","label":"Move between tasks at home"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:health"],"legacyQuestionId":"39951854-249a-41fa-a9e1-569696a7d3ec","signals":[{"optionId":"a","attributeKey":"discovery.health.b","value":"a","statement":"For “For small bursts of movement, what sounds practical?”, you chose “Walk during an existing break”.","scope":"For small bursts of movement, what sounds practical?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.health.b","value":"b","statement":"For “For small bursts of movement, what sounds practical?”, you chose “Move between tasks at home”.","scope":"For small bursts of movement, what sounds practical?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-health-aa',1,'{"id":"existing-health-aa","version":1,"familyId":"existing-health-aa","domain":"movement","subdomain":"health","prompt":"What makes a class feel inviting?","format":"choice","choices":[{"id":"a","label":"A supportive instructor"},{"id":"b","label":"A friend joining me"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:health"],"legacyQuestionId":"7f12789c-201f-43e9-af06-1bdb2a6c8764","signals":[{"optionId":"a","attributeKey":"discovery.health.aa","value":"a","statement":"For “What makes a class feel inviting?”, you chose “A supportive instructor”.","scope":"What makes a class feel inviting?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.health.aa","value":"b","statement":"For “What makes a class feel inviting?”, you chose “A friend joining me”.","scope":"What makes a class feel inviting?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-health-ab',1,'{"id":"existing-health-ab","version":1,"familyId":"existing-health-ab","domain":"movement","subdomain":"health","prompt":"For a solo routine, what keeps it manageable?","format":"choice","choices":[{"id":"a","label":"Repeat a simple sequence"},{"id":"b","label":"Vary activities by how I feel"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:health"],"legacyQuestionId":"4a942f18-ae33-4bac-a11c-7c9d2eb5003c","signals":[{"optionId":"a","attributeKey":"discovery.health.ab","value":"a","statement":"For “For a solo routine, what keeps it manageable?”, you chose “Repeat a simple sequence”.","scope":"For a solo routine, what keeps it manageable?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.health.ab","value":"b","statement":"For “For a solo routine, what keeps it manageable?”, you chose “Vary activities by how I feel”.","scope":"For a solo routine, what keeps it manageable?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-health-ba',1,'{"id":"existing-health-ba","version":1,"familyId":"existing-health-ba","domain":"movement","subdomain":"health","prompt":"What would improve a regular walking break?","format":"choice","choices":[{"id":"a","label":"A pleasant outdoor route"},{"id":"b","label":"A short errand with a purpose"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:health"],"legacyQuestionId":"48093515-e5eb-443e-a3d6-338b50c69f21","signals":[{"optionId":"a","attributeKey":"discovery.health.ba","value":"a","statement":"For “What would improve a regular walking break?”, you chose “A pleasant outdoor route”.","scope":"What would improve a regular walking break?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.health.ba","value":"b","statement":"For “What would improve a regular walking break?”, you chose “A short errand with a purpose”.","scope":"What would improve a regular walking break?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-health-bb',1,'{"id":"existing-health-bb","version":1,"familyId":"existing-health-bb","domain":"movement","subdomain":"health","prompt":"For movement at home, what is easier to sustain?","format":"choice","choices":[{"id":"a","label":"A reminder at a regular time"},{"id":"b","label":"A cue from finishing another task"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:health"],"legacyQuestionId":"0bc4bc2f-d9ae-4c0e-abec-eb9d032e2953","signals":[{"optionId":"a","attributeKey":"discovery.health.bb","value":"a","statement":"For “For movement at home, what is easier to sustain?”, you chose “A reminder at a regular time”.","scope":"For movement at home, what is easier to sustain?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.health.bb","value":"b","statement":"For “For movement at home, what is easier to sustain?”, you chose “A cue from finishing another task”.","scope":"For movement at home, what is easier to sustain?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-career-root',1,'{"id":"existing-career-root","version":1,"familyId":"existing-career-root","domain":"work","subdomain":"career","prompt":"In a good working week, what would you like more of?","format":"choice","choices":[{"id":"a","label":"Deep uninterrupted work"},{"id":"b","label":"Useful collaboration"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:career"],"legacyQuestionId":"d464f1b5-996e-44b0-ae93-4a0023d30cb5","signals":[{"optionId":"a","attributeKey":"discovery.career.root","value":"a","statement":"For “In a good working week, what would you like more of?”, you chose “Deep uninterrupted work”.","scope":"In a good working week, what would you like more of?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.career.root","value":"b","statement":"For “In a good working week, what would you like more of?”, you chose “Useful collaboration”.","scope":"In a good working week, what would you like more of?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-career-a',1,'{"id":"existing-career-a","version":1,"familyId":"existing-career-a","domain":"work","subdomain":"career","prompt":"What helps you protect focused work?","format":"choice","choices":[{"id":"a","label":"A predictable focus block"},{"id":"b","label":"Control over where I work"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:career"],"legacyQuestionId":"7376526f-840d-4d8d-aba9-dcde9bd9aae0","signals":[{"optionId":"a","attributeKey":"discovery.career.a","value":"a","statement":"For “What helps you protect focused work?”, you chose “A predictable focus block”.","scope":"What helps you protect focused work?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.career.a","value":"b","statement":"For “What helps you protect focused work?”, you chose “Control over where I work”.","scope":"What helps you protect focused work?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-career-b',1,'{"id":"existing-career-b","version":1,"familyId":"existing-career-b","domain":"work","subdomain":"career","prompt":"What makes collaboration useful for you?","format":"choice","choices":[{"id":"a","label":"Thinking through ideas together"},{"id":"b","label":"Clear ownership and hand-offs"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:career"],"legacyQuestionId":"8ca66b69-c324-4883-a3bc-b3b478733414","signals":[{"optionId":"a","attributeKey":"discovery.career.b","value":"a","statement":"For “What makes collaboration useful for you?”, you chose “Thinking through ideas together”.","scope":"What makes collaboration useful for you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.career.b","value":"b","statement":"For “What makes collaboration useful for you?”, you chose “Clear ownership and hand-offs”.","scope":"What makes collaboration useful for you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-career-aa',1,'{"id":"existing-career-aa","version":1,"familyId":"existing-career-aa","domain":"work","subdomain":"career","prompt":"For a focus block, what would you change first?","format":"choice","choices":[{"id":"a","label":"Reduce notifications"},{"id":"b","label":"Agree on quieter meeting hours"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:career"],"legacyQuestionId":"2e01115c-6e2a-4b2a-a2eb-980b6f58acaf","signals":[{"optionId":"a","attributeKey":"discovery.career.aa","value":"a","statement":"For “For a focus block, what would you change first?”, you chose “Reduce notifications”.","scope":"For a focus block, what would you change first?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.career.aa","value":"b","statement":"For “For a focus block, what would you change first?”, you chose “Agree on quieter meeting hours”.","scope":"For a focus block, what would you change first?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-career-ab',1,'{"id":"existing-career-ab","version":1,"familyId":"existing-career-ab","domain":"work","subdomain":"career","prompt":"Which working setting helps you concentrate?","format":"choice","choices":[{"id":"a","label":"A quiet private space"},{"id":"b","label":"A low-key shared workspace"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:career"],"legacyQuestionId":"41764682-aacd-4828-a98c-6630b1d9b969","signals":[{"optionId":"a","attributeKey":"discovery.career.ab","value":"a","statement":"For “Which working setting helps you concentrate?”, you chose “A quiet private space”.","scope":"Which working setting helps you concentrate?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.career.ab","value":"b","statement":"For “Which working setting helps you concentrate?”, you chose “A low-key shared workspace”.","scope":"Which working setting helps you concentrate?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-career-ba',1,'{"id":"existing-career-ba","version":1,"familyId":"existing-career-ba","domain":"work","subdomain":"career","prompt":"When discussing ideas, what helps you contribute?","format":"choice","choices":[{"id":"a","label":"Time to prepare my thoughts"},{"id":"b","label":"A lively conversation in the moment"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:career"],"legacyQuestionId":"c33f2827-1f6f-4e51-ab24-2704bdebb209","signals":[{"optionId":"a","attributeKey":"discovery.career.ba","value":"a","statement":"For “When discussing ideas, what helps you contribute?”, you chose “Time to prepare my thoughts”.","scope":"When discussing ideas, what helps you contribute?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.career.ba","value":"b","statement":"For “When discussing ideas, what helps you contribute?”, you chose “A lively conversation in the moment”.","scope":"When discussing ideas, what helps you contribute?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-career-bb',1,'{"id":"existing-career-bb","version":1,"familyId":"existing-career-bb","domain":"work","subdomain":"career","prompt":"For a hand-off, which form of clarity helps most?","format":"choice","choices":[{"id":"a","label":"A concise written brief"},{"id":"b","label":"A short live walkthrough"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:career"],"legacyQuestionId":"7d4d43dc-b6b7-4467-a3bb-51cf9a520fb6","signals":[{"optionId":"a","attributeKey":"discovery.career.bb","value":"a","statement":"For “For a hand-off, which form of clarity helps most?”, you chose “A concise written brief”.","scope":"For a hand-off, which form of clarity helps most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.career.bb","value":"b","statement":"For “For a hand-off, which form of clarity helps most?”, you chose “A short live walkthrough”.","scope":"For a hand-off, which form of clarity helps most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-relationships-root',1,'{"id":"existing-relationships-root","version":1,"familyId":"existing-relationships-root","domain":"relationships","subdomain":"relationships","prompt":"After a busy week, what kind of connection feels best?","format":"choice","choices":[{"id":"a","label":"Time with one close person"},{"id":"b","label":"A small group gathering"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:relationships"],"legacyQuestionId":"9c1e153e-649b-4d55-aa0e-c5a8f2feb558","signals":[{"optionId":"a","attributeKey":"discovery.relationships.root","value":"a","statement":"For “After a busy week, what kind of connection feels best?”, you chose “Time with one close person”.","scope":"After a busy week, what kind of connection feels best?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.relationships.root","value":"b","statement":"For “After a busy week, what kind of connection feels best?”, you chose “A small group gathering”.","scope":"After a busy week, what kind of connection feels best?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-relationships-a',1,'{"id":"existing-relationships-a","version":1,"familyId":"existing-relationships-a","domain":"relationships","subdomain":"relationships","prompt":"During one-to-one time, what would you enjoy?","format":"choice","choices":[{"id":"a","label":"An unhurried conversation"},{"id":"b","label":"Doing an activity together"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:relationships"],"legacyQuestionId":"68c3790e-bcea-474f-a2cc-433db66ad7e2","signals":[{"optionId":"a","attributeKey":"discovery.relationships.a","value":"a","statement":"For “During one-to-one time, what would you enjoy?”, you chose “An unhurried conversation”.","scope":"During one-to-one time, what would you enjoy?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.relationships.a","value":"b","statement":"For “During one-to-one time, what would you enjoy?”, you chose “Doing an activity together”.","scope":"During one-to-one time, what would you enjoy?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-relationships-b',1,'{"id":"existing-relationships-b","version":1,"familyId":"existing-relationships-b","domain":"relationships","subdomain":"relationships","prompt":"For a small gathering, what makes it comfortable?","format":"choice","choices":[{"id":"a","label":"A plan everyone knows"},{"id":"b","label":"A relaxed open-ended evening"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:relationships"],"legacyQuestionId":"060da961-a700-49a0-a4fb-599dd5bccc28","signals":[{"optionId":"a","attributeKey":"discovery.relationships.b","value":"a","statement":"For “For a small gathering, what makes it comfortable?”, you chose “A plan everyone knows”.","scope":"For a small gathering, what makes it comfortable?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.relationships.b","value":"b","statement":"For “For a small gathering, what makes it comfortable?”, you chose “A relaxed open-ended evening”.","scope":"For a small gathering, what makes it comfortable?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-relationships-aa',1,'{"id":"existing-relationships-aa","version":1,"familyId":"existing-relationships-aa","domain":"relationships","subdomain":"relationships","prompt":"For a meaningful conversation, what helps you open up?","format":"choice","choices":[{"id":"a","label":"A quiet private setting"},{"id":"b","label":"A shared walk"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:relationships"],"legacyQuestionId":"9dc256be-1b66-426d-a4bb-5f83bb407126","signals":[{"optionId":"a","attributeKey":"discovery.relationships.aa","value":"a","statement":"For “For a meaningful conversation, what helps you open up?”, you chose “A quiet private setting”.","scope":"For a meaningful conversation, what helps you open up?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.relationships.aa","value":"b","statement":"For “For a meaningful conversation, what helps you open up?”, you chose “A shared walk”.","scope":"For a meaningful conversation, what helps you open up?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-relationships-ab',1,'{"id":"existing-relationships-ab","version":1,"familyId":"existing-relationships-ab","domain":"relationships","subdomain":"relationships","prompt":"Which shared activity makes connection easier?","format":"choice","choices":[{"id":"a","label":"Cook or make something"},{"id":"b","label":"Go somewhere new together"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:relationships"],"legacyQuestionId":"1bd8c32d-11e4-43c9-a719-257682462f8e","signals":[{"optionId":"a","attributeKey":"discovery.relationships.ab","value":"a","statement":"For “Which shared activity makes connection easier?”, you chose “Cook or make something”.","scope":"Which shared activity makes connection easier?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.relationships.ab","value":"b","statement":"For “Which shared activity makes connection easier?”, you chose “Go somewhere new together”.","scope":"Which shared activity makes connection easier?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-relationships-ba',1,'{"id":"existing-relationships-ba","version":1,"familyId":"existing-relationships-ba","domain":"relationships","subdomain":"relationships","prompt":"When arranging a group plan, what matters more?","format":"choice","choices":[{"id":"a","label":"Give people plenty of notice"},{"id":"b","label":"Keep the plan simple to join"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:relationships"],"legacyQuestionId":"43ade0b8-2140-46f6-a64f-34720dbc6c7f","signals":[{"optionId":"a","attributeKey":"discovery.relationships.ba","value":"a","statement":"For “When arranging a group plan, what matters more?”, you chose “Give people plenty of notice”.","scope":"When arranging a group plan, what matters more?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.relationships.ba","value":"b","statement":"For “When arranging a group plan, what matters more?”, you chose “Keep the plan simple to join”.","scope":"When arranging a group plan, what matters more?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-relationships-bb',1,'{"id":"existing-relationships-bb","version":1,"familyId":"existing-relationships-bb","domain":"relationships","subdomain":"relationships","prompt":"In an open-ended evening, what feels welcoming?","format":"choice","choices":[{"id":"a","label":"Someone gently includes everyone"},{"id":"b","label":"People can dip in and out"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:relationships"],"legacyQuestionId":"c44bceaf-ab82-43be-a1bd-56a6aceafa5f","signals":[{"optionId":"a","attributeKey":"discovery.relationships.bb","value":"a","statement":"For “In an open-ended evening, what feels welcoming?”, you chose “Someone gently includes everyone”.","scope":"In an open-ended evening, what feels welcoming?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.relationships.bb","value":"b","statement":"For “In an open-ended evening, what feels welcoming?”, you chose “People can dip in and out”.","scope":"In an open-ended evening, what feels welcoming?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-finance-root',1,'{"id":"existing-finance-root","version":1,"familyId":"existing-finance-root","domain":"money","subdomain":"finance","prompt":"For everyday spending, which habit would feel easier to maintain?","format":"choice","choices":[{"id":"a","label":"Set a simple monthly limit"},{"id":"b","label":"Check spending a little at a time"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:finance"],"legacyQuestionId":"0190119c-9b54-4f29-a980-e6284c7bdc6e","signals":[{"optionId":"a","attributeKey":"discovery.finance.root","value":"a","statement":"For “For everyday spending, which habit would feel easier to maintain?”, you chose “Set a simple monthly limit”.","scope":"For everyday spending, which habit would feel easier to maintain?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.finance.root","value":"b","statement":"For “For everyday spending, which habit would feel easier to maintain?”, you chose “Check spending a little at a time”.","scope":"For everyday spending, which habit would feel easier to maintain?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-finance-a',1,'{"id":"existing-finance-a","version":1,"familyId":"existing-finance-a","domain":"money","subdomain":"finance","prompt":"What would make a monthly limit useful?","format":"choice","choices":[{"id":"a","label":"Separate essential and optional spending"},{"id":"b","label":"One flexible overall target"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:finance"],"legacyQuestionId":"deb76ef4-7263-4e54-a0c5-447d670f9886","signals":[{"optionId":"a","attributeKey":"discovery.finance.a","value":"a","statement":"For “What would make a monthly limit useful?”, you chose “Separate essential and optional spending”.","scope":"What would make a monthly limit useful?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.finance.a","value":"b","statement":"For “What would make a monthly limit useful?”, you chose “One flexible overall target”.","scope":"What would make a monthly limit useful?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-finance-b',1,'{"id":"existing-finance-b","version":1,"familyId":"existing-finance-b","domain":"money","subdomain":"finance","prompt":"For small spending check-ins, what would you choose?","format":"choice","choices":[{"id":"a","label":"A weekly review"},{"id":"b","label":"A quick check before bigger purchases"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:finance"],"legacyQuestionId":"624c7edc-3e18-46aa-a0ea-a7bebf9a79a3","signals":[{"optionId":"a","attributeKey":"discovery.finance.b","value":"a","statement":"For “For small spending check-ins, what would you choose?”, you chose “A weekly review”.","scope":"For small spending check-ins, what would you choose?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.finance.b","value":"b","statement":"For “For small spending check-ins, what would you choose?”, you chose “A quick check before bigger purchases”.","scope":"For small spending check-ins, what would you choose?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-finance-aa',1,'{"id":"existing-finance-aa","version":1,"familyId":"existing-finance-aa","domain":"money","subdomain":"finance","prompt":"Within optional spending, what would you rather protect?","format":"choice","choices":[{"id":"a","label":"Experiences with people"},{"id":"b","label":"Things I use often"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:finance"],"legacyQuestionId":"26c574af-e1bf-45ac-a97f-bcadbb43f3b4","signals":[{"optionId":"a","attributeKey":"discovery.finance.aa","value":"a","statement":"For “Within optional spending, what would you rather protect?”, you chose “Experiences with people”.","scope":"Within optional spending, what would you rather protect?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.finance.aa","value":"b","statement":"For “Within optional spending, what would you rather protect?”, you chose “Things I use often”.","scope":"Within optional spending, what would you rather protect?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-finance-ab',1,'{"id":"existing-finance-ab","version":1,"familyId":"existing-finance-ab","domain":"money","subdomain":"finance","prompt":"When an overall target needs changing, what helps?","format":"choice","choices":[{"id":"a","label":"A buffer for unexpected costs"},{"id":"b","label":"Adjust it to that month''s plans"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:finance"],"legacyQuestionId":"6833c4d6-912e-45bd-a6d6-94b032a8937f","signals":[{"optionId":"a","attributeKey":"discovery.finance.ab","value":"a","statement":"For “When an overall target needs changing, what helps?”, you chose “A buffer for unexpected costs”.","scope":"When an overall target needs changing, what helps?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.finance.ab","value":"b","statement":"For “When an overall target needs changing, what helps?”, you chose “Adjust it to that month''s plans”.","scope":"When an overall target needs changing, what helps?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-finance-ba',1,'{"id":"existing-finance-ba","version":1,"familyId":"existing-finance-ba","domain":"money","subdomain":"finance","prompt":"During a weekly spending review, what would be useful?","format":"choice","choices":[{"id":"a","label":"See a few clear categories"},{"id":"b","label":"See only the total and trend"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:finance"],"legacyQuestionId":"a0f4f03c-074a-4374-a0cb-6785d5dde4a4","signals":[{"optionId":"a","attributeKey":"discovery.finance.ba","value":"a","statement":"For “During a weekly spending review, what would be useful?”, you chose “See a few clear categories”.","scope":"During a weekly spending review, what would be useful?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.finance.ba","value":"b","statement":"For “During a weekly spending review, what would be useful?”, you chose “See only the total and trend”.","scope":"During a weekly spending review, what would be useful?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-finance-bb',1,'{"id":"existing-finance-bb","version":1,"familyId":"existing-finance-bb","domain":"money","subdomain":"finance","prompt":"Before a bigger purchase, what helps you pause?","format":"choice","choices":[{"id":"a","label":"Wait a day before deciding"},{"id":"b","label":"Compare it with another priority"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:finance"],"legacyQuestionId":"96f5709e-e190-4342-ac74-9dee06d41e43","signals":[{"optionId":"a","attributeKey":"discovery.finance.bb","value":"a","statement":"For “Before a bigger purchase, what helps you pause?”, you chose “Wait a day before deciding”.","scope":"Before a bigger purchase, what helps you pause?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.finance.bb","value":"b","statement":"For “Before a bigger purchase, what helps you pause?”, you chose “Compare it with another priority”.","scope":"Before a bigger purchase, what helps you pause?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-hobbies-root',1,'{"id":"existing-hobbies-root","version":1,"familyId":"existing-hobbies-root","domain":"play","subdomain":"hobbies","prompt":"What would make a hobby feel worthwhile right now?","format":"choice","choices":[{"id":"a","label":"Build a skill over time"},{"id":"b","label":"Enjoy it without a goal"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:hobbies"],"legacyQuestionId":"f60c3509-3704-4707-a0a3-8349956a8d5f","signals":[{"optionId":"a","attributeKey":"discovery.hobbies.root","value":"a","statement":"For “What would make a hobby feel worthwhile right now?”, you chose “Build a skill over time”.","scope":"What would make a hobby feel worthwhile right now?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.hobbies.root","value":"b","statement":"For “What would make a hobby feel worthwhile right now?”, you chose “Enjoy it without a goal”.","scope":"What would make a hobby feel worthwhile right now?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-hobbies-a',1,'{"id":"existing-hobbies-a","version":1,"familyId":"existing-hobbies-a","domain":"play","subdomain":"hobbies","prompt":"For a hobby skill, what motivates you?","format":"choice","choices":[{"id":"a","label":"A small project I can finish"},{"id":"b","label":"A clear next technique to learn"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:hobbies"],"legacyQuestionId":"bae334be-3f16-42e4-a32f-bd79fa0f348e","signals":[{"optionId":"a","attributeKey":"discovery.hobbies.a","value":"a","statement":"For “For a hobby skill, what motivates you?”, you chose “A small project I can finish”.","scope":"For a hobby skill, what motivates you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.hobbies.a","value":"b","statement":"For “For a hobby skill, what motivates you?”, you chose “A clear next technique to learn”.","scope":"For a hobby skill, what motivates you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-hobbies-b',1,'{"id":"existing-hobbies-b","version":1,"familyId":"existing-hobbies-b","domain":"play","subdomain":"hobbies","prompt":"For a hobby without a goal, what matters most?","format":"choice","choices":[{"id":"a","label":"A restful familiar activity"},{"id":"b","label":"Playful experimentation"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:hobbies"],"legacyQuestionId":"aa67f8ad-8906-47fa-a415-4745f425ba53","signals":[{"optionId":"a","attributeKey":"discovery.hobbies.b","value":"a","statement":"For “For a hobby without a goal, what matters most?”, you chose “A restful familiar activity”.","scope":"For a hobby without a goal, what matters most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.hobbies.b","value":"b","statement":"For “For a hobby without a goal, what matters most?”, you chose “Playful experimentation”.","scope":"For a hobby without a goal, what matters most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-hobbies-aa',1,'{"id":"existing-hobbies-aa","version":1,"familyId":"existing-hobbies-aa","domain":"play","subdomain":"hobbies","prompt":"For a small project, what finish line feels satisfying?","format":"choice","choices":[{"id":"a","label":"Make something useful"},{"id":"b","label":"Make something I can share"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:hobbies"],"legacyQuestionId":"4ea3500a-3eb7-4f45-a343-d2a0e382054a","signals":[{"optionId":"a","attributeKey":"discovery.hobbies.aa","value":"a","statement":"For “For a small project, what finish line feels satisfying?”, you chose “Make something useful”.","scope":"For a small project, what finish line feels satisfying?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.hobbies.aa","value":"b","statement":"For “For a small project, what finish line feels satisfying?”, you chose “Make something I can share”.","scope":"For a small project, what finish line feels satisfying?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-hobbies-ab',1,'{"id":"existing-hobbies-ab","version":1,"familyId":"existing-hobbies-ab","domain":"play","subdomain":"hobbies","prompt":"To learn a technique, what would you prefer?","format":"choice","choices":[{"id":"a","label":"A step-by-step demonstration"},{"id":"b","label":"Try it and work out the details"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:hobbies"],"legacyQuestionId":"81d0405b-c9bf-4863-a6ec-35019d9f5c65","signals":[{"optionId":"a","attributeKey":"discovery.hobbies.ab","value":"a","statement":"For “To learn a technique, what would you prefer?”, you chose “A step-by-step demonstration”.","scope":"To learn a technique, what would you prefer?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.hobbies.ab","value":"b","statement":"For “To learn a technique, what would you prefer?”, you chose “Try it and work out the details”.","scope":"To learn a technique, what would you prefer?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-hobbies-ba',1,'{"id":"existing-hobbies-ba","version":1,"familyId":"existing-hobbies-ba","domain":"play","subdomain":"hobbies","prompt":"For a restful hobby, what helps you settle?","format":"choice","choices":[{"id":"a","label":"A familiar rhythm"},{"id":"b","label":"An activity away from screens"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:hobbies"],"legacyQuestionId":"b416dd4c-3f9e-4bf2-a3cb-8a2d83c85f7f","signals":[{"optionId":"a","attributeKey":"discovery.hobbies.ba","value":"a","statement":"For “For a restful hobby, what helps you settle?”, you chose “A familiar rhythm”.","scope":"For a restful hobby, what helps you settle?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.hobbies.ba","value":"b","statement":"For “For a restful hobby, what helps you settle?”, you chose “An activity away from screens”.","scope":"For a restful hobby, what helps you settle?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-hobbies-bb',1,'{"id":"existing-hobbies-bb","version":1,"familyId":"existing-hobbies-bb","domain":"play","subdomain":"hobbies","prompt":"For playful experimentation, what makes it easier?","format":"choice","choices":[{"id":"a","label":"Low-cost materials"},{"id":"b","label":"Company that enjoys trying things"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:hobbies"],"legacyQuestionId":"c387b972-2213-4de6-a176-448691787b4a","signals":[{"optionId":"a","attributeKey":"discovery.hobbies.bb","value":"a","statement":"For “For playful experimentation, what makes it easier?”, you chose “Low-cost materials”.","scope":"For playful experimentation, what makes it easier?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.hobbies.bb","value":"b","statement":"For “For playful experimentation, what makes it easier?”, you chose “Company that enjoys trying things”.","scope":"For playful experimentation, what makes it easier?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-home-root',1,'{"id":"existing-home-root","version":1,"familyId":"existing-home-root","domain":"places","subdomain":"home","prompt":"What would make your home feel better on an ordinary day?","format":"choice","choices":[{"id":"a","label":"Less visual clutter"},{"id":"b","label":"More personal warmth"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:home"],"legacyQuestionId":"e4d6be5e-dba1-41b8-aa65-9a818bd01672","signals":[{"optionId":"a","attributeKey":"discovery.home.root","value":"a","statement":"For “What would make your home feel better on an ordinary day?”, you chose “Less visual clutter”.","scope":"What would make your home feel better on an ordinary day?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.home.root","value":"b","statement":"For “What would make your home feel better on an ordinary day?”, you chose “More personal warmth”.","scope":"What would make your home feel better on an ordinary day?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-home-a',1,'{"id":"existing-home-a","version":1,"familyId":"existing-home-a","domain":"places","subdomain":"home","prompt":"When reducing clutter, what would help first?","format":"choice","choices":[{"id":"a","label":"Fewer things on visible surfaces"},{"id":"b","label":"A clear place for everyday items"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:home"],"legacyQuestionId":"d455c74d-6eac-4cc4-aa21-621726d032e2","signals":[{"optionId":"a","attributeKey":"discovery.home.a","value":"a","statement":"For “When reducing clutter, what would help first?”, you chose “Fewer things on visible surfaces”.","scope":"When reducing clutter, what would help first?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.home.a","value":"b","statement":"For “When reducing clutter, what would help first?”, you chose “A clear place for everyday items”.","scope":"When reducing clutter, what would help first?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-home-b',1,'{"id":"existing-home-b","version":1,"familyId":"existing-home-b","domain":"places","subdomain":"home","prompt":"For more personal warmth, what appeals?","format":"choice","choices":[{"id":"a","label":"Lighting and textures"},{"id":"b","label":"Objects with a story"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:home"],"legacyQuestionId":"fed7cfb8-0575-4c34-a90e-efa0f26020ba","signals":[{"optionId":"a","attributeKey":"discovery.home.b","value":"a","statement":"For “For more personal warmth, what appeals?”, you chose “Lighting and textures”.","scope":"For more personal warmth, what appeals?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.home.b","value":"b","statement":"For “For more personal warmth, what appeals?”, you chose “Objects with a story”.","scope":"For more personal warmth, what appeals?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-home-aa',1,'{"id":"existing-home-aa","version":1,"familyId":"existing-home-aa","domain":"places","subdomain":"home","prompt":"With visible surfaces, which approach feels manageable?","format":"choice","choices":[{"id":"a","label":"Clear one area at a time"},{"id":"b","label":"Keep only the essentials out"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:home"],"legacyQuestionId":"7b8ae40a-f593-4c49-ace0-fc01df55c4bc","signals":[{"optionId":"a","attributeKey":"discovery.home.aa","value":"a","statement":"For “With visible surfaces, which approach feels manageable?”, you chose “Clear one area at a time”.","scope":"With visible surfaces, which approach feels manageable?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.home.aa","value":"b","statement":"For “With visible surfaces, which approach feels manageable?”, you chose “Keep only the essentials out”.","scope":"With visible surfaces, which approach feels manageable?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-home-ab',1,'{"id":"existing-home-ab","version":1,"familyId":"existing-home-ab","domain":"places","subdomain":"home","prompt":"For everyday storage, what matters more?","format":"choice","choices":[{"id":"a","label":"Everything easy to reach"},{"id":"b","label":"Everything tucked out of sight"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:home"],"legacyQuestionId":"ae5014d8-1000-445b-a8b1-86088f528b66","signals":[{"optionId":"a","attributeKey":"discovery.home.ab","value":"a","statement":"For “For everyday storage, what matters more?”, you chose “Everything easy to reach”.","scope":"For everyday storage, what matters more?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.home.ab","value":"b","statement":"For “For everyday storage, what matters more?”, you chose “Everything tucked out of sight”.","scope":"For everyday storage, what matters more?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-home-ba',1,'{"id":"existing-home-ba","version":1,"familyId":"existing-home-ba","domain":"places","subdomain":"home","prompt":"Which change in lighting would you enjoy?","format":"choice","choices":[{"id":"a","label":"Soft evening lamps"},{"id":"b","label":"More natural daylight"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:home"],"legacyQuestionId":"a2cfc050-0a06-4783-acd5-fa8a014a5a4a","signals":[{"optionId":"a","attributeKey":"discovery.home.ba","value":"a","statement":"For “Which change in lighting would you enjoy?”, you chose “Soft evening lamps”.","scope":"Which change in lighting would you enjoy?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.home.ba","value":"b","statement":"For “Which change in lighting would you enjoy?”, you chose “More natural daylight”.","scope":"Which change in lighting would you enjoy?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-home-bb',1,'{"id":"existing-home-bb","version":1,"familyId":"existing-home-bb","domain":"places","subdomain":"home","prompt":"For objects with a story, what would you display?","format":"choice","choices":[{"id":"a","label":"Memories from people and places"},{"id":"b","label":"Things I made myself"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:home"],"legacyQuestionId":"9b9a2301-f031-440d-acce-3e96e7f8dcdd","signals":[{"optionId":"a","attributeKey":"discovery.home.bb","value":"a","statement":"For “For objects with a story, what would you display?”, you chose “Memories from people and places”.","scope":"For objects with a story, what would you display?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.home.bb","value":"b","statement":"For “For objects with a story, what would you display?”, you chose “Things I made myself”.","scope":"For objects with a story, what would you display?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-learning-root',1,'{"id":"existing-learning-root","version":1,"familyId":"existing-learning-root","domain":"learning","subdomain":"learning","prompt":"When learning something new, how would you like to begin?","format":"choice","choices":[{"id":"a","label":"Understand the main idea"},{"id":"b","label":"Try a small real task"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:learning"],"legacyQuestionId":"8adb0cca-66d5-4e1e-adc4-e98962a02051","signals":[{"optionId":"a","attributeKey":"discovery.learning.root","value":"a","statement":"For “When learning something new, how would you like to begin?”, you chose “Understand the main idea”.","scope":"When learning something new, how would you like to begin?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.learning.root","value":"b","statement":"For “When learning something new, how would you like to begin?”, you chose “Try a small real task”.","scope":"When learning something new, how would you like to begin?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-learning-a',1,'{"id":"existing-learning-a","version":1,"familyId":"existing-learning-a","domain":"learning","subdomain":"learning","prompt":"For understanding a new idea, what helps most?","format":"choice","choices":[{"id":"a","label":"A clear example"},{"id":"b","label":"A visual explanation"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:learning"],"legacyQuestionId":"b15859ed-fd86-474a-a304-d51d8017a233","signals":[{"optionId":"a","attributeKey":"discovery.learning.a","value":"a","statement":"For “For understanding a new idea, what helps most?”, you chose “A clear example”.","scope":"For understanding a new idea, what helps most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.learning.a","value":"b","statement":"For “For understanding a new idea, what helps most?”, you chose “A visual explanation”.","scope":"For understanding a new idea, what helps most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-learning-b',1,'{"id":"existing-learning-b","version":1,"familyId":"existing-learning-b","domain":"learning","subdomain":"learning","prompt":"For a first real task, what feels useful?","format":"choice","choices":[{"id":"a","label":"A guided exercise"},{"id":"b","label":"A problem from my own life"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:learning"],"legacyQuestionId":"680f28d9-b9ce-4709-a3dc-260846f9a9ae","signals":[{"optionId":"a","attributeKey":"discovery.learning.b","value":"a","statement":"For “For a first real task, what feels useful?”, you chose “A guided exercise”.","scope":"For a first real task, what feels useful?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.learning.b","value":"b","statement":"For “For a first real task, what feels useful?”, you chose “A problem from my own life”.","scope":"For a first real task, what feels useful?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-learning-aa',1,'{"id":"existing-learning-aa","version":1,"familyId":"existing-learning-aa","domain":"learning","subdomain":"learning","prompt":"With an example, what helps the idea stick?","format":"choice","choices":[{"id":"a","label":"Compare two different cases"},{"id":"b","label":"Explain it back in my own words"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:learning"],"legacyQuestionId":"0ec36f73-8edb-4568-a733-26758ed0de01","signals":[{"optionId":"a","attributeKey":"discovery.learning.aa","value":"a","statement":"For “With an example, what helps the idea stick?”, you chose “Compare two different cases”.","scope":"With an example, what helps the idea stick?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.learning.aa","value":"b","statement":"For “With an example, what helps the idea stick?”, you chose “Explain it back in my own words”.","scope":"With an example, what helps the idea stick?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-learning-ab',1,'{"id":"existing-learning-ab","version":1,"familyId":"existing-learning-ab","domain":"learning","subdomain":"learning","prompt":"With a visual explanation, what would you choose?","format":"choice","choices":[{"id":"a","label":"A simple diagram"},{"id":"b","label":"A demonstration in motion"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:learning"],"legacyQuestionId":"5f543128-3b2a-45e8-ac3c-3958226e304f","signals":[{"optionId":"a","attributeKey":"discovery.learning.ab","value":"a","statement":"For “With a visual explanation, what would you choose?”, you chose “A simple diagram”.","scope":"With a visual explanation, what would you choose?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.learning.ab","value":"b","statement":"For “With a visual explanation, what would you choose?”, you chose “A demonstration in motion”.","scope":"With a visual explanation, what would you choose?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-learning-ba',1,'{"id":"existing-learning-ba","version":1,"familyId":"existing-learning-ba","domain":"learning","subdomain":"learning","prompt":"In a guided exercise, what support helps?","format":"choice","choices":[{"id":"a","label":"Feedback after each step"},{"id":"b","label":"A complete worked solution afterward"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:learning"],"legacyQuestionId":"60603175-2ccf-4253-afed-d37f424dcf9f","signals":[{"optionId":"a","attributeKey":"discovery.learning.ba","value":"a","statement":"For “In a guided exercise, what support helps?”, you chose “Feedback after each step”.","scope":"In a guided exercise, what support helps?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.learning.ba","value":"b","statement":"For “In a guided exercise, what support helps?”, you chose “A complete worked solution afterward”.","scope":"In a guided exercise, what support helps?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-learning-bb',1,'{"id":"existing-learning-bb","version":1,"familyId":"existing-learning-bb","domain":"learning","subdomain":"learning","prompt":"For a problem from your life, what keeps you going?","format":"choice","choices":[{"id":"a","label":"An immediately useful result"},{"id":"b","label":"The chance to explore freely"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:learning"],"legacyQuestionId":"3ffb9d49-5515-42df-a4d9-f0c69f44604b","signals":[{"optionId":"a","attributeKey":"discovery.learning.bb","value":"a","statement":"For “For a problem from your life, what keeps you going?”, you chose “An immediately useful result”.","scope":"For a problem from your life, what keeps you going?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.learning.bb","value":"b","statement":"For “For a problem from your life, what keeps you going?”, you chose “The chance to explore freely”.","scope":"For a problem from your life, what keeps you going?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-digital-root',1,'{"id":"existing-digital-root","version":1,"familyId":"existing-digital-root","domain":"digital","subdomain":"digital","prompt":"What would improve your everyday use of technology?","format":"choice","choices":[{"id":"a","label":"Fewer distractions"},{"id":"b","label":"Less friction in common tasks"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:digital"],"legacyQuestionId":"07a0b8aa-8307-48b6-abc5-62deb4ccd3d0","signals":[{"optionId":"a","attributeKey":"discovery.digital.root","value":"a","statement":"For “What would improve your everyday use of technology?”, you chose “Fewer distractions”.","scope":"What would improve your everyday use of technology?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.digital.root","value":"b","statement":"For “What would improve your everyday use of technology?”, you chose “Less friction in common tasks”.","scope":"What would improve your everyday use of technology?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-digital-a',1,'{"id":"existing-digital-a","version":1,"familyId":"existing-digital-a","domain":"digital","subdomain":"digital","prompt":"For fewer distractions, where would you start?","format":"choice","choices":[{"id":"a","label":"Control notifications"},{"id":"b","label":"Create time away from feeds"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:digital"],"legacyQuestionId":"202aaf29-85c2-4f50-af84-87039927b422","signals":[{"optionId":"a","attributeKey":"discovery.digital.a","value":"a","statement":"For “For fewer distractions, where would you start?”, you chose “Control notifications”.","scope":"For fewer distractions, where would you start?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.digital.a","value":"b","statement":"For “For fewer distractions, where would you start?”, you chose “Create time away from feeds”.","scope":"For fewer distractions, where would you start?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-digital-b',1,'{"id":"existing-digital-b","version":1,"familyId":"existing-digital-b","domain":"digital","subdomain":"digital","prompt":"To simplify common tasks, what would help?","format":"choice","choices":[{"id":"a","label":"Use fewer apps"},{"id":"b","label":"Connect tools I already use"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:digital"],"legacyQuestionId":"6326d4cf-dc62-4bf8-a538-2e26e2e303c5","signals":[{"optionId":"a","attributeKey":"discovery.digital.b","value":"a","statement":"For “To simplify common tasks, what would help?”, you chose “Use fewer apps”.","scope":"To simplify common tasks, what would help?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.digital.b","value":"b","statement":"For “To simplify common tasks, what would help?”, you chose “Connect tools I already use”.","scope":"To simplify common tasks, what would help?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-digital-aa',1,'{"id":"existing-digital-aa","version":1,"familyId":"existing-digital-aa","domain":"digital","subdomain":"digital","prompt":"For notifications, which rule feels practical?","format":"choice","choices":[{"id":"a","label":"Only people can interrupt"},{"id":"b","label":"Check everything at chosen times"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:digital"],"legacyQuestionId":"0d2a658e-458d-41a0-abd1-addf57caa711","signals":[{"optionId":"a","attributeKey":"discovery.digital.aa","value":"a","statement":"For “For notifications, which rule feels practical?”, you chose “Only people can interrupt”.","scope":"For notifications, which rule feels practical?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.digital.aa","value":"b","statement":"For “For notifications, which rule feels practical?”, you chose “Check everything at chosen times”.","scope":"For notifications, which rule feels practical?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-digital-ab',1,'{"id":"existing-digital-ab","version":1,"familyId":"existing-digital-ab","domain":"digital","subdomain":"digital","prompt":"For time away from feeds, what helps more?","format":"choice","choices":[{"id":"a","label":"Keep the phone out of reach"},{"id":"b","label":"Replace scrolling with another activity"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:digital"],"legacyQuestionId":"4212f143-d5ba-4cb6-a9c9-d928f8886d5b","signals":[{"optionId":"a","attributeKey":"discovery.digital.ab","value":"a","statement":"For “For time away from feeds, what helps more?”, you chose “Keep the phone out of reach”.","scope":"For time away from feeds, what helps more?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.digital.ab","value":"b","statement":"For “For time away from feeds, what helps more?”, you chose “Replace scrolling with another activity”.","scope":"For time away from feeds, what helps more?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-digital-ba',1,'{"id":"existing-digital-ba","version":1,"familyId":"existing-digital-ba","domain":"digital","subdomain":"digital","prompt":"When choosing fewer apps, what matters most?","format":"choice","choices":[{"id":"a","label":"A simple tool that does the basics"},{"id":"b","label":"One tool covering several needs"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:digital"],"legacyQuestionId":"db88f6eb-09dd-44d7-a7de-e94c66ef33df","signals":[{"optionId":"a","attributeKey":"discovery.digital.ba","value":"a","statement":"For “When choosing fewer apps, what matters most?”, you chose “A simple tool that does the basics”.","scope":"When choosing fewer apps, what matters most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.digital.ba","value":"b","statement":"For “When choosing fewer apps, what matters most?”, you chose “One tool covering several needs”.","scope":"When choosing fewer apps, what matters most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-digital-bb',1,'{"id":"existing-digital-bb","version":1,"familyId":"existing-digital-bb","domain":"digital","subdomain":"digital","prompt":"When connecting tools, what would you prioritise?","format":"choice","choices":[{"id":"a","label":"Saving repetitive effort"},{"id":"b","label":"Keeping control over shared data"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:digital"],"legacyQuestionId":"ad8f4097-7a58-4cbc-ae7a-f92d999c3b83","signals":[{"optionId":"a","attributeKey":"discovery.digital.bb","value":"a","statement":"For “When connecting tools, what would you prioritise?”, you chose “Saving repetitive effort”.","scope":"When connecting tools, what would you prioritise?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.digital.bb","value":"b","statement":"For “When connecting tools, what would you prioritise?”, you chose “Keeping control over shared data”.","scope":"When connecting tools, what would you prioritise?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-values-root',1,'{"id":"existing-values-root","version":1,"familyId":"existing-values-root","domain":"values","subdomain":"values","prompt":"When two good opportunities compete, what would you protect first?","format":"choice","choices":[{"id":"a","label":"Time for people who matter"},{"id":"b","label":"Room for personal growth"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:values"],"legacyQuestionId":"6b3bb51a-d58c-4d7e-a3df-447ab412ee78","signals":[{"optionId":"a","attributeKey":"discovery.values.root","value":"a","statement":"For “When two good opportunities compete, what would you protect first?”, you chose “Time for people who matter”.","scope":"When two good opportunities compete, what would you protect first?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.values.root","value":"b","statement":"For “When two good opportunities compete, what would you protect first?”, you chose “Room for personal growth”.","scope":"When two good opportunities compete, what would you protect first?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-values-a',1,'{"id":"existing-values-a","version":1,"familyId":"existing-values-a","domain":"values","subdomain":"values","prompt":"When protecting time for people, what matters most?","format":"choice","choices":[{"id":"a","label":"Be reliable in everyday life"},{"id":"b","label":"Make room for important moments"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:values"],"legacyQuestionId":"1c4db4a9-bcd5-44b7-ab5d-e417f8b4532d","signals":[{"optionId":"a","attributeKey":"discovery.values.a","value":"a","statement":"For “When protecting time for people, what matters most?”, you chose “Be reliable in everyday life”.","scope":"When protecting time for people, what matters most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.values.a","value":"b","statement":"For “When protecting time for people, what matters most?”, you chose “Make room for important moments”.","scope":"When protecting time for people, what matters most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-values-b',1,'{"id":"existing-values-b","version":1,"familyId":"existing-values-b","domain":"values","subdomain":"values","prompt":"For personal growth, which opportunity appeals?","format":"choice","choices":[{"id":"a","label":"Deepen an existing strength"},{"id":"b","label":"Explore an unfamiliar direction"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:values"],"legacyQuestionId":"d07f4fe1-182b-4605-af07-520eb3029828","signals":[{"optionId":"a","attributeKey":"discovery.values.b","value":"a","statement":"For “For personal growth, which opportunity appeals?”, you chose “Deepen an existing strength”.","scope":"For personal growth, which opportunity appeals?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.values.b","value":"b","statement":"For “For personal growth, which opportunity appeals?”, you chose “Explore an unfamiliar direction”.","scope":"For personal growth, which opportunity appeals?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-values-aa',1,'{"id":"existing-values-aa","version":1,"familyId":"existing-values-aa","domain":"values","subdomain":"values","prompt":"For everyday reliability, what would you prefer?","format":"choice","choices":[{"id":"a","label":"A few commitments I can keep"},{"id":"b","label":"Flexibility to respond when needed"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:values"],"legacyQuestionId":"121f6752-9917-4fa9-aaeb-531ed81749fe","signals":[{"optionId":"a","attributeKey":"discovery.values.aa","value":"a","statement":"For “For everyday reliability, what would you prefer?”, you chose “A few commitments I can keep”.","scope":"For everyday reliability, what would you prefer?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.values.aa","value":"b","statement":"For “For everyday reliability, what would you prefer?”, you chose “Flexibility to respond when needed”.","scope":"For everyday reliability, what would you prefer?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-values-ab',1,'{"id":"existing-values-ab","version":1,"familyId":"existing-values-ab","domain":"values","subdomain":"values","prompt":"For important moments, what helps you show up?","format":"choice","choices":[{"id":"a","label":"Plan ahead around them"},{"id":"b","label":"Leave room in my schedule"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:values"],"legacyQuestionId":"e981f10a-d8c0-4e55-a8d1-793586ed64b3","signals":[{"optionId":"a","attributeKey":"discovery.values.ab","value":"a","statement":"For “For important moments, what helps you show up?”, you chose “Plan ahead around them”.","scope":"For important moments, what helps you show up?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.values.ab","value":"b","statement":"For “For important moments, what helps you show up?”, you chose “Leave room in my schedule”.","scope":"For important moments, what helps you show up?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-values-ba',1,'{"id":"existing-values-ba","version":1,"familyId":"existing-values-ba","domain":"values","subdomain":"values","prompt":"To deepen a strength, what feels rewarding?","format":"choice","choices":[{"id":"a","label":"Become more capable independently"},{"id":"b","label":"Use it to help someone else"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:values"],"legacyQuestionId":"0cffda53-6ad0-410c-a9e9-c114799821cd","signals":[{"optionId":"a","attributeKey":"discovery.values.ba","value":"a","statement":"For “To deepen a strength, what feels rewarding?”, you chose “Become more capable independently”.","scope":"To deepen a strength, what feels rewarding?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.values.ba","value":"b","statement":"For “To deepen a strength, what feels rewarding?”, you chose “Use it to help someone else”.","scope":"To deepen a strength, what feels rewarding?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-values-bb',1,'{"id":"existing-values-bb","version":1,"familyId":"existing-values-bb","domain":"values","subdomain":"values","prompt":"To explore a new direction, what would help?","format":"choice","choices":[{"id":"a","label":"A low-stakes experiment"},{"id":"b","label":"Encouragement from someone I trust"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:values"],"legacyQuestionId":"c4704fc5-d3ac-42b4-a543-16cb1bcd67d7","signals":[{"optionId":"a","attributeKey":"discovery.values.bb","value":"a","statement":"For “To explore a new direction, what would help?”, you chose “A low-stakes experiment”.","scope":"To explore a new direction, what would help?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.values.bb","value":"b","statement":"For “To explore a new direction, what would help?”, you chose “Encouragement from someone I trust”.","scope":"To explore a new direction, what would help?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-time-root',1,'{"id":"existing-time-root","version":1,"familyId":"existing-time-root","domain":"time","subdomain":"time","prompt":"What would make a busy day feel more manageable?","format":"choice","choices":[{"id":"a","label":"A clear plan at the start"},{"id":"b","label":"Space to adjust as it unfolds"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:time"],"legacyQuestionId":"8e3b58c3-e56e-4bfc-a141-22e7654297ba","signals":[{"optionId":"a","attributeKey":"discovery.time.root","value":"a","statement":"For “What would make a busy day feel more manageable?”, you chose “A clear plan at the start”.","scope":"What would make a busy day feel more manageable?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.time.root","value":"b","statement":"For “What would make a busy day feel more manageable?”, you chose “Space to adjust as it unfolds”.","scope":"What would make a busy day feel more manageable?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-time-a',1,'{"id":"existing-time-a","version":1,"familyId":"existing-time-a","domain":"time","subdomain":"time","prompt":"For a clear daily plan, what helps you?","format":"choice","choices":[{"id":"a","label":"Choose three priorities"},{"id":"b","label":"Give tasks specific time blocks"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:time"],"legacyQuestionId":"a457a92d-2f68-447d-a0b2-fa8793ee57c1","signals":[{"optionId":"a","attributeKey":"discovery.time.a","value":"a","statement":"For “For a clear daily plan, what helps you?”, you chose “Choose three priorities”.","scope":"For a clear daily plan, what helps you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.time.a","value":"b","statement":"For “For a clear daily plan, what helps you?”, you chose “Give tasks specific time blocks”.","scope":"For a clear daily plan, what helps you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-time-b',1,'{"id":"existing-time-b","version":1,"familyId":"existing-time-b","domain":"time","subdomain":"time","prompt":"When adjusting through the day, what keeps you grounded?","format":"choice","choices":[{"id":"a","label":"A short mid-day reset"},{"id":"b","label":"A clear rule for what can wait"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:time"],"legacyQuestionId":"af602539-2611-4075-af87-c4b49875a69b","signals":[{"optionId":"a","attributeKey":"discovery.time.b","value":"a","statement":"For “When adjusting through the day, what keeps you grounded?”, you chose “A short mid-day reset”.","scope":"When adjusting through the day, what keeps you grounded?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.time.b","value":"b","statement":"For “When adjusting through the day, what keeps you grounded?”, you chose “A clear rule for what can wait”.","scope":"When adjusting through the day, what keeps you grounded?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-time-aa',1,'{"id":"existing-time-aa","version":1,"familyId":"existing-time-aa","domain":"time","subdomain":"time","prompt":"For three priorities, what would you choose first?","format":"choice","choices":[{"id":"a","label":"The most meaningful task"},{"id":"b","label":"The task blocking other things"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:time"],"legacyQuestionId":"12557726-ef42-47c4-a1ee-f62d5f825335","signals":[{"optionId":"a","attributeKey":"discovery.time.aa","value":"a","statement":"For “For three priorities, what would you choose first?”, you chose “The most meaningful task”.","scope":"For three priorities, what would you choose first?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.time.aa","value":"b","statement":"For “For three priorities, what would you choose first?”, you chose “The task blocking other things”.","scope":"For three priorities, what would you choose first?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-time-ab',1,'{"id":"existing-time-ab","version":1,"familyId":"existing-time-ab","domain":"time","subdomain":"time","prompt":"For time blocks, how much structure feels useful?","format":"choice","choices":[{"id":"a","label":"Predictable recurring blocks"},{"id":"b","label":"A fresh schedule for each day"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:time"],"legacyQuestionId":"ea74ffd8-ce29-4d8e-a191-4fda15a47f41","signals":[{"optionId":"a","attributeKey":"discovery.time.ab","value":"a","statement":"For “For time blocks, how much structure feels useful?”, you chose “Predictable recurring blocks”.","scope":"For time blocks, how much structure feels useful?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.time.ab","value":"b","statement":"For “For time blocks, how much structure feels useful?”, you chose “A fresh schedule for each day”.","scope":"For time blocks, how much structure feels useful?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-time-ba',1,'{"id":"existing-time-ba","version":1,"familyId":"existing-time-ba","domain":"time","subdomain":"time","prompt":"At a mid-day reset, what would help?","format":"choice","choices":[{"id":"a","label":"Review what is still realistic"},{"id":"b","label":"Take a break before deciding"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:time"],"legacyQuestionId":"cd90fe8d-7ded-445f-a204-c5a34da3e932","signals":[{"optionId":"a","attributeKey":"discovery.time.ba","value":"a","statement":"For “At a mid-day reset, what would help?”, you chose “Review what is still realistic”.","scope":"At a mid-day reset, what would help?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.time.ba","value":"b","statement":"For “At a mid-day reset, what would help?”, you chose “Take a break before deciding”.","scope":"At a mid-day reset, what would help?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-time-bb',1,'{"id":"existing-time-bb","version":1,"familyId":"existing-time-bb","domain":"time","subdomain":"time","prompt":"When deciding what can wait, what guides you?","format":"choice","choices":[{"id":"a","label":"The deadline and consequence"},{"id":"b","label":"My available energy"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:time"],"legacyQuestionId":"796dfc49-6b9a-43f4-afe8-b7d97a2d8987","signals":[{"optionId":"a","attributeKey":"discovery.time.bb","value":"a","statement":"For “When deciding what can wait, what guides you?”, you chose “The deadline and consequence”.","scope":"When deciding what can wait, what guides you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.time.bb","value":"b","statement":"For “When deciding what can wait, what guides you?”, you chose “My available energy”.","scope":"When deciding what can wait, what guides you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-creativity-root',1,'{"id":"existing-creativity-root","version":1,"familyId":"existing-creativity-root","domain":"creativity","subdomain":"creativity","prompt":"When making something creative, what starts the process for you?","format":"choice","choices":[{"id":"a","label":"A clear idea to bring to life"},{"id":"b","label":"Exploring until an idea appears"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:creativity"],"legacyQuestionId":"c8fb753c-41a3-4127-a952-6ffcdcaaf408","signals":[{"optionId":"a","attributeKey":"discovery.creativity.root","value":"a","statement":"For “When making something creative, what starts the process for you?”, you chose “A clear idea to bring to life”.","scope":"When making something creative, what starts the process for you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.creativity.root","value":"b","statement":"For “When making something creative, what starts the process for you?”, you chose “Exploring until an idea appears”.","scope":"When making something creative, what starts the process for you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-creativity-a',1,'{"id":"existing-creativity-a","version":1,"familyId":"existing-creativity-a","domain":"creativity","subdomain":"creativity","prompt":"With a clear idea, what helps you begin?","format":"choice","choices":[{"id":"a","label":"A rough outline"},{"id":"b","label":"A quick first version"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:creativity"],"legacyQuestionId":"b24dcc5d-17f1-4be3-a639-80b2ce9d1463","signals":[{"optionId":"a","attributeKey":"discovery.creativity.a","value":"a","statement":"For “With a clear idea, what helps you begin?”, you chose “A rough outline”.","scope":"With a clear idea, what helps you begin?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.creativity.a","value":"b","statement":"For “With a clear idea, what helps you begin?”, you chose “A quick first version”.","scope":"With a clear idea, what helps you begin?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-creativity-b',1,'{"id":"existing-creativity-b","version":1,"familyId":"existing-creativity-b","domain":"creativity","subdomain":"creativity","prompt":"When exploring creatively, what sparks you?","format":"choice","choices":[{"id":"a","label":"An interesting material or tool"},{"id":"b","label":"A prompt or constraint"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:creativity"],"legacyQuestionId":"dfe66509-76e0-482a-aa07-96254f7165dc","signals":[{"optionId":"a","attributeKey":"discovery.creativity.b","value":"a","statement":"For “When exploring creatively, what sparks you?”, you chose “An interesting material or tool”.","scope":"When exploring creatively, what sparks you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.creativity.b","value":"b","statement":"For “When exploring creatively, what sparks you?”, you chose “A prompt or constraint”.","scope":"When exploring creatively, what sparks you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-creativity-aa',1,'{"id":"existing-creativity-aa","version":1,"familyId":"existing-creativity-aa","domain":"creativity","subdomain":"creativity","prompt":"For a rough outline, what feels useful?","format":"choice","choices":[{"id":"a","label":"Map the overall shape"},{"id":"b","label":"Collect a few strong references"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:creativity"],"legacyQuestionId":"1ee4888a-1ff4-428b-a89c-9b3ff770f75e","signals":[{"optionId":"a","attributeKey":"discovery.creativity.aa","value":"a","statement":"For “For a rough outline, what feels useful?”, you chose “Map the overall shape”.","scope":"For a rough outline, what feels useful?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.creativity.aa","value":"b","statement":"For “For a rough outline, what feels useful?”, you chose “Collect a few strong references”.","scope":"For a rough outline, what feels useful?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-creativity-ab',1,'{"id":"existing-creativity-ab","version":1,"familyId":"existing-creativity-ab","domain":"creativity","subdomain":"creativity","prompt":"With a first version, what would you rather do?","format":"choice","choices":[{"id":"a","label":"Finish quickly then revise"},{"id":"b","label":"Develop one section carefully"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:creativity"],"legacyQuestionId":"3e892b14-9d86-4522-a631-cad5cafeba89","signals":[{"optionId":"a","attributeKey":"discovery.creativity.ab","value":"a","statement":"For “With a first version, what would you rather do?”, you chose “Finish quickly then revise”.","scope":"With a first version, what would you rather do?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.creativity.ab","value":"b","statement":"For “With a first version, what would you rather do?”, you chose “Develop one section carefully”.","scope":"With a first version, what would you rather do?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-creativity-ba',1,'{"id":"existing-creativity-ba","version":1,"familyId":"existing-creativity-ba","domain":"creativity","subdomain":"creativity","prompt":"When a material sparks an idea, how do you explore?","format":"choice","choices":[{"id":"a","label":"Experiment freely with its possibilities"},{"id":"b","label":"Learn one technique first"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:creativity"],"legacyQuestionId":"d28765f1-8953-430b-a85f-50dbaa695240","signals":[{"optionId":"a","attributeKey":"discovery.creativity.ba","value":"a","statement":"For “When a material sparks an idea, how do you explore?”, you chose “Experiment freely with its possibilities”.","scope":"When a material sparks an idea, how do you explore?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.creativity.ba","value":"b","statement":"For “When a material sparks an idea, how do you explore?”, you chose “Learn one technique first”.","scope":"When a material sparks an idea, how do you explore?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-creativity-bb',1,'{"id":"existing-creativity-bb","version":1,"familyId":"existing-creativity-bb","domain":"creativity","subdomain":"creativity","prompt":"With a creative constraint, what appeals?","format":"choice","choices":[{"id":"a","label":"A tight time limit"},{"id":"b","label":"A simple theme to interpret"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:creativity"],"legacyQuestionId":"fa7f4d47-3dd5-4eb6-aff8-5f9d5fb7f35f","signals":[{"optionId":"a","attributeKey":"discovery.creativity.bb","value":"a","statement":"For “With a creative constraint, what appeals?”, you chose “A tight time limit”.","scope":"With a creative constraint, what appeals?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.creativity.bb","value":"b","statement":"For “With a creative constraint, what appeals?”, you chose “A simple theme to interpret”.","scope":"With a creative constraint, what appeals?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sustainability-root',1,'{"id":"existing-sustainability-root","version":1,"familyId":"existing-sustainability-root","domain":"community","subdomain":"sustainability","prompt":"For reducing everyday waste, which change seems easier?","format":"choice","choices":[{"id":"a","label":"Use what I own for longer"},{"id":"b","label":"Buy fewer disposable items"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sustainability"],"legacyQuestionId":"7d924496-d043-43d1-a38b-80bba2142478","signals":[{"optionId":"a","attributeKey":"discovery.sustainability.root","value":"a","statement":"For “For reducing everyday waste, which change seems easier?”, you chose “Use what I own for longer”.","scope":"For reducing everyday waste, which change seems easier?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sustainability.root","value":"b","statement":"For “For reducing everyday waste, which change seems easier?”, you chose “Buy fewer disposable items”.","scope":"For reducing everyday waste, which change seems easier?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sustainability-a',1,'{"id":"existing-sustainability-a","version":1,"familyId":"existing-sustainability-a","domain":"community","subdomain":"sustainability","prompt":"To keep something useful longer, what would help?","format":"choice","choices":[{"id":"a","label":"Simple repair skills"},{"id":"b","label":"Better care and maintenance"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sustainability"],"legacyQuestionId":"c0dc739a-4efe-4914-a079-6b168e116fba","signals":[{"optionId":"a","attributeKey":"discovery.sustainability.a","value":"a","statement":"For “To keep something useful longer, what would help?”, you chose “Simple repair skills”.","scope":"To keep something useful longer, what would help?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sustainability.a","value":"b","statement":"For “To keep something useful longer, what would help?”, you chose “Better care and maintenance”.","scope":"To keep something useful longer, what would help?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sustainability-b',1,'{"id":"existing-sustainability-b","version":1,"familyId":"existing-sustainability-b","domain":"community","subdomain":"sustainability","prompt":"For fewer disposable items, what would you try?","format":"choice","choices":[{"id":"a","label":"A reusable item I can carry"},{"id":"b","label":"A refill option near home"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sustainability"],"legacyQuestionId":"a211abb3-e8e1-4575-ae31-f82a9bf4084b","signals":[{"optionId":"a","attributeKey":"discovery.sustainability.b","value":"a","statement":"For “For fewer disposable items, what would you try?”, you chose “A reusable item I can carry”.","scope":"For fewer disposable items, what would you try?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sustainability.b","value":"b","statement":"For “For fewer disposable items, what would you try?”, you chose “A refill option near home”.","scope":"For fewer disposable items, what would you try?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sustainability-aa',1,'{"id":"existing-sustainability-aa","version":1,"familyId":"existing-sustainability-aa","domain":"community","subdomain":"sustainability","prompt":"For simple repairs, how would you learn?","format":"choice","choices":[{"id":"a","label":"Fix one item with guidance"},{"id":"b","label":"Attend a practical workshop"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sustainability"],"legacyQuestionId":"f2140c63-c773-49d4-abad-5534825e42bb","signals":[{"optionId":"a","attributeKey":"discovery.sustainability.aa","value":"a","statement":"For “For simple repairs, how would you learn?”, you chose “Fix one item with guidance”.","scope":"For simple repairs, how would you learn?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sustainability.aa","value":"b","statement":"For “For simple repairs, how would you learn?”, you chose “Attend a practical workshop”.","scope":"For simple repairs, how would you learn?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sustainability-ab',1,'{"id":"existing-sustainability-ab","version":1,"familyId":"existing-sustainability-ab","domain":"community","subdomain":"sustainability","prompt":"For better maintenance, what works for you?","format":"choice","choices":[{"id":"a","label":"A small regular routine"},{"id":"b","label":"Care instructions when I need them"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sustainability"],"legacyQuestionId":"27376b00-da10-4ce8-ad35-919df401c3f6","signals":[{"optionId":"a","attributeKey":"discovery.sustainability.ab","value":"a","statement":"For “For better maintenance, what works for you?”, you chose “A small regular routine”.","scope":"For better maintenance, what works for you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sustainability.ab","value":"b","statement":"For “For better maintenance, what works for you?”, you chose “Care instructions when I need them”.","scope":"For better maintenance, what works for you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sustainability-ba',1,'{"id":"existing-sustainability-ba","version":1,"familyId":"existing-sustainability-ba","domain":"community","subdomain":"sustainability","prompt":"For a reusable item, what matters most?","format":"choice","choices":[{"id":"a","label":"Convenience to carry"},{"id":"b","label":"Easy cleaning after use"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sustainability"],"legacyQuestionId":"8f5b118c-53fa-4893-a76b-bfbd9258dd7a","signals":[{"optionId":"a","attributeKey":"discovery.sustainability.ba","value":"a","statement":"For “For a reusable item, what matters most?”, you chose “Convenience to carry”.","scope":"For a reusable item, what matters most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sustainability.ba","value":"b","statement":"For “For a reusable item, what matters most?”, you chose “Easy cleaning after use”.","scope":"For a reusable item, what matters most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sustainability-bb',1,'{"id":"existing-sustainability-bb","version":1,"familyId":"existing-sustainability-bb","domain":"community","subdomain":"sustainability","prompt":"With refills, what would make the habit practical?","format":"choice","choices":[{"id":"a","label":"Add it to an existing errand"},{"id":"b","label":"Buy enough to reduce trips"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sustainability"],"legacyQuestionId":"44be8d76-2f67-49cd-aff9-ac86e29d9e22","signals":[{"optionId":"a","attributeKey":"discovery.sustainability.bb","value":"a","statement":"For “With refills, what would make the habit practical?”, you chose “Add it to an existing errand”.","scope":"With refills, what would make the habit practical?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sustainability.bb","value":"b","statement":"For “With refills, what would make the habit practical?”, you chose “Buy enough to reduce trips”.","scope":"With refills, what would make the habit practical?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-wellbeing-root',1,'{"id":"existing-wellbeing-root","version":1,"familyId":"existing-wellbeing-root","domain":"rest","subdomain":"wellbeing","prompt":"After an overstimulating day, what helps you recover?","format":"choice","choices":[{"id":"a","label":"Quiet time on my own"},{"id":"b","label":"Gentle company"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:wellbeing"],"legacyQuestionId":"3d1408b1-c088-4e4b-ac13-052c680c395c","signals":[{"optionId":"a","attributeKey":"discovery.wellbeing.root","value":"a","statement":"For “After an overstimulating day, what helps you recover?”, you chose “Quiet time on my own”.","scope":"After an overstimulating day, what helps you recover?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.wellbeing.root","value":"b","statement":"For “After an overstimulating day, what helps you recover?”, you chose “Gentle company”.","scope":"After an overstimulating day, what helps you recover?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-wellbeing-a',1,'{"id":"existing-wellbeing-a","version":1,"familyId":"existing-wellbeing-a","domain":"rest","subdomain":"wellbeing","prompt":"For quiet recovery, what would feel best?","format":"choice","choices":[{"id":"a","label":"An activity without screens"},{"id":"b","label":"Doing very little for a while"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:wellbeing"],"legacyQuestionId":"0cfcedb6-392c-482f-af29-febc0743c6e3","signals":[{"optionId":"a","attributeKey":"discovery.wellbeing.a","value":"a","statement":"For “For quiet recovery, what would feel best?”, you chose “An activity without screens”.","scope":"For quiet recovery, what would feel best?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.wellbeing.a","value":"b","statement":"For “For quiet recovery, what would feel best?”, you chose “Doing very little for a while”.","scope":"For quiet recovery, what would feel best?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-wellbeing-b',1,'{"id":"existing-wellbeing-b","version":1,"familyId":"existing-wellbeing-b","domain":"rest","subdomain":"wellbeing","prompt":"For gentle company, what would you enjoy?","format":"choice","choices":[{"id":"a","label":"A familiar person nearby"},{"id":"b","label":"A low-key shared activity"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:wellbeing"],"legacyQuestionId":"1888cf57-52b3-4e1d-a2fd-fae87cb94306","signals":[{"optionId":"a","attributeKey":"discovery.wellbeing.b","value":"a","statement":"For “For gentle company, what would you enjoy?”, you chose “A familiar person nearby”.","scope":"For gentle company, what would you enjoy?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.wellbeing.b","value":"b","statement":"For “For gentle company, what would you enjoy?”, you chose “A low-key shared activity”.","scope":"For gentle company, what would you enjoy?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-wellbeing-aa',1,'{"id":"existing-wellbeing-aa","version":1,"familyId":"existing-wellbeing-aa","domain":"rest","subdomain":"wellbeing","prompt":"For screen-free recovery, what helps you unwind?","format":"choice","choices":[{"id":"a","label":"A short walk outdoors"},{"id":"b","label":"A small hands-on task"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:wellbeing"],"legacyQuestionId":"881a576b-832f-4ea3-ad0b-dcbe68b540c3","signals":[{"optionId":"a","attributeKey":"discovery.wellbeing.aa","value":"a","statement":"For “For screen-free recovery, what helps you unwind?”, you chose “A short walk outdoors”.","scope":"For screen-free recovery, what helps you unwind?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.wellbeing.aa","value":"b","statement":"For “For screen-free recovery, what helps you unwind?”, you chose “A small hands-on task”.","scope":"For screen-free recovery, what helps you unwind?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-wellbeing-ab',1,'{"id":"existing-wellbeing-ab","version":1,"familyId":"existing-wellbeing-ab","domain":"rest","subdomain":"wellbeing","prompt":"When doing very little, what makes it easier?","format":"choice","choices":[{"id":"a","label":"A clear break with no obligations"},{"id":"b","label":"A comfortable place to rest"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:wellbeing"],"legacyQuestionId":"015dd204-9632-45fb-ac1a-38cd84d43867","signals":[{"optionId":"a","attributeKey":"discovery.wellbeing.ab","value":"a","statement":"For “When doing very little, what makes it easier?”, you chose “A clear break with no obligations”.","scope":"When doing very little, what makes it easier?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.wellbeing.ab","value":"b","statement":"For “When doing very little, what makes it easier?”, you chose “A comfortable place to rest”.","scope":"When doing very little, what makes it easier?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-wellbeing-ba',1,'{"id":"existing-wellbeing-ba","version":1,"familyId":"existing-wellbeing-ba","domain":"rest","subdomain":"wellbeing","prompt":"With someone familiar nearby, what feels supportive?","format":"choice","choices":[{"id":"a","label":"Talking a little about the day"},{"id":"b","label":"Being together without needing to talk"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:wellbeing"],"legacyQuestionId":"8e87798c-30c2-4a3b-a40a-033c342d919e","signals":[{"optionId":"a","attributeKey":"discovery.wellbeing.ba","value":"a","statement":"For “With someone familiar nearby, what feels supportive?”, you chose “Talking a little about the day”.","scope":"With someone familiar nearby, what feels supportive?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.wellbeing.ba","value":"b","statement":"For “With someone familiar nearby, what feels supportive?”, you chose “Being together without needing to talk”.","scope":"With someone familiar nearby, what feels supportive?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-wellbeing-bb',1,'{"id":"existing-wellbeing-bb","version":1,"familyId":"existing-wellbeing-bb","domain":"rest","subdomain":"wellbeing","prompt":"For a low-key activity with company, what would you choose?","format":"choice","choices":[{"id":"a","label":"Prepare an easy meal"},{"id":"b","label":"Watch something familiar"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:wellbeing"],"legacyQuestionId":"79c70f87-5adf-4bef-aae2-bbd36181f7a7","signals":[{"optionId":"a","attributeKey":"discovery.wellbeing.bb","value":"a","statement":"For “For a low-key activity with company, what would you choose?”, you chose “Prepare an easy meal”.","scope":"For a low-key activity with company, what would you choose?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.wellbeing.bb","value":"b","statement":"For “For a low-key activity with company, what would you choose?”, you chose “Watch something familiar”.","scope":"For a low-key activity with company, what would you choose?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-gaming-root',1,'{"id":"existing-gaming-root","version":1,"familyId":"existing-gaming-root","domain":"play","subdomain":"gaming","prompt":"What makes a game session satisfying for you?","format":"choice","choices":[{"id":"a","label":"Work toward a clear objective"},{"id":"b","label":"Explore without a fixed plan"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:gaming"],"legacyQuestionId":"0f1e72c0-4b11-48bc-a13f-daa4c339f08b","signals":[{"optionId":"a","attributeKey":"discovery.gaming.root","value":"a","statement":"For “What makes a game session satisfying for you?”, you chose “Work toward a clear objective”.","scope":"What makes a game session satisfying for you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.gaming.root","value":"b","statement":"For “What makes a game session satisfying for you?”, you chose “Explore without a fixed plan”.","scope":"What makes a game session satisfying for you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-gaming-a',1,'{"id":"existing-gaming-a","version":1,"familyId":"existing-gaming-a","domain":"play","subdomain":"gaming","prompt":"When pursuing a game objective, what do you enjoy most?","format":"choice","choices":[{"id":"a","label":"Improve a strategy"},{"id":"b","label":"Build something over time"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:gaming"],"legacyQuestionId":"825cbe28-a567-4673-a8f3-5d2a4bfddf3e","signals":[{"optionId":"a","attributeKey":"discovery.gaming.a","value":"a","statement":"For “When pursuing a game objective, what do you enjoy most?”, you chose “Improve a strategy”.","scope":"When pursuing a game objective, what do you enjoy most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.gaming.a","value":"b","statement":"For “When pursuing a game objective, what do you enjoy most?”, you chose “Build something over time”.","scope":"When pursuing a game objective, what do you enjoy most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-gaming-b',1,'{"id":"existing-gaming-b","version":1,"familyId":"existing-gaming-b","domain":"play","subdomain":"gaming","prompt":"When exploring a game, what draws you onward?","format":"choice","choices":[{"id":"a","label":"Discover unfamiliar places"},{"id":"b","label":"Try unexpected interactions"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:gaming"],"legacyQuestionId":"8a3cac4b-8e75-4dbb-aed6-f2e59d7c76fe","signals":[{"optionId":"a","attributeKey":"discovery.gaming.b","value":"a","statement":"For “When exploring a game, what draws you onward?”, you chose “Discover unfamiliar places”.","scope":"When exploring a game, what draws you onward?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.gaming.b","value":"b","statement":"For “When exploring a game, what draws you onward?”, you chose “Try unexpected interactions”.","scope":"When exploring a game, what draws you onward?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-gaming-aa',1,'{"id":"existing-gaming-aa","version":1,"familyId":"existing-gaming-aa","domain":"play","subdomain":"gaming","prompt":"For improving a strategy, what feels rewarding?","format":"choice","choices":[{"id":"a","label":"Experiment and learn from attempts"},{"id":"b","label":"Study the rules before trying"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:gaming"],"legacyQuestionId":"6a7c2ec1-b11f-4171-a7cc-956f84a0e066","signals":[{"optionId":"a","attributeKey":"discovery.gaming.aa","value":"a","statement":"For “For improving a strategy, what feels rewarding?”, you chose “Experiment and learn from attempts”.","scope":"For improving a strategy, what feels rewarding?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.gaming.aa","value":"b","statement":"For “For improving a strategy, what feels rewarding?”, you chose “Study the rules before trying”.","scope":"For improving a strategy, what feels rewarding?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-gaming-ab',1,'{"id":"existing-gaming-ab","version":1,"familyId":"existing-gaming-ab","domain":"play","subdomain":"gaming","prompt":"For a long game project, what keeps you interested?","format":"choice","choices":[{"id":"a","label":"Visible progress each session"},{"id":"b","label":"Freedom to change the design"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:gaming"],"legacyQuestionId":"6d7d476f-7fbd-408a-ad88-98334759a486","signals":[{"optionId":"a","attributeKey":"discovery.gaming.ab","value":"a","statement":"For “For a long game project, what keeps you interested?”, you chose “Visible progress each session”.","scope":"For a long game project, what keeps you interested?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.gaming.ab","value":"b","statement":"For “For a long game project, what keeps you interested?”, you chose “Freedom to change the design”.","scope":"For a long game project, what keeps you interested?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-gaming-ba',1,'{"id":"existing-gaming-ba","version":1,"familyId":"existing-gaming-ba","domain":"play","subdomain":"gaming","prompt":"While discovering a game world, what would you prefer?","format":"choice","choices":[{"id":"a","label":"Explore at my own pace"},{"id":"b","label":"Share discoveries with friends"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:gaming"],"legacyQuestionId":"43f5e3e1-f942-4e26-a04f-e763a1510a4c","signals":[{"optionId":"a","attributeKey":"discovery.gaming.ba","value":"a","statement":"For “While discovering a game world, what would you prefer?”, you chose “Explore at my own pace”.","scope":"While discovering a game world, what would you prefer?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.gaming.ba","value":"b","statement":"For “While discovering a game world, what would you prefer?”, you chose “Share discoveries with friends”.","scope":"While discovering a game world, what would you prefer?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-gaming-bb',1,'{"id":"existing-gaming-bb","version":1,"familyId":"existing-gaming-bb","domain":"play","subdomain":"gaming","prompt":"When testing game interactions, what sounds fun?","format":"choice","choices":[{"id":"a","label":"Solve a puzzle within the rules"},{"id":"b","label":"Make up a personal challenge"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:gaming"],"legacyQuestionId":"02a92476-dc3b-4f32-a0c6-b75cb7e99f42","signals":[{"optionId":"a","attributeKey":"discovery.gaming.bb","value":"a","statement":"For “When testing game interactions, what sounds fun?”, you chose “Solve a puzzle within the rules”.","scope":"When testing game interactions, what sounds fun?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.gaming.bb","value":"b","statement":"For “When testing game interactions, what sounds fun?”, you chose “Make up a personal challenge”.","scope":"When testing game interactions, what sounds fun?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-outdoors-root',1,'{"id":"existing-outdoors-root","version":1,"familyId":"existing-outdoors-root","domain":"places","subdomain":"outdoors","prompt":"For time outdoors, what would you enjoy more?","format":"choice","choices":[{"id":"a","label":"Follow a familiar route"},{"id":"b","label":"Explore a new place"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:outdoors"],"legacyQuestionId":"eaeb2a27-9640-4dab-a386-61942dac1fe9","signals":[{"optionId":"a","attributeKey":"discovery.outdoors.root","value":"a","statement":"For “For time outdoors, what would you enjoy more?”, you chose “Follow a familiar route”.","scope":"For time outdoors, what would you enjoy more?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.outdoors.root","value":"b","statement":"For “For time outdoors, what would you enjoy more?”, you chose “Explore a new place”.","scope":"For time outdoors, what would you enjoy more?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-outdoors-a',1,'{"id":"existing-outdoors-a","version":1,"familyId":"existing-outdoors-a","domain":"places","subdomain":"outdoors","prompt":"On a familiar outdoor route, what makes it enjoyable?","format":"choice","choices":[{"id":"a","label":"Notice small seasonal changes"},{"id":"b","label":"Keep a comfortable steady rhythm"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:outdoors"],"legacyQuestionId":"f9fd10b4-8ea8-4735-a863-5c2c8a9b19de","signals":[{"optionId":"a","attributeKey":"discovery.outdoors.a","value":"a","statement":"For “On a familiar outdoor route, what makes it enjoyable?”, you chose “Notice small seasonal changes”.","scope":"On a familiar outdoor route, what makes it enjoyable?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.outdoors.a","value":"b","statement":"For “On a familiar outdoor route, what makes it enjoyable?”, you chose “Keep a comfortable steady rhythm”.","scope":"On a familiar outdoor route, what makes it enjoyable?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-outdoors-b',1,'{"id":"existing-outdoors-b","version":1,"familyId":"existing-outdoors-b","domain":"places","subdomain":"outdoors","prompt":"When exploring somewhere new outdoors, what helps you enjoy it?","format":"choice","choices":[{"id":"a","label":"A clear route planned in advance"},{"id":"b","label":"A short flexible outing"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:outdoors"],"legacyQuestionId":"0418296e-60e2-447f-aeae-e24a62857a1d","signals":[{"optionId":"a","attributeKey":"discovery.outdoors.b","value":"a","statement":"For “When exploring somewhere new outdoors, what helps you enjoy it?”, you chose “A clear route planned in advance”.","scope":"When exploring somewhere new outdoors, what helps you enjoy it?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.outdoors.b","value":"b","statement":"For “When exploring somewhere new outdoors, what helps you enjoy it?”, you chose “A short flexible outing”.","scope":"When exploring somewhere new outdoors, what helps you enjoy it?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-outdoors-aa',1,'{"id":"existing-outdoors-aa","version":1,"familyId":"existing-outdoors-aa","domain":"places","subdomain":"outdoors","prompt":"For noticing seasonal changes, what would you bring?","format":"choice","choices":[{"id":"a","label":"A camera or sketchbook"},{"id":"b","label":"Only time to look around"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:outdoors"],"legacyQuestionId":"2f238817-f2f1-4098-ad43-b223bec1bac2","signals":[{"optionId":"a","attributeKey":"discovery.outdoors.aa","value":"a","statement":"For “For noticing seasonal changes, what would you bring?”, you chose “A camera or sketchbook”.","scope":"For noticing seasonal changes, what would you bring?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.outdoors.aa","value":"b","statement":"For “For noticing seasonal changes, what would you bring?”, you chose “Only time to look around”.","scope":"For noticing seasonal changes, what would you bring?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-outdoors-ab',1,'{"id":"existing-outdoors-ab","version":1,"familyId":"existing-outdoors-ab","domain":"places","subdomain":"outdoors","prompt":"For a comfortable outdoor rhythm, what would you choose?","format":"choice","choices":[{"id":"a","label":"A quiet solo outing"},{"id":"b","label":"Someone who enjoys the same pace"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:outdoors"],"legacyQuestionId":"b86b5727-0197-4bac-a945-9a4ac05e8047","signals":[{"optionId":"a","attributeKey":"discovery.outdoors.ab","value":"a","statement":"For “For a comfortable outdoor rhythm, what would you choose?”, you chose “A quiet solo outing”.","scope":"For a comfortable outdoor rhythm, what would you choose?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.outdoors.ab","value":"b","statement":"For “For a comfortable outdoor rhythm, what would you choose?”, you chose “Someone who enjoys the same pace”.","scope":"For a comfortable outdoor rhythm, what would you choose?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-outdoors-ba',1,'{"id":"existing-outdoors-ba","version":1,"familyId":"existing-outdoors-ba","domain":"places","subdomain":"outdoors","prompt":"For planning a new route, what would you prefer?","format":"choice","choices":[{"id":"a","label":"Check the terrain and conditions"},{"id":"b","label":"Start with a well-described short route"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:outdoors"],"legacyQuestionId":"40814eda-4f7c-4ac3-a8da-b550a3107297","signals":[{"optionId":"a","attributeKey":"discovery.outdoors.ba","value":"a","statement":"For “For planning a new route, what would you prefer?”, you chose “Check the terrain and conditions”.","scope":"For planning a new route, what would you prefer?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.outdoors.ba","value":"b","statement":"For “For planning a new route, what would you prefer?”, you chose “Start with a well-described short route”.","scope":"For planning a new route, what would you prefer?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-outdoors-bb',1,'{"id":"existing-outdoors-bb","version":1,"familyId":"existing-outdoors-bb","domain":"places","subdomain":"outdoors","prompt":"For a flexible outdoor outing, what would you prioritise?","format":"choice","choices":[{"id":"a","label":"Time to stop and observe"},{"id":"b","label":"A few places close together"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:outdoors"],"legacyQuestionId":"d47f50a3-994e-49e9-a82a-f9277fe9931f","signals":[{"optionId":"a","attributeKey":"discovery.outdoors.bb","value":"a","statement":"For “For a flexible outdoor outing, what would you prioritise?”, you chose “Time to stop and observe”.","scope":"For a flexible outdoor outing, what would you prioritise?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.outdoors.bb","value":"b","statement":"For “For a flexible outdoor outing, what would you prioritise?”, you chose “A few places close together”.","scope":"For a flexible outdoor outing, what would you prioritise?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-reading-root',1,'{"id":"existing-reading-root","version":1,"familyId":"existing-reading-root","domain":"culture","subdomain":"reading","prompt":"What draws you to your next book?","format":"choice","choices":[{"id":"a","label":"A world to become immersed in"},{"id":"b","label":"An idea I want to understand"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:reading"],"legacyQuestionId":"1f859a15-8e9a-4761-a69b-62109f3390ad","signals":[{"optionId":"a","attributeKey":"discovery.reading.root","value":"a","statement":"For “What draws you to your next book?”, you chose “A world to become immersed in”.","scope":"What draws you to your next book?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.reading.root","value":"b","statement":"For “What draws you to your next book?”, you chose “An idea I want to understand”.","scope":"What draws you to your next book?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-reading-a',1,'{"id":"existing-reading-a","version":1,"familyId":"existing-reading-a","domain":"culture","subdomain":"reading","prompt":"For an immersive book, what holds your attention?","format":"choice","choices":[{"id":"a","label":"Characters with inner depth"},{"id":"b","label":"A setting full of discoveries"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:reading"],"legacyQuestionId":"fc5778f5-0ee4-4f9d-a9fb-05b64398a8c3","signals":[{"optionId":"a","attributeKey":"discovery.reading.a","value":"a","statement":"For “For an immersive book, what holds your attention?”, you chose “Characters with inner depth”.","scope":"For an immersive book, what holds your attention?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.reading.a","value":"b","statement":"For “For an immersive book, what holds your attention?”, you chose “A setting full of discoveries”.","scope":"For an immersive book, what holds your attention?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-reading-b',1,'{"id":"existing-reading-b","version":1,"familyId":"existing-reading-b","domain":"culture","subdomain":"reading","prompt":"When reading about an idea, what helps you engage?","format":"choice","choices":[{"id":"a","label":"Concrete examples and stories"},{"id":"b","label":"A clear structured argument"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:reading"],"legacyQuestionId":"243888a7-0fcb-4f9a-a457-674c4ba10f94","signals":[{"optionId":"a","attributeKey":"discovery.reading.b","value":"a","statement":"For “When reading about an idea, what helps you engage?”, you chose “Concrete examples and stories”.","scope":"When reading about an idea, what helps you engage?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.reading.b","value":"b","statement":"For “When reading about an idea, what helps you engage?”, you chose “A clear structured argument”.","scope":"When reading about an idea, what helps you engage?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-reading-aa',1,'{"id":"existing-reading-aa","version":1,"familyId":"existing-reading-aa","domain":"culture","subdomain":"reading","prompt":"With complex characters, what do you enjoy?","format":"choice","choices":[{"id":"a","label":"Gradual changes in relationships"},{"id":"b","label":"A surprising personal perspective"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:reading"],"legacyQuestionId":"8c619680-c450-4bda-a116-9b3ccd1b291e","signals":[{"optionId":"a","attributeKey":"discovery.reading.aa","value":"a","statement":"For “With complex characters, what do you enjoy?”, you chose “Gradual changes in relationships”.","scope":"With complex characters, what do you enjoy?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.reading.aa","value":"b","statement":"For “With complex characters, what do you enjoy?”, you chose “A surprising personal perspective”.","scope":"With complex characters, what do you enjoy?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-reading-ab',1,'{"id":"existing-reading-ab","version":1,"familyId":"existing-reading-ab","domain":"culture","subdomain":"reading","prompt":"For a richly imagined setting, what appeals most?","format":"choice","choices":[{"id":"a","label":"Everyday details of its world"},{"id":"b","label":"A large unfolding mystery"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:reading"],"legacyQuestionId":"f6d953fc-8392-4708-a23a-a27954e41da9","signals":[{"optionId":"a","attributeKey":"discovery.reading.ab","value":"a","statement":"For “For a richly imagined setting, what appeals most?”, you chose “Everyday details of its world”.","scope":"For a richly imagined setting, what appeals most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.reading.ab","value":"b","statement":"For “For a richly imagined setting, what appeals most?”, you chose “A large unfolding mystery”.","scope":"For a richly imagined setting, what appeals most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-reading-ba',1,'{"id":"existing-reading-ba","version":1,"familyId":"existing-reading-ba","domain":"culture","subdomain":"reading","prompt":"When examples explain an idea, what do you prefer?","format":"choice","choices":[{"id":"a","label":"Follow one case in depth"},{"id":"b","label":"Compare several different cases"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:reading"],"legacyQuestionId":"439ac49a-c3ba-4f75-a2a2-f4eb9a074b0b","signals":[{"optionId":"a","attributeKey":"discovery.reading.ba","value":"a","statement":"For “When examples explain an idea, what do you prefer?”, you chose “Follow one case in depth”.","scope":"When examples explain an idea, what do you prefer?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.reading.ba","value":"b","statement":"For “When examples explain an idea, what do you prefer?”, you chose “Compare several different cases”.","scope":"When examples explain an idea, what do you prefer?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-reading-bb',1,'{"id":"existing-reading-bb","version":1,"familyId":"existing-reading-bb","domain":"culture","subdomain":"reading","prompt":"For a structured argument, what would you do?","format":"choice","choices":[{"id":"a","label":"Take notes as I read"},{"id":"b","label":"Discuss it after finishing"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:reading"],"legacyQuestionId":"938bd5f2-0c86-41b1-ac84-88ccc94bb666","signals":[{"optionId":"a","attributeKey":"discovery.reading.bb","value":"a","statement":"For “For a structured argument, what would you do?”, you chose “Take notes as I read”.","scope":"For a structured argument, what would you do?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.reading.bb","value":"b","statement":"For “For a structured argument, what would you do?”, you chose “Discuss it after finishing”.","scope":"For a structured argument, what would you do?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-making-root',1,'{"id":"existing-making-root","version":1,"familyId":"existing-making-root","domain":"creativity","subdomain":"making","prompt":"For a hands-on project, what sounds rewarding?","format":"choice","choices":[{"id":"a","label":"Repair something I already own"},{"id":"b","label":"Make something new"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:making"],"legacyQuestionId":"39be16da-a696-404d-abc9-f43507a35fea","signals":[{"optionId":"a","attributeKey":"discovery.making.root","value":"a","statement":"For “For a hands-on project, what sounds rewarding?”, you chose “Repair something I already own”.","scope":"For a hands-on project, what sounds rewarding?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.making.root","value":"b","statement":"For “For a hands-on project, what sounds rewarding?”, you chose “Make something new”.","scope":"For a hands-on project, what sounds rewarding?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-making-a',1,'{"id":"existing-making-a","version":1,"familyId":"existing-making-a","domain":"creativity","subdomain":"making","prompt":"When repairing something, how would you begin?","format":"choice","choices":[{"id":"a","label":"Understand why it stopped working"},{"id":"b","label":"Follow a trusted repair guide"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:making"],"legacyQuestionId":"cdc72f4a-79ec-4005-addc-41ab9100973c","signals":[{"optionId":"a","attributeKey":"discovery.making.a","value":"a","statement":"For “When repairing something, how would you begin?”, you chose “Understand why it stopped working”.","scope":"When repairing something, how would you begin?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.making.a","value":"b","statement":"For “When repairing something, how would you begin?”, you chose “Follow a trusted repair guide”.","scope":"When repairing something, how would you begin?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-making-b',1,'{"id":"existing-making-b","version":1,"familyId":"existing-making-b","domain":"creativity","subdomain":"making","prompt":"For making something new, what inspires you?","format":"choice","choices":[{"id":"a","label":"A practical need"},{"id":"b","label":"An interesting material"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:making"],"legacyQuestionId":"4ee552b1-a8a4-4bf9-a6af-39aa2579c7bb","signals":[{"optionId":"a","attributeKey":"discovery.making.b","value":"a","statement":"For “For making something new, what inspires you?”, you chose “A practical need”.","scope":"For making something new, what inspires you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.making.b","value":"b","statement":"For “For making something new, what inspires you?”, you chose “An interesting material”.","scope":"For making something new, what inspires you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-making-aa',1,'{"id":"existing-making-aa","version":1,"familyId":"existing-making-aa","domain":"creativity","subdomain":"making","prompt":"When understanding a fault, what helps you?","format":"choice","choices":[{"id":"a","label":"A diagram of the parts"},{"id":"b","label":"A careful step-by-step inspection"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:making"],"legacyQuestionId":"26a0c515-3967-4014-a65e-7362ee918037","signals":[{"optionId":"a","attributeKey":"discovery.making.aa","value":"a","statement":"For “When understanding a fault, what helps you?”, you chose “A diagram of the parts”.","scope":"When understanding a fault, what helps you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.making.aa","value":"b","statement":"For “When understanding a fault, what helps you?”, you chose “A careful step-by-step inspection”.","scope":"When understanding a fault, what helps you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-making-ab',1,'{"id":"existing-making-ab","version":1,"familyId":"existing-making-ab","domain":"creativity","subdomain":"making","prompt":"With a repair guide, what would you prefer?","format":"choice","choices":[{"id":"a","label":"Clear written instructions"},{"id":"b","label":"A close-up demonstration"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:making"],"legacyQuestionId":"16bf5ddb-05db-4ecc-a5f9-96a2467de2ca","signals":[{"optionId":"a","attributeKey":"discovery.making.ab","value":"a","statement":"For “With a repair guide, what would you prefer?”, you chose “Clear written instructions”.","scope":"With a repair guide, what would you prefer?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.making.ab","value":"b","statement":"For “With a repair guide, what would you prefer?”, you chose “A close-up demonstration”.","scope":"With a repair guide, what would you prefer?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-making-ba',1,'{"id":"existing-making-ba","version":1,"familyId":"existing-making-ba","domain":"creativity","subdomain":"making","prompt":"For a practical project, what matters most?","format":"choice","choices":[{"id":"a","label":"A reliable simple result"},{"id":"b","label":"A design tailored to my routine"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:making"],"legacyQuestionId":"5a518e1c-c325-451d-a7e6-a4dcda03370e","signals":[{"optionId":"a","attributeKey":"discovery.making.ba","value":"a","statement":"For “For a practical project, what matters most?”, you chose “A reliable simple result”.","scope":"For a practical project, what matters most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.making.ba","value":"b","statement":"For “For a practical project, what matters most?”, you chose “A design tailored to my routine”.","scope":"For a practical project, what matters most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-making-bb',1,'{"id":"existing-making-bb","version":1,"familyId":"existing-making-bb","domain":"creativity","subdomain":"making","prompt":"When exploring a material, how would you start?","format":"choice","choices":[{"id":"a","label":"Make a small sample"},{"id":"b","label":"Adapt a familiar technique"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:making"],"legacyQuestionId":"db0f755a-59ce-40ed-a8bb-15502f88afb6","signals":[{"optionId":"a","attributeKey":"discovery.making.bb","value":"a","statement":"For “When exploring a material, how would you start?”, you chose “Make a small sample”.","scope":"When exploring a material, how would you start?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.making.bb","value":"b","statement":"For “When exploring a material, how would you start?”, you chose “Adapt a familiar technique”.","scope":"When exploring a material, how would you start?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-community-root',1,'{"id":"existing-community-root","version":1,"familyId":"existing-community-root","domain":"community","subdomain":"community","prompt":"How would you like to contribute to a community?","format":"choice","choices":[{"id":"a","label":"Help with a practical task"},{"id":"b","label":"Share a skill I know"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:community"],"legacyQuestionId":"32332730-2fac-4407-ad7c-61f82ebe95e7","signals":[{"optionId":"a","attributeKey":"discovery.community.root","value":"a","statement":"For “How would you like to contribute to a community?”, you chose “Help with a practical task”.","scope":"How would you like to contribute to a community?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.community.root","value":"b","statement":"For “How would you like to contribute to a community?”, you chose “Share a skill I know”.","scope":"How would you like to contribute to a community?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-community-a',1,'{"id":"existing-community-a","version":1,"familyId":"existing-community-a","domain":"community","subdomain":"community","prompt":"For a practical community task, what suits you?","format":"choice","choices":[{"id":"a","label":"A regular small commitment"},{"id":"b","label":"An occasional focused event"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:community"],"legacyQuestionId":"35abaa0e-6ce0-41e9-a30f-ac504a58bb2f","signals":[{"optionId":"a","attributeKey":"discovery.community.a","value":"a","statement":"For “For a practical community task, what suits you?”, you chose “A regular small commitment”.","scope":"For a practical community task, what suits you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.community.a","value":"b","statement":"For “For a practical community task, what suits you?”, you chose “An occasional focused event”.","scope":"For a practical community task, what suits you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-community-b',1,'{"id":"existing-community-b","version":1,"familyId":"existing-community-b","domain":"community","subdomain":"community","prompt":"When sharing a skill, what feels comfortable?","format":"choice","choices":[{"id":"a","label":"Help one person at a time"},{"id":"b","label":"Join a small learning group"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:community"],"legacyQuestionId":"b490f935-258d-480e-acaa-a1eab1ec9ad9","signals":[{"optionId":"a","attributeKey":"discovery.community.b","value":"a","statement":"For “When sharing a skill, what feels comfortable?”, you chose “Help one person at a time”.","scope":"When sharing a skill, what feels comfortable?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.community.b","value":"b","statement":"For “When sharing a skill, what feels comfortable?”, you chose “Join a small learning group”.","scope":"When sharing a skill, what feels comfortable?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-community-aa',1,'{"id":"existing-community-aa","version":1,"familyId":"existing-community-aa","domain":"community","subdomain":"community","prompt":"For a regular commitment, what would help?","format":"choice","choices":[{"id":"a","label":"A predictable role"},{"id":"b","label":"A team I get to know"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:community"],"legacyQuestionId":"c6eddcc6-b06f-4ee7-a77a-48deb73df420","signals":[{"optionId":"a","attributeKey":"discovery.community.aa","value":"a","statement":"For “For a regular commitment, what would help?”, you chose “A predictable role”.","scope":"For a regular commitment, what would help?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.community.aa","value":"b","statement":"For “For a regular commitment, what would help?”, you chose “A team I get to know”.","scope":"For a regular commitment, what would help?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-community-ab',1,'{"id":"existing-community-ab","version":1,"familyId":"existing-community-ab","domain":"community","subdomain":"community","prompt":"For an occasional event, what draws you in?","format":"choice","choices":[{"id":"a","label":"A clear useful outcome"},{"id":"b","label":"The chance to meet local people"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:community"],"legacyQuestionId":"585c0126-4a5f-4a28-a74e-29349deb14e6","signals":[{"optionId":"a","attributeKey":"discovery.community.ab","value":"a","statement":"For “For an occasional event, what draws you in?”, you chose “A clear useful outcome”.","scope":"For an occasional event, what draws you in?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.community.ab","value":"b","statement":"For “For an occasional event, what draws you in?”, you chose “The chance to meet local people”.","scope":"For an occasional event, what draws you in?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-community-ba',1,'{"id":"existing-community-ba","version":1,"familyId":"existing-community-ba","domain":"community","subdomain":"community","prompt":"For helping someone learn, what do you enjoy?","format":"choice","choices":[{"id":"a","label":"Show a worked example"},{"id":"b","label":"Help them work through a question"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:community"],"legacyQuestionId":"e622642d-e8fe-4a5e-a731-7f1f06b5f46e","signals":[{"optionId":"a","attributeKey":"discovery.community.ba","value":"a","statement":"For “For helping someone learn, what do you enjoy?”, you chose “Show a worked example”.","scope":"For helping someone learn, what do you enjoy?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.community.ba","value":"b","statement":"For “For helping someone learn, what do you enjoy?”, you chose “Help them work through a question”.","scope":"For helping someone learn, what do you enjoy?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-community-bb',1,'{"id":"existing-community-bb","version":1,"familyId":"existing-community-bb","domain":"community","subdomain":"community","prompt":"In a community learning group, what appeals most?","format":"choice","choices":[{"id":"a","label":"Exchange different experiences"},{"id":"b","label":"Make something useful together"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:community"],"legacyQuestionId":"56d183be-e881-4381-a6de-c2711e4cf2e8","signals":[{"optionId":"a","attributeKey":"discovery.community.bb","value":"a","statement":"For “In a community learning group, what appeals most?”, you chose “Exchange different experiences”.","scope":"In a community learning group, what appeals most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.community.bb","value":"b","statement":"For “In a community learning group, what appeals most?”, you chose “Make something useful together”.","scope":"In a community learning group, what appeals most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sports-root',1,'{"id":"existing-sports-root","version":1,"familyId":"existing-sports-root","domain":"movement","subdomain":"sports","prompt":"For a recreational sport, what would you enjoy most?","format":"choice","choices":[{"id":"a","label":"Practise a skill on my own"},{"id":"b","label":"Play with other people"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sports"],"legacyQuestionId":"1a385764-5bb6-4526-aa76-df1a446411b6","signals":[{"optionId":"a","attributeKey":"discovery.sports.root","value":"a","statement":"For “For a recreational sport, what would you enjoy most?”, you chose “Practise a skill on my own”.","scope":"For a recreational sport, what would you enjoy most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sports.root","value":"b","statement":"For “For a recreational sport, what would you enjoy most?”, you chose “Play with other people”.","scope":"For a recreational sport, what would you enjoy most?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sports-a',1,'{"id":"existing-sports-a","version":1,"familyId":"existing-sports-a","domain":"movement","subdomain":"sports","prompt":"When practising a sport skill, what keeps it enjoyable?","format":"choice","choices":[{"id":"a","label":"Track small improvements"},{"id":"b","label":"Vary the challenges I try"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sports"],"legacyQuestionId":"c584a5a2-75ff-425f-ad8a-c686b2710797","signals":[{"optionId":"a","attributeKey":"discovery.sports.a","value":"a","statement":"For “When practising a sport skill, what keeps it enjoyable?”, you chose “Track small improvements”.","scope":"When practising a sport skill, what keeps it enjoyable?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sports.a","value":"b","statement":"For “When practising a sport skill, what keeps it enjoyable?”, you chose “Vary the challenges I try”.","scope":"When practising a sport skill, what keeps it enjoyable?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sports-b',1,'{"id":"existing-sports-b","version":1,"familyId":"existing-sports-b","domain":"movement","subdomain":"sports","prompt":"When playing sport with others, what atmosphere suits you?","format":"choice","choices":[{"id":"a","label":"Friendly cooperation"},{"id":"b","label":"A close but respectful contest"}],"purpose":"evidence","depth":1,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sports"],"legacyQuestionId":"1cc7affc-37a8-43a0-a315-190bf25d41ba","signals":[{"optionId":"a","attributeKey":"discovery.sports.b","value":"a","statement":"For “When playing sport with others, what atmosphere suits you?”, you chose “Friendly cooperation”.","scope":"When playing sport with others, what atmosphere suits you?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sports.b","value":"b","statement":"For “When playing sport with others, what atmosphere suits you?”, you chose “A close but respectful contest”.","scope":"When playing sport with others, what atmosphere suits you?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sports-aa',1,'{"id":"existing-sports-aa","version":1,"familyId":"existing-sports-aa","domain":"movement","subdomain":"sports","prompt":"For tracking a skill, what would you prefer?","format":"choice","choices":[{"id":"a","label":"One simple personal target"},{"id":"b","label":"Feedback on my technique"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sports"],"legacyQuestionId":"2dc1e6c5-22d4-445c-ae26-c406fad693b2","signals":[{"optionId":"a","attributeKey":"discovery.sports.aa","value":"a","statement":"For “For tracking a skill, what would you prefer?”, you chose “One simple personal target”.","scope":"For tracking a skill, what would you prefer?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sports.aa","value":"b","statement":"For “For tracking a skill, what would you prefer?”, you chose “Feedback on my technique”.","scope":"For tracking a skill, what would you prefer?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sports-ab',1,'{"id":"existing-sports-ab","version":1,"familyId":"existing-sports-ab","domain":"movement","subdomain":"sports","prompt":"For varied sport challenges, what sounds fun?","format":"choice","choices":[{"id":"a","label":"Try a different drill"},{"id":"b","label":"Adapt a familiar game"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sports"],"legacyQuestionId":"39d402cd-a1aa-4d93-a2e6-2b6ddcecb0f5","signals":[{"optionId":"a","attributeKey":"discovery.sports.ab","value":"a","statement":"For “For varied sport challenges, what sounds fun?”, you chose “Try a different drill”.","scope":"For varied sport challenges, what sounds fun?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sports.ab","value":"b","statement":"For “For varied sport challenges, what sounds fun?”, you chose “Adapt a familiar game”.","scope":"For varied sport challenges, what sounds fun?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sports-ba',1,'{"id":"existing-sports-ba","version":1,"familyId":"existing-sports-ba","domain":"movement","subdomain":"sports","prompt":"In cooperative play, what feels rewarding?","format":"choice","choices":[{"id":"a","label":"Include people of different abilities"},{"id":"b","label":"Build a familiar team rhythm"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sports"],"legacyQuestionId":"19154c92-70bc-4663-acf0-37fd95638232","signals":[{"optionId":"a","attributeKey":"discovery.sports.ba","value":"a","statement":"For “In cooperative play, what feels rewarding?”, you chose “Include people of different abilities”.","scope":"In cooperative play, what feels rewarding?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sports.ba","value":"b","statement":"For “In cooperative play, what feels rewarding?”, you chose “Build a familiar team rhythm”.","scope":"In cooperative play, what feels rewarding?","kind":"preference","strength":"direct"}]}'::jsonb),
('existing-sports-bb',1,'{"id":"existing-sports-bb","version":1,"familyId":"existing-sports-bb","domain":"movement","subdomain":"sports","prompt":"In a friendly contest, what matters most?","format":"choice","choices":[{"id":"a","label":"A fair well-matched game"},{"id":"b","label":"Learning something from the other player"}],"purpose":"evidence","depth":2,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"existing","allowedResponses":["both","depends","neither","skip"],"review":{"type":"existing_catalog","version":1},"tags":["existing_catalog","topic:sports"],"legacyQuestionId":"17243cfa-ef33-4884-a686-f88b30a7c6a9","signals":[{"optionId":"a","attributeKey":"discovery.sports.bb","value":"a","statement":"For “In a friendly contest, what matters most?”, you chose “A fair well-matched game”.","scope":"In a friendly contest, what matters most?","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"discovery.sports.bb","value":"b","statement":"For “In a friendly contest, what matters most?”, you chose “Learning something from the other player”.","scope":"In a friendly contest, what matters most?","kind":"preference","strength":"direct"}]}'::jsonb);
create function nudge_private.discovery_catalog_version() returns integer language sql immutable as $$ select 1 $$;
revoke all on function nudge_private.discovery_catalog_version() from public,anon,authenticated;

$migration_16$;
  end if;
  if to_regprocedure('nudge_private.self_discovery_privacy_version()') is null then
    execute $migration_17$
-- Retract deleted discovery sources, preserve explicit feedback, and expose
-- forgotten-question suppression to clients. Existing decisions are unchanged.

-- Serialize the repair with account edits, forgetting, and resets.
do $$ begin perform id from public.profiles order by id for update; end $$;

-- Only the database operator can enable reviewed formats. User preferences
-- cannot bypass a rollout that has not passed its release checks.
create table nudge_private.discovery_rollout (
 singleton boolean primary key default true check(singleton),
 written_answers_ready boolean not null default false,
 optional_topics_ready boolean not null default false
);
insert into nudge_private.discovery_rollout(singleton) values(true);
alter table nudge_private.discovery_rollout enable row level security;
revoke all on nudge_private.discovery_rollout from public,anon,authenticated,service_role;

create function nudge_private.discovery_question_enabled(q jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select q is not null and exists(select 1 from nudge_private.discovery_rollout r where r.singleton
   and (q->>'format'<>'text' or r.written_answers_ready)
   and (q->>'sensitivity'<>'optional' or r.optional_topics_ready));
$$;
revoke all on function nudge_private.discovery_question_enabled(jsonb) from public,anon,authenticated,service_role;

-- Match encodeURIComponent in the application without trusting submitted IDs.
create function nudge_private.discovery_encode_component(value text) returns text
language plpgsql immutable strict set search_path='' as $$
declare bytes bytea:=convert_to(value,'UTF8'); result text:=''; n integer; c integer;
begin
 for n in 0..length(bytes)-1 loop
   c:=get_byte(bytes,n);
   if (c between 65 and 90) or (c between 97 and 122) or (c between 48 and 57) or c in (45,95,46,33,126,42,39,40,41) then result:=result||chr(c);
   else result:=result||'%'||upper(lpad(to_hex(c),2,'0')); end if;
 end loop;
 return result;
end $$;
create function nudge_private.discovery_reflection_id(rule jsonb) returns text
language sql immutable set search_path='' as $$
 select (rule->>'attributeKey')||':'||nudge_private.discovery_encode_component(rule->>'scope')||':'||nudge_private.discovery_encode_component(rule->>'value');
$$;
revoke all on function nudge_private.discovery_encode_component(text),nudge_private.discovery_reflection_id(jsonb) from public,anon,authenticated,service_role;

-- A forgotten key is a suppression tombstone. The deleted answer's statement
-- and evidence are not needed to retain that intent.
insert into public.forgotten_knowledge_keys(user_id,key)
select user_id,key from public.knowledge_nodes where key like 'discovery.%' and status='forgotten'
on conflict do nothing;
delete from public.knowledge_evidence e using public.knowledge_nodes n
where n.id=e.node_id and n.user_id=e.user_id and n.key like 'discovery.%'
  and e.detail ? 'discoveryAnswerId' and not exists(
    select 1 from nudge_private.discovery_answers a where a.user_id=e.user_id and a.id::text=e.detail->>'discoveryAnswerId');
delete from public.knowledge_nodes n
where n.key like 'discovery.%' and n.status='forgotten' and not exists(
  select 1 from public.knowledge_evidence e join nudge_private.discovery_answers a
    on a.id::text=e.detail->>'discoveryAnswerId' and a.user_id=e.user_id
  where e.node_id=n.id and e.user_id=n.user_id);
delete from nudge_private.discovery_feedback f where not exists(
 select 1 from nudge_private.discovery_answers saved join public.discovery_question_versions q
   on q.question_id=saved.question_id and q.version=saved.question_version
 cross join lateral jsonb_array_elements(coalesce(q.definition->'signals','[]')) signal(value)
 where saved.user_id=f.user_id and nudge_private.discovery_reflection_id(signal.value)=f.insight_id
   and ((saved.response->>'kind'='choice' and signal.value->>'optionId'=saved.response->>'optionId')
     or (saved.response->>'kind'='ranking' and saved.response->'groups'->0 ? (signal.value->>'optionId'))));

create or replace function nudge_private.rebuild_discovery_evidence() returns void
language plpgsql security definer set search_path='' as $$
declare a record; rule jsonb; picked jsonb; v_generation integer; ignored uuid;
begin
 select memory_generation into v_generation from public.profiles where id=auth.uid() for update;
 -- Remove feedback only when its last saved source was removed or changed.
 -- Excluded answers still exist, so their explicit corrections remain intact.
 delete from nudge_private.discovery_feedback f where f.user_id=auth.uid() and not exists(
   select 1 from nudge_private.discovery_answers saved join public.discovery_question_versions q
     on q.question_id=saved.question_id and q.version=saved.question_version
   cross join lateral jsonb_array_elements(coalesce(q.definition->'signals','[]')) signal(value)
   where saved.user_id=f.user_id and nudge_private.discovery_reflection_id(signal.value)=f.insight_id
     and ((saved.response->>'kind'='choice' and signal.value->>'optionId'=saved.response->>'optionId')
       or (saved.response->>'kind'='ranking' and saved.response->'groups'->0 ? (signal.value->>'optionId'))));
 insert into public.forgotten_knowledge_keys(user_id,key)
   select user_id,key from public.knowledge_nodes where user_id=auth.uid() and key like 'discovery.%' and status='forgotten'
   on conflict do nothing;
 delete from public.knowledge_evidence e using public.knowledge_nodes n
   where n.id=e.node_id and n.user_id=e.user_id and n.user_id=auth.uid() and n.key like 'discovery.%'
   and e.detail ? 'discoveryAnswerId' and not exists(
     select 1 from nudge_private.discovery_answers saved where saved.user_id=e.user_id and saved.id::text=e.detail->>'discoveryAnswerId');
 delete from public.knowledge_nodes n where n.user_id=auth.uid() and n.key like 'discovery.%'
   and (n.status<>'forgotten' or not exists(
     select 1 from public.knowledge_evidence e join nudge_private.discovery_answers saved
       on saved.id::text=e.detail->>'discoveryAnswerId' and saved.user_id=e.user_id
     where e.node_id=n.id and e.user_id=n.user_id));
 for a in select saved.*,q.definition from nudge_private.discovery_answers saved join public.discovery_question_versions q
   on q.question_id=saved.question_id and q.version=saved.question_version
   where saved.user_id=auth.uid() and saved.active and q.definition->>'purpose'='evidence' loop
   picked:=case a.response->>'kind' when 'choice' then jsonb_build_array(a.response->>'optionId') when 'ranking' then coalesce(a.response->'groups'->0,'[]') else '[]' end;
   for rule in select value from jsonb_array_elements(coalesce(a.definition->'signals','[]')) loop
     if rule ? 'optionId' and picked ? (rule->>'optionId') then
       ignored:=nudge_private.record_knowledge_signal_guarded(nudge_private.discovery_rule_key(rule),rule->>'statement','lifestyle','like','explicit',0.25,'discover_answer',null,null,false,
         jsonb_build_object('discoveryAnswerId',a.id,'questionId',a.question_id,'questionVersion',a.question_version,'revision',a.revision,'attributeKey',rule->>'attributeKey','scope',rule->>'scope','familyId',a.definition->>'familyId','value',rule->>'value'),v_generation);
     end if;
   end loop;
 end loop;
end $$;

create or replace function nudge_private.purge_discovery_on_privacy_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.memory_generation is distinct from old.memory_generation then
   delete from nudge_private.discovery_requests where user_id=new.id;
   delete from nudge_private.discovery_exposures where user_id=new.id;
   delete from nudge_private.discovery_feedback where user_id=new.id and feedback='fits';
 end if;
 -- Feedback describes a specific statement, scope and value. An unrelated
 -- edit must never silently revoke a user's "not me" or "sometimes" correction.
 if new.memory_reset_at is distinct from old.memory_reset_at then
   delete from nudge_private.discovery_answers where user_id=new.id;
   delete from nudge_private.discovery_feedback where user_id=new.id;
   delete from nudge_private.discovery_settings where user_id=new.id;
   delete from nudge_private.discovery_metrics where user_id=new.id;
 end if;
 return new;
end $$;

create or replace function nudge_private.withdraw_forgotten_discovery_answer() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.key like 'discovery.%' and (new.status='forgotten' or new.polarity is distinct from old.polarity) then
   with withdrawn as (
     update nudge_private.discovery_answers a set active=false,revision=revision+1,updated_at=clock_timestamp()
     where a.user_id=new.user_id and a.active and exists(
       select 1 from public.knowledge_evidence e where e.node_id=new.id and e.user_id=a.user_id
       and e.detail->>'discoveryAnswerId'=a.id::text)
     returning a.*
   ) insert into nudge_private.discovery_answer_revisions(answer_id,user_id,revision,response,active)
     select id,user_id,revision,response,active from withdrawn;
 end if;
 return new;
end $$;

create or replace function public.read_discovery_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_generation integer; result jsonb;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 select memory_generation into v_generation from public.profiles where id=auth.uid();
 if not found then raise exception 'Profile not found'; end if;
 select jsonb_build_object('generation',v_generation,'available',true,'today',(select public.user_today(timezone) from public.profiles where id=auth.uid()),
   'capabilities',(select jsonb_build_object('writtenAnswers',written_answers_ready,'optionalTopics',optional_topics_ready) from nudge_private.discovery_rollout where singleton),
   'answers',coalesce((select jsonb_agg(to_jsonb(a) order by a.answered_at,a.id) from nudge_private.discovery_answers a where a.user_id=auth.uid()),'[]'),
   'exposures',coalesce((select jsonb_agg(to_jsonb(e) order by e.served_at,e.id) from nudge_private.discovery_exposures e where e.user_id=auth.uid() and e.served_at>clock_timestamp()-interval '30 days'),'[]'),
   'feedback',coalesce((select jsonb_agg(to_jsonb(f)) from nudge_private.discovery_feedback f where f.user_id=auth.uid()),'[]'),
   'settings',coalesce((select to_jsonb(s) from nudge_private.discovery_settings s where s.user_id=auth.uid()),'{}'),
   'suppressedQuestionIds',coalesce((select jsonb_agg(blocked.question_id order by blocked.question_id) from (
     select distinct q.question_id from public.discovery_question_versions q
     cross join lateral jsonb_array_elements(coalesce(q.definition->'signals','[]')) rule
     join public.forgotten_knowledge_keys f on f.user_id=auth.uid() and f.key=nudge_private.discovery_rule_key(rule)
   ) blocked),'[]')) into result;
 return result;
end $$;

create function nudge_private.discovery_question_suppressed(q jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from jsonb_array_elements(coalesce(q->'signals','[]')) rule
   join public.forgotten_knowledge_keys f on f.user_id=auth.uid() and f.key=nudge_private.discovery_rule_key(rule));
$$;
revoke all on function nudge_private.discovery_question_suppressed(jsonb) from public,anon,authenticated,service_role;

revoke all on function nudge_private.rebuild_discovery_evidence(),
 nudge_private.purge_discovery_on_privacy_change(),nudge_private.withdraw_forgotten_discovery_answer()
 from public,anon,authenticated,service_role;
revoke all on function public.read_discovery_state() from public,anon,service_role;
grant execute on function public.read_discovery_state() to authenticated;
create or replace function public.save_discovery_answers(p_request_id uuid,p_generation integer,p_answers jsonb,p_source text default 'daily') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_generation integer; previous nudge_private.discovery_requests%rowtype; digest text; item jsonb; q jsonb; a nudge_private.discovery_answers%rowtype; ids jsonb:='[]'; result jsonb;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 select memory_generation into v_generation from public.profiles where id=auth.uid() for update;
 if not found or p_request_id is null or p_generation is null or p_source not in ('preview','daily') or jsonb_typeof(p_answers) is distinct from 'array' then raise exception 'Invalid discovery request'; end if;
 if jsonb_array_length(p_answers) not between 1 and 20 or length(p_answers::text)>16000 then raise exception 'Invalid discovery answers'; end if;
 digest:=md5(p_source||p_answers::text);
 select * into previous from nudge_private.discovery_requests where user_id=auth.uid() and request_id=p_request_id;
 if found then
   if previous.intent_hash<>digest or previous.expected_generation<>p_generation or previous.result_generation<>v_generation then raise sqlstate 'PT409' using message='This request no longer matches'; end if;
   return previous.result;
 end if;
 if p_generation<>v_generation then raise sqlstate 'PT409' using message='Your memory changed. Review your answers again.'; end if;
 if (select count(distinct entry.value->>'questionId') from jsonb_array_elements(p_answers) entry)<>jsonb_array_length(p_answers) then raise exception 'Repeated question'; end if;
 if (select count(*) from nudge_private.discovery_requests where user_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=60 then raise sqlstate 'PT429' using message='Take a moment before saving more answers'; end if;
 for item in select value from jsonb_array_elements(p_answers) loop
   if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('questionId','questionVersion','response')) then raise exception 'Invalid answer fields'; end if;
   select definition into q from public.discovery_question_versions where question_id=item->>'questionId' and version=(item->>'questionVersion')::integer and definition->>'status'='published';
   if q is null or nudge_private.validate_discovery_response(q,item->'response') is distinct from true or (p_source='preview' and coalesce((q->>'preview')::boolean,false)=false) then raise exception 'Invalid or unavailable question'; end if;
   if nudge_private.discovery_question_suppressed(q) then raise sqlstate 'PT409' using message='This question was forgotten and cannot be used again.'; end if;
   if item->'response'->>'kind' not in ('both','depends','neither','skip') and not nudge_private.discovery_question_enabled(q) then raise exception 'This question format is not available yet'; end if;
   if q->>'sensitivity'='optional' and item->'response'->>'kind' not in ('both','depends','neither','skip') and not exists(select 1 from nudge_private.discovery_settings where user_id=auth.uid() and optional_topics) then raise exception 'Optional topics are turned off'; end if;
   if item->'response'->>'kind'='text' or length(trim(coalesce(item->'response'->>'context','')))>0 then
     if not exists(select 1 from nudge_private.discovery_rollout where singleton and written_answers_ready) or not exists(select 1 from nudge_private.discovery_settings where user_id=auth.uid() and written_answers) then raise exception 'Written answers are turned off'; end if;
   end if;
   if p_source='daily' and not exists(select 1 from nudge_private.discovery_exposures e where e.user_id=auth.uid() and e.question_id=item->>'questionId' and e.question_version=(item->>'questionVersion')::integer and e.generation=v_generation) then raise exception 'Open this question before answering'; end if;
   select * into a from nudge_private.discovery_answers where user_id=auth.uid() and question_id=item->>'questionId' and question_version=(item->>'questionVersion')::integer;
   if found then
     if a.response is distinct from item->'response' then raise sqlstate 'PT409' using message='This question already has an answer. Edit the saved answer.'; end if;
   else
     insert into nudge_private.discovery_answers(user_id,question_id,question_version,response,source) values(auth.uid(),item->>'questionId',(item->>'questionVersion')::integer,item->'response',p_source) returning * into a;
     insert into nudge_private.discovery_answer_revisions(answer_id,user_id,revision,response,active) values(a.id,auth.uid(),a.revision,a.response,a.active);
   end if;
   ids:=ids||jsonb_build_array(a.id);
   update nudge_private.discovery_exposures set state=case when item->'response'->>'kind'='skip' then 'skipped' else 'answered' end
     where user_id=auth.uid() and question_id=a.question_id and question_version=a.question_version and generation=p_generation and state='served';
 end loop;
 perform nudge_private.rebuild_discovery_evidence();
 if p_source='preview' then update public.profiles set onboarded_at=coalesce(onboarded_at,clock_timestamp()) where id=auth.uid(); end if;
 result:=jsonb_build_object('saved',true,'generation',v_generation,'answerIds',ids);
 insert into nudge_private.discovery_requests values(auth.uid(),p_request_id,p_generation,v_generation,digest,result,clock_timestamp());
 if exists(select 1 from nudge_private.discovery_settings where user_id=auth.uid() and metrics_enabled) then
   insert into nudge_private.discovery_metrics(user_id,event) values(auth.uid(),case when p_source='preview' then 'claim_succeeded' else 'answer_submitted' end);
 end if;
 return result;
end $$;

create or replace function public.edit_discovery_answer(p_request_id uuid,p_generation integer,p_answer_id uuid,p_revision integer,p_response jsonb default null,p_active boolean default null,p_delete boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_generation integer; previous nudge_private.discovery_requests%rowtype; digest text; a nudge_private.discovery_answers%rowtype; q jsonb; result jsonb;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 select memory_generation into v_generation from public.profiles where id=auth.uid() for update;
 digest:=md5(jsonb_build_array('edit',p_answer_id,p_revision,p_response,p_active,p_delete)::text);
 select * into previous from nudge_private.discovery_requests where user_id=auth.uid() and request_id=p_request_id;
 if found then
   if previous.intent_hash<>digest or previous.expected_generation<>p_generation or previous.result_generation<>v_generation then raise sqlstate 'PT409' using message='This edit no longer matches'; end if;
   return previous.result;
 end if;
 if p_request_id is null or p_generation is distinct from v_generation then raise sqlstate 'PT409' using message='Your memory changed. Reload before editing.'; end if;
 select * into a from nudge_private.discovery_answers where id=p_answer_id and user_id=auth.uid();
 if not found then raise sqlstate 'PT404' using message='Answer not found'; end if;
 if a.revision is distinct from p_revision then raise sqlstate 'PT409' using message='This answer changed. Reload it.'; end if;
 select definition into q from public.discovery_question_versions where question_id=a.question_id and version=a.question_version;
 if not coalesce(p_delete,false) and (p_active=true or p_response is not null) and nudge_private.discovery_question_suppressed(q) then raise sqlstate 'PT409' using message='This question was forgotten. You can keep it excluded or delete it.'; end if;
 if p_response is not null and nudge_private.validate_discovery_response(q,p_response) is distinct from true then raise exception 'Invalid edited answer'; end if;
 if not coalesce(p_delete,false) and (p_response->>'kind'='text' or length(trim(coalesce(p_response->>'context','')))>0) then
   if not exists(select 1 from nudge_private.discovery_rollout where singleton and written_answers_ready) or not exists(select 1 from nudge_private.discovery_settings where user_id=auth.uid() and written_answers) then raise exception 'Written answers are turned off'; end if;
 end if;
 if not coalesce(p_delete,false) and ((p_response is not null and p_response->>'kind' not in ('both','depends','neither','skip')) or p_active=true) then
   if not nudge_private.discovery_question_enabled(q) then raise exception 'This question format is not available yet'; end if;
   if q->>'format'='text' and not exists(select 1 from nudge_private.discovery_settings where user_id=auth.uid() and written_answers) then raise exception 'Written answers are turned off'; end if;
   if q->>'sensitivity'='optional' and not exists(select 1 from nudge_private.discovery_settings where user_id=auth.uid() and optional_topics) then raise exception 'Optional topics are turned off'; end if;
 end if;
 if p_delete then delete from nudge_private.discovery_answers where id=a.id;
 else
   update nudge_private.discovery_answers set response=coalesce(p_response,response),active=coalesce(p_active,active),revision=revision+1,updated_at=clock_timestamp() where id=a.id returning * into a;
   insert into nudge_private.discovery_answer_revisions(answer_id,user_id,revision,response,active) values(a.id,auth.uid(),a.revision,a.response,a.active);
 end if;
 update public.profiles set memory_generation=memory_generation+1 where id=auth.uid() returning memory_generation into v_generation;
 perform nudge_private.rebuild_discovery_evidence();
 result:=jsonb_build_object('saved',true,'generation',v_generation);
 insert into nudge_private.discovery_requests values(auth.uid(),p_request_id,p_generation,v_generation,digest,result,clock_timestamp());
 return result;
end $$;

create or replace function public.reserve_discovery_question(p_request_id uuid,p_generation integer,p_question_id text,p_version integer,p_daily boolean default false,p_change boolean default false,p_reason text default 'coverage') returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.profiles%rowtype; existing nudge_private.discovery_exposures%rowtype; q jsonb; today date;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 select * into profile from public.profiles where id=auth.uid() for update;
 if p_generation is distinct from profile.memory_generation or p_request_id is null then raise sqlstate 'PT409' using message='Your memory changed. Reload questions.'; end if;
 today:=public.user_today(profile.timezone);
 select * into existing from nudge_private.discovery_exposures where user_id=auth.uid() and request_id=p_request_id;
 if found then
   select definition into q from public.discovery_question_versions where question_id=existing.question_id and version=existing.question_version;
   if not nudge_private.discovery_question_enabled(q) then raise sqlstate 'PT409' using message='This question is no longer available. Choose another question.'; end if;
   return to_jsonb(existing);
 end if;
 if p_daily and not p_change then
   select * into existing from nudge_private.discovery_exposures where user_id=auth.uid() and local_day=today and daily and state<>'changed';
   if found then
     select definition into q from public.discovery_question_versions where question_id=existing.question_id and version=existing.question_version;
     if nudge_private.discovery_question_enabled(q) then return to_jsonb(existing); end if;
     update nudge_private.discovery_exposures set state='changed' where id=existing.id;
   end if;
 end if;
 if (select count(*) from nudge_private.discovery_exposures where user_id=auth.uid() and served_at>clock_timestamp()-interval '1 minute')>=60 then raise sqlstate 'PT429' using message='Take a moment before opening more questions'; end if;
 select definition into q from public.discovery_question_versions where question_id=p_question_id and version=p_version and definition->>'status'='published';
 if q is null or p_reason is null or p_reason not in ('coverage','explore','relevant') or p_daily is null or p_change is null then raise exception 'Unavailable question'; end if;
 if not nudge_private.discovery_question_enabled(q) then raise exception 'This question format is not available yet'; end if;
 if nudge_private.discovery_question_suppressed(q) then raise sqlstate 'PT409' using message='This question was forgotten and cannot be offered again.'; end if;
 if exists(select 1 from nudge_private.discovery_settings s where s.user_id=auth.uid() and (s.muted_topics ? (q->>'domain') or s.max_depth<(q->>'depth')::integer or (q->>'sensitivity'='optional' and not s.optional_topics) or (q->>'format'='text' and not s.written_answers)))
   or (not exists(select 1 from nudge_private.discovery_settings s where s.user_id=auth.uid()) and (q->>'sensitivity'='optional' or q->>'format'='text' or (q->>'depth')::integer>0)) then raise exception 'Question outside your selected settings'; end if;
 if p_change then update nudge_private.discovery_exposures set state='changed' where user_id=auth.uid() and local_day=today and daily and state<>'changed'; end if;
 insert into nudge_private.discovery_exposures(user_id,request_id,question_id,question_version,family_id,local_day,daily,reason,generation)
   values(auth.uid(),p_request_id,p_question_id,p_version,q->>'familyId',today,p_daily,p_reason,p_generation) returning * into existing;
 delete from nudge_private.discovery_exposures where user_id=auth.uid() and served_at<clock_timestamp()-interval '30 days';
 return to_jsonb(existing);
end $$;

create or replace function public.save_discovery_preferences(p_generation integer,p_muted jsonb,p_optional boolean,p_depth integer,p_written boolean,p_metrics boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_generation integer;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 select memory_generation into v_generation from public.profiles where id=auth.uid() for update;
 if p_generation is distinct from v_generation then raise sqlstate 'PT409' using message='Your memory changed. Reload settings.'; end if;
 if jsonb_typeof(p_muted) is distinct from 'array' or jsonb_array_length(p_muted)>18 or exists(select 1 from jsonb_array_elements_text(p_muted) x where x not in ('rest','time','values','relationships','work','learning','money','food','culture','play','creativity','childhood','uncertainty','community','places','movement','digital','future')) or p_depth is null or p_depth not between 0 and 2 or p_optional is null or p_written is null or p_metrics is null then raise exception 'Invalid discovery settings'; end if;
 if not exists(select 1 from nudge_private.discovery_rollout where singleton and (not p_written or written_answers_ready) and (not p_optional or optional_topics_ready)) then raise exception 'These question formats are not available yet'; end if;
 insert into nudge_private.discovery_settings(user_id,muted_topics,optional_topics,max_depth,written_answers,metrics_enabled) values(auth.uid(),p_muted,p_optional,p_depth,p_written,p_metrics)
 on conflict(user_id) do update set muted_topics=excluded.muted_topics,optional_topics=excluded.optional_topics,max_depth=excluded.max_depth,written_answers=excluded.written_answers,metrics_enabled=excluded.metrics_enabled,updated_at=clock_timestamp();
 if not p_metrics then delete from nudge_private.discovery_metrics where user_id=auth.uid(); end if;
 update nudge_private.discovery_exposures e set state='changed' from public.discovery_question_versions q
 where e.user_id=auth.uid() and e.state='served' and q.question_id=e.question_id and q.version=e.question_version
 and (p_muted ? (q.definition->>'domain') or (q.definition->>'depth')::integer>p_depth or (q.definition->>'sensitivity'='optional' and not p_optional) or (q.definition->>'format'='text' and not p_written));
end $$;

create function nudge_private.self_discovery_privacy_version() returns integer language sql immutable as $$ select 1 $$;
revoke all on function nudge_private.self_discovery_privacy_version() from public,anon,authenticated;
notify pgrst,'reload schema';

$migration_17$;
  end if;
  if to_regprocedure('nudge_private.discovery_criterion_provenance_version()') is null then
    execute $migration_18$
-- Private provenance for owner-confirmed discovery criterion suggestions.

create function nudge_private.validate_comparison_evidence_v1(p_evidence jsonb,p_decision_id uuid,p_generation integer)
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


create or replace function nudge_private.validate_comparison_evidence(p_evidence jsonb,p_decision_id uuid,p_generation integer)
returns void language plpgsql security definer set search_path='' as $$
declare d public.decisions%rowtype; source jsonb; item jsonb; criterion jsonb; a nudge_private.discovery_answers%rowtype; q jsonb; rule jsonb; matched jsonb; seen text[]:='{}'; answer_ids text[]; freshest timestamptz;
begin
 select * into d from public.decisions where id=p_decision_id and user_id=auth.uid();
 if not found then raise exception 'Comparison not found'; end if;
 if exists(select 1 from jsonb_array_elements(coalesce(d.context->'criteria','[]')) c where c ? 'discoverySuggestion') then raise exception 'Suggestion references must remain private'; end if;
 if p_evidence->'version'='1'::jsonb then
   if d.context->'discovery_criteria_used'='true'::jsonb then raise exception 'Missing criterion provenance'; end if;
   perform nudge_private.validate_comparison_evidence_v1(p_evidence,p_decision_id,p_generation); return;
 end if;
 if p_evidence->'version' is distinct from '2'::jsonb or p_evidence->>'basis' is distinct from 'criteria'
   or d.context->'discovery_criteria_used' is distinct from 'true'::jsonb
   or octet_length(p_evidence::text)>131072
   or jsonb_typeof(p_evidence->'criterionSources') is distinct from 'array'
   or jsonb_array_length(p_evidence->'criterionSources') not between 1 and 5 then raise exception 'Invalid criterion provenance'; end if;
 perform nudge_private.validate_comparison_evidence_v1(jsonb_set(p_evidence-'criterionSources','{version}','1'),p_decision_id,p_generation);
 if lower(trim(d.context->>'domain')) not in ('everyday life','real life','daily life','work','study','food','money','travel','learning','rest') then raise exception 'Suggestion is outside this setting'; end if;
 for source in select value from jsonb_array_elements(p_evidence->'criterionSources') loop
   if jsonb_typeof(source) is distinct from 'object' or source-array['criterionId','suggestionId','generation','answers']<>'{}'::jsonb
     or not source ?& array['criterionId','suggestionId','generation','answers']
     or jsonb_typeof(source->'criterionId') is distinct from 'string' or length(source->>'criterionId') not between 1 and 50 or source->>'criterionId' !~ '^[a-zA-Z0-9-]+$'
     or source->>'criterionId'=any(seen) or jsonb_typeof(source->'suggestionId') is distinct from 'string' or length(source->>'suggestionId') not between 1 and 512
     or jsonb_typeof(source->'generation') is distinct from 'number' or source->'generation' is distinct from to_jsonb(p_generation)
     or jsonb_typeof(source->'answers') is distinct from 'array' or jsonb_array_length(source->'answers') not between 1 and 80 then raise exception 'Invalid criterion source'; end if;
   seen:=array_append(seen,source->>'criterionId');
   select c into criterion from jsonb_array_elements(d.context->'criteria') c where c->>'id'=source->>'criterionId';
   if criterion is null then raise exception 'Criterion source does not match this comparison'; end if;
   if exists(select 1 from nudge_private.discovery_feedback f where f.user_id=auth.uid() and f.insight_id=source->>'suggestionId' and f.feedback in ('not_me','sometimes')) then raise exception 'Reflection is excluded from suggestions'; end if;
   answer_ids:='{}';freshest:=null;matched:=null;
   for item in select value from jsonb_array_elements(source->'answers') loop
     if jsonb_typeof(item) is distinct from 'object' or item-array['answerId','answerRevision','questionId','questionVersion']<>'{}'::jsonb
       or not item ?& array['answerId','answerRevision','questionId','questionVersion']
       or jsonb_typeof(item->'answerId') is distinct from 'string' or item->>'answerId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or item->>'answerId'=any(answer_ids)
       or jsonb_typeof(item->'answerRevision') is distinct from 'number' or item->>'answerRevision' !~ '^\d+$'
       or jsonb_typeof(item->'questionId') is distinct from 'string' or length(item->>'questionId') not between 1 and 96
       or jsonb_typeof(item->'questionVersion') is distinct from 'number' or item->>'questionVersion' !~ '^[1-9]\d*$' then raise exception 'Invalid source answer reference'; end if;
     select * into a from nudge_private.discovery_answers where id=(item->>'answerId')::uuid and user_id=auth.uid() and active;
     if not found or to_jsonb(a.revision) is distinct from item->'answerRevision' or a.question_id is distinct from item->>'questionId' or to_jsonb(a.question_version) is distinct from item->'questionVersion' then raise exception 'Source answer changed or is unavailable'; end if;
     select definition into q from public.discovery_question_versions where question_id=a.question_id and version=a.question_version;
     if q->>'purpose' is distinct from 'evidence' or nudge_private.discovery_question_suppressed(q) then raise exception 'Source answer is excluded'; end if;
     rule:=null;
     select s into rule from jsonb_array_elements(coalesce(q->'signals','[]')) s
       where nudge_private.discovery_reflection_id(s)=source->>'suggestionId'
       and s->'criterion'->>'label'=criterion->>'label'
       and (s->'criterion'->'decisionDomains' ? lower(trim(d.context->>'domain')) or s->'criterion'->'decisionDomains' ? d.category::text)
       and ((a.response->>'kind'='choice' and s->>'optionId'=a.response->>'optionId') or (a.response->>'kind'='ranking' and a.response->'groups'->0 ? (s->>'optionId')));
     if rule is null then raise exception 'Source does not support this criterion'; end if;
     answer_ids:=array_append(answer_ids,a.id::text);freshest:=greatest(freshest,a.answered_at);matched:=rule;
   end loop;
   if freshest<clock_timestamp()-interval '180 days' then raise exception 'Suggested criterion is stale'; end if;
   -- Any different saved answer expressing the opposite value blocks a fixed
   -- preference. Joint first ranks from the same answer remain compatible.
   if exists(select 1 from nudge_private.discovery_answers other_a join public.discovery_question_versions other_q on other_q.question_id=other_a.question_id and other_q.version=other_a.question_version
     cross join lateral jsonb_array_elements(coalesce(other_q.definition->'signals','[]')) other_rule
     where other_a.user_id=auth.uid() and other_a.active and not other_a.id::text=any(answer_ids)
       and other_q.definition->>'purpose'='evidence' and not nudge_private.discovery_question_suppressed(other_q.definition)
       and other_rule->>'attributeKey'=matched->>'attributeKey' and other_rule->>'scope'=matched->>'scope' and other_rule->>'value'<>matched->>'value'
       and ((other_a.response->>'kind'='choice' and other_rule->>'optionId'=other_a.response->>'optionId') or (other_a.response->>'kind'='ranking' and other_a.response->'groups'->0 ? (other_rule->>'optionId')))) then raise exception 'Mixed answers need context'; end if;
 end loop;
end $$;
revoke all on function nudge_private.validate_comparison_evidence_v1(jsonb,uuid,integer),nudge_private.validate_comparison_evidence(jsonb,uuid,integer) from public,anon,authenticated,service_role;
-- Correcting a reflection also withdraws any saved source link derived from
-- it. The comparison and the user's explicit criterion inputs remain theirs.
create function nudge_private.withdraw_discovery_criterion_feedback() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.feedback in ('not_me','sometimes') then
   delete from nudge_private.comparison_evidence e where e.user_id=new.user_id and exists(
     select 1 from jsonb_array_elements(coalesce(e.snapshot->'criterionSources','[]')) s where s->>'suggestionId'=new.insight_id);
 end if;
 return new;
end $$;
revoke all on function nudge_private.withdraw_discovery_criterion_feedback() from public,anon,authenticated,service_role;
create trigger discovery_feedback_withdraw_criteria after insert or update on nudge_private.discovery_feedback
 for each row execute function nudge_private.withdraw_discovery_criterion_feedback();
create function nudge_private.discovery_criterion_provenance_version() returns integer language sql immutable as $$ select 1 $$;
revoke all on function nudge_private.discovery_criterion_provenance_version() from public,anon,authenticated;
notify pgrst,'reload schema';

$migration_18$;
  end if;
  if to_regprocedure('nudge_private.discovery_starter_edition_version()') is null then
    execute $migration_19$
-- Add six revised starter definitions. Prior versions and answers stay unchanged.

insert into public.discovery_question_versions(question_id,version,definition) values
('rest-break',2,'{"id":"rest-break","version":2,"familyId":"rest-break","domain":"rest","subdomain":"breaks","prompt":"After a draining day, what do you usually end up doing first?","format":"choice","choices":[{"id":"a","label":"Put on something familiar and keep to myself."},{"id":"b","label":"Reach out to someone I feel comfortable with."},{"id":"c","label":"Do something with my hands to take my mind off the day."},{"id":"d","label":"Go outside or move around for a bit."},{"id":"e","label":"Keep scrolling, even when I meant to rest."}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":20,"status":"published","source":"starter","preview":true,"allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":2},"signals":[{"optionId":"a","attributeKey":"rest.recovery.first","value":"familiar_alone","statement":"You said you usually turn to something familiar on your own after a draining day.","scope":"after a draining day","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"rest.recovery.first","value":"familiar_company","statement":"You said you usually reach out to someone you feel comfortable with after a draining day.","scope":"after a draining day","kind":"preference","strength":"direct"},{"optionId":"c","attributeKey":"rest.recovery.first","value":"hands_on","statement":"You said a hands-on activity is often your first move after a draining day.","scope":"after a draining day","kind":"preference","strength":"direct"},{"optionId":"d","attributeKey":"rest.recovery.first","value":"movement","statement":"You said you often head outside or move around after a draining day.","scope":"after a draining day","kind":"preference","strength":"direct"},{"optionId":"e","attributeKey":"rest.recovery.first","value":"scrolling","statement":"You said you sometimes end up scrolling after a draining day, even when you meant to rest.","scope":"after a draining day","kind":"preference","strength":"direct"}]}'::jsonb),
('time-free-day',2,'{"id":"time-free-day","version":2,"familyId":"time-free-day","domain":"time","subdomain":"planning","prompt":"You have a day with no plans. What are you most likely to do?","format":"choice","choices":[{"id":"a","label":"Choose one thing, then leave the rest open."},{"id":"b","label":"Make a plan so the day doesn''t slip away."},{"id":"c","label":"Wait and see what I feel like doing."},{"id":"d","label":"Catch up on things I''ve been putting off."},{"id":"e","label":"Let someone else suggest something."}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":20,"status":"published","source":"starter","preview":true,"allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":2},"signals":[{"optionId":"a","attributeKey":"time.unplanned_day.approach","value":"one_anchor","statement":"You chose one activity with room to decide the rest of an unplanned day.","scope":"a day with no plans","kind":"preference","strength":"direct","criterion":{"label":"Flexibility","decisionDomains":["travel","lifestyle","hobbies"]}},{"optionId":"b","attributeKey":"time.unplanned_day.approach","value":"several_plans","statement":"You chose to give an unplanned day some structure.","scope":"a day with no plans","kind":"preference","strength":"direct"},{"optionId":"c","attributeKey":"time.unplanned_day.approach","value":"spontaneous","statement":"You chose to wait and see what feels right on an unplanned day.","scope":"a day with no plans","kind":"preference","strength":"direct","criterion":{"label":"Flexibility","decisionDomains":["travel","lifestyle","hobbies"]}},{"optionId":"d","attributeKey":"time.unplanned_day.approach","value":"catch_up","statement":"You chose catching up on postponed tasks for a day without plans.","scope":"a day with no plans","kind":"preference","strength":"direct"},{"optionId":"e","attributeKey":"time.unplanned_day.approach","value":"others_suggest","statement":"You chose to let someone else suggest what to do on an unplanned day.","scope":"a day with no plans","kind":"preference","strength":"direct"}]}'::jsonb),
('learning-puzzle',2,'{"id":"learning-puzzle","version":2,"familyId":"learning-puzzle","domain":"learning","subdomain":"starting","prompt":"Think of the last time a simple task wouldn''t work. What did you do next?","format":"choice","choices":[{"id":"a","label":"Kept trying different things until something worked."},{"id":"b","label":"Looked up instructions or an example."},{"id":"c","label":"Asked someone to help me work it out."},{"id":"d","label":"Got frustrated and left it for later."},{"id":"e","label":"Tried a shortcut, even if the result would be a bit messy."}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":20,"status":"published","source":"starter","preview":true,"allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":2},"signals":[{"optionId":"a","attributeKey":"learning.stuck.response","value":"experimented","statement":"You recalled trying different approaches when a simple task would not work.","scope":"the last simple task that would not work","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"learning.stuck.response","value":"looked_up","statement":"You recalled looking up instructions or an example when a task would not work.","scope":"the last simple task that would not work","kind":"preference","strength":"direct","criterion":{"label":"Worked examples","decisionDomains":["learning"]}},{"optionId":"c","attributeKey":"learning.stuck.response","value":"asked_help","statement":"You recalled asking someone for help when a task would not work.","scope":"the last simple task that would not work","kind":"preference","strength":"direct"},{"optionId":"d","attributeKey":"learning.stuck.response","value":"stepped_away","statement":"You recalled getting frustrated and leaving that task for later.","scope":"the last simple task that would not work","kind":"preference","strength":"direct"},{"optionId":"e","attributeKey":"learning.stuck.response","value":"shortcut","statement":"You recalled trying a shortcut, accepting a messier result for that task.","scope":"the last simple task that would not work","kind":"preference","strength":"direct"}]}'::jsonb),
('food-snack',2,'{"id":"food-snack","version":2,"familyId":"food-snack","domain":"food","subdomain":"novelty","prompt":"You''re choosing something to eat, and a new option looks good. What tends to decide it?","format":"choice","choices":[{"id":"a","label":"I stick with a favorite; I know I''ll enjoy it."},{"id":"b","label":"I try the new thing; I''m curious how it tastes."},{"id":"c","label":"The price matters more than whether it''s familiar."},{"id":"d","label":"I go with what''s easy; I don''t want to think about it."},{"id":"e","label":"My appetite that day matters more than either."}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":20,"status":"published","source":"starter","preview":true,"allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":2},"signals":[{"optionId":"a","attributeKey":"food.choice.priority","value":"familiar","statement":"You said a familiar favorite tends to win when a new food option also looks appealing.","scope":"choosing food when a new option looks appealing","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"food.choice.priority","value":"curious","statement":"You said curiosity tends to draw you toward an appealing new food option.","scope":"choosing food when a new option looks appealing","kind":"preference","strength":"direct"},{"optionId":"c","attributeKey":"food.choice.priority","value":"price","statement":"You said price matters more than familiarity in this food choice.","scope":"choosing food when a new option looks appealing","kind":"preference","strength":"direct","criterion":{"label":"Price","decisionDomains":["food"]}},{"optionId":"d","attributeKey":"food.choice.priority","value":"ease","statement":"You said an easy choice matters when you do not want to think much about food.","scope":"choosing food when a new option looks appealing","kind":"preference","strength":"direct"},{"optionId":"e","attributeKey":"food.choice.priority","value":"appetite","statement":"You said your appetite that day matters more than familiarity or novelty.","scope":"choosing food when a new option looks appealing","kind":"preference","strength":"direct"}]}'::jsonb),
('play-humor',2,'{"id":"play-humor","version":2,"familyId":"play-humor","domain":"play","subdomain":"humor","prompt":"Think of something that made you laugh recently. What was it closest to?","format":"choice","choices":[{"id":"a","label":"Something ridiculously unexpected."},{"id":"b","label":"A sharp or sarcastic comment."},{"id":"c","label":"Someone laughing at their own mistake."},{"id":"d","label":"A small everyday thing we all recognize."},{"id":"e","label":"An inside joke that wouldn''t make sense to anyone else."}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":20,"status":"published","source":"starter","preview":true,"allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":2},"signals":[{"optionId":"a","attributeKey":"play.recent_humor","value":"absurd","statement":"You recalled laughing at something ridiculously unexpected.","scope":"something that made you laugh recently","kind":"preference","strength":"direct"},{"optionId":"b","attributeKey":"play.recent_humor","value":"sarcastic","statement":"You recalled laughing at a sharp or sarcastic comment.","scope":"something that made you laugh recently","kind":"preference","strength":"direct"},{"optionId":"c","attributeKey":"play.recent_humor","value":"own_mistake","statement":"You recalled laughing with someone about their own mistake.","scope":"something that made you laugh recently","kind":"preference","strength":"direct"},{"optionId":"d","attributeKey":"play.recent_humor","value":"everyday","statement":"You recalled laughing at a recognizable everyday moment.","scope":"something that made you laugh recently","kind":"preference","strength":"direct"},{"optionId":"e","attributeKey":"play.recent_humor","value":"inside_joke","statement":"You recalled an inside joke that depended on shared context.","scope":"something that made you laugh recently","kind":"preference","strength":"direct"}]}'::jsonb),
('creativity-postcard',2,'{"id":"creativity-postcard","version":2,"familyId":"creativity-postcard","domain":"creativity","subdomain":"starting","prompt":"You want to make something but aren''t sure where to start. What do you tend to do?","format":"choice","choices":[{"id":"a","label":"Make a rough first attempt and see where it goes."},{"id":"b","label":"Start with one detail I already have in mind."},{"id":"c","label":"Find an example I can adapt."},{"id":"d","label":"Work out what I want to say before I begin."},{"id":"e","label":"Put it off; choosing where to start can be the hardest part."}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":20,"status":"published","source":"starter","preview":true,"allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":2},"signals":[{"optionId":"a","attributeKey":"creativity.starting.approach","value":"rough_attempt","statement":"You said you tend to start a creative task with a rough first attempt.","scope":"starting something creative","kind":"preference","strength":"direct","criterion":{"label":"Room for a rough first attempt","decisionDomains":["hobbies","learning"]}},{"optionId":"b","attributeKey":"creativity.starting.approach","value":"one_detail","statement":"You said you tend to start a creative task with one detail already in mind.","scope":"starting something creative","kind":"preference","strength":"direct"},{"optionId":"c","attributeKey":"creativity.starting.approach","value":"example","statement":"You said you tend to look for an example to adapt when starting a creative task.","scope":"starting something creative","kind":"preference","strength":"direct"},{"optionId":"d","attributeKey":"creativity.starting.approach","value":"message","statement":"You said you tend to work out your message before beginning a creative task.","scope":"starting something creative","kind":"preference","strength":"direct"},{"optionId":"e","attributeKey":"creativity.starting.approach","value":"put_off","statement":"You said you sometimes put off a creative task because choosing where to start is difficult.","scope":"starting something creative","kind":"preference","strength":"direct"}]}'::jsonb);
create function nudge_private.discovery_starter_edition_version() returns integer language sql immutable as $$ select 2 $$;
revoke all on function nudge_private.discovery_starter_edition_version() from public,anon,authenticated;

$migration_19$;
  end if;
  if to_regprocedure('nudge_private.native_push_version()') is null then
    execute $migration_20$

create table public.native_push_devices (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 installation_id uuid not null unique,
 secret_hash bytea not null,
 device_epoch bigint not null check(device_epoch between 1 and 9007199254740991),
 intent_hash bytea not null,
 token text unique,
 token_revision integer not null default 1 check(token_revision>0),
 enabled boolean not null default false,
 time_zone text not null default 'UTC',
 quiet_start integer not null default 1320 check(quiet_start between 0 and 1439),
 quiet_end integer not null default 480 check(quiet_end between 0 and 1439),
 enabled_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 days',
 check(token is null or (length(token) between 20 and 4096 and token ~ '^[A-Za-z0-9:_.~-]+$')),
 check(not enabled or token is not null)
);
create index native_push_devices_owner on public.native_push_devices(user_id);
alter table public.native_push_devices enable row level security;
create policy native_push_device_owner_read on public.native_push_devices for select to authenticated using(user_id=auth.uid());
revoke all on public.native_push_devices from public,anon,authenticated;
grant select(id,user_id,installation_id,enabled,time_zone,quiet_start,quiet_end,enabled_at,updated_at,expires_at) on public.native_push_devices to authenticated;
grant all on public.native_push_devices to service_role;

create table nudge_private.native_push_deliveries (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid not null references public.notifications(id) on delete cascade,
 device_id uuid not null references public.native_push_devices(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','processing','accepted','expired','failed')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 deadline_at timestamptz not null,
 lease_until timestamptz,
 claim_token uuid,
 token_revision integer,
 last_status integer,
 accepted_at timestamptz,
 constraint native_push_delivery_identity unique(notification_id,device_id)
);
alter table nudge_private.native_push_deliveries enable row level security;
revoke all on nudge_private.native_push_deliveries from public,anon,authenticated,service_role;
create index native_push_ready on nudge_private.native_push_deliveries(next_attempt_at,id) where status in ('pending','processing');

-- A device proof plus monotonically increasing client intent prevents late writes
-- from a former account from re-enabling that account after a switch/logout.
create function public.set_native_push_device(p_installation_id uuid,p_secret text,p_epoch bigint,p_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); previous public.native_push_devices%rowtype; occupied public.native_push_devices%rowtype;
 secret_digest bytea; intent_digest bytea; want_enabled boolean; tz text; qs integer; qe integer; push_token text;
begin
 if uid is null then raise insufficient_privilege; end if;
 if p_installation_id is null or p_secret is null or p_secret !~ '^[a-f0-9]{64}$' or p_epoch is null or p_epoch<1 or p_epoch>9007199254740991
  or p_settings is null or jsonb_typeof(p_settings)<>'object' or jsonb_typeof(p_settings->'enabled') is distinct from 'boolean'
  then raise exception using errcode='22023',message='Invalid device settings'; end if;
 want_enabled:=(p_settings->>'enabled')::boolean;
 if want_enabled then
  if p_settings-ARRAY['enabled','token','timeZone','quietStart','quietEnd'] <> '{}'::jsonb
   or jsonb_typeof(p_settings->'token') is distinct from 'string' or jsonb_typeof(p_settings->'timeZone') is distinct from 'string'
   or jsonb_typeof(p_settings->'quietStart') is distinct from 'number' or jsonb_typeof(p_settings->'quietEnd') is distinct from 'number'
   or (p_settings->>'quietStart') !~ '^\d{1,4}$' or (p_settings->>'quietEnd') !~ '^\d{1,4}$'
   then raise exception using errcode='22023',message='Invalid device settings'; end if;
  push_token:=p_settings->>'token';tz:=p_settings->>'timeZone';qs:=(p_settings->>'quietStart')::integer;qe:=(p_settings->>'quietEnd')::integer;
  if length(push_token) not between 20 and 4096 or push_token !~ '^[A-Za-z0-9:_.~-]+$' or qs not between 0 and 1439 or qe not between 0 and 1439
   or length(tz)>64 or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz)
   then raise exception using errcode='22023',message='Invalid device settings'; end if;
 else
  if p_settings<>'{"enabled":false}'::jsonb then raise exception using errcode='22023',message='Invalid device settings'; end if;
 end if;
 secret_digest:=sha256(convert_to(p_secret,'UTF8'));
 intent_digest:=sha256(convert_to(jsonb_build_object('user',uid,'settings',p_settings)::text,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended('native-push-user:'||uid::text,0));
 perform pg_advisory_xact_lock(hashtextextended('native-push-install:'||p_installation_id::text,0));
 select * into previous from public.native_push_devices where installation_id=p_installation_id for update;
 if found then
  if previous.secret_hash<>secret_digest then raise insufficient_privilege; end if;
  if p_epoch<previous.device_epoch or (p_epoch=previous.device_epoch and previous.intent_hash<>intent_digest)
   then raise exception using errcode='PT409',message='Device settings changed'; end if;
  if p_epoch=previous.device_epoch then return jsonb_build_object('saved',true,'enabled',previous.enabled,'epoch',previous.device_epoch); end if;
 end if;
 if want_enabled then
  select * into occupied from public.native_push_devices where token=push_token and installation_id<>p_installation_id for update;
  if found then
   if occupied.user_id<>uid then raise exception using errcode='PT409',message='Device registration changed'; end if;
   delete from public.native_push_devices where id=occupied.id;
  end if;
 end if;
 if (previous.id is null or previous.user_id<>uid) and (select count(*) from public.native_push_devices where user_id=uid)>=20
  then raise exception using errcode='PT429',message='Too many registered devices'; end if;
 if previous.id is not null and (previous.user_id<>uid or not want_enabled) then
  delete from nudge_private.native_push_deliveries where device_id=previous.id and (previous.user_id<>uid or status in ('pending','processing'));
 end if;
 insert into public.native_push_devices(user_id,installation_id,secret_hash,device_epoch,intent_hash,token,enabled,time_zone,quiet_start,quiet_end)
 values(uid,p_installation_id,secret_digest,p_epoch,intent_digest,push_token,want_enabled,coalesce(tz,'UTC'),coalesce(qs,1320),coalesce(qe,480))
 on conflict(installation_id) do update set user_id=uid,device_epoch=p_epoch,intent_hash=intent_digest,enabled=want_enabled,token=push_token,
  token_revision=public.native_push_devices.token_revision+case when public.native_push_devices.token is distinct from push_token then 1 else 0 end,
  time_zone=coalesce(tz,public.native_push_devices.time_zone),quiet_start=coalesce(qs,public.native_push_devices.quiet_start),quiet_end=coalesce(qe,public.native_push_devices.quiet_end),
  enabled_at=case when want_enabled and (not public.native_push_devices.enabled or public.native_push_devices.user_id<>uid or public.native_push_devices.expires_at<=now()) then now() else public.native_push_devices.enabled_at end,
  updated_at=now(),expires_at=now()+interval '30 days';
 return jsonb_build_object('saved',true,'enabled',want_enabled,'epoch',p_epoch);
end $$;

create function nudge_private.native_push_awake(p_timezone text,p_start integer,p_end integer)
returns boolean language sql stable set search_path='' as $$
 select p_start=p_end or case when p_start<p_end then m<p_start or m>=p_end else m<p_start and m>=p_end end
 from (select extract(hour from now() at time zone p_timezone)::integer*60+extract(minute from now() at time zone p_timezone)::integer m) clock;
$$;
revoke all on function nudge_private.native_push_awake(text,integer,integer) from public,anon,authenticated,service_role;

create function public.claim_native_push_deliveries(p_limit integer default 25)
returns table(delivery_id uuid,claim_token uuid,notification_id uuid,device_id uuid,device_revision integer,recipient_user_id uuid,token text,decision_id uuid)
language plpgsql security definer set search_path='' as $$
begin
 update nudge_private.native_push_deliveries d set status='expired',lease_until=null,claim_token=null
 where d.status in ('pending','processing') and (d.deadline_at<=now() or (d.attempts>=6 and coalesce(d.lease_until,'-infinity'::timestamptz)<=now())
  or exists(select 1 from public.notifications n join public.native_push_devices v on v.id=d.device_id where n.id=d.notification_id and (n.read_at is not null or n.user_id<>v.user_id or not v.enabled or v.expires_at<=now())));
 insert into nudge_private.native_push_deliveries(notification_id,device_id,next_attempt_at,deadline_at)
 select n.id,v.id,n.created_at,n.created_at+interval '7 days'
 from public.notifications n join public.native_push_devices v on v.user_id=n.user_id
 join public.decisions c on c.id::text=n.payload->>'decision_id' and c.user_id=n.user_id
 where n.kind='reflection_prompt' and n.read_at is null and n.created_at>=v.enabled_at and n.created_at>now()-interval '7 days'
  and v.enabled and v.expires_at>now() and c.status='decided' and c.reminder_enabled and c.reminder_version::text=n.payload->>'reminder_version'
  and not exists(select 1 from nudge_private.native_push_deliveries d where d.notification_id=n.id and d.device_id=v.id)
 order by n.created_at,n.id,v.id limit 250 on conflict on constraint native_push_delivery_identity do nothing;
 return query with ready as (
  select d.id from nudge_private.native_push_deliveries d join public.native_push_devices v on v.id=d.device_id
  where d.status in ('pending','processing') and d.next_attempt_at<=now() and (d.lease_until is null or d.lease_until<=now())
   and d.deadline_at>now() and d.attempts<6 and v.enabled and v.expires_at>now() and nudge_private.native_push_awake(v.time_zone,v.quiet_start,v.quiet_end)
  order by d.next_attempt_at,d.id for update of d skip locked limit greatest(1,least(coalesce(p_limit,25),50))
 ), claimed as (
  update nudge_private.native_push_deliveries d set status='processing',attempts=d.attempts+1,lease_until=now()+interval '5 minutes',claim_token=gen_random_uuid(),token_revision=v.token_revision
  from ready,public.native_push_devices v where d.id=ready.id and v.id=d.device_id returning d.*
 ) select d.id,d.claim_token,n.id,v.id,v.token_revision,v.user_id,v.token,(n.payload->>'decision_id')::uuid
 from claimed d join public.native_push_devices v on v.id=d.device_id join public.notifications n on n.id=d.notification_id;
end $$;

create function public.native_push_delivery_current(p_delivery_id uuid,p_claim_token uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from nudge_private.native_push_deliveries d join public.native_push_devices v on v.id=d.device_id
 join public.notifications n on n.id=d.notification_id join public.decisions c on c.id::text=n.payload->>'decision_id' and c.user_id=n.user_id
 where d.id=p_delivery_id and d.claim_token=p_claim_token and d.status='processing' and d.lease_until>now() and d.deadline_at>now()
  and v.enabled and v.expires_at>now() and v.token_revision=d.token_revision and n.read_at is null and n.user_id=v.user_id
  and c.status='decided' and c.reminder_enabled and c.reminder_version::text=n.payload->>'reminder_version'
  and nudge_private.native_push_awake(v.time_zone,v.quiet_start,v.quiet_end));
$$;

create function public.finish_native_push_delivery(p_delivery_id uuid,p_claim_token uuid,p_outcome text,p_status integer default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare delivery nudge_private.native_push_deliveries%rowtype; device public.native_push_devices%rowtype;
begin
 if p_outcome is null or p_outcome not in ('accepted','retry','failed','gone','expired') then raise exception 'Invalid native delivery outcome'; end if;
 select * into delivery from nudge_private.native_push_deliveries where id=p_delivery_id and status='processing' and claim_token=p_claim_token and lease_until>now() for update;
 if not found then return false; end if;
 select * into device from public.native_push_devices where id=delivery.device_id for update;
 if not found then return false; end if;
 if p_outcome='gone' and device.token_revision=delivery.token_revision then
  update public.native_push_devices set enabled=false,token=null,updated_at=now() where id=device.id;
 end if;
 update nudge_private.native_push_deliveries set
  status=case when p_outcome='accepted' then 'accepted' when p_outcome='failed' then 'failed'
   when p_outcome='expired' or (p_outcome='gone' and device.token_revision=delivery.token_revision) or attempts>=6 or deadline_at<=now() then 'expired' else 'pending' end,
  next_attempt_at=now()+least(3600,60*power(2,attempts-1))::integer*interval '1 second',
  accepted_at=case when p_outcome='accepted' then now() else null end,last_status=case when p_status between 100 and 599 then p_status else null end,
  lease_until=null,claim_token=null where id=delivery.id;
 return true;
end $$;

revoke all on function public.set_native_push_device(uuid,text,bigint,jsonb) from public,anon;
grant execute on function public.set_native_push_device(uuid,text,bigint,jsonb) to authenticated;
revoke all on function public.claim_native_push_deliveries(integer),public.native_push_delivery_current(uuid,uuid),public.finish_native_push_delivery(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_native_push_deliveries(integer),public.native_push_delivery_current(uuid,uuid),public.finish_native_push_delivery(uuid,uuid,text,integer) to service_role;
create function nudge_private.native_push_version() returns integer language sql immutable set search_path='' as $$ select 20; $$;
revoke all on function nudge_private.native_push_version() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';

$migration_20$;
  end if;
  if to_regprocedure('nudge_private.native_daily_questions_version()') is null then
    execute $migration_21$

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

$migration_21$;
  end if;
  if to_regprocedure('nudge_private.discovery_decision_priorities_version()') is null then
    execute $migration_22$
-- Add scoped decision-priority questions without changing existing definitions.

insert into public.discovery_question_versions(question_id,version,definition) values
('food-weeknight-tradeoff',1,'{"id":"food-weeknight-tradeoff","version":1,"familyId":"food-weeknight-tradeoff","domain":"food","subdomain":"weeknight-meal","prompt":"You’re making dinner on a busy night. What would make one meal win over another?","format":"choice","choices":[{"id":"a","label":"It comes together fast"},{"id":"b","label":"There’s almost nothing to wash"},{"id":"c","label":"I already have what I need"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"food.weeknight-meal.priority","value":"speed","statement":"You picked quick preparation for a busy-night dinner.","scope":"for a busy-night dinner","kind":"preference","strength":"direct","criterion":{"label":"Quick preparation","decisionDomains":["food"]}},{"optionId":"b","attributeKey":"food.weeknight-meal.priority","value":"cleanup","statement":"You picked easy cleanup for a busy-night dinner.","scope":"for a busy-night dinner","kind":"preference","strength":"direct","criterion":{"label":"Easy cleanup","decisionDomains":["food"]}},{"optionId":"c","attributeKey":"food.weeknight-meal.priority","value":"ingredients","statement":"You picked ingredients already on hand for a busy-night dinner.","scope":"for a busy-night dinner","kind":"preference","strength":"direct","criterion":{"label":"Ingredients already on hand","decisionDomains":["food"]}}]}'::jsonb),
('food-lunch-tradeoff',1,'{"id":"food-lunch-tradeoff","version":1,"familyId":"food-lunch-tradeoff","domain":"food","subdomain":"lunch-out","prompt":"You’re choosing lunch between errands. What would tip the choice?","format":"choice","choices":[{"id":"a","label":"I can get it without waiting"},{"id":"b","label":"I know it will fill me up"},{"id":"c","label":"It gives me a chance to try something new"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"food.lunch-out.priority","value":"wait","statement":"You picked a short wait for lunch between errands.","scope":"for lunch between errands","kind":"preference","strength":"direct","criterion":{"label":"A short wait","decisionDomains":["food"]}},{"optionId":"b","attributeKey":"food.lunch-out.priority","value":"filling","statement":"You picked a filling portion for lunch between errands.","scope":"for lunch between errands","kind":"preference","strength":"direct","criterion":{"label":"A filling portion","decisionDomains":["food"]}},{"optionId":"c","attributeKey":"food.lunch-out.priority","value":"novelty","statement":"You picked something new to try for lunch between errands.","scope":"for lunch between errands","kind":"preference","strength":"direct","criterion":{"label":"Something new to try","decisionDomains":["food"]}}]}'::jsonb),
('study-short-session',1,'{"id":"study-short-session","version":1,"familyId":"study-short-session","domain":"learning","subdomain":"short-study-session","prompt":"You have 20 minutes before your next class. Which would make that time feel well spent?","format":"choice","choices":[{"id":"a","label":"Practice one thing from memory"},{"id":"b","label":"Work through one example"},{"id":"c","label":"Clear up one question I’m stuck on"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"learning.short-study-session.priority","value":"practice","statement":"You picked recall practice for a short study session.","scope":"for a short study session","kind":"preference","strength":"direct","criterion":{"label":"Recall practice","decisionDomains":["study","learning"]}},{"optionId":"b","attributeKey":"learning.short-study-session.priority","value":"example","statement":"You picked worked examples for a short study session.","scope":"for a short study session","kind":"preference","strength":"direct","criterion":{"label":"Worked examples","decisionDomains":["study","learning"]}},{"optionId":"c","attributeKey":"learning.short-study-session.priority","value":"question","statement":"You picked help with one sticking point for a short study session.","scope":"for a short study session","kind":"preference","strength":"direct","criterion":{"label":"Help with one sticking point","decisionDomains":["study","learning"]}}]}'::jsonb),
('study-space-tradeoff',1,'{"id":"study-space-tradeoff","version":1,"familyId":"study-space-tradeoff","domain":"learning","subdomain":"study-space","prompt":"If you could study in any of these settings, what would matter most?","format":"choice","choices":[{"id":"a","label":"Somewhere I can count on quiet"},{"id":"b","label":"Somewhere I can get to quickly"},{"id":"c","label":"Somewhere a friend can join"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"learning.study-space.priority","value":"quiet","statement":"You picked quiet surroundings for a place to study.","scope":"for a place to study","kind":"preference","strength":"direct","criterion":{"label":"Quiet surroundings","decisionDomains":["study","learning"]}},{"optionId":"b","attributeKey":"learning.study-space.priority","value":"access","statement":"You picked easy to get to for a place to study.","scope":"for a place to study","kind":"preference","strength":"direct","criterion":{"label":"Easy to get to","decisionDomains":["study","learning"]}},{"optionId":"c","attributeKey":"learning.study-space.priority","value":"company","statement":"You picked room to study with a friend for a place to study.","scope":"for a place to study","kind":"preference","strength":"direct","criterion":{"label":"Room to study with a friend","decisionDomains":["study","learning"]}}]}'::jsonb),
('rest-break-tradeoff',1,'{"id":"rest-break-tradeoff","version":1,"familyId":"rest-break-tradeoff","domain":"rest","subdomain":"short-break","prompt":"You have a short break and nothing you need to get done. What would make it feel like a break?","format":"choice","choices":[{"id":"a","label":"A few minutes with no input"},{"id":"b","label":"A change of scenery"},{"id":"c","label":"A little time with someone I like"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"rest.short-break.priority","value":"quiet","statement":"You picked low stimulation for a short break.","scope":"for a short break","kind":"preference","strength":"direct","criterion":{"label":"Low stimulation","decisionDomains":["rest"]}},{"optionId":"b","attributeKey":"rest.short-break.priority","value":"scenery","statement":"You picked a change of scenery for a short break.","scope":"for a short break","kind":"preference","strength":"direct","criterion":{"label":"A change of scenery","decisionDomains":["rest"]}},{"optionId":"c","attributeKey":"rest.short-break.priority","value":"company","statement":"You picked easy company for a short break.","scope":"for a short break","kind":"preference","strength":"direct","criterion":{"label":"Easy company","decisionDomains":["rest"]}}]}'::jsonb),
('rest-evening-tradeoff',1,'{"id":"rest-evening-tradeoff","version":1,"familyId":"rest-evening-tradeoff","domain":"rest","subdomain":"evening-plan","prompt":"After a full day, what would make an evening plan sound easier to say yes to?","format":"choice","choices":[{"id":"a","label":"I can stay close to home"},{"id":"b","label":"I can leave whenever I like"},{"id":"c","label":"Someone else takes care of the details"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"rest.evening-plan.priority","value":"nearby","statement":"You picked close to home for an evening after a full day.","scope":"for an evening after a full day","kind":"preference","strength":"direct","criterion":{"label":"Close to home","decisionDomains":["rest"]}},{"optionId":"b","attributeKey":"rest.evening-plan.priority","value":"flexible","statement":"You picked freedom to leave early for an evening after a full day.","scope":"for an evening after a full day","kind":"preference","strength":"direct","criterion":{"label":"Freedom to leave early","decisionDomains":["rest"]}},{"optionId":"c","attributeKey":"rest.evening-plan.priority","value":"effort","statement":"You picked little planning effort for an evening after a full day.","scope":"for an evening after a full day","kind":"preference","strength":"direct","criterion":{"label":"Little planning effort","decisionDomains":["rest"]}}]}'::jsonb),
('money-small-purchase-tradeoff',1,'{"id":"money-small-purchase-tradeoff","version":1,"familyId":"money-small-purchase-tradeoff","domain":"money","subdomain":"small-purchase","prompt":"Two everyday items would both do the job. What usually tips a small purchase for you?","format":"choice","choices":[{"id":"a","label":"Pay less today"},{"id":"b","label":"Get something that will last longer"},{"id":"c","label":"Be able to return it easily"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"money.small-purchase.priority","value":"cost","statement":"You picked lower upfront cost for a small everyday purchase.","scope":"for a small everyday purchase","kind":"preference","strength":"direct","criterion":{"label":"Lower upfront cost","decisionDomains":["money"]}},{"optionId":"b","attributeKey":"money.small-purchase.priority","value":"durable","statement":"You picked expected durability for a small everyday purchase.","scope":"for a small everyday purchase","kind":"preference","strength":"direct","criterion":{"label":"Expected durability","decisionDomains":["money"]}},{"optionId":"c","attributeKey":"money.small-purchase.priority","value":"return","statement":"You picked an easy return for a small everyday purchase.","scope":"for a small everyday purchase","kind":"preference","strength":"direct","criterion":{"label":"An easy return","decisionDomains":["money"]}}]}'::jsonb),
('money-recurring-service-tradeoff',1,'{"id":"money-recurring-service-tradeoff","version":1,"familyId":"money-recurring-service-tradeoff","domain":"money","subdomain":"recurring-service","prompt":"You’re choosing between two low-cost monthly services. What do you check first?","format":"choice","choices":[{"id":"a","label":"What I’ll actually pay each month"},{"id":"b","label":"How easy it is to cancel"},{"id":"c","label":"Whether I’ll use it most weeks"}],"purpose":"evidence","depth":0,"sensitivity":"ordinary","estimatedSeconds":12,"status":"published","source":"starter","allowedResponses":["depends","neither","skip"],"review":{"type":"authored_seed","version":1},"signals":[{"optionId":"a","attributeKey":"money.recurring-service.priority","value":"cost","statement":"You picked total monthly cost for a monthly service.","scope":"for a monthly service","kind":"preference","strength":"direct","criterion":{"label":"Total monthly cost","decisionDomains":["money"]}},{"optionId":"b","attributeKey":"money.recurring-service.priority","value":"cancel","statement":"You picked easy cancellation for a monthly service.","scope":"for a monthly service","kind":"preference","strength":"direct","criterion":{"label":"Easy cancellation","decisionDomains":["money"]}},{"optionId":"c","attributeKey":"money.recurring-service.priority","value":"use","statement":"You picked expected frequency of use for a monthly service.","scope":"for a monthly service","kind":"preference","strength":"direct","criterion":{"label":"Expected frequency of use","decisionDomains":["money"]}}]}'::jsonb);
create function nudge_private.discovery_decision_priorities_version() returns integer language sql immutable as $$ select 1 $$;
revoke all on function nudge_private.discovery_decision_priorities_version() from public,anon,authenticated;

$migration_22$;
  end if;
  if to_regprocedure('public.save_reviewed_memories(uuid,jsonb,integer)') is null or to_regprocedure('public.create_comparison_with_evidence(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer,jsonb)') is null or to_regprocedure('public.rerank_comparison_with_evidence(uuid,integer,jsonb,jsonb,integer,jsonb)') is null or to_regprocedure('public.read_my_comparison_evidence(uuid)') is null or to_regprocedure('public.export_my_comparison_evidence(integer)') is null or to_regprocedure('public.get_comparison_settings_state()') is null or to_regprocedure('public.save_comparison_setting(uuid,text,text,public.decision_category,text,jsonb,integer)') is null or to_regprocedure('public.delete_comparison_setting(uuid,integer)') is null or to_regprocedure('public.reserve_ai_usage_attempt(uuid,uuid,text,text,text,integer,bigint,bigint,bigint)') is null or to_regprocedure('public.finish_ai_usage_attempt(uuid,uuid,text,bigint,bigint,bigint)') is null or to_regprocedure('public.export_my_ai_usage()') is null or to_regprocedure('public.discover_next_question(text)') is null or to_regprocedure('public.reserve_ai_request(text)') is null or to_regprocedure('public.create_circle_poll(uuid,text,jsonb)') is null or to_regprocedure('public.create_comparison_once(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer)') is null then raise exception 'Incomplete schema detected. No update was committed; restore/review the missing functions.'; end if;
end $update$;
notify pgrst,'reload schema';
commit;
