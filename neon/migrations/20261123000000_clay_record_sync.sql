-- Clay per-record sync for Neon Data API + Managed Neon Auth.
-- Apply only after a dedicated Clay project is separately approved and
-- Neon Auth + Data API are enabled on the target branch.
-- No Supabase auth.uid() dependency: Neon Data API exposes auth.user_id()
-- from the verified JWT sub claim as text.
--
-- This migration creates private personal-data tables only. Shared catalogues,
-- ingredient evidence and research datasets remain in their versioned sources.

create table if not exists public.clay_sync_collections (
  user_id text not null,
  collection text not null check (collection in ('products','hair','log','prefs','scents')),
  generation bigint not null default 1 check (generation > 0),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, collection)
);

create table if not exists public.clay_sync_records (
  user_id text not null,
  collection text not null,
  record_id text not null check (length(record_id) between 1 and 200),
  generation bigint not null check (generation > 0),
  version bigint not null check (version > 0),
  payload jsonb,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, record_id),
  foreign key (user_id, collection)
    references public.clay_sync_collections(user_id, collection)
    on delete cascade,
  check (deleted_at is not null or (payload is not null and jsonb_typeof(payload) = 'object'))
);

create index if not exists clay_sync_records_visible_idx
  on public.clay_sync_records(user_id, collection, generation)
  where deleted_at is null;

alter table public.clay_sync_collections enable row level security;
alter table public.clay_sync_records enable row level security;

drop policy if exists clay_sync_collections_select_own on public.clay_sync_collections;
create policy clay_sync_collections_select_own
  on public.clay_sync_collections for select to authenticated
  using ((select auth.user_id()) = user_id);

drop policy if exists clay_sync_records_select_own on public.clay_sync_records;
create policy clay_sync_records_select_own
  on public.clay_sync_records for select to authenticated
  using (
    (select auth.user_id()) = user_id
    and exists (
      select 1
      from public.clay_sync_collections as current_collection
      where current_collection.user_id = clay_sync_records.user_id
        and current_collection.collection = clay_sync_records.collection
        and current_collection.generation = clay_sync_records.generation
    )
  );

-- Data API access is deliberately read-only at table level. All mutations
-- go through the two narrowly scoped transactional functions below.
revoke all on table public.clay_sync_collections from public, anon, authenticated;
revoke all on table public.clay_sync_records from public, anon, authenticated;
grant select on table public.clay_sync_collections to authenticated;
grant select on table public.clay_sync_records to authenticated;

create or replace function public.clay_sync_apply_record(
  p_collection text,
  p_record_id text,
  p_expected_generation bigint,
  p_expected_version bigint,
  p_payload jsonb,
  p_delete boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user text := auth.user_id();
  v_generation bigint;
  v_revision bigint;
  v_record_generation bigint;
  v_record_version bigint;
  v_next_version bigint;
begin
  if v_user is null or length(v_user) = 0 then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_collection is null or p_collection not in ('products','hair','log','prefs','scents') then
    raise exception 'invalid collection' using errcode = '22023';
  end if;
  if p_record_id is null or length(p_record_id) not between 1 and 200 then
    raise exception 'invalid record id' using errcode = '22023';
  end if;
  if p_expected_generation is null or p_expected_generation < 1
     or p_expected_version is null or p_expected_version < 0 then
    raise exception 'invalid expected version' using errcode = '22023';
  end if;
  if p_delete is null then
    raise exception 'delete flag is required' using errcode = '22023';
  end if;
  if not p_delete and (p_payload is null or jsonb_typeof(p_payload) <> 'object') then
    raise exception 'record payload must be a JSON object' using errcode = '22023';
  end if;

  insert into public.clay_sync_collections(user_id, collection)
  values (v_user, p_collection)
  on conflict (user_id, collection) do nothing;

  select generation, revision into v_generation, v_revision
    from public.clay_sync_collections
    where user_id = v_user and collection = p_collection
    for update;

  if p_expected_generation <> v_generation then
    return jsonb_build_object('status','conflict','reason','generation_changed',
      'generation',v_generation,'revision',v_revision);
  end if;

  select generation, version into v_record_generation, v_record_version
    from public.clay_sync_records
    where user_id = v_user and collection = p_collection and record_id = p_record_id
    for update;

  if not found or v_record_generation <> v_generation then
    v_record_version := 0;
  end if;

  if p_expected_version <> v_record_version then
    return jsonb_build_object('status','conflict','reason','record_changed',
      'generation',v_generation,'version',v_record_version,'revision',v_revision);
  end if;

  v_next_version := v_record_version + 1;

  insert into public.clay_sync_records(
    user_id, collection, record_id, generation, version, payload, deleted_at, updated_at
  ) values (
    v_user, p_collection, p_record_id, v_generation, v_next_version,
    case when p_delete then null else p_payload end,
    case when p_delete then now() else null end,
    now()
  )
  on conflict (user_id, collection, record_id) do update set
    generation = excluded.generation,
    version = excluded.version,
    payload = excluded.payload,
    deleted_at = excluded.deleted_at,
    updated_at = excluded.updated_at;

  update public.clay_sync_collections
    set revision = revision + 1, updated_at = now()
    where user_id = v_user and collection = p_collection
    returning revision into v_revision;

  return jsonb_build_object('status','applied','generation',v_generation,
    'version',v_next_version,'revision',v_revision);
end;
$$;

create or replace function public.clay_sync_clear_collection(
  p_collection text,
  p_expected_generation bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user text := auth.user_id();
  v_generation bigint;
  v_revision bigint;
begin
  if v_user is null or length(v_user) = 0 then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_collection is null or p_collection not in ('products','hair','log','prefs','scents') then
    raise exception 'invalid collection' using errcode = '22023';
  end if;
  if p_expected_generation is null or p_expected_generation < 1 then
    raise exception 'invalid expected generation' using errcode = '22023';
  end if;

  insert into public.clay_sync_collections(user_id, collection)
  values (v_user, p_collection)
  on conflict (user_id, collection) do nothing;

  select generation, revision into v_generation, v_revision
    from public.clay_sync_collections
    where user_id = v_user and collection = p_collection
    for update;

  if p_expected_generation <> v_generation then
    return jsonb_build_object('status','conflict','generation',v_generation,'revision',v_revision);
  end if;

  update public.clay_sync_collections
    set generation = generation + 1, revision = revision + 1, updated_at = now()
    where user_id = v_user and collection = p_collection
    returning generation, revision into v_generation, v_revision;

  return jsonb_build_object('status','cleared','generation',v_generation,'revision',v_revision);
end;
$$;

revoke all on function public.clay_sync_apply_record(text,text,bigint,bigint,jsonb,boolean) from public, anon;
revoke all on function public.clay_sync_clear_collection(text,bigint) from public, anon;
grant execute on function public.clay_sync_apply_record(text,text,bigint,bigint,jsonb,boolean) to authenticated;
grant execute on function public.clay_sync_clear_collection(text,bigint) to authenticated;
