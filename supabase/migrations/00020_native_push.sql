begin;

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
commit;
