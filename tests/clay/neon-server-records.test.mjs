import test from 'node:test';
import assert from 'node:assert/strict';
import { createClayNeonServerRecordsAdapter } from '../../apps/clay-sync/neon-server-records.js';

const claims = {
  sub: 'synthetic-user-a',
  iss: 'https://auth.example.test',
  exp: 2_000_000_000
};

function createSqlHarness(responses) {
  const transactions = [];
  function sql(strings, ...values) {
    return { text: Array.from(strings).join('?'), values };
  }
  sql.transaction = async queries => {
    transactions.push(queries);
    const result = responses.shift();
    if (!result) throw new Error('No synthetic SQL response configured');
    return result;
  };
  return { sql, transactions };
}

test('reads a user-scoped snapshot inside a JWT-claims transaction', async () => {
  const { sql, transactions } = createSqlHarness([[
    [],
    [{ generation: '2', revision: '4' }],
    [{ record_id: 'p-1', generation: '2', version: '3', payload: { name: 'Synthetic' }, deleted_at: null }]
  ]]);
  const adapter = createClayNeonServerRecordsAdapter({ sql, claims });
  const result = await adapter.readCollection('products');

  assert.deepEqual(result, {
    collection: 'products',
    generation: 2,
    revision: 4,
    records: [{
      id: 'p-1',
      generation: 2,
      version: 3,
      payload: { name: 'Synthetic' },
      deletedAt: null,
      deleted: false
    }]
  });
  assert.equal(transactions.length, 1);
  assert.match(transactions[0][0].text, /set_config\('request\.jwt\.claims'/);
  assert.equal(transactions[0][0].values[0], JSON.stringify(claims));
  assert.match(transactions[0][1].text, /clay_sync_collections/);
  assert.match(transactions[0][2].text, /clay_sync_records/);
});

test('writes records through the scoped mutation function, without a caller user id', async () => {
  const result = { status: 'applied', generation: 1, version: 1, revision: 1 };
  const { sql, transactions } = createSqlHarness([[[], [{ result }]]]);
  const adapter = createClayNeonServerRecordsAdapter({ sql, claims });
  assert.deepEqual(await adapter.writeRecord({
    collection: 'products',
    recordId: 'p-1',
    expectedGeneration: 1,
    expectedVersion: 0,
    payload: { name: 'Synthetic' }
  }), result);
  assert.match(transactions[0][1].text, /clay_sync_apply_record/);
  assert.equal(transactions[0][1].values[0], 'products');
  assert.equal(transactions[0][1].values[1], 'p-1');
  assert.equal(transactions[0][1].values[4], JSON.stringify({ name: 'Synthetic' }));
});

test('rejects caller-supplied user ids and invalid collections', async () => {
  const { sql } = createSqlHarness([]);
  const adapter = createClayNeonServerRecordsAdapter({ sql, claims });
  await assert.rejects(adapter.writeRecord({
    userId: 'synthetic-user-b',
    collection: 'products',
    recordId: 'p-1',
    expectedGeneration: 1,
    expectedVersion: 0,
    payload: { name: 'Forged' }
  }), /unsupported fields/);
  await assert.rejects(adapter.readCollection('admin'), /Unsupported Clay sync collection/);
});

test('writes tombstones and clears collections with expected concurrency values', async () => {
  const tombstone = { status: 'applied', generation: 1, version: 2, revision: 2 };
  const clear = { status: 'cleared', generation: 2, revision: 3 };
  const { sql, transactions } = createSqlHarness([
    [[], [{ result: tombstone }]],
    [[], [{ result: clear }]]
  ]);
  const adapter = createClayNeonServerRecordsAdapter({ sql, claims });
  assert.deepEqual(await adapter.deleteRecord({
    collection: 'products',
    recordId: 'p-1',
    expectedGeneration: 1,
    expectedVersion: 1
  }), tombstone);
  assert.equal(transactions[0][1].values[4], null);
  assert.equal(transactions[0][1].values[5], true);
  assert.deepEqual(await adapter.clearCollection({
    collection: 'products',
    expectedGeneration: 1
  }), clear);
  assert.match(transactions[1][1].text, /clay_sync_clear_collection/);
});

test('requires a verified subject and transactional SQL client', () => {
  const { sql } = createSqlHarness([]);
  assert.throws(() => createClayNeonServerRecordsAdapter({ sql, claims: {} }), /verified JWT subject/);
  assert.throws(() => createClayNeonServerRecordsAdapter({ sql: async () => [], claims }), /transaction support/);
});
