import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:8788';
const child = spawn('npx', [
  'wrangler', 'pages', 'dev', 'dist',
  '--ip', '127.0.0.1',
  '--port', '8788',
  '--compatibility-date', '2026-11-24',
  '--log-level', 'error'
], { cwd: appRoot, stdio: ['ignore', 'pipe', 'pipe'] });

let logs = '';
child.stdout.on('data', chunk => { logs = (logs + chunk.toString()).slice(-4000); });
child.stderr.on('data', chunk => { logs = (logs + chunk.toString()).slice(-4000); });

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Wrangler Pages preview exited early: ' + logs);
    try {
      const response = await fetch(origin + '/');
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(500);
  }
  assert.equal(ready, true, 'Wrangler Pages preview did not become ready: ' + logs);

  const config = await fetch(origin + '/api/clay/config');
  assert.equal(config.status, 503, 'Unconfigured Auth should fail closed');

  const sync = await fetch(origin + '/api/clay/sync/products');
  assert.equal(sync.status, 401, 'Sync API must reject requests without a bearer JWT');

  const crossOrigin = await fetch(origin + '/api/clay/sync/products', {
    headers: { origin: 'https://attacker.example' }
  });
  assert.equal(crossOrigin.status, 403, 'Sync API must reject cross-origin requests');

  console.log('Pages preview smoke passed: static app, fail-closed config, bearer gate and origin gate.');
} finally {
  child.kill('SIGTERM');
}
