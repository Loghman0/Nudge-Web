-- Apply after 00003. Keeps existing answers and evidence intact.
begin;

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

commit;
