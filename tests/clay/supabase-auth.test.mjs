// All identities and addresses below are synthetic test fixtures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaySupabaseAuth } from '../../apps/clay-sync/supabase-auth.js';

const TEST_EMAIL = ['person', '@', 'example.test'].join('');
const UPPER_TEST_EMAIL = ['Person', '@', 'Example.test'].join('');

function makeAuth({ user = null, authError = null } = {}) {
  const calls = { getUser: 0, otp: [], signOut: 0, listener: null, unsubscribed: 0 };
  const client = {
    auth: {
      async getUser() {
        calls.getUser++;
        return { data: { user }, error: authError };
      },
      async signInWithOtp(input) {
        calls.otp.push(input);
        return { data: {}, error: null };
      },
      async signOut() {
        calls.signOut++;
        return { error: null };
      },
      onAuthStateChange(listener) {
        calls.listener = listener;
        return { data: { subscription: { unsubscribe() { calls.unsubscribed++; } } } };
      }
    }
  };
  return { client, calls };
}

test('reports signed-out state without leaking a caller-supplied identity', async () => {
  const { client, calls } = makeAuth();
  const auth = createClaySupabaseAuth(client);
  assert.deepEqual(await auth.getState(), { status: 'signed_out', user: null });
  assert.equal(calls.getUser, 1);
});

test('reports only the verified user id and email', async () => {
  const { client } = makeAuth({ user: { id: 'verified-user', email: TEST_EMAIL, app_metadata: { role: 'admin' } } });
  const state = await createClaySupabaseAuth(client).getState();
  assert.deepEqual(state, { status: 'signed_in', user: { id: 'verified-user', email: TEST_EMAIL } });
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.user), true);
});

test('implements the provider-neutral email sign-in request without implicitly creating accounts', async () => {
  const { client, calls } = makeAuth();
  const result = await createClaySupabaseAuth(client).requestEmailSignIn('  ' + UPPER_TEST_EMAIL + ' ');
  assert.deepEqual(result, { status: 'link_sent', email: TEST_EMAIL });
  assert.deepEqual(calls.otp, [{
    email: TEST_EMAIL,
    options: { shouldCreateUser: false }
  }]);
});

test('rejects malformed sign-in input before calling Supabase', async () => {
  const { client, calls } = makeAuth();
  const auth = createClaySupabaseAuth(client);
  await assert.rejects(auth.requestEmailSignIn('not-an-email'), { code: 'CLAY_AUTH_INVALID_ARGUMENT' });
  await assert.rejects(auth.requestEmailSignIn('  '), { code: 'CLAY_AUTH_INVALID_ARGUMENT' });
  assert.equal(calls.otp.length, 0);
});

test('propagates authentication service errors', async () => {
  const failure = new Error('Supabase unavailable');
  const { client } = makeAuth({ authError: failure });
  await assert.rejects(createClaySupabaseAuth(client).getState(), failure);
});

test('sign out delegates to Supabase and returns no token or session data', async () => {
  const { client, calls } = makeAuth();
  assert.deepEqual(await createClaySupabaseAuth(client).signOut(), { status: 'signed_out' });
  assert.equal(calls.signOut, 1);
});

test('state subscription exposes minimal user state and returns an unsubscribe function', () => {
  const { client, calls } = makeAuth();
  const received = [];
  const unsubscribe = createClaySupabaseAuth(client).onStateChange(value => received.push(value));
  calls.listener('SIGNED_IN', { user: { id: 'verified-user', email: TEST_EMAIL, secret: 'not-exposed' } });
  calls.listener('SIGNED_OUT', null);
  assert.deepEqual(received, [
    { event: 'SIGNED_IN', status: 'signed_in', user: { id: 'verified-user', email: TEST_EMAIL } },
    { event: 'SIGNED_OUT', status: 'signed_out', user: null }
  ]);
  unsubscribe();
  assert.equal(calls.unsubscribed, 1);
});

test('rejects incomplete client interfaces', () => {
  assert.throws(() => createClaySupabaseAuth({ auth: {} }), { code: 'CLAY_AUTH_INVALID_ARGUMENT' });
});
