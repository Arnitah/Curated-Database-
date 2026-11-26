import test from 'node:test';
import assert from 'node:assert/strict';
import { createClayPagesRecordsAdapter } from '../../apps/clay-sync/pages-records.js';

const snapshot = { collection: 'products', generation: 1, revision: 0, records: [] };
const applied = { status: 'applied', generation: 1, version: 1, revision: 1 };
const cleared = { status: 'cleared', generation: 2, revision: 2 };

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

function createHarness(payloads = []) {
  const calls = [];
  const adapter = createClayPagesRecordsAdapter({
    baseUrl: 'https://clay.example.test/api/clay/sync',
    getAccessToken: async () => 'signed.jwt.value',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, payloads.shift());
    }
  });
  return { adapter, calls };
}

test('reads a collection with a fresh bearer JWT and no user id', async () => {
  const { adapter, calls } = createHarness([snapshot]);
  assert.deepEqual(await adapter.readCollection('products'), snapshot);
  assert.equal(calls[0].url, 'https://clay.example.test/api/clay/sync/products');
  assert.equal(calls[0].init.headers.authorization, 'Bearer signed.jwt.value');
  assert.equal(calls[0].init.cache, 'no-store');
});

test('writes records through the same-origin API and rejects owner ids', async () => {
  const { adapter, calls } = createHarness([applied]);
  assert.deepEqual(await adapter.writeRecord({
    collection: 'products',
    recordId: 'state',
    expectedGeneration: 1,
    expectedVersion: 0,
    payload: { data: [] }
  }), applied);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    recordId: 'state',
    expectedGeneration: 1,
    expectedVersion: 0,
    payload: { data: [] }
  });
  await assert.rejects(adapter.writeRecord({
    userId: 'test-user-b',
    collection: 'products',
    recordId: 'state',
    expectedGeneration: 1,
    expectedVersion: 0,
    payload: { data: [] }
  }), /unsupported fields/);
});

test('deletes and clears with explicit concurrency values', async () => {
  const { adapter, calls } = createHarness([applied, cleared]);
  assert.deepEqual(await adapter.deleteRecord({
    collection: 'products',
    recordId: 'state',
    expectedGeneration: 1,
    expectedVersion: 1
  }), applied);
  assert.equal(calls[0].url, 'https://clay.example.test/api/clay/sync/products/records/state');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[0].init.body), { expectedGeneration: 1, expectedVersion: 1 });

  assert.deepEqual(await adapter.clearCollection({
    collection: 'products',
    expectedGeneration: 1
  }), cleared);
  assert.equal(calls[1].url, 'https://clay.example.test/api/clay/sync/products/clear');
  assert.equal(calls[1].init.method, 'POST');
});

test('maps unauthorized responses to an authentication error', async () => {
  const adapter = createClayPagesRecordsAdapter({
    getAccessToken: async () => 'expired.jwt',
    fetchImpl: async () => response(401, { error: 'unauthorized' })
  });
  await assert.rejects(adapter.readCollection('products'), error => error.code === 'CLAY_SYNC_AUTH_REQUIRED');
});

test('requires a fresh user token and maps network failures', async () => {
  const noToken = createClayPagesRecordsAdapter({
    getAccessToken: async () => '',
    fetchImpl: async () => response(200, snapshot)
  });
  await assert.rejects(noToken.readCollection('products'), error => error.code === 'CLAY_SYNC_AUTH_REQUIRED');

  const offline = createClayPagesRecordsAdapter({
    getAccessToken: async () => 'signed.jwt.value',
    fetchImpl: async () => { throw new Error('offline'); }
  });
  await assert.rejects(offline.readCollection('products'), error => error.code === 'CLAY_SYNC_NETWORK_ERROR');
});
