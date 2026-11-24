import test from 'node:test';
import assert from 'node:assert/strict';
import { createClayNeonAuthAdapter } from '../../apps/clay-sync/neon-auth.js';

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

function createAuthHarness() {
  const calls = [];
  let session = {
    session: { id: 'session-1' },
    user: { id: 'neon-user-a', email: 'synthetic-user-a-email' }
  };
  const client = {
    getSession: async () => {
      calls.push(['getSession']);
      return { data: session };
    },
    token: async () => {
      calls.push(['token']);
      return { data: { token: 'signed.jwt.value' } };
    },
    signIn: {
      magicLink: async input => {
        calls.push(['magicLink', input]);
        return { data: { status: true } };
      }
    },
    signOut: async () => {
      calls.push(['signOut']);
      session = null;
      return { data: { success: true } };
    }
  };
  return {
    client,
    calls,
    setSession(value) { session = value; }
  };
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

test('projects only the verified user identity and never exposes session tokens', async () => {
  const { client } = createAuthHarness();
  const auth = createClayNeonAuthAdapter(client);
  assert.deepEqual(await auth.getState(), {
    status: 'signed_in',
    user: { id: 'neon-user-a', email: 'synthetic-user-a-email' }
  });
  assert.equal(Object.hasOwn(await auth.getState(), 'token'), false);
});

test('requests a fresh user JWT through the documented token method', async () => {
  const { client, calls } = createAuthHarness();
  const auth = createClayNeonAuthAdapter(client);
  assert.equal(await auth.getAccessToken(), 'signed.jwt.value');
  assert.deepEqual(calls.slice(0, 2), [['getSession'], ['token']]);
});

test('does not return an anonymous token when the user is signed out', async () => {
  const { client, setSession, calls } = createAuthHarness();
  setSession(null);
  const auth = createClayNeonAuthAdapter(client);
  await assert.rejects(auth.getAccessToken(), error => error.code === 'CLAY_SYNC_AUTH_REQUIRED');
  assert.equal(calls.some(call => call[0] === 'token'), false);
});

test('uses magic-link sign-in only and returns the provider-neutral result', async () => {
  const { client, calls } = createAuthHarness();
  const auth = createClayNeonAuthAdapter(client, { callbackURL: '/auth/callback' });
  assert.deepEqual(await auth.requestEmailSignIn('  synthetic-person-email  '), {
    status: 'link_sent',
    email: 'synthetic-person-email'
  });
  assert.deepEqual(calls[0], ['magicLink', {
    email: 'synthetic-person-email',
    callbackURL: '/auth/callback'
  }]);
  assert.equal(typeof client.signUp, 'undefined');
});

test('emits signed-out state and returns the normalized sign-out result', async () => {
  const { client } = createAuthHarness();
  const auth = createClayNeonAuthAdapter(client);
  const states = [];
  const unsubscribe = auth.onStateChange(state => states.push(state));
  await flush();
  assert.equal(states[0].status, 'signed_in');
  assert.deepEqual(await auth.signOut(), { status: 'signed_out' });
  assert.deepEqual(states.at(-1), { status: 'signed_out', user: null });
  unsubscribe();
});

test('refreshes session state on focus, page show and visible-tab changes', async () => {
  const { client, setSession } = createAuthHarness();
  const windowTarget = eventTarget();
  const documentTarget = eventTarget();
  documentTarget.visibilityState = 'visible';
  const auth = createClayNeonAuthAdapter(client, {
    eventTarget: windowTarget,
    visibilityTarget: documentTarget
  });
  const states = [];
  const unsubscribe = auth.onStateChange(state => states.push(state));
  await flush();
  assert.equal(states.length, 1);

  setSession(null);
  windowTarget.emit('focus');
  await flush();
  assert.equal(states.at(-1).status, 'signed_out');

  setSession({ session: { id: 'session-2' }, user: { id: 'neon-user-a' } });
  documentTarget.emit('visibilitychange');
  await flush();
  assert.deepEqual(states.at(-1), { status: 'signed_in', user: { id: 'neon-user-a' } });

  unsubscribe();
  assert.equal(windowTarget.count('focus'), 0);
  assert.equal(windowTarget.count('pageshow'), 0);
  assert.equal(documentTarget.count('visibilitychange'), 0);
});

test('does not emit signed-out state when session refresh fails transiently', async () => {
  const { client } = createAuthHarness();
  let fail = false;
  const original = client.getSession;
  client.getSession = async () => {
    if (fail) throw new Error('network unavailable');
    return original();
  };
  const windowTarget = eventTarget();
  const auth = createClayNeonAuthAdapter(client, { eventTarget: windowTarget });
  const states = [];
  const unsubscribe = auth.onStateChange(state => states.push(state));
  await flush();
  fail = true;
  windowTarget.emit('focus');
  await flush();
  assert.equal(states.length, 1);
  assert.equal(states[0].status, 'signed_in');
  unsubscribe();
});

test('rejects incomplete Managed Auth clients', () => {
  assert.throws(() => createClayNeonAuthAdapter({}), /supported Managed Neon Auth client/);
});
