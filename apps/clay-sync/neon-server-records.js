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

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return isObject(value) && Object.keys(value).every(key => allowed.includes(key));
}

function assertGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('Expected generation must be a positive safe integer');
}

function assertVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('Expected version must be a non-negative safe integer');
}

function parseJsonResult(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    fail('Clay sync RPC returned invalid JSON', 'CLAY_SYNC_PROTOCOL_ERROR');
  }
}

function unwrapMutation(rows) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || !Object.prototype.hasOwnProperty.call(row, 'result')) {
    fail('Clay sync RPC returned an invalid response', 'CLAY_SYNC_PROTOCOL_ERROR');
  }
  return assertClaySyncMutationResult(parseJsonResult(row.result));
}

/**
 * Server-side Neon records adapter for a verified Managed Auth principal.
 *
 * `sql` is the `neon()` HTTP query function from @neondatabase/serverless.
 * Every operation is one non-interactive transaction: set_config(..., true)
 * installs the already-verified JWT claims locally, then RLS evaluates the
 * same claims for all queries in that transaction. No user id is accepted
 * from operation payloads.
 */
export function createClayNeonServerRecordsAdapter({ sql, claims } = {}) {
  if (typeof sql !== 'function' || typeof sql.transaction !== 'function') {
    fail('A Neon HTTP query function with transaction support is required');
  }
  if (!isObject(claims) || typeof claims.sub !== 'string' || !claims.sub.trim()) {
    fail('A verified JWT subject is required', 'CLAY_SYNC_AUTH_REQUIRED');
  }

  const claimsJson = JSON.stringify(claims);
  if (typeof claimsJson !== 'string') fail('Verified JWT claims must be JSON serializable');

  async function transact(queries) {
    return sql.transaction([
      sql\`SELECT set_config('request.jwt.claims', \${claimsJson}, true)\`,
      ...queries
    ]);
  }

  async function readCollection(collection) {
    assertClaySyncCollection(collection);
    const [, stateRows, recordRows] = await transact([
      sql\`SELECT generation, revision
          FROM public.clay_sync_collections
          WHERE collection = \${collection}
          LIMIT 1\`,
      sql\`SELECT record_id, generation, version, payload, deleted_at
          FROM public.clay_sync_records
          WHERE collection = \${collection}
            AND generation = COALESCE(
              (SELECT generation
               FROM public.clay_sync_collections
               WHERE collection = \${collection}
               LIMIT 1),
              1
            )
          ORDER BY record_id ASC\`
    ]);

    const state = Array.isArray(stateRows) ? stateRows[0] : null;
    const generation = state ? Number(state.generation) : 1;
    const revision = state ? Number(state.revision) : 0;
    const records = (recordRows || []).map(row => ({
      id: row.record_id,
      generation: Number(row.generation),
      version: Number(row.version),
      payload: row.payload ?? null,
      deletedAt: row.deleted_at || null,
      deleted: Boolean(row.deleted_at)
    }));

    return assertClaySyncSnapshot({ collection, generation, revision, records }, collection);
  }

  async function applyRecord(input, deleted) {
    const allowed = deleted
      ? ['collection', 'recordId', 'expectedGeneration', 'expectedVersion']
      : ['collection', 'recordId', 'expectedGeneration', 'expectedVersion', 'payload'];
    if (!hasOnlyKeys(input, allowed)) fail('Record mutation contains unsupported fields');
    const collection = assertClaySyncCollection(input.collection);
    const recordId = assertClaySyncRecordId(input.recordId);
    assertGeneration(input.expectedGeneration);
    assertVersion(input.expectedVersion);
    if (!deleted && !isObject(input.payload)) fail('Record payload must be a JSON object');

    const payloadJson = deleted ? null : JSON.stringify(input.payload);
    const [, rows] = await transact([
      sql\`SELECT public.clay_sync_apply_record(
        \${collection},
        \${recordId},
        \${input.expectedGeneration},
        \${input.expectedVersion},
        \${payloadJson}::jsonb,
        \${deleted}
      ) AS result\`
    ]);
    return unwrapMutation(rows);
  }

  async function clearCollection(input) {
    if (!hasOnlyKeys(input, ['collection', 'expectedGeneration'])) {
      fail('Collection clear contains unsupported fields');
    }
    const collection = assertClaySyncCollection(input.collection);
    assertGeneration(input.expectedGeneration);
    const [, rows] = await transact([
      sql\`SELECT public.clay_sync_clear_collection(
        \${collection},
        \${input.expectedGeneration}
      ) AS result\`
    ]);
    return unwrapMutation(rows);
  }

  return assertClaySyncRecordsPort(Object.freeze({
    readCollection,
    writeRecord: input => applyRecord(input, false),
    deleteRecord: input => applyRecord(input, true),
    clearCollection
  }));
}
