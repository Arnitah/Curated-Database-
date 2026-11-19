const COLLECTIONS = new Set(['products', 'hair', 'log', 'prefs', 'scents']);

function fail(message, code = 'CLAY_SYNC_INVALID_ARGUMENT') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertCollection(collection) {
  if (typeof collection !== 'string' || !COLLECTIONS.has(collection)) {
    fail('Unsupported Clay sync collection');
  }
}

function assertRecordId(recordId) {
  if (typeof recordId !== 'string' || recordId.length < 1 || recordId.length > 200) {
    fail('Record id must contain between 1 and 200 characters');
  }
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
    fail('Clay sync RPC returned an invalid response', 'CLAY_SYNC_PROTOCOL_ERROR');
  }
  return result;
}

/**
 * Create a per-record Clay sync adapter around an authenticated Supabase JS client.
 *
 * Identity is always established by Supabase Auth. No caller-supplied uid is
 * accepted, and ownership is enforced by the database's RLS policies/RPCs.
 * This adapter deliberately does not retry conflicts or queue offline writes.
 */
export function createClaySupabaseRecordsAdapter(client) {
  if (!client || !client.auth || typeof client.auth.getUser !== 'function'
      || typeof client.from !== 'function' || typeof client.rpc !== 'function') {
    fail('An authenticated Supabase client is required');
  }

  async function requireSignedInUser() {
    const { data, error } = await client.auth.getUser();
    throwIfError(error);
    if (!data || !data.user || !data.user.id) {
      fail('Sign in to Clay before syncing', 'CLAY_SYNC_AUTH_REQUIRED');
    }
    return data.user;
  }

  async function readCollection(collection) {
    assertCollection(collection);
    await requireSignedInUser();

    const { data: collectionRow, error: collectionError } = await client
      .from('clay_sync_collections')
      .select('generation,revision')
      .eq('collection', collection)
      .maybeSingle();
    throwIfError(collectionError);

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

    return {
      collection,
      generation,
      revision,
      records: (rows || []).map(row => ({
        id: row.record_id,
        generation: Number(row.generation),
        version: Number(row.version),
        payload: row.payload,
        deletedAt: row.deleted_at || null,
        deleted: Boolean(row.deleted_at)
      }))
    };
  }

  async function applyRecord({
    collection, recordId, expectedGeneration, expectedVersion, payload, deleted = false
  }) {
    assertCollection(collection);
    assertRecordId(recordId);
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
    assertCollection(collection);
    assertGeneration(expectedGeneration);
    await requireSignedInUser();

    const { data, error } = await client.rpc('clay_sync_clear_collection', {
      p_collection: collection,
      p_expected_generation: expectedGeneration
    });
    throwIfError(error);
    return unwrapRpc(data);
  }

  return Object.freeze({
    readCollection,
    writeRecord: input => applyRecord({ ...input, deleted: false }),
    deleteRecord: input => applyRecord({ ...input, payload: null, deleted: true }),
    clearCollection
  });
}

