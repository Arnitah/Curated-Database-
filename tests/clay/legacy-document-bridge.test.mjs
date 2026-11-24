import test from 'node:test';
import assert from 'node:assert/strict';
import { createClayLegacyDocumentBridge } from '../../apps/clay-sync/legacy-document-bridge.js';

const KEY_MAP = {
  'clay-products': 'products',
  'clay-hair': 'hair',
  'clay-log': 'log',
  'clay-prefs': 'prefs',
  'clay-scents': 'scents'
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStore() {
  const state = new Map();
  const calls = [];
  function get(collection) {
    return state.get(collection) || { generation: 1, revision: 0, records: [] };
  }
  const records = {
    async readCollection(collection) {
      calls.push(['readCollection', collection]);
      return clone({ collection, ...get(collection) });
    },
    async writeRecord(input) {
      calls.push(['writeRecord', clone(input)]);
      const current = get(input.collection);
      const existing = current.records.find(record => record.id === input.recordId);
      if (input.expectedGeneration !== current.generation
          || input.expectedVersion !== (existing?.version || 0)) {
        return {
          status: 'conflict',
          generation: current.generation,
          version: existing?.version || 0,
          revision: current.revision
        };
      }
      const version = (existing?.version || 0) + 1;
      const record = {
        id: input.recordId,
        generation: current.generation,
        version,
        payload: clone(input.payload),
        deletedAt: null,
        deleted: false
      };
      const records = current.records.filter(item => item.id !== input.recordId);
      records.push(record);
      const next = { generation: current.generation, revision: current.revision + 1, records };
      state.set(input.collection, next);
      return { status: 'applied', generation: next.generation, version, revision: next.revision };
    },
    async deleteRecord() {
      throw new Error('not used by legacy document bridge');
    },
    async clearCollection() {
      throw new Error('not used by legacy document bridge');
    }
  };
  return {
    records,
    calls,
    externalWrite(collection, payload) {
      const current = get(collection);
      const existing = current.records.find(record => record.id === 'state');
      const version = (existing?.version || 0) + 1;
      const next = {
        generation: current.generation,
        revision: current.revision + 1,
        records: [{
          id: 'state',
          generation: current.generation,
          version,
          payload: clone(payload),
          deletedAt: null,
          deleted: false
        }]
      };
      state.set(collection, next);
    }
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback);
    },
    emit(name) {
      for (const callback of [...(listeners.get(name) || [])]) callback();
    },
    count(name) {
      return listeners.get(name)?.size || 0;
    }
  };
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

test('maps the five existing Clay document keys to one versioned state record each', async () => {
  const store = createStore();
  const bridge = createClayLegacyDocumentBridge(store.records, { userId: 'test-user-a', pollIntervalMs: 0 });
  const collection = bridge.collection('data/users/test-user-a');

  for (const [key, mappedCollection] of Object.entries(KEY_MAP)) {
    const doc = collection.doc(key);
    const missing = await doc.get();
    assert.equal(missing.exists, false);
    await doc.set({ data: { sample: key }, at: 123, cleared: false });
    const saved = await doc.get();
    assert.equal(saved.exists, true);
    assert.deepEqual(saved.data(), { data: { sample: key }, at: 123, cleared: false });
    const write = store.calls.filter(call => call[0] === 'writeRecord').at(-1)[1];
    assert.equal(write.collection, mappedCollection);
    assert.equal(write.recordId, 'state');
    assert.equal(write.expectedGeneration, 1);
    assert.equal(write.expectedVersion, 0);
  }
});

test('uses the latest record version for updates and does not auto-retry conflicts', async () => {
  const store = createStore();
  const bridge = createClayLegacyDocumentBridge(store.records, { userId: 'test-user-a', pollIntervalMs: 0 });
  const doc = bridge.collection('data/users/test-user-a').doc('clay-products');
  await doc.set({ data: [{ id: 'p1' }], at: 100 });
  await doc.set({ data: [{ id: 'p1' }, { id: 'p2' }], at: 200 });
  const writes = store.calls.filter(call => call[0] === 'writeRecord');
  assert.equal(writes[1][1].expectedVersion, 1);

  store.records.writeRecord = async input => ({
    status: 'conflict',
    generation: input.expectedGeneration,
    version: input.expectedVersion + 1,
    revision: 3
  });
  await assert.rejects(doc.set({ data: [], at: 300 }), error => error.code === 'CLAY_SYNC_CONFLICT');
  assert.equal(store.calls.filter(call => call[0] === 'writeRecord').length, 2);
});

test('rejects a document path for a different user and unknown legacy keys', () => {
  const store = createStore();
  const bridge = createClayLegacyDocumentBridge(store.records, { userId: 'test-user-a', pollIntervalMs: 0 });
  assert.throws(() => bridge.collection('data/users/test-user-b'), error => error.code === 'CLAY_SYNC_AUTH_REQUIRED');
  assert.throws(() => bridge.collection('data/users/test-user-a').doc('unknown'), /Unknown legacy Clay document key/);
});

test('refreshes document snapshots on focus, visible-tab changes and the shared poll', async () => {
  const store = createStore();
  const windowTarget = eventTarget();
  const documentTarget = eventTarget();
  documentTarget.visibilityState = 'visible';
  let tick;
  let cleared = false;
  const bridge = createClayLegacyDocumentBridge(store.records, {
    userId: 'test-user-a',
    eventTarget: windowTarget,
    visibilityTarget: documentTarget,
    pollIntervalMs: 30_000,
    setIntervalFn(callback, delay) {
      assert.equal(delay, 30_000);
      tick = callback;
      return 'timer-id';
    },
    clearIntervalFn(id) {
      assert.equal(id, 'timer-id');
      cleared = true;
    }
  });
  const snapshots = [];
  const unsubscribe = bridge.collection('data/users/test-user-a').doc('clay-products')
    .onSnapshot(snapshot => snapshots.push(snapshot));
  await flush();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].exists, false);

  store.externalWrite('products', { data: [{ id: 'remote-product' }], at: 400 });
  windowTarget.emit('focus');
  await flush();
  assert.equal(snapshots.at(-1).exists, true);
  assert.deepEqual(snapshots.at(-1).data(), { data: [{ id: 'remote-product' }], at: 400 });

  store.externalWrite('products', { data: [{ id: 'polled-product' }], at: 500 });
  tick();
  await flush();
  assert.deepEqual(snapshots.at(-1).data(), { data: [{ id: 'polled-product' }], at: 500 });

  documentTarget.visibilityState = 'hidden';
  store.externalWrite('products', { data: [{ id: 'hidden-product' }], at: 600 });
  documentTarget.emit('visibilitychange');
  await flush();
  assert.equal(snapshots.at(-1).data().data[0].id, 'polled-product');

  unsubscribe();
  assert.equal(windowTarget.count('focus'), 0);
  assert.equal(windowTarget.count('pageshow'), 0);
  assert.equal(documentTarget.count('visibilitychange'), 0);
  assert.equal(cleared, true);
});
