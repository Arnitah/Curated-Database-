// The engine block inside apps/clay.html must match what the bundler produces from the engine source.
// Runs the bundler on a temporary copy; the real files are only read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './helpers/server.mjs';

test('[invariant] re-bundling the engine into a copy of clay.html changes nothing', () => {
  const src = path.join(REPO_ROOT, 'apps', 'clay.html');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-bundle-'));
  const copy = path.join(dir, 'clay.html');
  fs.copyFileSync(src, copy);
  execFileSync(process.execPath, [path.join(REPO_ROOT, 'apps/ingredient-intelligence/tools/bundle.mjs'), copy], { stdio: 'pipe' });
  const same = fs.readFileSync(copy, 'utf8') === fs.readFileSync(src, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(same, 'the engine inside apps/clay.html is out of date: run apps/ingredient-intelligence/tools/bundle.mjs');
});
