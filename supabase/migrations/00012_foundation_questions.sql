-- Six contextual starter questions. Existing catalog rows, flags, answers and
-- journal records are retained. The UI selects foundationEdition=1 explicitly.
begin;

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
commit;
