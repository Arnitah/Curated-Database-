import { createClayPagesRecordsAdapter } from './pages-records.js';
import { createClayLegacyDocumentBridge } from './legacy-document-bridge.js';
import { createClayScopedStorage } from './scoped-storage.js';

function authRequired() {
  const error = new Error('Sign in to Clay before opening the hosted workspace');
  error.code = 'CLAY_SYNC_AUTH_REQUIRED';
  return error;
}

/**
 * Creates the compatibility host used by the standalone Pages build.
 * It preserves the current app's db/user/comments capability contract while
 * routing storage through the verified user's cache namespace. The caller
 * must install the returned storage before executing the legacy app scripts.
 */
export async function createClayArtifactHostShim({
  auth,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch,
  baseUrl = '/api/clay/sync',
  eventTarget = globalThis.window || null,
  visibilityTarget = globalThis.document || null,
  pollIntervalMs = 30_000,
  onIdentityChange = null
} = {}) {
  if (!auth
      || typeof auth.getState !== 'function'
      || typeof auth.getAccessToken !== 'function'
      || typeof auth.onStateChange !== 'function') {
    throw new TypeError('A Managed Neon Auth adapter is required');
  }

  const state = await auth.getState();
  if (state.status !== 'signed_in' || !state.user?.id) throw authRequired();
  const userId = state.user.id;

  const scopedStorage = createClayScopedStorage(storage, { userId });
  const records = createClayPagesRecordsAdapter({
    baseUrl,
    getAccessToken: auth.getAccessToken,
    fetchImpl
  });
  const db = createClayLegacyDocumentBridge(records, {
    userId,
    eventTarget,
    visibilityTarget,
    pollIntervalMs
  });
  const user = Object.freeze({ id: async () => userId });

  const unsubscribe = auth.onStateChange(nextState => {
    const nextUserId = nextState.status === 'signed_in' ? nextState.user?.id || null : null;
    if (nextUserId !== userId && typeof onIdentityChange === 'function') {
      try {
        onIdentityChange({ previousUserId: userId, nextUserId });
      } catch {
        // A host navigation callback must not break auth state delivery.
      }
    }
  });

  let disposed = false;
  return Object.freeze({
    storage: scopedStorage,
    userId,
    async use(capability) {
      if (disposed) throw new Error('Clay host shim has been disposed');
      if (capability === 'db') return db;
      if (capability === 'user') return user;
      if (capability === 'comments') return null;
      return null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      db.dispose();
    }
  });
}
