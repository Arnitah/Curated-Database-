begin;

select plan(7);

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

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is(
  (select count(*)::text from public.clay_sync_records
    where user_id = '11111111-1111-4111-8111-111111111111'),
  '0',
  'another authenticated user cannot read the first user records'
);

select * from finish();
rollback;
