import {
  assertClaySyncEmailSignInResult,
  assertClaySyncIdentityPort,
  assertClaySyncIdentityState,
  assertClaySyncSignOutResult
} from './contracts.js';

function fail(message, code = 'CLAY_SYNC_PROTOCOL_ERROR') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function throwIfError(error) {
  if (error) throw error;
}

function makeSignedOutState() {
  return assertClaySyncIdentityState({ status: 'signed_out', user: null });
}

/**
 * Managed Neon Auth adapter for the provider-neutral Clay identity port.
 *
 * Pass the documented @neon/auth client. Session observation uses getSession,
 * sign-in uses signIn.magicLink, sign-out uses signOut, and protected API
 * requests obtain a fresh user JWT through token() -> data.token. No private
 * SDK store internals or localStorage token persistence are used.
 *
 * Magic Link's branch setting must disable new-user registration separately;
 * this adapter never calls a sign-up method.
 */
export function createClayNeonAuthAdapter(authClient, {
  callbackURL = '/',
  eventTarget = null,
  visibilityTarget = null
} = {}) {
  if (!authClient
      || typeof authClient.getSession !== 'function'
      || typeof authClient.signIn?.magicLink !== 'function'
      || typeof authClient.signOut !== 'function'
      || typeof authClient.token !== 'function') {
    fail('A supported Managed Neon Auth client is required');
  }

  const listeners = new Set();

  async function getState() {
    const result = await authClient.getSession();
    throwIfError(result?.error);
    const data = result?.data;
    if (!data?.session) return makeSignedOutState();

    const user = data.user || data.session.user;
    if (!user || typeof user.id !== 'string' || !user.id.trim()) {
      fail('Managed Auth returned a session without a valid user');
    }
    return assertClaySyncIdentityState({
      status: 'signed_in',
      user: {
        id: user.id,
        ...(typeof user.email === 'string' ? { email: user.email } : {})
      }
    });
  }

  async function getAccessToken() {
    const state = await getState();
    if (state.status !== 'signed_in') {
      fail('Sign in to Clay before syncing', 'CLAY_SYNC_AUTH_REQUIRED');
    }
    const result = await authClient.token();
    throwIfError(result?.error);
    const token = result?.data?.token;
    if (typeof token !== 'string' || !token.trim()) {
      fail('Managed Auth did not return a user JWT', 'CLAY_SYNC_AUTH_REQUIRED');
    }
    return token;
  }

  function emit(state) {
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // One UI subscriber must not prevent other subscribers from updating.
      }
    }
  }

  async function refreshAndEmit() {
    try {
      emit(await getState());
    } catch {
      // Transient network failures are not evidence that the user signed out.
    }
  }

  function onStateChange(callback) {
    if (typeof callback !== 'function') fail('Identity state listener must be a function');
    listeners.add(callback);

    const onFocus = () => { void refreshAndEmit(); };
    const onVisibility = () => {
      if (!visibilityTarget || visibilityTarget.visibilityState !== 'hidden') {
        void refreshAndEmit();
      }
    };

    eventTarget?.addEventListener?.('focus', onFocus);
    eventTarget?.addEventListener?.('pageshow', onFocus);
    visibilityTarget?.addEventListener?.('visibilitychange', onVisibility);
    void refreshAndEmit();

    return () => {
      listeners.delete(callback);
      eventTarget?.removeEventListener?.('focus', onFocus);
      eventTarget?.removeEventListener?.('pageshow', onFocus);
      visibilityTarget?.removeEventListener?.('visibilitychange', onVisibility);
    };
  }

  async function requestEmailSignIn(email) {
    if (typeof email !== 'string' || !email.trim()) {
      fail('A valid email address is required', 'CLAY_SYNC_INVALID_ARGUMENT');
    }
    const result = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL
    });
    throwIfError(result?.error);
    return assertClaySyncEmailSignInResult({ status: 'link_sent', email: email.trim() });
  }

  async function signOut() {
    const result = await authClient.signOut();
    throwIfError(result?.error);
    emit(makeSignedOutState());
    return assertClaySyncSignOutResult({ status: 'signed_out' });
  }

  return assertClaySyncIdentityPort(Object.freeze({
    getState,
    requestEmailSignIn,
    signOut,
    onStateChange,
    getAccessToken
  }));
}
