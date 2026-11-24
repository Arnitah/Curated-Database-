import {
  assertClaySyncCollection,
  assertClaySyncRecordsPort
} from './contracts.js';

const DOCUMENT_COLLECTIONS = Object.freeze({
  'clay-products': 'products',
  'clay-hair': 'hair',
  'clay-log': 'log',
  'clay-prefs': 'prefs',
  'clay-scents': 'scents'
});
const STATE_RECORD_ID = 'state';

function fail(message, code = 'CLAY_SYNC_INVALID_ARGUMENT') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function assertLegacyDocument(value) {
  if (!isObject(value) || !Object.prototype.hasOwnProperty.call(value, 'data')) {
    fail('Legacy Clay document must contain data');
  }
  if (!Number.isFinite(value.at)) fail('Legacy Clay document timestamp must be finite');
  if (Object.keys(value).some(key => !['data','at','cleared'].includes(key))) {
    fail('Legacy Clay document contains unsupported fields');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'cleared') && typeof value.cleared !== 'boolean') {
    fail('Legacy Clay cleared flag must be boolean');
  }
  return cloneJson(value);
}

function makeDocumentSnapshot(snapshot, record) {
  const exists = Boolean(record && !record.deleted);
  const data = exists ? cloneJson(record.payload) : null;
  return Object.freeze({
    exists,
    generation: snapshot.generation,
    revision: snapshot.revision,
    version: record?.version || 0,
    data: () => cloneJson(data)
  });
}

/**
 * Compatibility layer for Clay's current five Firestore-style documents.
 *
 * Each existing document key is represented as one versioned record named
 * "state" in its matching provider-neutral collection. The browser path is
 * checked against the signed-in user id, but that id is never sent as proof
 * of ownership; the Pages API derives ownership from the verified JWT.
 *
 * Snapshot notifications use one shared focus/visibility listener and a
 * lightweight 30-second poll while the page is visible. This intentionally
 * replaces the artifact host's realtime listener without claiming realtime
 * push semantics from Neon.
 */
export function createClayLegacyDocumentBridge(records, {
  userId,
  eventTarget = null,
  visibilityTarget = null,
  pollIntervalMs = 30_000,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval
} = {}) {
  assertClaySyncRecordsPort(records);
  if (typeof userId !== 'string' || !userId.trim() || userId.includes('/')) {
    fail('A valid signed-in Clay user id is required', 'CLAY_SYNC_AUTH_REQUIRED');
  }

  const expectedPath = 'data/users/' + userId;
  const subscriptions = new Set();
  let pollHandle = null;
  let started = false;

  async function readDocument(collection) {
    const snapshot = await records.readCollection(collection);
    const record = snapshot.records.find(item =>
      item.id === STATE_RECORD_ID && item.generation === snapshot.generation
    ) || null;
    return { snapshot, record };
  }

  function notifyError(subscription, error) {
    if (typeof subscription.onError === 'function') {
      try { subscription.onError(error); } catch { /* isolate listener errors */ }
    }
  }

  async function refreshSubscription(subscription, force = false) {
    if (subscription.inFlight) return;
    subscription.inFlight = true;
    try {
      const { snapshot, record } = await readDocument(subscription.collection);
      const changed = force
        || subscription.lastGeneration !== snapshot.generation
        || subscription.lastRevision !== snapshot.revision;
      subscription.lastGeneration = snapshot.generation;
      subscription.lastRevision = snapshot.revision;
      if (changed) {
        try {
          subscription.callback(makeDocumentSnapshot(snapshot, record));
        } catch (error) {
          notifyError(subscription, error);
        }
      }
    } catch (error) {
      notifyError(subscription, error);
    } finally {
      subscription.inFlight = false;
    }
  }

  async function refreshAll() {
    await Promise.all([...subscriptions].map(subscription => refreshSubscription(subscription)));
  }

  function onFocus() {
    void refreshAll();
  }

  function onVisibilityChange() {
    if (!visibilityTarget || visibilityTarget.visibilityState !== 'hidden') {
      void refreshAll();
    }
  }

  function startNotifications() {
    if (started) return;
    started = true;
    eventTarget?.addEventListener?.('focus', onFocus);
    eventTarget?.addEventListener?.('pageshow', onFocus);
    visibilityTarget?.addEventListener?.('visibilitychange', onVisibilityChange);
    if (pollIntervalMs > 0 && typeof setIntervalFn === 'function') {
      pollHandle = setIntervalFn(() => {
        if (!visibilityTarget || visibilityTarget.visibilityState !== 'hidden') {
          void refreshAll();
        }
      }, pollIntervalMs);
    }
  }

  function stopNotifications() {
    if (!started || subscriptions.size > 0) return;
    started = false;
    eventTarget?.removeEventListener?.('focus', onFocus);
    eventTarget?.removeEventListener?.('pageshow', onFocus);
    visibilityTarget?.removeEventListener?.('visibilitychange', onVisibilityChange);
    if (pollHandle !== null && typeof clearIntervalFn === 'function') {
      clearIntervalFn(pollHandle);
    }
    pollHandle = null;
  }

  function createDocumentReference(key) {
    const collection = DOCUMENT_COLLECTIONS[key];
    if (!collection) fail('Unknown legacy Clay document key');
    assertClaySyncCollection(collection);

    return Object.freeze({
      async get() {
        const { snapshot, record } = await readDocument(collection);
        return makeDocumentSnapshot(snapshot, record);
      },

      async set(value) {
        const document = assertLegacyDocument(value);
        const { snapshot, record } = await readDocument(collection);
        const result = await records.writeRecord({
          collection,
          recordId: STATE_RECORD_ID,
          expectedGeneration: snapshot.generation,
          expectedVersion: record?.version || 0,
          payload: document
        });
        if (result.status !== 'applied') {
          const error = new Error('Clay data changed on another device; refresh before retrying');
          error.code = 'CLAY_SYNC_CONFLICT';
          error.result = result;
          throw error;
        }
        for (const subscription of subscriptions) {
          if (subscription.collection === collection) {
            subscription.lastGeneration = result.generation;
            subscription.lastRevision = result.revision;
          }
        }
        return result;
      },

      onSnapshot(callback, onError) {
        if (typeof callback !== 'function') fail('A snapshot callback is required');
        const subscription = {
          collection,
          callback,
          onError,
          lastGeneration: null,
          lastRevision: null,
          inFlight: false
        };
        subscriptions.add(subscription);
        startNotifications();
        void refreshSubscription(subscription, true);
        return () => {
          subscriptions.delete(subscription);
          stopNotifications();
        };
      }
    });
  }

  return Object.freeze({
    collection(path) {
      if (path !== expectedPath) {
        fail('Clay document path does not match the signed-in user', 'CLAY_SYNC_AUTH_REQUIRED');
      }
      return Object.freeze({
        doc: createDocumentReference
      });
    },
    dispose() {
      subscriptions.clear();
      stopNotifications();
    }
  });
}

export const CLAY_LEGACY_DOCUMENT_COLLECTIONS = DOCUMENT_COLLECTIONS;
