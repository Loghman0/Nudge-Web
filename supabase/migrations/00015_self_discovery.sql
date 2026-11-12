-- Additive self-discovery storage. Existing decisions and question answers remain intact.
begin;
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
commit;

