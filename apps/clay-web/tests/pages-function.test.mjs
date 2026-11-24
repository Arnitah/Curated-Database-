import test from 'node:test';
import assert from 'node:assert/strict';
import { createClayPagesSyncFunction } from '../../clay-sync/pages-function.js';

function makeNeon() {
  const sql = function(strings, ...values) { return { strings, values }; };
  sql.transaction = async queries => {
    assert.equal(queries.length, 3);
    return [[], [{ generation: 1, revision: 0 }], []];
  };
  return () => sql;
}

test('Pages composition verifies branch issuer and EdDSA before creating records access', async () => {
  let jwksUrl;
  let verifyOptions;
  const handler = createClayPagesSyncFunction({
    neon: makeNeon(),
    createRemoteJWKSet(url) { jwksUrl = url.href; return { keySet: true }; },
    async jwtVerify(token, jwks, options) {
      assert.equal(token, 'signed.jwt.token');
      assert.deepEqual(jwks, { keySet: true });
      verifyOptions = options;
      return {
        protectedHeader: { alg: 'EdDSA' },
        payload: { sub: 'user-123', iss: 'https://auth.example.test', exp: 1_900_000_000 }
      };
    }
  });
  const response = await handler({
    request: new Request('https://clay.example.test/api/clay/sync/products', {
      headers: { authorization: 'Bearer signed.jwt.token' }
    }),
    env: {
      CLAY_NEON_AUTH_BASE_URL: 'https://auth.example.test/db/auth',
      CLAY_NEON_AUTH_JWKS_URL: 'https://auth.example.test/db/auth/.well-known/jwks.json',
      DATABASE_URL: 'postgresql://runtime:secret@db.example.test/clay'
    }
  });
  assert.equal(response.status, 200);
  assert.equal(jwksUrl, 'https://auth.example.test/db/auth/.well-known/jwks.json');
  assert.deepEqual(verifyOptions, { algorithms: ['EdDSA'], issuer: 'https://auth.example.test' });
  assert.deepEqual(await response.json(), { collection: 'products', generation: 1, revision: 0, records: [] });
});

test('Pages composition rejects non-HTTPS auth configuration before token verification', async () => {
  let verified = false;
  const handler = createClayPagesSyncFunction({
    neon: makeNeon(),
    createRemoteJWKSet() { return {}; },
    async jwtVerify() { verified = true; throw new Error('should not be called'); }
  });
  const response = await handler({
    request: new Request('https://clay.example.test/api/clay/sync/products', {
      headers: { authorization: 'Bearer token' }
    }),
    env: {
      CLAY_NEON_AUTH_BASE_URL: 'http://auth.example.test/db/auth',
      CLAY_NEON_AUTH_JWKS_URL: 'https://auth.example.test/jwks',
      DATABASE_URL: 'postgresql://runtime:secret@db.example.test/clay'
    }
  });
  assert.equal(response.status, 401);
  assert.equal(verified, false);
});
