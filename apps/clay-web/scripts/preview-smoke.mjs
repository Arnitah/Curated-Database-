import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:8788';
const child = spawn(resolve(appRoot, 'node_modules/.bin/wrangler'), [
  'pages', 'dev', 'dist',
  '--ip', '127.0.0.1',
  '--port', '8788',
  '--compatibility-date', '2026-11-24',
  '--log-level', 'error'
], { cwd: appRoot, stdio: 'ignore', detached: true });

try {
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Wrangler Pages preview exited early with code ' + child.exitCode);
    try {
      const response = await fetch(origin + '/', { signal: AbortSignal.timeout(750) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(500);
  }
  assert.equal(ready, true, 'Wrangler Pages preview did not become ready');

  const config = await fetch(origin + '/api/clay/config', { signal: AbortSignal.timeout(3000) });
  assert.equal(config.status, 503, 'Unconfigured Auth should fail closed');

  const sync = await fetch(origin + '/api/clay/sync/products', { signal: AbortSignal.timeout(5000) });
  assert.equal(sync.status, 401, 'Sync API must reject requests without a bearer JWT');

  const crossOrigin = await fetch(origin + '/api/clay/sync/products', {
    headers: { origin: 'https://attacker.example' },
    signal: AbortSignal.timeout(5000)
  });
  assert.equal(crossOrigin.status, 403, 'Sync API must reject cross-origin requests');

  console.log('Pages preview smoke passed: static app, fail-closed config, bearer gate and origin gate.');
} finally {
  if (child.exitCode === null && child.pid && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await delay(500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  } else if (child.exitCode === null) {
    child.kill('SIGTERM');
  }
}
