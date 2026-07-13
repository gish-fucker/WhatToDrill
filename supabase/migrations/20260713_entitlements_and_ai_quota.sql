create table if not exists public.account_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled', 'expired')),
  current_period_end timestamptz,
  provider_customer_id text,
  provider_subscription_id text,
  updated_at timestamptz not null default now()
);

create unique index if not exists account_entitlements_provider_customer_unique
  on public.account_entitlements (provider_customer_id)
  where provider_customer_id is not null;

create unique index if not exists account_entitlements_provider_subscription_unique
  on public.account_entitlements (provider_subscription_id)
  where provider_subscription_id is not null;

create table if not exists public.ai_quota_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  status text not null check (status in ('reserved', 'completed', 'released')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  released_at timestamptz,
  check ((status = 'completed') = (completed_at is not null)),
  check ((status = 'released') = (released_at is not null))
);

create index if not exists ai_quota_events_account_period_status
  on public.ai_quota_events (user_id, period_start, status, created_at);

alter table public.account_entitlements enable row level security;
alter table public.ai_quota_events enable row level security;

revoke all on table public.account_entitlements from public, anon, authenticated;
revoke all on table public.ai_quota_events from public, anon, authenticated;

create or replace function public._get_account_entitlement_summary(
  p_user_id uuid,
  p_free_limit integer,
  p_pro_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_status text;
  v_period_end timestamptz;
  v_effective_plan text := 'free';
  v_limit integer;
  v_period_start date := date_trunc('month', timezone('UTC', now()))::date;
  v_reset_at timestamptz := (date_trunc('month', timezone('UTC', now())) + interval '1 month') at time zone 'UTC';
  v_used integer := 0;
  v_pending integer := 0;
begin
  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;
  if p_free_limit < 1 or p_pro_limit < 1 then
    raise exception 'quota limits must be positive' using errcode = '22023';
  end if;

  select plan, status, current_period_end
    into v_plan, v_status, v_period_end
    from public.account_entitlements
    where user_id = p_user_id;

  if found and v_plan = 'pro' and v_status in ('active', 'trialing') and v_period_end > now() then
    v_effective_plan := 'pro';
  end if;
  v_limit := case when v_effective_plan = 'pro' then p_pro_limit else p_free_limit end;

  select
    count(*) filter (where status = 'completed')::integer,
    count(*) filter (where status = 'reserved' and created_at >= now() - interval '10 minutes')::integer
  into v_used, v_pending
  from public.ai_quota_events
  where user_id = p_user_id and period_start = v_period_start;

  return jsonb_build_object(
    'effective_plan', v_effective_plan,
    'subscription_status', v_status,
    'current_period_end', v_period_end,
    'quota', jsonb_build_object(
      'used', v_used,
      'pending', v_pending,
      'remaining', greatest(v_limit - v_used - v_pending, 0),
      'limit', v_limit,
      'reset_at', v_reset_at
    )
  );
end;
$$;

create or replace function public.get_account_entitlement(
  p_user_id uuid,
  p_free_limit integer,
  p_pro_limit integer
) returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public._get_account_entitlement_summary(p_user_id, p_free_limit, p_pro_limit);
$$;

create or replace function public.reserve_ai_advice_quota(
  p_user_id uuid,
  p_request_id uuid,
  p_free_limit integer,
  p_pro_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_user uuid;
  v_existing_status text;
  v_existing_created_at timestamptz;
  v_period_start date := date_trunc('month', timezone('UTC', now()))::date;
  v_summary jsonb;
begin
  if p_request_id is null then
    raise exception 'request id is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select user_id, status, created_at
    into v_existing_user, v_existing_status, v_existing_created_at
    from public.ai_quota_events
    where id = p_request_id;

  if found then
    if v_existing_user <> p_user_id then
      raise exception 'request id belongs to another account' using errcode = '42501';
    end if;
    if v_existing_status = 'completed' or (v_existing_status = 'reserved' and v_existing_created_at >= now() - interval '10 minutes') then
      return public._get_account_entitlement_summary(p_user_id, p_free_limit, p_pro_limit)
        || jsonb_build_object('allowed', true, 'idempotent', true);
    end if;
    if v_existing_status = 'reserved' then
      update public.ai_quota_events
        set status = 'released', released_at = now()
        where id = p_request_id;
    end if;
    return public._get_account_entitlement_summary(p_user_id, p_free_limit, p_pro_limit)
      || jsonb_build_object('allowed', false, 'idempotent', true);
  end if;

  v_summary := public._get_account_entitlement_summary(p_user_id, p_free_limit, p_pro_limit);
  if (v_summary #>> '{quota,remaining}')::integer < 1 then
    return v_summary || jsonb_build_object('allowed', false, 'idempotent', false);
  end if;

  insert into public.ai_quota_events (id, user_id, period_start, status)
    values (p_request_id, p_user_id, v_period_start, 'reserved');

  return public._get_account_entitlement_summary(p_user_id, p_free_limit, p_pro_limit)
    || jsonb_build_object('allowed', true, 'idempotent', false);
end;
$$;

create or replace function public.complete_ai_advice_quota(
  p_user_id uuid,
  p_request_id uuid,
  p_free_limit integer,
  p_pro_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.ai_quota_events%rowtype;
  v_completed boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into v_event from public.ai_quota_events where id = p_request_id;
  if not found or v_event.user_id <> p_user_id then
    raise exception 'quota reservation not found' using errcode = '22023';
  end if;

  if v_event.status = 'completed' then
    v_completed := true;
  elsif v_event.status = 'reserved' and v_event.created_at >= now() - interval '10 minutes' then
    update public.ai_quota_events
      set status = 'completed', completed_at = now()
      where id = p_request_id;
    v_completed := true;
  elsif v_event.status = 'reserved' then
    update public.ai_quota_events
      set status = 'released', released_at = now()
      where id = p_request_id;
  end if;

  return public._get_account_entitlement_summary(p_user_id, p_free_limit, p_pro_limit)
    || jsonb_build_object('completed', v_completed);
end;
$$;

create or replace function public.release_ai_advice_quota(
  p_user_id uuid,
  p_request_id uuid,
  p_free_limit integer,
  p_pro_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.ai_quota_events%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into v_event from public.ai_quota_events where id = p_request_id;
  if not found or v_event.user_id <> p_user_id then
    raise exception 'quota reservation not found' using errcode = '22023';
  end if;

  if v_event.status = 'reserved' then
    update public.ai_quota_events
      set status = 'released', released_at = now()
      where id = p_request_id;
  end if;

  return public._get_account_entitlement_summary(p_user_id, p_free_limit, p_pro_limit)
    || jsonb_build_object('released', v_event.status <> 'completed');
end;
$$;

revoke all on function public._get_account_entitlement_summary(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.get_account_entitlement(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.reserve_ai_advice_quota(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_ai_advice_quota(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.release_ai_advice_quota(uuid, uuid, integer, integer) from public, anon, authenticated;

grant execute on function public._get_account_entitlement_summary(uuid, integer, integer) to service_role;
grant execute on function public.get_account_entitlement(uuid, integer, integer) to service_role;
grant execute on function public.reserve_ai_advice_quota(uuid, uuid, integer, integer) to service_role;
grant execute on function public.complete_ai_advice_quota(uuid, uuid, integer, integer) to service_role;
grant execute on function public.release_ai_advice_quota(uuid, uuid, integer, integer) to service_role;
