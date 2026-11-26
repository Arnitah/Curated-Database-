import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('standalone builder keeps the source artifact untouched and uses a deferred app entry', async () => {
  const builder = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
  const entry = await readFile(resolve(root, 'src/main.js'), 'utf8');
  assert.match(builder, /ii-engine/);
  assert.match(builder, /window\.__clayScopedStorage/);
  assert.match(builder, /src\/main\.js/);
  assert.match(entry, /bootstrapClayStandalone/);
  assert.match(entry, /requestEmailSignIn/);
  assert.doesNotMatch(entry, /signUp/);
});
