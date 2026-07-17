create table public.cloud_sync_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  schema_version integer,
  payload jsonb,
  checksum text,
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint cloud_sync_states_active_or_tombstone check (
    (
      deleted_at is null
      and schema_version is not null
      and payload is not null
      and pg_catalog.jsonb_typeof(payload) = 'object'
      and checksum is not null
      and schema_version > 0
      and checksum ~ '^[0-9a-f]{64}$'
    )
    or
    (
      deleted_at is not null
      and schema_version is null
      and payload is null
      and checksum is null
    )
  )
);

alter table public.cloud_sync_states enable row level security;
revoke all on table public.cloud_sync_states from public, anon, authenticated, service_role;

create or replace function public.get_cloud_sync_state(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_state public.cloud_sync_states%rowtype;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'Invalid cloud sync account.';
  end if;

  select *
    into v_state
    from public.cloud_sync_states
   where user_id = p_user_id;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'exists', false,
      'revision', 0
    );
  end if;

  if v_state.deleted_at is not null then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'exists', false,
      'revision', v_state.revision
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'exists', true,
    'revision', v_state.revision,
    'schemaVersion', v_state.schema_version,
    'checksum', v_state.checksum,
    'payload', v_state.payload,
    'updatedAt', v_state.updated_at
  );
end;
$$;

create or replace function public.put_cloud_sync_state(
  p_user_id uuid,
  p_base_revision bigint,
  p_schema_version integer,
  p_checksum text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_state public.cloud_sync_states%rowtype;
  v_current_revision bigint := 0;
  v_next_revision bigint;
  v_now timestamptz := pg_catalog.now();
begin
  if p_user_id is null
    or p_base_revision is null
    or p_base_revision < 0
    or p_schema_version is null
    or p_schema_version < 1
    or p_checksum is null
    or p_checksum !~ '^[0-9a-f]{64}$'
    or p_payload is null
    or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'Invalid cloud sync write.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('what_to_drill.cloud_sync_states:' || p_user_id::text, 0)
  );

  select *
    into v_state
    from public.cloud_sync_states
   where user_id = p_user_id
     for update;

  if found then
    v_current_revision := v_state.revision;
  end if;

  if p_base_revision <> v_current_revision then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'conflict', pg_catalog.jsonb_build_object(
        'revision', v_current_revision,
        'exists', found and v_state.deleted_at is null,
        'checksum', case when found and v_state.deleted_at is null then v_state.checksum else null end
      )
    );
  end if;

  v_next_revision := v_current_revision + 1;
  if found then
    update public.cloud_sync_states
       set revision = v_next_revision,
           schema_version = p_schema_version,
           payload = p_payload,
           checksum = p_checksum,
           deleted_at = null,
           updated_at = v_now
     where user_id = p_user_id;
  else
    insert into public.cloud_sync_states (
      user_id, revision, schema_version, payload, checksum, deleted_at, created_at, updated_at
    ) values (
      p_user_id, v_next_revision, p_schema_version, p_payload, p_checksum, null, v_now, v_now
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'exists', true,
    'revision', v_next_revision,
    'schemaVersion', p_schema_version,
    'checksum', p_checksum,
    'payload', p_payload,
    'updatedAt', v_now
  );
end;
$$;

create or replace function public.delete_cloud_sync_state(
  p_user_id uuid,
  p_base_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_state public.cloud_sync_states%rowtype;
  v_current_revision bigint := 0;
  v_next_revision bigint;
  v_now timestamptz := pg_catalog.now();
begin
  if p_user_id is null or p_base_revision is null or p_base_revision < 0 then
    raise exception using errcode = '22023', message = 'Invalid cloud sync delete.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('what_to_drill.cloud_sync_states:' || p_user_id::text, 0)
  );

  select *
    into v_state
    from public.cloud_sync_states
   where user_id = p_user_id
     for update;

  if found then
    v_current_revision := v_state.revision;
  end if;

  if p_base_revision <> v_current_revision then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'conflict', pg_catalog.jsonb_build_object(
        'revision', v_current_revision,
        'exists', found and v_state.deleted_at is null,
        'checksum', case when found and v_state.deleted_at is null then v_state.checksum else null end
      )
    );
  end if;

  v_next_revision := v_current_revision + 1;
  if found then
    update public.cloud_sync_states
       set revision = v_next_revision,
           schema_version = null,
           payload = null,
           checksum = null,
           deleted_at = v_now,
           updated_at = v_now
     where user_id = p_user_id;
  else
    insert into public.cloud_sync_states (
      user_id, revision, schema_version, payload, checksum, deleted_at, created_at, updated_at
    ) values (
      p_user_id, v_next_revision, null, null, null, v_now, v_now, v_now
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'exists', false,
    'revision', v_next_revision,
    'deletedAt', v_now
  );
end;
$$;

revoke all on function public.get_cloud_sync_state(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_cloud_sync_state(uuid) to service_role;
revoke all on function public.put_cloud_sync_state(uuid, bigint, integer, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.put_cloud_sync_state(uuid, bigint, integer, text, jsonb) to service_role;
revoke all on function public.delete_cloud_sync_state(uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.delete_cloud_sync_state(uuid, bigint) to service_role;
