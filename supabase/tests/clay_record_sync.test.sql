begin;

select plan(14);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select is(
  public.clay_sync_apply_record('products','p-1',1,0,'{"name":"Synthetic cleanser"}'::jsonb,false)->>'status',
  'applied',
  'first item revision is accepted'
);

select is(
  public.clay_sync_apply_record('products','p-1',1,0,'{"name":"Stale overwrite"}'::jsonb,false)->>'status',
  'conflict',
  'stale same-record write is rejected'
);

select is(
  public.clay_sync_apply_record('products','p-1',1,1,null,true)->>'status',
  'applied',
  'deletion is recorded as a tombstone'
);

select ok(
  exists(select 1 from public.clay_sync_records
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'products' and record_id = 'p-1'
      and deleted_at is not null and version = 2),
  'tombstone remains stored with incremented version'
);

select is(
  public.clay_sync_clear_collection('products',1)->>'generation',
  '2',
  'clear-all advances collection generation atomically'
);

select is(
  public.clay_sync_apply_record('products','p-2',1,0,'{"name":"Stale after clear"}'::jsonb,false)->>'status',
  'conflict',
  'write from pre-clear generation is rejected'
);

select is(
  public.clay_sync_apply_record('products','p-2',2,0,'{"name":"Current generation item"}'::jsonb,false)->>'status',
  'applied',
  'write using the current generation is accepted'
);

select is(
  (select count(*)::text from public.clay_sync_records
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'products' and record_id = 'p-2'),
  '1',
  'current-generation records remain visible to their owner'
);

select is(
  (select count(*)::text from public.clay_sync_records
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'products' and record_id = 'p-1'),
  '0',
  'records from a prior generation are invisible after clear-all'
);

select throws_ok(
  $$select public.clay_sync_apply_record(null,'p-null',2,0,'{"name":"Invalid"}'::jsonb,false)$$,
  '22023',
  'invalid collection',
  'NULL collection identifiers are rejected'
);

select throws_ok(
  $$select public.clay_sync_apply_record('not-allowed','p-invalid',2,0,'{"name":"Invalid"}'::jsonb,false)$$,
  '22023',
  'invalid collection',
  'unknown collection identifiers are rejected'
);

select throws_ok(
  $$select public.clay_sync_apply_record('products','p-invalid-payload',2,0,'["not","an","object"]'::jsonb,false)$$,
  '22023',
  'record payload must be a JSON object',
  'non-object payloads are rejected'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is(
  (select count(*)::text from public.clay_sync_records
    where user_id = '11111111-1111-4111-8111-111111111111'),
  '0',
  'another authenticated user cannot read the first user records'
);

select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$select public.clay_sync_apply_record('products','p-unauthenticated',1,0,'{"name":"No identity"}'::jsonb,false)$$,
  '28000',
  'authentication required',
  'authenticated database role without a user identity cannot write'
);

select * from finish();
rollback;
