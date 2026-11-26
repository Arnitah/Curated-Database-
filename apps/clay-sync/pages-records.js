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

function assertGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('Expected generation must be a positive safe integer');
}

function assertVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('Expected version must be a non-negative safe integer');
}

function makeHttpError(status, payload) {
  const code = status === 401 ? 'CLAY_SYNC_AUTH_REQUIRED'
    : status === 409 ? 'CLAY_SYNC_CONFLICT'
    : status >= 500 ? 'CLAY_SYNC_SERVER_ERROR'
    : 'CLAY_SYNC_REQUEST_ERROR';
  const error = new Error(payload?.error || 'Clay sync request failed');
  error.code = code;
  error.status = status;
  error.payload = payload;
  return error;
}

/**
 * Browser-side records adapter for the same-origin Cloudflare Pages API.
 * The caller supplies the Managed Auth token getter; this adapter never
 * accepts or transmits a caller-supplied user id.
 */
export function createClayPagesRecordsAdapter({
  baseUrl = '/api/clay/sync',
  getAccessToken,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof getAccessToken !== 'function') fail('A Managed Auth token getter is required');
  if (typeof fetchImpl !== 'function') fail('A fetch implementation is required');
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) fail('A sync API base URL is required');
  const base = baseUrl.replace(/\/$/, '');

  async function request(path, method = 'GET', body) {
    const token = await getAccessToken();
    if (typeof token !== 'string' || !token.trim()) {
      fail('A signed-in user JWT is required', 'CLAY_SYNC_AUTH_REQUIRED');
    }

    const headers = { authorization: 'Bearer ' + token };
    const init = { method, headers, cache: 'no-store' };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetchImpl(base + path, init);
    } catch {
      fail('Clay sync API is unreachable', 'CLAY_SYNC_NETWORK_ERROR');
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      fail('Clay sync API returned invalid JSON', 'CLAY_SYNC_PROTOCOL_ERROR');
    }
    if (!response.ok) throw makeHttpError(response.status, payload);
    return payload;
  }

  async function readCollection(collection) {
    assertClaySyncCollection(collection);
    const snapshot = await request('/' + encodeURIComponent(collection));
    return assertClaySyncSnapshot(snapshot, collection);
  }

  async function writeRecord(input) {
    if (!isObject(input)) fail('Record mutation must be an object');
    const collection = assertClaySyncCollection(input.collection);
    const recordId = assertClaySyncRecordId(input.recordId);
    assertGeneration(input.expectedGeneration);
    assertVersion(input.expectedVersion);
    if (!isObject(input.payload)) fail('Record payload must be a JSON object');
    if (Object.keys(input).some(key => !['collection','recordId','expectedGeneration','expectedVersion','payload'].includes(key))) {
      fail('Record mutation contains unsupported fields');
    }
    const result = await request('/' + encodeURIComponent(collection) + '/records', 'POST', {
      recordId,
      expectedGeneration: input.expectedGeneration,
      expectedVersion: input.expectedVersion,
      payload: input.payload
    });
    return assertClaySyncMutationResult(result);
  }

  async function deleteRecord(input) {
    if (!isObject(input)) fail('Record deletion must be an object');
    const collection = assertClaySyncCollection(input.collection);
    const recordId = assertClaySyncRecordId(input.recordId);
    assertGeneration(input.expectedGeneration);
    assertVersion(input.expectedVersion);
    if (Object.keys(input).some(key => !['collection','recordId','expectedGeneration','expectedVersion'].includes(key))) {
      fail('Record deletion contains unsupported fields');
    }
    const result = await request(
      '/' + encodeURIComponent(collection) + '/records/' + encodeURIComponent(recordId),
      'DELETE',
      { expectedGeneration: input.expectedGeneration, expectedVersion: input.expectedVersion }
    );
    return assertClaySyncMutationResult(result);
  }

  async function clearCollection(input) {
    if (!isObject(input)) fail('Collection clear must be an object');
    const collection = assertClaySyncCollection(input.collection);
    assertGeneration(input.expectedGeneration);
    if (Object.keys(input).some(key => !['collection','expectedGeneration'].includes(key))) {
      fail('Collection clear contains unsupported fields');
    }
    const result = await request('/' + encodeURIComponent(collection) + '/clear', 'POST', {
      expectedGeneration: input.expectedGeneration
    });
    return assertClaySyncMutationResult(result);
  }

  return assertClaySyncRecordsPort(Object.freeze({
    readCollection,
    writeRecord,
    deleteRecord,
    clearCollection
  }));
}
