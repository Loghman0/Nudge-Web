-- Apply after 00001_baseline (or the matching complete-setup snapshot).
-- All access changes and new functions become visible together.
begin;
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
commit;
