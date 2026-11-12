-- Only explicitly reviewed statements become new durable extracted memories.
begin;
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
commit;
