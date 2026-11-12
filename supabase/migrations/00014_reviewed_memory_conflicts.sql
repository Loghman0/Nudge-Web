-- A privacy/consent validation conflict must not trigger serialization retries.
-- PostgREST maps PT409 to HTTP 409 without retrying the transaction.
begin;
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
commit;
