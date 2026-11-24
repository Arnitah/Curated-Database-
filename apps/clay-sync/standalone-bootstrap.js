import { createClayNeonAuthAdapter } from './neon-auth.js';
import { createClayArtifactHostShim } from './artifact-host-shim.js';

/**
 * Safe boot sequence for the standalone hosted Clay build.
 *
 * The main app script is loaded only after Managed Auth has confirmed a user,
 * the user-scoped storage namespace is created, and the legacy host shim is
 * installed. A signed-out visitor receives an auth adapter for the sign-in
 * screen but does not execute the personal-data app bundle.
 */
export async function bootstrapClayStandalone({
  authClient,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch,
  baseUrl = '/api/clay/sync',
  hostGlobal = globalThis,
  callbackURL = '/',
  loadApp,
  pollIntervalMs = 30_000
} = {}) {
  if (typeof loadApp !== 'function') {
    throw new TypeError('A deferred Clay app loader is required');
  }

  const auth = createClayNeonAuthAdapter(authClient, { callbackURL });
  const state = await auth.getState();

  if (state.status !== 'signed_in') {
    return Object.freeze({
      status: 'signed_out',
      auth,
      requestEmailSignIn: auth.requestEmailSignIn,
      signOut: auth.signOut
    });
  }

  const host = await createClayArtifactHostShim({
    auth,
    storage,
    fetchImpl,
    baseUrl,
    eventTarget: hostGlobal.window || hostGlobal,
    visibilityTarget: hostGlobal.document || null,
    pollIntervalMs,
    onIdentityChange: () => hostGlobal.location?.reload?.()
  });

  hostGlobal.claude = host;
  hostGlobal.__clayScopedStorage = host.storage;

  try {
    await loadApp();
  } catch (error) {
    host.dispose();
    delete hostGlobal.claude;
    delete hostGlobal.__clayScopedStorage;
    throw error;
  }

  let disposed = false;
  return Object.freeze({
    status: 'ready',
    auth,
    host,
    dispose() {
      if (disposed) return;
      disposed = true;
      host.dispose();
      if (hostGlobal.claude === host) delete hostGlobal.claude;
      if (hostGlobal.__clayScopedStorage === host.storage) delete hostGlobal.__clayScopedStorage;
    }
  });
}
