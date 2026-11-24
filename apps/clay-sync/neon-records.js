import {
  assertClaySyncCollection,
  assertClaySyncRecordId,
  assertClaySyncSnapshot,
  assertClaySyncMutationResult,
  assertClaySyncRecordsPort
} from './contracts.js';

function fail(message, code = 'CLAY_SYNC_INVALID_ARGUMENT') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('Expected generation must be a positive safe integer');
  }
}

function assertVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('Expected version must be a non-negative safe integer');
  }
}

function throwIfError(error) {
  if (error) throw error;
}

function unwrapRpc(data) {
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result !== 'object' || typeof result.status !== 'string') {
    fail('Clay Neon Data API RPC returned an invalid response', 'CLAY_SYNC_PROTOCOL_ERROR');
  }
  return assertClaySyncMutationResult(result);
}

function sessionUser(data) {
  // Better Auth's browser getSession() exposes data.user. Accept the nested
  // session shape as well for compatible wrappers, but never accept a uid
  // supplied by a record mutation or application caller.
  return data && (data.user || (data.session && data.session.user)) || null;
}

/**
 * Neon Data API implementation of the provider-neutral Clay records port.
 *
 * Pass the combined @neondatabase/neon-js client configured with Managed
 * Neon Auth and the Data API. Its PostgREST client attaches the current
 * verified session JWT to each request; PostgreSQL GRANTs and RLS remain the
 * authorization boundary. This adapter never accepts a caller-supplied uid.
 *
 * The Neon project, Auth and Data API must be configured separately. This
 * module does not provision resources, hold secrets, or enable app sync.
 */
export function createClayNeonRecordsAdapter(client) {
  if (!client || !client.auth || typeof client.auth.getSession !== 'function'
      || typeof client.from !== 'function' || typeof client.rpc !== 'function') {
    fail('A combined Neon Auth and Data API client is required');
  }

  async function requireSignedInUser() {
    const { data, error } = await client.auth.getSession();
    throwIfError(error);
    const user = sessionUser(data);
    if (!user || typeof user.id !== 'string' || !user.id.trim()) {
      fail('Sign in to Clay before syncing', 'CLAY_SYNC_AUTH_REQUIRED');
    }
    return user;
  }

  async function readCollection(collection) {
    assertClaySyncCollection(collection);
    await requireSignedInUser();

    const { data: collectionRows, error: collectionError } = await client
      .from('clay_sync_collections')
      .select('generation,revision')
      .eq('collection', collection)
      .limit(1);
    throwIfError(collectionError);
    if (!Array.isArray(collectionRows) || collectionRows.length > 1) {
      fail('Clay Neon Data API returned an invalid collection result', 'CLAY_SYNC_PROTOCOL_ERROR');
    }

    const collectionRow = collectionRows[0] || null;
    const generation = collectionRow ? Number(collectionRow.generation) : 1;
    const revision = collectionRow ? Number(collectionRow.revision) : 0;
    assertGeneration(generation);

    const { data: rows, error: recordsError } = await client
      .from('clay_sync_records')
      .select('record_id,generation,version,payload,deleted_at')
      .eq('collection', collection)
      .eq('generation', generation)
      .order('record_id', { ascending: true });
    throwIfError(recordsError);
    if (!Array.isArray(rows)) {
      fail('Clay Neon Data API returned an invalid records result', 'CLAY_SYNC_PROTOCOL_ERROR');
    }

    return assertClaySyncSnapshot({
      collection,
      generation,
      revision,
      records: rows.map(row => ({
        id: row.record_id,
        generation: Number(row.generation),
        version: Number(row.version),
        payload: row.payload,
        deletedAt: row.deleted_at || null,
        deleted: Boolean(row.deleted_at)
      }))
    }, collection);
  }

  async function applyRecord({
    collection, recordId, expectedGeneration, expectedVersion, payload, deleted = false
  }) {
    assertClaySyncCollection(collection);
    assertClaySyncRecordId(recordId);
    assertGeneration(expectedGeneration);
    assertVersion(expectedVersion);
    if (typeof deleted !== 'boolean') fail('deleted must be a boolean');
    if (!deleted && (!payload || typeof payload !== 'object' || Array.isArray(payload))) {
      fail('Record payload must be a JSON object');
    }
    await requireSignedInUser();

    const { data, error } = await client.rpc('clay_sync_apply_record', {
      p_collection: collection,
      p_record_id: recordId,
      p_expected_generation: expectedGeneration,
      p_expected_version: expectedVersion,
      p_payload: deleted ? null : payload,
      p_delete: deleted
    });
    throwIfError(error);
    return unwrapRpc(data);
  }

  async function clearCollection({ collection, expectedGeneration }) {
    assertClaySyncCollection(collection);
    assertGeneration(expectedGeneration);
    await requireSignedInUser();

    const { data, error } = await client.rpc('clay_sync_clear_collection', {
      p_collection: collection,
      p_expected_generation: expectedGeneration
    });
    throwIfError(error);
    return unwrapRpc(data);
  }

  return assertClaySyncRecordsPort(Object.freeze({
    readCollection,
    writeRecord: input => applyRecord({ ...input, deleted: false }),
    deleteRecord: input => applyRecord({ ...input, payload: null, deleted: true }),
    clearCollection
  }));
}
