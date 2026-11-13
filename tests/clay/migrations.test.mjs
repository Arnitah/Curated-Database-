// Load-time migrations. These pin what the app does TODAY to records it finds on a device.
// They are [current-behaviour] tests: they describe the present rules (including quirks) so a change is noticed.
// They are NOT a statement that these rules are right. The [invariant] tests state what must always hold.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.mjs';
import { launchBrowser, openClay, rec } from './helpers/launch.mjs';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser.close(); await srv.close(); });

const boot = async (records, extra = {}) => {
  const h = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': records, ...extra } });
  return h;
};

test('[current-behaviour] empty storage starts from the built-in starter list, with ids 1..n in order', async () => {
  const h = await openClay(browser, srv.base, { noClaude: true });
  const r = await h.page.evaluate(() => ({ seed: MP_SEED.map(([a, st, n, s], i) => ({ id: i + 1, a, st, n, s })), mp: JSON.parse(JSON.stringify(MP)) }));
  assert.deepEqual(r.mp.slice(0, r.seed.length), r.seed);
  assert.ok(r.mp.length >= r.seed.length);
  await h.close();
});

test('[current-behaviour] old product names in the rename map are renamed on load', async () => {
  const h0 = await openClay(browser, srv.base, { noClaude: true });
  const pairs = await h0.page.evaluate(() => Object.entries(MP_REN).slice(0, 4));
  await h0.close();
  assert.ok(pairs.length >= 3);
  const h = await boot(pairs.map(([old], i) => rec(i + 1, 'face', 'Other', old)));
  const names = (await h.mp()).map((r) => r.n);
  for (const [, now] of pairs) assert.ok(names.includes(now), now);
  await h.close();
});

test('[current-behaviour] "Olay sea salt body scrub" is renamed and its step set to Wash or soap', async () => {
  const h = await boot([rec(1, 'body', 'Scrub', 'Olay sea salt body scrub')]);
  const r = (await h.mp()).find((x) => x.id === 1);
  assert.equal(r.n, 'Olay Exfoliating Moisture sea salt body wash');
  assert.equal(r.st, 'Wash or soap');
  await h.close();
});

test('[current-behaviour] the two intimate wash records are added if missing, once, and not duplicated on reload', async () => {
  const h = await boot([rec(1, 'face', 'Cleanser', 'Synthetic cleanser')]);
  const count = async () => (await h.mp()).filter((r) => /Summer's Eve fragrance-free wash|Vagisil fragrance-free wash/.test(r.n)).length;
  assert.equal(await count(), 2);
  await h.reload();
  assert.equal(await count(), 2);
  await h.close();
});

test('[current-behaviour] the old step "Intimate wash" becomes area intimate, step Wash', async () => {
  const h = await boot([rec(1, 'face', 'Intimate wash', 'Synthetic wash')]);
  const r = (await h.mp()).find((x) => x.id === 1);
  assert.equal(r.a, 'intimate');
  assert.equal(r.st, 'Wash');
  await h.close();
});

test('[current-behaviour] the one-off Hatomugi fix runs once and is not repeated after the flag is set', async () => {
  const h = await boot([rec(1, 'face', 'Toner', 'Synthetic hatomugi lotion')]);
  let r = (await h.mp()).find((x) => x.id === 1);
  assert.equal(r.a, 'body');
  assert.equal(r.st, 'Skin conditioner or mist');
  assert.equal(await h.ls('clay-mig-hato'), '1');
  // move it back by hand and reload: the flag stops a second run
  await h.page.evaluate(() => { const p = MP.find((x) => x.id === 1); p.a = 'face'; p.st = 'Toner'; localStorage.setItem('clay-products', JSON.stringify(MP)); });
  await h.reload();
  r = (await h.mp()).find((x) => x.id === 1);
  assert.equal(r.a, 'face');
  await h.close();
});

test('[current-behaviour] records with an unknown area, step or status are rescued by keyword rules', async () => {
  const h = await boot([
    rec(1, 'zzz', 'Other', 'Synthetic panty liners'),
    rec(2, 'face', 'Not a step', 'Synthetic serum'),
    rec(3, 'face', 'Cleanser', 'Synthetic cleanser', 'bogus'),
  ]);
  const m = Object.fromEntries((await h.mp()).map((r) => [r.id, r]));
  assert.equal(m[1].a, 'intimate');
  assert.equal(m[1].st, 'Pads or liners');
  assert.equal(m[2].st, 'Other');
  assert.equal(m[3].s, 'cur');
  await h.close();
});

test('[invariant] loading never removes a record the device holds, and keeps ids unique', async () => {
  const input = [rec(1, 'face', 'Cleanser', 'Synthetic one'), rec(2, 'under', 'Exfoliant', 'Synthetic two', 'past'), rec(9, 'zzz', 'Other', 'Synthetic three', 'x')];
  const h = await boot(input);
  const mp = await h.mp();
  for (const r of input) assert.ok(mp.some((x) => x.id === r.id && x.n === r.n), r.n);
  assert.equal(new Set(mp.map((x) => x.id)).size, mp.length);
  await h.close();
});

test('[invariant] two shelf records with the same product name in different areas are both kept (the duplicate is preserved)', async () => {
  const h = await boot([rec(1, 'face', 'Toner', 'Synthetic acid toner'), rec(2, 'under', 'Exfoliant', 'Synthetic acid toner')]);
  const dup = (await h.mp()).filter((r) => r.n === 'Synthetic acid toner');
  assert.equal(dup.length, 2);
  assert.deepEqual(dup.map((r) => r.a).sort(), ['face', 'under']);
  await h.close();
});

test('[invariant] the built-in starter list keeps its own pair of same-named records, in different areas', async () => {
  const h = await openClay(browser, srv.base, { noClaude: true });
  const names = await h.page.evaluate(() => MP_SEED.map((r) => r[2] + '|' + r[0]));
  const byName = {};
  for (const x of names) { const [n, a] = x.split('|'); (byName[n] ||= []).push(a); }
  const dups = Object.values(byName).filter((a) => a.length > 1);
  assert.ok(dups.length >= 1, 'a same-named pair exists in the starter list');
  const mp = await h.mp();
  for (const [n, areas] of Object.entries(byName).filter(([, a]) => a.length > 1)) assert.equal(mp.filter((r) => r.n === n).length, areas.length, n);
  await h.close();
});

test('[invariant] loading twice gives the same shelf as loading once (migrations are repeatable)', async () => {
  const h = await boot([rec(1, 'face', 'Intimate wash', 'Synthetic wash'), rec(2, 'zzz', 'x', 'Synthetic tampons', 'bogus')]);
  const once = await h.mp();
  await h.reload();
  assert.deepEqual(await h.mp(), once);
  await h.close();
});
