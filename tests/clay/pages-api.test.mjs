import test from 'node:test';
import assert from 'node:assert/strict';
import { createClayPagesSyncHandler } from '../../apps/clay-sync/pages-api.js';

const claims = { sub: 'synthetic-user-a', iss: 'https://auth.example.test', exp: 2_000_000_000 };
const snapshot = {
  collection: 'products',
  generation: 1,
  revision: 0,
  records: []
};
const applied = { status: 'applied', generation: 1, version: 1, revision: 1 };
const cleared = { status: 'cleared', generation: 2, revision: 2 };

function createHarness(overrides = {}) {
  const calls = [];
  const records = {
    readCollection: async collection => {
      calls.push(['readCollection', collection]);
      return snapshot;
    },
    writeRecord: async input => {
      calls.push(['writeRecord', input]);
      return applied;
    },
    deleteRecord: async input => {
      calls.push(['deleteRecord', input]);
      return applied;
    },
    clearCollection: async input => {
      calls.push(['clearCollection', input]);
      return cleared;
    }
  };
  const handler = createClayPagesSyncHandler({
    verifyBearerToken: async token => {
      if (token !== 'valid-token') throw new Error('invalid token');
      return claims;
    },
    createRecordsAdapter: async context => {
      calls.push(['createRecordsAdapter', context.claims.sub]);
      return records;
    },
    ...overrides
  });
  return { handler, calls };
}

function makeRequest(path, method = 'GET', body, headers = {}) {
  const init = { method, headers: { authorization: 'Bearer valid-token', ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  return new Request(`https://clay.example.test${path}`, init);
}

test('rejects requests without a bearer token before creating a records adapter', async () => {
  const { handler, calls } = createHarness();
  const response = await handler({ request: new Request('https://clay.example.test/api/clay/sync/products') });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
  assert.equal(calls.length, 0);
});

test('rejects invalid JWTs and does not instantiate the records adapter', async () => {
  const { handler, calls } = createHarness();
  const response = await handler({
    request: new Request('https://clay.example.test/api/clay/sync/products', {
      headers: { authorization: 'Bearer invalid-token' }
    })
  });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test('rejects cross-origin requests before token verification', async () => {
  const { handler, calls } = createHarness();
  const response = await handler({
    request: makeRequest('/api/clay/sync/products', 'GET', undefined, { origin: 'https://attacker.example' })
  });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('reads a collection using only the verified JWT subject', async () => {
  const { handler, calls } = createHarness();
  const response = await handler({ request: makeRequest('/api/clay/sync/products'), env: { stage: 'test' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), snapshot);
  assert.deepEqual(calls, [
    ['createRecordsAdapter', 'synthetic-user-a'],
    ['readCollection', 'products']
  ]);
});

test('writes a record and does not accept caller-supplied owner ids', async () => {
  const { handler, calls } = createHarness();
  const response = await handler({
    request: makeRequest('/api/clay/sync/products/records', 'POST', {
      recordId: 'p-1',
      expectedGeneration: 1,
      expectedVersion: 0,
      payload: { name: 'Synthetic' }
    })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), applied);
  assert.deepEqual(calls.at(-1), ['writeRecord', {
    collection: 'products',
    recordId: 'p-1',
    expectedGeneration: 1,
    expectedVersion: 0,
    payload: { name: 'Synthetic' }
  }]);

  const forged = await handler({
    request: makeRequest('/api/clay/sync/products/records', 'POST', {
      userId: 'synthetic-user-b',
      recordId: 'p-2',
      expectedGeneration: 1,
      expectedVersion: 0,
      payload: { name: 'Forged' }
    })
  });
  assert.equal(forged.status, 400);
});

test('deletes a record as a tombstone using a verified principal', async () => {
  const { handler, calls } = createHarness();
  const response = await handler({
    request: makeRequest('/api/clay/sync/products/records/p-1', 'DELETE', {
      expectedGeneration: 1,
      expectedVersion: 1
    })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), applied);
  assert.deepEqual(calls.at(-1), ['deleteRecord', {
    collection: 'products',
    recordId: 'p-1',
    expectedGeneration: 1,
    expectedVersion: 1
  }]);
});

test('clears a collection using its expected generation', async () => {
  const { handler, calls } = createHarness();
  const response = await handler({
    request: makeRequest('/api/clay/sync/products/clear', 'POST', { expectedGeneration: 1 })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), cleared);
  assert.deepEqual(calls.at(-1), ['clearCollection', {
    collection: 'products',
    expectedGeneration: 1
  }]);
});

test('rejects unsupported collections and incorrect methods', async () => {
  const { handler } = createHarness();
  const unsupported = await handler({ request: makeRequest('/api/clay/sync/admin') });
  assert.equal(unsupported.status, 404);
  const wrongMethod = await handler({ request: makeRequest('/api/clay/sync/products', 'POST', {}) });
  assert.equal(wrongMethod.status, 405);
});

test('rejects oversized JSON payloads', async () => {
  const { handler } = createHarness();
  const body = JSON.stringify({ expectedGeneration: 1, padding: 'x'.repeat(1_000_010) });
  const response = await handler({
    request: new Request('https://clay.example.test/api/clay/sync/products/clear', {
      method: 'POST',
      headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
      body
    })
  });
  assert.equal(response.status, 413);
});
