-- Short-lived operational accounting for paid AI requests. Never stores input,
-- output, credentials, URLs, or provider error bodies. Server-side credentials
-- are required to reserve/finish; authenticated users can only export their own.
begin;

create table nudge_private.ai_usage_attempts (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('extract','explain','recap','interpret')),
  provider text not null check (provider ~ '^[a-z0-9:_-]{1,80}$'),
  model text not null check (length(model) between 1 and 160 and model !~ '[[:cntrl:]]'),
  memory_generation integer not null check (memory_generation >= 0),
  usage_day date not null,
  status text not null default 'reserved' check (status in ('reserved','unknown','settled')),
  outcome text check (outcome in ('succeeded','failed','unknown')),
  reserved_cost_micros bigint not null check (reserved_cost_micros > 0),
  charged_cost_micros bigint not null check (charged_cost_micros >= 0),
  actual_cost_micros bigint check (actual_cost_micros >= 0),
  input_tokens bigint check (input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  constraint ai_usage_known_cost check (
    (status='settled' and actual_cost_micros is not null and input_tokens is not null
      and output_tokens is not null and charged_cost_micros=actual_cost_micros and outcome is not null and outcome in ('succeeded','failed'))
    or (status in ('reserved','unknown') and actual_cost_micros is null
      and charged_cost_micros=reserved_cost_micros)
  )
);
create index ai_usage_attempts_user_day on nudge_private.ai_usage_attempts(user_id,usage_day);
create index ai_usage_attempts_retention on nudge_private.ai_usage_attempts(created_at);

-- No owner identifier: deletion removes owned attempts but must not refund
-- incurred costs from the shared daily budget. These totals are also temporary.
create table nudge_private.ai_usage_daily_totals (
  usage_day date primary key,
  charged_cost_micros bigint not null default 0 check (charged_cost_micros >= 0)
);
alter table nudge_private.ai_usage_attempts enable row level security;
alter table nudge_private.ai_usage_daily_totals enable row level security;
revoke all on nudge_private.ai_usage_attempts,nudge_private.ai_usage_daily_totals from public,anon,authenticated,service_role;

create function public.reserve_ai_usage_attempt(
  p_user_id uuid,p_request_id uuid,p_action text,p_provider text,p_model text,p_memory_generation integer,
  p_max_cost_micros bigint,p_user_daily_budget_micros bigint,p_global_daily_budget_micros bigint
)
returns table(reserved boolean,reason text)
language plpgsql security definer set search_path='' as $$
declare
  v_day date := (clock_timestamp() at time zone 'UTC')::date;
  v_global bigint;
  v_user bigint;
  v_inserted uuid;
begin
  if p_user_id is null or p_request_id is null or p_action is null
    or p_action not in ('extract','explain','recap','interpret')
    or p_provider is null or p_provider !~ '^[a-z0-9:_-]{1,80}$'
    or p_model is null or length(p_model) not between 1 and 160 or p_model ~ '[[:cntrl:]]'
    or p_memory_generation is null or p_memory_generation<0
    or p_max_cost_micros is null or p_max_cost_micros not between 1 and 1000000000000
    or p_user_daily_budget_micros is null or p_user_daily_budget_micros not between 1 and 1000000000000000
    or p_global_daily_budget_micros is null or p_global_daily_budget_micros not between 1 and 1000000000000000
  then raise exception 'Invalid AI usage reservation'; end if;

  -- Lock the same consent/generation row used by privacy changes. The captured
  -- generation must still be current at the point the server reserves a call.
  perform 1 from public.profiles p where p.id=p_user_id and p.ai_enabled
    and p.terms_version='2026-10-12' and p.memory_generation=p_memory_generation for update;
  if not found then return query select false,'consent_or_generation'::text; return; end if;

  -- Opportunistic bounded retention. SKIP LOCKED does not interrupt a concurrent
  -- reconciliation. No current or previous UTC date is eligible for totals
  -- cleanup, and a day with a retained attempt is never removed.
  with expired as (
    select a.request_id from nudge_private.ai_usage_attempts a
    where a.created_at<clock_timestamp()-interval '48 hours'
    order by a.created_at,a.request_id for update skip locked limit 1000
  ) delete from nudge_private.ai_usage_attempts a using expired where a.request_id=expired.request_id;
  with expired_days as (
    select d.usage_day from nudge_private.ai_usage_daily_totals d
    where d.usage_day<v_day-1
      and not exists(select 1 from nudge_private.ai_usage_attempts a where a.usage_day=d.usage_day)
    for update skip locked
  ) delete from nudge_private.ai_usage_daily_totals d using expired_days where d.usage_day=expired_days.usage_day;

  insert into nudge_private.ai_usage_daily_totals(usage_day) values(v_day) on conflict do nothing;
  -- Every reservation and reconciliation for a UTC day serializes on this row.
  -- Checking and charging both budgets therefore happens in one transaction.
  select d.charged_cost_micros into v_global from nudge_private.ai_usage_daily_totals d
    where d.usage_day=v_day for update;
  if exists(select 1 from nudge_private.ai_usage_attempts a where a.request_id=p_request_id) then
    return query select false,'duplicate'::text; return;
  end if;
  select coalesce(sum(a.charged_cost_micros),0)::bigint into v_user
    from nudge_private.ai_usage_attempts a where a.user_id=p_user_id and a.usage_day=v_day;
  if p_max_cost_micros>p_user_daily_budget_micros-v_user then
    return query select false,'user_budget'::text; return;
  end if;
  if p_max_cost_micros>p_global_daily_budget_micros-v_global then
    return query select false,'global_budget'::text; return;
  end if;
  insert into nudge_private.ai_usage_attempts(request_id,user_id,action,provider,model,memory_generation,
    usage_day,reserved_cost_micros,charged_cost_micros)
    values(p_request_id,p_user_id,p_action,p_provider,p_model,p_memory_generation,v_day,p_max_cost_micros,p_max_cost_micros)
    on conflict do nothing returning request_id into v_inserted;
  -- Also handles the extremely narrow same-UUID race across a UTC day boundary.
  if v_inserted is null then return query select false,'duplicate'::text; return; end if;
  update nudge_private.ai_usage_daily_totals d set charged_cost_micros=d.charged_cost_micros+p_max_cost_micros
    where d.usage_day=v_day;
  return query select true,'reserved'::text;
end $$;

create function public.finish_ai_usage_attempt(
  p_user_id uuid,p_request_id uuid,p_outcome text,p_input_tokens bigint default null,
  p_output_tokens bigint default null,p_actual_cost_micros bigint default null
)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_day date; v_attempt nudge_private.ai_usage_attempts%rowtype; v_known boolean;
begin
  if p_user_id is null or p_request_id is null or p_outcome is null or p_outcome not in ('succeeded','failed','unknown')
    or (p_input_tokens is not null and p_input_tokens not between 0 and 1000000000000)
    or (p_output_tokens is not null and p_output_tokens not between 0 and 1000000000000)
    or (p_actual_cost_micros is not null and p_actual_cost_micros not between 0 and 1000000000000)
  then raise exception 'Invalid AI usage reconciliation'; end if;
  v_known := p_input_tokens is not null and p_output_tokens is not null and p_actual_cost_micros is not null
    and p_outcome in ('succeeded','failed');
  -- Lock order matches reservation: global day before attempt. Unknown usage
  -- (timeouts, dropped connections, malformed usage) always keeps the reserve.
  select a.usage_day into v_day from nudge_private.ai_usage_attempts a
    where a.request_id=p_request_id and a.user_id=p_user_id;
  if not found then return false; end if;
  perform 1 from nudge_private.ai_usage_daily_totals d where d.usage_day=v_day for update;
  if not found then return false; end if;
  select * into v_attempt from nudge_private.ai_usage_attempts a
    where a.request_id=p_request_id and a.user_id=p_user_id for update;
  if not found then return false; end if;
  if v_attempt.status='settled' then
    if not v_known then return true; end if; -- late timeout cannot erase known usage
    if v_attempt.input_tokens=p_input_tokens and v_attempt.output_tokens=p_output_tokens
      and v_attempt.actual_cost_micros=p_actual_cost_micros and v_attempt.outcome=p_outcome then return true; end if;
    raise exception 'Conflicting AI usage reconciliation';
  end if;
  if not v_known then
    update nudge_private.ai_usage_attempts a set status='unknown',outcome=p_outcome,
      input_tokens=p_input_tokens,output_tokens=p_output_tokens,finished_at=clock_timestamp()
      where a.request_id=p_request_id;
    return true;
  end if;
  -- A provider can report more than the reservation. Charge all observed cost;
  -- later reservations will then fail closed against the exceeded budget.
  update nudge_private.ai_usage_daily_totals d set
    charged_cost_micros=d.charged_cost_micros-v_attempt.charged_cost_micros+p_actual_cost_micros
    where d.usage_day=v_day;
  update nudge_private.ai_usage_attempts a set status='settled',outcome=p_outcome,
    input_tokens=p_input_tokens,output_tokens=p_output_tokens,actual_cost_micros=p_actual_cost_micros,
    charged_cost_micros=p_actual_cost_micros,finished_at=clock_timestamp() where a.request_id=p_request_id;
  return true;
end $$;

create function public.export_my_ai_usage()
returns table(request_id uuid,action text,provider text,model text,status text,outcome text,input_tokens bigint,
  output_tokens bigint,reserved_cost_micros bigint,actual_cost_micros bigint,created_at timestamptz,finished_at timestamptz)
language sql stable security definer set search_path='' as $$
  select a.request_id,a.action,a.provider,a.model,a.status,a.outcome,a.input_tokens,a.output_tokens,
    a.reserved_cost_micros,a.actual_cost_micros,a.created_at,a.finished_at
  from nudge_private.ai_usage_attempts a where a.user_id=auth.uid() and a.created_at>=now()-interval '48 hours'
  order by a.created_at desc,a.request_id asc;
$$;

revoke all on function public.reserve_ai_usage_attempt(uuid,uuid,text,text,text,integer,bigint,bigint,bigint),
  public.finish_ai_usage_attempt(uuid,uuid,text,bigint,bigint,bigint),public.export_my_ai_usage() from public,anon,authenticated;
grant execute on function public.reserve_ai_usage_attempt(uuid,uuid,text,text,text,integer,bigint,bigint,bigint),
  public.finish_ai_usage_attempt(uuid,uuid,text,bigint,bigint,bigint) to service_role;
grant execute on function public.export_my_ai_usage() to authenticated;
create function nudge_private.ai_usage_ledger_version() returns integer language sql immutable set search_path='' as $$ select 10; $$;
revoke all on function nudge_private.ai_usage_ledger_version() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
