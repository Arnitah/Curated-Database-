import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAY_SYNC_COLLECTIONS,
  assertClaySyncCollection,
  assertClaySyncIdentityState,
  assertClaySyncIdentityPort,
  assertClaySyncSnapshot,
  assertClaySyncMutationResult,
  assertClaySyncRecordsPort,
  assertClaySyncPorts
} from '../../apps/clay-sync/contracts.js';

const validIdentity = {
  getState: async () => ({ status: 'signed_out', user: null }),
  requestEmailSignIn: async () => ({ status: 'link_sent', email: 'person@example.test' }),
  signOut: async () => ({ status: 'signed_out' }),
  onStateChange: () => () => {}
};
const validRecords = {
  readCollection: async () => ({}),
  writeRecord: async () => ({}),
  deleteRecord: async () => ({}),
  clearCollection: async () => ({})
};

test('exports the allow-listed personal-data collections without provider details', () => {
  assert.deepEqual(CLAY_SYNC_COLLECTIONS, ['products', 'hair', 'log', 'prefs', 'scents']);
  assert.equal(assertClaySyncCollection('products'), 'products');
  assert.throws(() => assertClaySyncCollection('admin'), { code: 'CLAY_SYNC_INVALID_ARGUMENT' });
});

test('identity state contains only a minimal verified principal projection', () => {
  assert.deepEqual(assertClaySyncIdentityState({ status: 'signed_out', user: null }), {
    status: 'signed_out', user: null
  });
  assert.deepEqual(assertClaySyncIdentityState({
    status: 'signed_in', user: { id: 'verified-principal', email: null }
  }).user, { id: 'verified-principal', email: null });
  assert.throws(() => assertClaySyncIdentityState({
    status: 'signed_out', user: { id: 'caller-supplied' }
  }), { code: 'CLAY_SYNC_PROTOCOL_ERROR' });
  assert.throws(() => assertClaySyncIdentityState({
    status: 'signed_in', user: { email: 'person@example.test' }
  }), { code: 'CLAY_SYNC_PROTOCOL_ERROR' });
});

test('identity and record adapters must implement the shared ports', () => {
  assert.equal(assertClaySyncIdentityPort(validIdentity), validIdentity);
  assert.equal(assertClaySyncRecordsPort(validRecords), validRecords);
  assert.deepEqual(assertClaySyncPorts({ identity: validIdentity, records: validRecords }), {
    identity: validIdentity, records: validRecords
  });
  assert.throws(() => assertClaySyncIdentityPort({ getState() {} }), {
    code: 'CLAY_SYNC_CONTRACT_INVALID'
  });
  assert.throws(() => assertClaySyncRecordsPort({ readCollection() {} }), {
    code: 'CLAY_SYNC_CONTRACT_INVALID'
  });
});

test('collection snapshots preserve stable ids, versions, and deletion tombstones', () => {
  const snapshot = {
    collection: 'products', generation: 2, revision: 7,
    records: [
      { id: 'product-1', generation: 2, version: 3, payload: { name: 'Synthetic item' }, deletedAt: null, deleted: false },
      { id: 'product-2', generation: 2, version: 4, payload: null, deletedAt: '2026-11-22T00:00:00Z', deleted: true }
    ]
  };
  assert.equal(assertClaySyncSnapshot(snapshot, 'products'), snapshot);
  assert.throws(() => assertClaySyncSnapshot({ ...snapshot, collection: 'hair' }, 'products'), {
    code: 'CLAY_SYNC_PROTOCOL_ERROR'
  });
  assert.throws(() => assertClaySyncSnapshot({
    ...snapshot, records: [...snapshot.records, snapshot.records[0]]
  }, 'products'), { code: 'CLAY_SYNC_PROTOCOL_ERROR' });
  assert.throws(() => assertClaySyncSnapshot({
    ...snapshot, records: [{ ...snapshot.records[0], generation: 1 }]
  }, 'products'), { code: 'CLAY_SYNC_PROTOCOL_ERROR' });
  assert.throws(() => assertClaySyncSnapshot({
    ...snapshot, records: [{ ...snapshot.records[1], payload: { resurrected: true } }]
  }, 'products'), { code: 'CLAY_SYNC_PROTOCOL_ERROR' });
});

test('mutation outcomes are normalized and stale conflicts remain explicit', () => {
  assert.deepEqual(assertClaySyncMutationResult({
    status: 'applied', generation: 1, version: 2, revision: 9
  }), { status: 'applied', generation: 1, version: 2, revision: 9 });
  assert.deepEqual(assertClaySyncMutationResult({
    status: 'cleared', generation: 2, revision: 10
  }), { status: 'cleared', generation: 2, revision: 10 });
  assert.deepEqual(assertClaySyncMutationResult({
    status: 'conflict', reason: 'record_changed', generation: 1, version: 4, revision: 9
  }), { status: 'conflict', reason: 'record_changed', generation: 1, version: 4, revision: 9 });
  assert.throws(() => assertClaySyncMutationResult({ status: 'success' }), {
    code: 'CLAY_SYNC_PROTOCOL_ERROR'
  });
  assert.throws(() => assertClaySyncMutationResult({ status: 'applied' }), {
    code: 'CLAY_SYNC_PROTOCOL_ERROR'
  });
});
