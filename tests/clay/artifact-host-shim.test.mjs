import test from 'node:test';
import assert from 'node:assert/strict';
import { createClayArtifactHostShim } from '../../apps/clay-sync/artifact-host-shim.js';

function fakeStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function eventTarget() {
  const listeners = new Set();
  return {
    addEventListener(name, callback) { if (name === 'focus') listeners.add(callback); },
    removeEventListener(name, callback) { if (name === 'focus') listeners.delete(callback); },
    emit() { for (const callback of [...listeners]) callback(); },
    count() { return listeners.size; }
  };
}

function authHarness(initialState = {
  status: 'signed_in',
  user: { id: 'test-user-a', email: 'synthetic-user-a' }
}) {
  let callback = null;
  let unsubscribed = false;
  return {
    auth: {
      async getState() { return initialState; },
      async getAccessToken() { return 'signed.jwt.value'; },
      onStateChange(listener) {
        callback = listener;
        return () => { unsubscribed = true; callback = null; };
      }
    },
    emit(state) { callback?.(state); },
    get unsubscribed() { return unsubscribed; }
  };
}

test('creates the db/user/comments host contract with a user-scoped storage cache', async () => {
  const harness = authHarness();
  const storage = fakeStorage();
  const shim = await createClayArtifactHostShim({
    auth: harness.auth,
    storage,
    fetchImpl: async () => { throw new Error('no network call expected'); },
    pollIntervalMs: 0
  });

  assert.equal(shim.userId, 'test-user-a');
  const user = await shim.use('user');
  assert.equal(await user.id(), 'test-user-a');
  const db = await shim.use('db');
  const missing = await db.collection('data/users/test-user-a').doc('clay-products').get();
  assert.equal(missing.exists, false);
  assert.equal(await shim.use('comments'), null);
  assert.equal(await shim.use('unknown-capability'), null);

  shim.storage.setItem('clay-products', 'private-cache');
  assert.equal(storage.getItem('clay:user:test-user-a:clay-products'), 'private-cache');
  shim.dispose();
  assert.equal(harness.unsubscribed, true);
});

test('requires a signed-in identity before exposing the hosted data bridge', async () => {
  const harness = authHarness({ status: 'signed_out', user: null });
  await assert.rejects(createClayArtifactHostShim({
    auth: harness.auth,
    storage: fakeStorage()
  }), error => error.code === 'CLAY_SYNC_AUTH_REQUIRED');
});

test('requests a reload boundary when the authenticated account changes', async () => {
  const harness = authHarness();
  const changes = [];
  const shim = await createClayArtifactHostShim({
    auth: harness.auth,
    storage: fakeStorage(),
    fetchImpl: async () => { throw new Error('no network call expected'); },
    pollIntervalMs: 0,
    onIdentityChange: change => changes.push(change)
  });

  harness.emit({ status: 'signed_out', user: null });
  harness.emit({ status: 'signed_in', user: { id: 'test-user-b' } });
  assert.deepEqual(changes, [
    { previousUserId: 'test-user-a', nextUserId: null },
    { previousUserId: 'test-user-a', nextUserId: 'test-user-b' }
  ]);
  shim.dispose();
});
