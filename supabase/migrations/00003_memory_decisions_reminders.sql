-- New features after 00001 + 00002. Apply once before deploying this source.
begin;

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
commit;
