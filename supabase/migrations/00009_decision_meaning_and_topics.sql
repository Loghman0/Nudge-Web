-- Additive upgrade after 00008. No existing questions, answers or decisions are removed.
begin;

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

commit;
