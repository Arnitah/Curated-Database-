import test from 'node:test';
import assert from 'node:assert/strict';
import { createClayScopedStorage } from '../../apps/clay-sync/scoped-storage.js';

function fakeStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    dump() { return new Map(values); }
  };
}

test('isolates identical Clay cache keys by verified user id', () => {
  const storage = fakeStorage();
  const userA = createClayScopedStorage(storage, { userId: 'test-user-a' });
  const userB = createClayScopedStorage(storage, { userId: 'test-user-b' });

  userA.setItem('clay-products', '[{"id":"a"}]');
  userB.setItem('clay-products', '[{"id":"b"}]');

  assert.equal(userA.getItem('clay-products'), '[{"id":"a"}]');
  assert.equal(userB.getItem('clay-products'), '[{"id":"b"}]');
  assert.equal(userA.length, 1);
  assert.equal(userB.length, 1);
  assert.equal(storage.length, 2);
});

test('clear removes only the current user namespace', () => {
  const storage = fakeStorage();
  const userA = createClayScopedStorage(storage, { userId: 'test-user-a' });
  const userB = createClayScopedStorage(storage, { userId: 'test-user-b' });

  userA.setItem('clay-web', '{"page":"today"}');
  userA.setItem('clay-sync-ts', '{"clay-products":123}');
  userB.setItem('clay-web', '{"page":"routine"}');
  userA.clear();

  assert.equal(userA.length, 0);
  assert.equal(userA.getItem('clay-web'), null);
  assert.equal(userB.getItem('clay-web'), '{"page":"routine"}');
  assert.equal(storage.length, 1);
});

test('implements the relevant Web Storage key, remove and string coercion behavior', () => {
  const storage = fakeStorage();
  const scoped = createClayScopedStorage(storage, { userId: 'test/user' });
  scoped.setItem(12, 34);
  scoped.setItem('clay-hair', { profile: true });

  assert.equal(scoped.getItem('12'), '34');
  assert.equal(scoped.getItem('clay-hair'), '[object Object]');
  assert.equal(scoped.key(0), '12');
  assert.equal(scoped.key(1), 'clay-hair');
  assert.equal(scoped.key(-1), null);
  assert.equal(scoped.key(20), null);
  scoped.removeItem('12');
  assert.equal(scoped.length, 1);
  assert.equal(scoped.key(0), 'clay-hair');
});

test('rejects missing user ids and non-storage backends', () => {
  assert.throws(() => createClayScopedStorage(fakeStorage(), { userId: '' }), /verified Clay user id/);
  assert.throws(() => createClayScopedStorage({}, { userId: 'test-user-a' }), /Web Storage-compatible/);
});
