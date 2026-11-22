import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaySupabaseRecordsAdapter } from '../../apps/clay-sync/supabase-records.js';

function makeClient({ user = { id: 'synthetic-user' }, collectionRow = null, rows = [], rpcResult = { status: 'applied', generation: 1, version: 1, revision: 1 } } = {}) {
  const calls = { queries: [], rpcs: [], auth: 0 };
  const client = {
    auth: {
      async getUser() {
        calls.auth++;
        return { data: { user }, error: null };
      }
    },
    from(table) {
      const query = { table, columns: null, filters: [], sort: null };
      calls.queries.push(query);
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        order(column, options) { query.sort = [column, options]; return builder; },
        async maybeSingle() {
          return { data: table === 'clay_sync_collections' ? collectionRow : null, error: null };
        },
        then(resolve, reject) {
          const result = table === 'clay_sync_records' ? rows : [];
          return Promise.resolve({ data: result, error: null }).then(resolve, reject);
        }
      };
      return builder;
    },
    async rpc(name, args) {
      calls.rpcs.push({ name, args });
      return { data: rpcResult, error: null };
    }
  };
  return { client, calls };
}

test('reads only the current generation and preserves versions and tombstones', async () => {
  const { client, calls } = makeClient({
    collectionRow: { generation: 3, revision: 8 },
    rows: [
      { record_id: 'item-1', generation: 3, version: 2, payload: { name: 'Synthetic item' }, deleted_at: null },
      { record_id: 'item-2', generation: 3, version: 4, payload: null, deleted_at: '2026-11-19T00:00:00Z' }
    ]
  });
  const adapter = createClaySupabaseRecordsAdapter(client);
  const snapshot = await adapter.readCollection('products');

  assert.equal(snapshot.generation, 3);
  assert.equal(snapshot.revision, 8);
  assert.deepEqual(snapshot.records.map(x => [x.id, x.version, x.deleted]), [
    ['item-1', 2, false], ['item-2', 4, true]
  ]);
  assert.deepEqual(calls.queries[1].filters, [['collection', 'products'], ['generation', 3]]);
});

test('a collection without a row starts at generation one with no records', async () => {
  const { client } = makeClient();
  const snapshot = await createClaySupabaseRecordsAdapter(client).readCollection('hair');
  assert.deepEqual(snapshot, { collection: 'hair', generation: 1, revision: 0, records: [] });
});

test('write forwards the caller base generation and record version to the transactional RPC', async () => {
  const { client, calls } = makeClient({ rpcResult: { status: 'applied', generation: 2, version: 5, revision: 9 } });
  const result = await createClaySupabaseRecordsAdapter(client).writeRecord({
    collection: 'products', recordId: 'p-5', expectedGeneration: 2,
    expectedVersion: 4, payload: { name: 'Synthetic moisturiser' }
  });

  assert.equal(result.status, 'applied');
  assert.deepEqual(calls.rpcs[0], {
    name: 'clay_sync_apply_record',
    args: {
      p_collection: 'products', p_record_id: 'p-5', p_expected_generation: 2,
      p_expected_version: 4, p_payload: { name: 'Synthetic moisturiser' }, p_delete: false
    }
  });
});

test('delete writes a tombstone through the same guarded RPC', async () => {
  const { client, calls } = makeClient();
  await createClaySupabaseRecordsAdapter(client).deleteRecord({
    collection: 'scents', recordId: 's-1', expectedGeneration: 1, expectedVersion: 3
  });
  assert.equal(calls.rpcs[0].args.p_delete, true);
  assert.equal(calls.rpcs[0].args.p_payload, null);
});

test('clear-all advances only from the expected generation', async () => {
  const { client, calls } = makeClient({ rpcResult: { status: 'cleared', generation: 4, revision: 12 } });
  const result = await createClaySupabaseRecordsAdapter(client).clearCollection({
    collection: 'products', expectedGeneration: 3
  });
  assert.equal(result.status, 'cleared');
  assert.deepEqual(calls.rpcs[0], {
    name: 'clay_sync_clear_collection',
    args: { p_collection: 'products', p_expected_generation: 3 }
  });
});

test('unauthenticated clients cannot read or mutate', async () => {
  const { client, calls } = makeClient({ user: null });
  const adapter = createClaySupabaseRecordsAdapter(client);
  await assert.rejects(adapter.readCollection('products'), { code: 'CLAY_SYNC_AUTH_REQUIRED' });
  await assert.rejects(adapter.writeRecord({
    collection: 'products', recordId: 'p-1', expectedGeneration: 1,
    expectedVersion: 0, payload: { name: 'No user' }
  }), { code: 'CLAY_SYNC_AUTH_REQUIRED' });
  assert.equal(calls.queries.length, 0);
  assert.equal(calls.rpcs.length, 0);
});

test('invalid collections, ids, versions and payloads fail before network access', async () => {
  const { client, calls } = makeClient();
  const adapter = createClaySupabaseRecordsAdapter(client);
  await assert.rejects(adapter.readCollection('admin'));
  await assert.rejects(adapter.writeRecord({
    collection: 'products', recordId: '', expectedGeneration: 1, expectedVersion: 0, payload: {}
  }));
  await assert.rejects(adapter.writeRecord({
    collection: 'products', recordId: 'p-1', expectedGeneration: 0, expectedVersion: 0, payload: {}
  }));
  await assert.rejects(adapter.writeRecord({
    collection: 'products', recordId: 'p-1', expectedGeneration: 1, expectedVersion: -1, payload: {}
  }));
  await assert.rejects(adapter.writeRecord({
    collection: 'products', recordId: 'p-1', expectedGeneration: 1, expectedVersion: 0, payload: []
  }));
  assert.equal(calls.auth, 0);
  assert.equal(calls.queries.length, 0);
  assert.equal(calls.rpcs.length, 0);
});

test('stale-write conflicts are returned unchanged for UI handling, never auto-retried', async () => {
  const conflict = { status: 'conflict', reason: 'record_changed', version: 7, generation: 1, revision: 8 };
  const { client, calls } = makeClient({ rpcResult: conflict });
  const result = await createClaySupabaseRecordsAdapter(client).writeRecord({
    collection: 'products', recordId: 'p-1', expectedGeneration: 1,
    expectedVersion: 2, payload: { name: 'Stale edit' }
  });
  assert.deepEqual(result, conflict);
  assert.equal(calls.rpcs.length, 1);
});
