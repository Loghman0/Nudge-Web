-- Durable per-device delivery. Provider success followed by a crash before ACK
-- can still duplicate a send: Web Push has no transactional exactly-once API.
begin;
create table nudge_private.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed','expired')),
  attempts integer not null default 0 check (attempts between 0 and 6),
  next_attempt_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  lease_until timestamptz,
  claim_token uuid,
  delivered_at timestamptz,
  last_status integer,
  constraint push_delivery_identity unique(notification_id,subscription_id)
);
create index push_deliveries_ready on nudge_private.push_deliveries(next_attempt_at,id) where status in ('pending','processing');
create index push_deliveries_notification on nudge_private.push_deliveries(notification_id);
create index push_deliveries_subscription on nudge_private.push_deliveries(subscription_id);
alter table nudge_private.push_deliveries enable row level security;
revoke all on nudge_private.push_deliveries from public,anon,authenticated,service_role;

create function public.claim_push_deliveries(p_limit integer default 25)
returns table(delivery_id uuid,claim_token uuid,notification_id uuid,subscription_id uuid,endpoint text,p256dh text,auth text,title text,body text)
language plpgsql security definer set search_path='' as $$
begin
  -- Mark read/snoozed/expired prompts terminal, including crashed last attempts.
  update nudge_private.push_deliveries d set status='expired',lease_until=null,claim_token=null
    where d.status in ('pending','processing') and
      (d.deadline_at<=now() or (d.attempts>=6 and coalesce(d.lease_until,'-infinity'::timestamptz)<=now())
       or exists(select 1 from public.notifications n where n.id=d.notification_id and n.read_at is not null));

  -- No one-hour cutoff. Seed a bounded oldest-first backlog and skip identities
  -- already present so completed devices cannot starve later notifications.
  insert into nudge_private.push_deliveries(notification_id,subscription_id,next_attempt_at,deadline_at)
    select n.id,s.id,n.created_at,n.created_at+interval '7 days'
    from public.notifications n join public.push_subscriptions s on s.user_id=n.user_id
    where n.kind='reflection_prompt' and n.read_at is null and n.created_at>now()-interval '7 days'
      and not exists(select 1 from nudge_private.push_deliveries d where d.notification_id=n.id and d.subscription_id=s.id)
    order by n.created_at,n.id,s.id limit 250
    on conflict on constraint push_delivery_identity do nothing;

  return query
    with ready as (
      select d.id from nudge_private.push_deliveries d
      where d.status in ('pending','processing') and d.next_attempt_at<=now()
        and (d.lease_until is null or d.lease_until<=now()) and d.deadline_at>now() and d.attempts<6
      order by d.next_attempt_at,d.id
      for update skip locked limit greatest(1,least(coalesce(p_limit,25),50))
    ), claimed as (
      update nudge_private.push_deliveries d set status='processing',attempts=d.attempts+1,
        lease_until=now()+interval '5 minutes',claim_token=gen_random_uuid()
      from ready where d.id=ready.id returning d.*
    )
    select d.id,d.claim_token,n.id,s.id,s.endpoint,s.p256dh,s.auth,n.title,n.body
    from claimed d join public.notifications n on n.id=d.notification_id
      join public.push_subscriptions s on s.id=d.subscription_id;
end $$;

create function public.finish_push_delivery(p_delivery_id uuid,p_claim_token uuid,p_outcome text,p_status integer default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare delivery nudge_private.push_deliveries%rowtype;
begin
  if p_outcome not in ('delivered','retry','failed','gone') or p_outcome is null then raise exception 'Invalid delivery outcome'; end if;
  select * into delivery from nudge_private.push_deliveries d where d.id=p_delivery_id and d.status='processing'
    and d.claim_token=p_claim_token and d.lease_until>now() for update;
  if not found then return false; end if;
  if p_outcome='gone' then
    if p_status not in (404,410) or p_status is null then raise exception 'Invalid subscription expiry status'; end if;
    delete from public.push_subscriptions where id=delivery.subscription_id;
    return true;
  end if;
  update nudge_private.push_deliveries d set
    status=case when p_outcome='delivered' then 'delivered'
      when p_outcome='failed' then 'failed'
      when d.attempts>=6 or d.deadline_at<=now() then 'expired' else 'pending' end,
    next_attempt_at=case when p_outcome='retry' then now()+least(3600,60*power(2,d.attempts-1))::integer*interval '1 second' else d.next_attempt_at end,
    delivered_at=case when p_outcome='delivered' then now() else null end,
    last_status=case when p_status between 100 and 599 then p_status else null end,
    lease_until=null,claim_token=null
    where d.id=delivery.id;
  return true;
end $$;

revoke all on function public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,uuid,text,integer) to service_role;
create function nudge_private.push_delivery_version() returns integer language sql immutable set search_path='' as $$ select 7; $$;
revoke all on function nudge_private.push_delivery_version() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
