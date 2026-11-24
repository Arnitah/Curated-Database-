-- Executed against an isolated local PostgreSQL service with a test-only
-- auth.user_id() shim that mirrors the Neon Data API's verified JWT sub claim.
-- Never run this test fixture against a hosted or production database.

set role authenticated;
select set_config('request.jwt.claim.sub', 'synthetic-user-a', false);

select public.clay_sync_apply_record(
  'products', 'record-1', 1, 0, '{"name":"Synthetic A"}'::jsonb, false
);

do $$
begin
  if (select count(*) from public.clay_sync_records where collection = 'products') <> 1 then
    raise exception 'owner should read exactly their own inserted record';
  end if;
end;
$$;

-- A different verified subject cannot see or mutate the first user's row.
select set_config('request.jwt.claim.sub', 'synthetic-user-b', false);

do $$
begin
  if (select count(*) from public.clay_sync_records where collection = 'products') <> 0 then
    raise exception 'cross-user read was not denied by RLS';
  end if;
end;
$$;

select public.clay_sync_apply_record(
  'products', 'record-1', 1, 0, '{"name":"Synthetic B"}'::jsonb, false
);

-- Switching the JWT subject back reveals only User A's record.
select set_config('request.jwt.claim.sub', 'synthetic-user-a', false);

do $$
declare
  v_name text;
begin
  select payload ->> 'name' into v_name
    from public.clay_sync_records
    where collection = 'products' and record_id = 'record-1';
  if v_name is distinct from 'Synthetic A' then
    raise exception 'user A saw an unexpected or cross-user record';
  end if;
end;
$$;

-- Direct table writes are denied; mutation must use the scoped RPC.
do $$
begin
  begin
    insert into public.clay_sync_collections(user_id, collection)
    values ('forged-user', 'hair');
    raise exception 'direct table insert unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- A stale version is an explicit conflict, not a last-write-wins update.
do $$
declare
  v_result jsonb;
begin
  v_result := public.clay_sync_apply_record(
    'products', 'record-1', 1, 0, '{"name":"Stale"}'::jsonb, false
  );
  if v_result ->> 'status' <> 'conflict'
     or v_result ->> 'reason' <> 'record_changed' then
    raise exception 'stale write did not return the expected conflict';
  end if;
end;
$$;

-- Deletion is a tombstone; clear-all advances generation and hides old records.
select public.clay_sync_apply_record(
  'products', 'record-1', 1, 1, null, true
);

do $$
begin
  if not exists (
    select 1 from public.clay_sync_records
    where user_id = 'synthetic-user-a'
      and collection = 'products'
      and record_id = 'record-1'
      and deleted_at is not null
  ) then
    raise exception 'delete did not persist a tombstone';
  end if;
end;
$$;

select public.clay_sync_clear_collection('products', 1);

do $$
begin
  if (select generation from public.clay_sync_collections
      where user_id = 'synthetic-user-a' and collection = 'products') <> 2 then
    raise exception 'clear-all did not advance generation';
  end if;
  if (select count(*) from public.clay_sync_records where collection = 'products') <> 0 then
    raise exception 'old-generation records remained visible after clear-all';
  end if;
end;
$$;

reset role;
set role anon;

do $$
begin
  begin
    perform public.clay_sync_clear_collection('products', 1);
    raise exception 'anonymous mutation unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.clay_sync_records;
    raise exception 'anonymous table read unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
