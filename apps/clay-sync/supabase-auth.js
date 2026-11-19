function authError(message, code = 'CLAY_AUTH_INVALID_ARGUMENT') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function normalizeEmail(email) {
  if (typeof email !== 'string') authError('Enter a valid sign-in value');
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    authError('Enter a valid sign-in value');
  }
  return normalized;
}

function throwIfError(error) {
  if (error) throw error;
}

/**
 * Supabase Auth boundary for Clay.
 *
 * This controller intentionally supports existing-account email magic links
 * only. It never creates an account implicitly, accepts an external uid, or
 * exposes tokens. A separately approved sign-up flow can be added later.
 */
export function createClaySupabaseAuth(client) {
  if (!client || !client.auth
      || typeof client.auth.getUser !== 'function'
      || typeof client.auth.signInWithOtp !== 'function'
      || typeof client.auth.signOut !== 'function'
      || typeof client.auth.onAuthStateChange !== 'function') {
    authError('A Supabase Auth client is required');
  }

  async function getState() {
    const { data, error } = await client.auth.getUser();
    throwIfError(error);
    const user = data && data.user ? data.user : null;
    return Object.freeze({
      status: user ? 'signed_in' : 'signed_out',
      user: user ? Object.freeze({ id: user.id, email: user.email || null }) : null
    });
  }

  async function sendMagicLink(email) {
    const normalizedEmail = normalizeEmail(email);
    const { error } = await client.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: false }
    });
    throwIfError(error);
    return Object.freeze({ status: 'link_sent', email: normalizedEmail });
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    throwIfError(error);
    return Object.freeze({ status: 'signed_out' });
  }

  function onStateChange(listener) {
    if (typeof listener !== 'function') authError('A state-change listener is required');
    const result = client.auth.onAuthStateChange((event, session) => {
      const user = session && session.user ? session.user : null;
      listener(Object.freeze({
        event,
        status: user ? 'signed_in' : 'signed_out',
        user: user ? Object.freeze({ id: user.id, email: user.email || null }) : null
      }));
    });
    const subscription = result && result.data && result.data.subscription;
    if (!subscription || typeof subscription.unsubscribe !== 'function') {
      authError('Supabase Auth returned an invalid subscription', 'CLAY_AUTH_PROTOCOL_ERROR');
    }
    return () => subscription.unsubscribe();
  }

  return Object.freeze({ getState, sendMagicLink, signOut, onStateChange });
}
