import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClayNeonRecordsAdapter } from '../../apps/clay-sync/neon-records.js';

function makeClient({
  user = { id: 'neon-user-a', email: 'a@example.test' },
  collectionRows = [{ generation: 2, revision: 7 }],
  recordRows = [{
    record_id: 'product-1', generation: 2, version: 3,
    payload: { name: 'Synthetic moisturiser' }, deleted_at: null
  }],
  rpcResult = { status: 'applied', generation: 2, version: 4, revision: 8 },
  authError = null
} = {}) {
  const calls = { session: 0, queries: [], rpcs: [] };
  const queryResults = [collectionRows, recordRows];
  const client = {
    auth: {
      async getSession() {
        calls.session += 1;
        return { data: user ? { user } : null, error: authError };
      }
    },
    from(table) {
      const query = {
        table,
        filters: [],
        selected: null,
        ordering: null,
        limitValue: null,
        select(fields) { this.selected = fields; return this; },
        eq(field, value) { this.filters.push([field, value]); return this; },
        limit(value) { this.limitValue = value; return this.finish(); },
        order(field, options) { this.ordering = [field, options]; return this.finish(); },
        finish() {
          calls.queries.push({
            table: this.table, selected: this.selected,
            filters: [...this.filters], ordering: this.ordering,
            limit: this.limitValue
          });
          const data = queryResults.shift() ?? [];
          return Promise.resolve({ data, error: null });
        }
      };
      return query;
    },
    async rpc(name, params) {
      calls.rpcs.push({ name, params });
      return { data: rpcResult, error: null };
    }
  };
  return { client, calls };
}

test('reads only the allow-listed collection through the authenticated Neon client', async () => {
  const { client, calls } = makeClient();
  const records = createClayNeonRecordsAdapter(client);
  const snapshot = await records.readCollection('products');
  assert.equal(snapshot.collection, 'products');
  assert.equal(snapshot.generation, 2);
  assert.equal(snapshot.revision, 7);
  assert.deepEqual(snapshot.records[0], {
    id: 'product-1', generation: 2, version: 3,
    payload: { name: 'Synthetic moisturiser' }, deletedAt: null, deleted: false
  });
  assert.equal(calls.session, 1);
  assert.deepEqual(calls.queries.map(query => query.table), [
    'clay_sync_collections', 'clay_sync_records'
  ]);
  assert.equal(calls.queries.some(query => query.filters.some(([field]) => field === 'user_id')), false);
});

test('unauthenticated users are rejected before any Data API query or RPC', async () => {
  const { client, calls } = makeClient({ user: null });
  const records = createClayNeonRecordsAdapter(client);
  await assert.rejects(records.readCollection('products'), { code: 'CLAY_SYNC_AUTH_REQUIRED' });
  await assert.rejects(records.writeRecord({
    collection: 'products', recordId: 'p1', expectedGeneration: 1,
    expectedVersion: 0, payload: { name: 'Synthetic' }
  }), { code: 'CLAY_SYNC_AUTH_REQUIRED' });
  assert.equal(calls.queries.length, 0);
  assert.equal(calls.rpcs.length, 0);
});

test('writes use the transactional RPC and never accept a caller-supplied owner id', async () => {
  const { client, calls } = makeClient();
  const records = createClayNeonRecordsAdapter(client);
  const result = await records.writeRecord({
    collection: 'products', recordId: 'p1', expectedGeneration: 2,
    expectedVersion: 3, payload: { name: 'Synthetic' }, userId: 'forged-user'
  });
  assert.deepEqual(result, {
    status: 'applied', generation: 2, version: 4, revision: 8
  });
  assert.equal(calls.rpcs.length, 1);
  assert.equal(calls.rpcs[0].name, 'clay_sync_apply_record');
  assert.equal(Object.hasOwn(calls.rpcs[0].params, 'p_user_id'), false);
  assert.equal(Object.hasOwn(calls.rpcs[0].params, 'user_id'), false);
});

test('deletes are versioned tombstones through the same transactional RPC', async () => {
  const { client, calls } = makeClient();
  const records = createClayNeonRecordsAdapter(client);
  await records.deleteRecord({
    collection: 'hair', recordId: 'hair-1',
    expectedGeneration: 1, expectedVersion: 2
  });
  assert.equal(calls.rpcs[0].params.p_delete, true);
  assert.equal(calls.rpcs[0].params.p_payload, null);
});

test('clear-all advances the collection generation through the transactional RPC', async () => {
  const { client, calls } = makeClient({
    rpcResult: { status: 'cleared', generation: 3, revision: 9 }
  });
  const records = createClayNeonRecordsAdapter(client);
  const result = await records.clearCollection({
    collection: 'products', expectedGeneration: 2
  });
  assert.deepEqual(result, { status: 'cleared', generation: 3, revision: 9 });
  assert.equal(calls.rpcs[0].name, 'clay_sync_clear_collection');
});

test('stale writes remain explicit conflicts and are never retried', async () => {
  const conflict = {
    status: 'conflict', reason: 'record_changed',
    generation: 2, version: 4, revision: 8
  };
  const { client, calls } = makeClient({ rpcResult: conflict });
  const records = createClayNeonRecordsAdapter(client);
  assert.deepEqual(await records.writeRecord({
    collection: 'products', recordId: 'p1',
    expectedGeneration: 2, expectedVersion: 3, payload: { name: 'Stale' }
  }), conflict);
  assert.equal(calls.rpcs.length, 1);
});

test('rejects unknown collections and malformed RPC responses', async () => {
  const { client, calls } = makeClient({
    rpcResult: { status: 'ok', generation: 2, version: 1, revision: 8 }
  });
  const records = createClayNeonRecordsAdapter(client);
  await assert.rejects(records.readCollection('admin'), { code: 'CLAY_SYNC_INVALID_ARGUMENT' });
  await assert.rejects(records.writeRecord({
    collection: 'products', recordId: 'p1',
    expectedGeneration: 2, expectedVersion: 0, payload: { name: 'Synthetic' }
  }), { code: 'CLAY_SYNC_PROTOCOL_ERROR' });
  assert.equal(calls.queries.length, 0);
});

test('propagates authentication service errors without issuing data requests', async () => {
  const failure = new Error('Synthetic Neon Auth failure');
  const { client, calls } = makeClient({ authError: failure });
  const records = createClayNeonRecordsAdapter(client);
  await assert.rejects(records.readCollection('products'), failure);
  assert.equal(calls.queries.length, 0);
});
