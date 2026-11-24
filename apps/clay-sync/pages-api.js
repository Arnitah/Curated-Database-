import {
  assertClaySyncCollection,
  assertClaySyncRecordId,
  assertClaySyncSnapshot,
  assertClaySyncMutationResult,
  assertClaySyncRecordsPort
} from './contracts.js';

const PREFIX = '/api/clay/sync/';
const MAX_BODY_BYTES = 1_000_000;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function apiError(status, code) {
  return jsonResponse(status, { error: code });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every(key => allowed.includes(key));
}

function parseBearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(header);
  return match ? match[1] : null;
}

function parseRoute(pathname) {
  if (!pathname.startsWith(PREFIX)) return null;
  const parts = pathname.slice(PREFIX.length).split('/');
  if (parts.some(part => !part)) return null;

  let collection;
  try {
    collection = decodeURIComponent(parts[0]);
    assertClaySyncCollection(collection);
  } catch {
    return null;
  }

  if (parts.length === 1) return { action: 'read', collection };
  if (parts.length === 2 && parts[1] === 'records') return { action: 'write', collection };
  if (parts.length === 3 && parts[1] === 'records') {
    try {
      return { action: 'delete', collection, recordId: assertClaySyncRecordId(decodeURIComponent(parts[2])) };
    } catch {
      return null;
    }
  }
  if (parts.length === 2 && parts[1] === 'clear') return { action: 'clear', collection };
  return null;
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) throw Object.assign(new Error('body too large'), { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error('body too large'), { status: 413 });
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('invalid json'), { status: 400 });
  }
}

function requireBodyKeys(body, allowed) {
  if (!isObject(body) || !hasOnlyKeys(body, allowed)) {
    throw Object.assign(new Error('invalid body'), { status: 400 });
  }
  return body;
}

/**
 * Creates the provider-neutral API router used by a Cloudflare Pages Function.
 * Runtime wiring is injected deliberately: the Pages entrypoint must provide
 * a real JWT verifier (JWKS + issuer validation) and a Neon-backed records
 * adapter. This keeps routing/security behavior independently testable.
 */
export function createClayPagesSyncHandler({ verifyBearerToken, createRecordsAdapter } = {}) {
  if (typeof verifyBearerToken !== 'function' || typeof createRecordsAdapter !== 'function') {
    throw new TypeError('A JWT verifier and records-adapter factory are required');
  }

  return async function handlePagesRequest(context) {
    const request = context?.request;
    const env = context?.env || {};
    if (!(request instanceof Request)) return apiError(400, 'invalid_request');

    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return apiError(403, 'origin_not_allowed');

    const route = parseRoute(url.pathname);
    if (!route) return apiError(404, 'not_found');

    const expectedMethod = route.action === 'read' ? 'GET' : route.action === 'delete' ? 'DELETE' : 'POST';
    if (request.method !== expectedMethod) {
      return new Response(null, {
        status: 405,
        headers: { allow: expectedMethod, 'cache-control': 'no-store' }
      });
    }

    const token = parseBearerToken(request);
    if (!token) return apiError(401, 'unauthorized');

    let claims;
    try {
      claims = await verifyBearerToken(token, env);
    } catch {
      return apiError(401, 'unauthorized');
    }
    if (!isObject(claims) || typeof claims.sub !== 'string' || !claims.sub.trim()) {
      return apiError(401, 'unauthorized');
    }

    let records;
    try {
      records = assertClaySyncRecordsPort(await createRecordsAdapter({ claims, env }));
    } catch {
      return apiError(503, 'sync_unavailable');
    }

    try {
      if (route.action === 'read') {
        const snapshot = await records.readCollection(route.collection);
        return jsonResponse(200, assertClaySyncSnapshot(snapshot, route.collection));
      }

      const body = await readJsonBody(request);
      if (route.action === 'write') {
        requireBodyKeys(body, ['recordId', 'expectedGeneration', 'expectedVersion', 'payload']);
        const result = await records.writeRecord({
          collection: route.collection,
          recordId: assertClaySyncRecordId(body.recordId),
          expectedGeneration: body.expectedGeneration,
          expectedVersion: body.expectedVersion,
          payload: body.payload
        });
        return jsonResponse(200, assertClaySyncMutationResult(result));
      }

      if (route.action === 'delete') {
        requireBodyKeys(body, ['expectedGeneration', 'expectedVersion']);
        const result = await records.deleteRecord({
          collection: route.collection,
          recordId: route.recordId,
          expectedGeneration: body.expectedGeneration,
          expectedVersion: body.expectedVersion
        });
        return jsonResponse(200, assertClaySyncMutationResult(result));
      }

      requireBodyKeys(body, ['expectedGeneration']);
      const result = await records.clearCollection({
        collection: route.collection,
        expectedGeneration: body.expectedGeneration
      });
      return jsonResponse(200, assertClaySyncMutationResult(result));
    } catch (error) {
      if (error?.status === 413) return apiError(413, 'payload_too_large');
      if (error?.status === 400 || error?.code === 'CLAY_SYNC_INVALID_ARGUMENT') {
        return apiError(400, 'invalid_request');
      }
      return apiError(500, 'sync_failed');
    }
  };
}
