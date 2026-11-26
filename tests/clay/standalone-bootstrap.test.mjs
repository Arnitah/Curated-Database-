import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapClayStandalone } from '../../apps/clay-sync/standalone-bootstrap.js';

function fakeStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function authClientHarness(signedIn = true) {
  let session = signedIn
    ? { session: { id: 'session-a' }, user: { id: 'test-user-a' } }
    : null;
  return {
    client: {
      async getSession() { return { data: session }; },
      async token() { return { data: { token: 'signed.jwt.value' } }; },
      async signOut() { session = null; return { data: { success: true } }; },
      signIn: {
        async magicLink(input) { return { data: { sent: true, input } }; }
      }
    },
    signInAs(userId) {
      session = { session: { id: 'session-b' }, user: { id: userId } };
    }
  };
}

test('does not load personal-data scripts for signed-out visitors', async () => {
  const auth = authClientHarness(false);
  let loaded = false;
  const boot = await bootstrapClayStandalone({
    authClient: auth.client,
    storage: fakeStorage(),
    hostGlobal: {},
    loadApp: async () => { loaded = true; }
  });
  assert.equal(boot.status, 'signed_out');
  assert.equal(loaded, false);
  assert.deepEqual(await boot.requestEmailSignIn('synthetic-user-a'), {
    status: 'link_sent',
    email: 'synthetic-user-a'
  });
});

test('installs scoped storage and host shim before loading the app bundle', async () => {
  const auth = authClientHarness(true);
  const reloads = [];
  const hostGlobal = { location: { reload: () => reloads.push('reload') } };
  const storage = fakeStorage();
  let loaded = false;

  const boot = await bootstrapClayStandalone({
    authClient: auth.client,
    storage,
    hostGlobal,
    fetchImpl: async () => { throw new Error('no network call expected'); },
    pollIntervalMs: 0,
    loadApp: async () => {
      assert.equal(hostGlobal.claude.userId, 'test-user-a');
      assert.equal(typeof hostGlobal.claude.use, 'function');
      assert.equal(typeof hostGlobal.__clayScopedStorage.setItem, 'function');
      hostGlobal.__clayScopedStorage.setItem('clay-products', 'user-cache');
      loaded = true;
    }
  });

  assert.equal(boot.status, 'ready');
  assert.equal(loaded, true);
  assert.equal(storage.getItem('clay:user:test-user-a:clay-products'), 'user-cache');

  await boot.auth.signOut();
  assert.deepEqual(reloads, ['reload']);
  await assert.rejects(hostGlobal.claude.use('db'), /disposed/);
  boot.dispose();
  assert.equal(Object.hasOwn(hostGlobal, 'claude'), false);
  assert.equal(Object.hasOwn(hostGlobal, '__clayScopedStorage'), false);
});

test('cleans up host globals when app loading fails', async () => {
  const auth = authClientHarness(true);
  const hostGlobal = {};
  await assert.rejects(bootstrapClayStandalone({
    authClient: auth.client,
    storage: fakeStorage(),
    hostGlobal,
    fetchImpl: async () => { throw new Error('unused'); },
    pollIntervalMs: 0,
    loadApp: async () => { throw new Error('script failed'); }
  }), /script failed/);
  assert.equal(Object.hasOwn(hostGlobal, 'claude'), false);
  assert.equal(Object.hasOwn(hostGlobal, '__clayScopedStorage'), false);
});
