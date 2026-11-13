// Sync and persistence against an in-memory fake of the platform database. Nothing here touches a real database or user id.
// Test classes in the names:
//   [invariant]          must always hold
//   [current-behaviour]  how it works today; may be changed deliberately later, not a product requirement
//   [known-limitation]   a documented gap; passing means the gap still exists, it is NOT a requirement
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers/server.mjs';
import { launchBrowser, openClay, sleep, waitUntil, rec } from './helpers/launch.mjs';

const FX = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'synthetic-shelf.json'), 'utf8'));
const T = 1_700_000_000_000;
const KEYS = ['clay-products', 'clay-hair', 'clay-log', 'clay-prefs', 'clay-scents'];
const own = (k) => 'data/users/test-user-a/' + k;

let srv, browser;
before(async () => { srv = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser.close(); await srv.close(); });

const fullRemote = (at) => ({
  'clay-products': { data: FX.records, at },
  'clay-hair': { data: FX.remoteHair, at },
  'clay-log': { data: FX.remoteLog, at },
  'clay-prefs': { data: { tone: 1 }, at },
  'clay-scents': { data: FX.remoteScents, at },
});

test('[invariant] with no platform database the app stays local: nothing is written anywhere', async () => {
  const h = await openClay(browser, srv.base, { noClaude: true });
  await h.settled();
  assert.equal(await h.page.evaluate(() => CSYNC.status), 'local');
  assert.equal(await h.page.evaluate(() => typeof window.__fake.log.writes.length), 'number');
  assert.equal((await h.log()).writes.length, 0);
  assert.ok((await h.mp()).length > 0, 'shelf still usable');
  await h.close();
});

test('[invariant] with a database but no signed-in user the app stays local and writes nothing', async () => {
  const h = await openClay(browser, srv.base, { noUser: true });
  await h.settled();
  assert.equal(await h.page.evaluate(() => CSYNC.status), 'local');
  assert.equal((await h.log()).writes.length, 0);
  assert.equal((await h.log()).reads.length, 0);
  await h.close();
});

test('[current-behaviour] first sign-in with an empty remote uploads this device’s copy once per document (not preferences), as {data, at}', async () => {
  const h = await openClay(browser, srv.base);
  await waitUntil(async () => (await h.log()).writes.length >= 4, 6000);
  await sleep(1600);
  const { writes } = await h.log();
  assert.deepEqual(writes.map((w) => w.key).sort(), ['clay-hair', 'clay-log', 'clay-products', 'clay-scents']);
  for (const w of writes) {
    assert.deepEqual(Object.keys(w.value).sort(), ['at', 'data']);
    assert.equal(typeof w.value.at, 'number');
    assert.equal(w.full, own(w.key));
  }
  await h.close();
});

test('[invariant] first sign-in on a fresh device: empty local copies never overwrite non-empty remote documents', async () => {
  const remote = fullRemote(T);
  const h = await openClay(browser, srv.base, { remote });
  await h.settled();
  await sleep(1800); // longer than the 1.2 s write delay, so a stray upload would show
  assert.equal((await h.log()).writes.length, 0, 'no document may be written');
  assert.deepEqual(await h.page.evaluate(() => window.__fake.store()), Object.fromEntries(KEYS.map((k) => [own(k), remote[k]])), 'remote unchanged');
  assert.deepEqual(await h.mp(), FX.records, 'remote shelf applied here');
  assert.deepEqual(await h.lsJson('clay-hair'), FX.remoteHair);
  assert.deepEqual(await h.lsJson('clay-log'), FX.remoteLog);
  assert.deepEqual(await h.lsJson('clay-scents'), FX.remoteScents);
  await h.close();
});

test('[invariant] a remote document that is newer than this device is applied and mirrored locally, never overwritten', async () => {
  const local = { 'clay-products': [rec(1, 'face', 'Cleanser', 'Synthetic old local', 'cur')], 'clay-sync-ts': { 'clay-products': T - 5000 } };
  const h = await openClay(browser, srv.base, { local, remote: { 'clay-products': { data: FX.records, at: T } } });
  await h.settled();
  await sleep(1600);
  assert.ok(!(await h.log()).writes.some((w) => w.key === 'clay-products'));
  assert.deepEqual(await h.mp(), FX.records);
  assert.deepEqual(await h.lsJson('clay-products'), FX.records);
  assert.equal((await h.lsJson('clay-sync-ts'))['clay-products'], T);
  await h.close();
});

test('[current-behaviour] a device copy that is newer than the remote is uploaded and replaces it (newest wins by timestamp)', async () => {
  const mine = [rec(1, 'face', 'Cleanser', 'Synthetic newer local', 'cur')];
  const h = await openClay(browser, srv.base, { local: { 'clay-products': mine, 'clay-sync-ts': { 'clay-products': T + 9000 } }, remote: { 'clay-products': { data: FX.records, at: T } } });
  await h.settled();
  await waitUntil(async () => (await h.log()).writes.some((w) => w.key === 'clay-products'), 6000);
  const w = (await h.log()).writes.find((x) => x.key === 'clay-products');
  assert.ok(w.value.at > T + 9000, 'the upload is stamped with the time of writing');
  assert.ok(w.value.data.some((r) => r.n === 'Synthetic newer local'));
  await h.close();
});

test('[known-limitation] an EMPTY local document with a newer timestamp overwrites a non-empty remote one (decision pending, not a requirement)', async () => {
  // Newest-wins uses the device clock and does not look at content. If a device holds an empty copy stamped newer than
  // the remote, that empty copy replaces the remote. Documented for a separate decision; Phase 1 does not change it.
  const h = await openClay(browser, srv.base, {
    local: { 'clay-hair': {}, 'clay-sync-ts': { 'clay-hair': T + 9000 } },
    remote: { 'clay-hair': { data: FX.remoteHair, at: T } },
  });
  await h.settled();
  await waitUntil(async () => (await h.log()).writes.some((w) => w.key === 'clay-hair'), 6000);
  const w = (await h.log()).writes.find((x) => x.key === 'clay-hair');
  assert.deepEqual(w.value.data, {}, 'the empty copy replaced the non-empty remote');
  await h.close();
});

test('[current-behaviour] an edit is written once, after the 1.2 s delay, and several quick edits are combined into one write', async () => {
  const h = await openClay(browser, srv.base, { remote: fullRemote(T) });
  await h.settled();
  await h.page.evaluate(() => { document.querySelector('#nav button[data-v="shelf"]').click(); });
  await sleep(200);
  const add = (name) => h.page.evaluate((n) => { document.querySelector('#mpName').value = n; document.querySelector('[data-act="mpadd"]').click(); }, name);
  await add('Synthetic added one');
  await sleep(300);
  await add('Synthetic added two');
  await add('Synthetic added three');
  await sleep(500);
  assert.equal((await h.log()).writes.length, 0, 'nothing is written before the delay ends');
  await waitUntil(async () => (await h.log()).writes.length >= 1, 4000);
  await sleep(1800);
  const { writes } = await h.log();
  assert.equal(writes.length, 1, 'combined into one write');
  assert.equal(writes[0].key, 'clay-products');
  assert.deepEqual(Object.keys(writes[0].value).sort(), ['at', 'data']);
  assert.equal(writes[0].value.data.filter((r) => /^Synthetic added/.test(r.n)).length, 3);
  await h.close();
});

test('[invariant] never more than one write in flight per document', async () => {
  const h = await openClay(browser, srv.base, { remote: fullRemote(T), setDelayMs: 1800 });
  await h.settled();
  await h.page.evaluate(() => { document.querySelector('#nav button[data-v="shelf"]').click(); });
  await sleep(200);
  const add = (n) => h.page.evaluate((name) => { document.querySelector('#mpName').value = name; document.querySelector('[data-act="mpadd"]').click(); }, n);
  await add('Synthetic first');
  await sleep(1500); // first write now in flight (slow fake)
  await add('Synthetic second');
  await sleep(4500);
  const log = await h.log();
  assert.equal(log.maxInflight[own('clay-products')], 1);
  assert.ok(log.writes.filter((w) => w.key === 'clay-products').length >= 2, 'both edits eventually saved');
  await h.close();
});

test('[invariant] a live update that is older than this device is ignored; a newer one is applied and mirrored', async () => {
  const h = await openClay(browser, srv.base, { remote: fullRemote(T) });
  await h.settled();
  await h.page.evaluate(({ recs }) => window.__fake.emit('clay-products', { data: recs, at: 1 }), { recs: [rec(1, 'face', 'Cleanser', 'Synthetic stale', 'cur')] });
  await sleep(200);
  assert.deepEqual(await h.mp(), FX.records, 'older update ignored');
  const newer = [...FX.records, rec(7, 'face', 'Serum', 'Synthetic from another device', 'cur')];
  await h.page.evaluate(({ recs, t }) => window.__fake.emit('clay-products', { data: recs, at: t }), { recs: newer, t: T + 1000 });
  await sleep(200);
  assert.deepEqual(await h.mp(), newer);
  assert.deepEqual(await h.lsJson('clay-products'), newer);
  await h.close();
});

test('[invariant] a failed write never removes or changes the local copy', async () => {
  const h = await openClay(browser, srv.base, { remote: fullRemote(T), failSet: true });
  await h.settled();
  await h.page.evaluate(() => { document.querySelector('#nav button[data-v="shelf"]').click(); });
  await sleep(200);
  await h.page.evaluate(() => { document.querySelector('#mpName').value = 'Synthetic kept locally'; document.querySelector('[data-act="mpadd"]').click(); });
  await waitUntil(async () => (await h.page.evaluate(() => CSYNC.status)) === 'error', 6000);
  assert.ok((await h.lsJson('clay-products')).some((r) => r.n === 'Synthetic kept locally'));
  assert.ok((await h.mp()).some((r) => r.n === 'Synthetic kept locally'));
  await h.close();
});

test('[invariant] only the five known documents under the signed-in user’s own private path are ever touched', async () => {
  const h = await openClay(browser, srv.base);
  await h.settled();
  await sleep(1800);
  const log = await h.log();
  assert.deepEqual(log.violations, []);
  for (const p of [...log.reads, ...log.writes.map((w) => w.full)]) assert.match(p, /^data\/users\/test-user-a\/clay-(products|hair|log|prefs|scents)$/);
  await h.close();
});
