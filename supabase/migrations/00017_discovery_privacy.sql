-- Retract deleted discovery sources, preserve explicit feedback, and expose
-- forgotten-question suppression to clients. Existing decisions are unchanged.
begin;

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
commit;

