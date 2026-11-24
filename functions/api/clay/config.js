export async function onRequestGet({ env }) {
  const authBaseUrl = env.CLAY_NEON_AUTH_BASE_URL;
  if (typeof authBaseUrl !== 'string' || !authBaseUrl.trim()) {
    return new Response(JSON.stringify({ error: 'auth_not_configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  let parsed;
  try {
    parsed = new URL(authBaseUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'auth_not_configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  if (parsed.protocol !== 'https:') {
    return new Response(JSON.stringify({ error: 'auth_not_configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  return new Response(JSON.stringify({ authBaseUrl: parsed.href.replace(/\/$/, '') }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
