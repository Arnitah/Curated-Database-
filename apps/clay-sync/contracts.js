/**
 * Provider-neutral contracts for Clay identity and personal-record persistence.
 *
 * These interfaces describe the application boundary only. Provider adapters
 * remain responsible for authenticating requests and enforcing ownership in
 * the remote service (for example, through JWT verification and database RLS).
 */

const COLLECTIONS = new Set(['products', 'hair', 'log', 'prefs', 'scents']);

function contractError(message, code = 'CLAY_SYNC_CONTRACT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeIntegerAtLeast(value, minimum) {
  return Number.isSafeInteger(value) && value >= minimum;
}

export const CLAY_SYNC_COLLECTIONS = Object.freeze([...COLLECTIONS]);

/** Validate a domain collection name before any provider request. */
export function assertClaySyncCollection(collection) {
  if (typeof collection !== 'string' || !COLLECTIONS.has(collection)) {
    contractError('Unsupported Clay sync collection', 'CLAY_SYNC_INVALID_ARGUMENT');
  }
  return collection;
}

/** Validate a stable, provider-independent record identifier. */
export function assertClaySyncRecordId(recordId) {
  if (typeof recordId !== 'string' || recordId.length < 1 || recordId.length > 200) {
    contractError('Record id must contain between 1 and 200 characters', 'CLAY_SYNC_INVALID_ARGUMENT');
  }
  return recordId;
}

/**
 * Identity projection shared by auth providers.
 * Never accept a uid from a caller as proof of identity; adapters must derive
 * the principal from the authenticated provider session on every request.
 */
export function assertClaySyncIdentityState(state) {
  if (!isObject(state) || !['signed_in', 'signed_out'].includes(state.status)) {
    contractError('Identity provider returned an invalid state', 'CLAY_SYNC_PROTOCOL_ERROR');
  }
  if (state.status === 'signed_out') {
    if (state.user !== null) {
      contractError('Signed-out identity state must not include a user', 'CLAY_SYNC_PROTOCOL_ERROR');
    }
    return state;
  }
  if (!isObject(state.user) || typeof state.user.id !== 'string' || !state.user.id.trim()
      || (state.user.email !== undefined && state.user.email !== null && typeof state.user.email !== 'string')) {
    contractError('Signed-in identity state must include a verified principal id', 'CLAY_SYNC_PROTOCOL_ERROR');
  }
  return state;
}

/** The identity port deliberately exposes no raw tokens or provider SDK objects. */
export function assertClaySyncIdentityPort(identity) {
  const methods = ['getState', 'requestEmailSignIn', 'signOut', 'onStateChange'];
  if (!isObject(identity) || methods.some(name => typeof identity[name] !== 'function')) {
    contractError('Identity provider does not implement the Clay identity contract');
  }
  return identity;
}

/**
 * Validate the normalized snapshot returned by any personal-record adapter.
 * Tombstones remain records with a version; they are not silently discarded.
 */
export function assertClaySyncSnapshot(snapshot, expectedCollection) {
  if (!isObject(snapshot)
      || snapshot.collection !== expectedCollection
      || !isSafeIntegerAtLeast(snapshot.generation, 1)
      || !isSafeIntegerAtLeast(snapshot.revision, 0)
      || !Array.isArray(snapshot.records)) {
    contractError('Record adapter returned an invalid collection snapshot', 'CLAY_SYNC_PROTOCOL_ERROR');
  }

  const seen = new Set();
  for (const record of snapshot.records) {
    if (!isObject(record)
        || typeof record.id !== 'string' || record.id.length < 1 || record.id.length > 200
        || seen.has(record.id)
        || record.generation !== snapshot.generation
        || !isSafeIntegerAtLeast(record.version, 1)
        || typeof record.deleted !== 'boolean'
        || !(record.deletedAt === null || typeof record.deletedAt === 'string')
        || record.deleted !== (record.deletedAt !== null)
        || (record.deleted ? record.payload !== null : !isObject(record.payload))) {
      contractError('Record adapter returned an invalid record or tombstone', 'CLAY_SYNC_PROTOCOL_ERROR');
    }
    seen.add(record.id);
  }
  return snapshot;
}

/**
 * Normalized mutation outcomes. Conflicts are values, not automatic retries;
 * callers must refresh and explicitly resolve stale edits.
 */
export function assertClaySyncMutationResult(result) {
  if (!isObject(result) || !['applied', 'cleared', 'conflict'].includes(result.status)) {
    contractError('Record adapter returned an unknown mutation outcome', 'CLAY_SYNC_PROTOCOL_ERROR');
  }

  if (result.status === 'applied') {
    if (!isSafeIntegerAtLeast(result.generation, 1)
        || !isSafeIntegerAtLeast(result.version, 1)
        || !isSafeIntegerAtLeast(result.revision, 1)) {
      contractError('Applied mutation is missing its generation, version or revision', 'CLAY_SYNC_PROTOCOL_ERROR');
    }
  } else if (result.status === 'cleared') {
    if (!isSafeIntegerAtLeast(result.generation, 2)
        || !isSafeIntegerAtLeast(result.revision, 1)) {
      contractError('Clear result is missing its new generation or revision', 'CLAY_SYNC_PROTOCOL_ERROR');
    }
  } else if (!isSafeIntegerAtLeast(result.generation, 1)
      || !isSafeIntegerAtLeast(result.revision, 0)
      || (result.version !== undefined && !isSafeIntegerAtLeast(result.version, 0))
      || (result.reason !== undefined && typeof result.reason !== 'string')) {
    contractError('Conflict result is missing its current concurrency state', 'CLAY_SYNC_PROTOCOL_ERROR');
  }
  return result;
}

/** The repository API is intentionally small and independent of SQL/SDK names. */
export function assertClaySyncRecordsPort(records) {
  const methods = ['readCollection', 'writeRecord', 'deleteRecord', 'clearCollection'];
  if (!isObject(records) || methods.some(name => typeof records[name] !== 'function')) {
    contractError('Persistence adapter does not implement the Clay records contract');
  }
  return records;
}

/** Validate the pair that an application composition root will inject. */
export function assertClaySyncPorts({ identity, records } = {}) {
  return Object.freeze({
    identity: assertClaySyncIdentityPort(identity),
    records: assertClaySyncRecordsPort(records)
  });
}
