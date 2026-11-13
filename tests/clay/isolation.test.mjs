// User-data isolation and leak checks. Real user ids, private records and personal details must never appear
// in fixtures, logs, stored documents or screenshots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers/server.mjs';
import { launchBrowser, openClay, sleep, rec, OUT_DIR } from './helpers/launch.mjs';
import { scanText, disallowedNames } from './helpers/leak-scan.mjs';

const HERE = import.meta.dirname;
let srv, browser;
before(async () => { srv = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser.close(); await srv.close(); });

test('[invariant] another user’s documents are never read, written or shown', async () => {
  const marker = 'Synthetic OTHER USER marker';
  const others = {
    'data/users/test-user-b/clay-products': { data: [rec(1, 'face', 'Cleanser', marker)], at: 9_999_999_999_999 },
    'data/users/test-user-b/clay-hair': { data: { x: marker }, at: 9_999_999_999_999 },
  };
  const h = await openClay(browser, srv.base, { uid: 'test-user-a', others });
  await h.settled();
  await sleep(1800);
  const log = await h.log();
  assert.deepEqual(log.violations, []);
  assert.ok(![...log.reads, ...log.writes.map((w) => w.full)].some((p) => p.includes('test-user-b')));
  assert.equal(JSON.stringify(await h.mp()).includes(marker), false);
  const all = await h.page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  assert.equal(all.includes(marker), false);
  assert.equal(JSON.stringify(await h.store()).includes('test-user-a/') && (await h.store())['data/users/test-user-b/clay-products'].data[0].n === marker, true, 'other user’s document untouched');
  await h.close();
});

test('[invariant] a second browser profile starts with none of the first profile’s local data', async () => {
  const a = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': [rec(1, 'face', 'Cleanser', 'Synthetic only in profile one')] } });
  const b = await openClay(browser, srv.base, { noClaude: true });
  assert.equal(JSON.stringify(await b.mp()).includes('only in profile one'), false);
  await a.close(); await b.close();
});

test('[invariant] fixtures, helpers and tests contain no real ids, emails or non-synthetic user paths', () => {
  const dirs = [path.join(HERE, 'fixtures'), path.join(HERE, 'helpers')];
  const files = dirs.flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f))).filter((f) => !f.endsWith('leak-scan.mjs'));
  files.push(...fs.readdirSync(HERE).filter((f) => f.endsWith('.test.mjs') && f !== 'isolation.test.mjs').map((f) => path.join(HERE, f)));
  for (const f of files) {
    const opts = { tokens: f.includes('fixtures') };
    assert.deepEqual(scanText(fs.readFileSync(f, 'utf8'), opts), [], path.relative(HERE, f));
  }
});

test('[invariant] every fixture record is either from the public starter list in the app or clearly synthetic', async () => {
  const fx = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'synthetic-shelf.json'), 'utf8'));
  const h = await openClay(browser, srv.base, { noClaude: true });
  const seed = await h.page.evaluate(() => MP_SEED.map((r) => r[2]));
  assert.deepEqual(disallowedNames(fx.records, seed), []);
  await h.close();
});

test('[invariant] logs and stored documents from a signed-in session contain no ids or emails outside the test ids', async () => {
  const h = await openClay(browser, srv.base, { uid: 'test-user-a' });
  await h.settled();
  await sleep(1800);
  const text = JSON.stringify({ console: h.consoleText, store: await h.store(), writes: (await h.log()).writes, ls: await h.page.evaluate(() => Object.entries(localStorage)) });
  assert.deepEqual(scanText(text, { tokens: false }), []);
  await h.close();
});

test('[invariant] screenshots are refused when the shelf holds anything outside the public starter list or synthetic names', async () => {
  const h = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': [rec(1, 'face', 'Cleanser', 'Real-looking private product name')] } });
  await assert.rejects(() => h.shot('should-not-exist'), /refusing to screenshot/);
  assert.equal(fs.existsSync(path.join(OUT_DIR, 'should-not-exist.png')), false);
  await h.close();
});

test('[invariant] the leak scanner itself catches what it should', () => {
  assert.ok(scanText('data/users/abc123realid/clay-products').length > 0);
  assert.ok(scanText('someone@example.com').length > 0);
  assert.ok(scanText('9f1c2d3e-1111-4222-8333-444455556666').length > 0);
  assert.deepEqual(scanText('data/users/test-user-a/clay-products', { tokens: false }), []);
});
