import { createClayPagesSyncHandler } from './pages-api.js';
import { createClayNeonServerRecordsAdapter } from './neon-server-records.js';

function requiredHttpsUrl(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(name + ' is required');
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(name + ' must use HTTPS');
  return url;
}

/**
 * Compose the Pages Function boundary from Web-API-compatible dependencies.
 * A remote JWKS is cached per configured URL for the life of the isolate.
 */
export function createClayPagesSyncFunction({ neon, createRemoteJWKSet, jwtVerify } = {}) {
  if (typeof neon !== 'function' || typeof createRemoteJWKSet !== 'function' || typeof jwtVerify !== 'function') {
    throw new TypeError('Neon and JOSE runtime dependencies are required');
  }

  const jwksByUrl = new Map();
  const verifyBearerToken = async (token, env) => {
    const authBase = requiredHttpsUrl(env.CLAY_NEON_AUTH_BASE_URL, 'CLAY_NEON_AUTH_BASE_URL');
    const jwksUrl = requiredHttpsUrl(env.CLAY_NEON_AUTH_JWKS_URL, 'CLAY_NEON_AUTH_JWKS_URL');
    let jwks = jwksByUrl.get(jwksUrl.href);
    if (!jwks) {
      jwks = createRemoteJWKSet(jwksUrl);
      jwksByUrl.set(jwksUrl.href, jwks);
    }
    const { payload, protectedHeader } = await jwtVerify(token, jwks, {
      algorithms: ['EdDSA'],
      issuer: authBase.origin
    });
    if (protectedHeader.alg !== 'EdDSA'
        || typeof payload.sub !== 'string'
        || !payload.sub.trim()
        || typeof payload.iss !== 'string'
        || !Number.isFinite(payload.exp)) {
      throw new Error('Managed Auth JWT claims are incomplete');
    }
    return payload;
  };

  return createClayPagesSyncHandler({
    verifyBearerToken,
    createRecordsAdapter: ({ claims, env }) => {
      if (typeof env.DATABASE_URL !== 'string' || !env.DATABASE_URL.trim()) {
        throw new Error('DATABASE_URL is not configured');
      }
      const sql = neon(env.DATABASE_URL);
      return createClayNeonServerRecordsAdapter({ sql, claims });
    }
  });
}
