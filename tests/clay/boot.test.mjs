// Boot: the page loads, shows its nine sections, and has no script errors. Offline, fake platform, synthetic data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.mjs';
import { launchBrowser, openClay } from './helpers/launch.mjs';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser.close(); await srv.close(); });

const NAV = ['Today', 'Routine', 'Your year', 'My Shelf', 'Travel', 'Discover', 'Pairs & scent', 'Learn', 'Scan'];

test('[invariant] page boots with no script errors and all nine sections in the nav', async () => {
  const h = await openClay(browser, srv.base);
  await h.settled();
  const labels = await h.page.$$eval('#nav button', (bs) => bs.map((b) => b.textContent.trim()));
  assert.deepEqual(labels, NAV);
  assert.deepEqual(h.errors, []);
  assert.equal(await h.page.title(), 'Clay Web');
  await h.close();
});

test('[invariant] the ingredient engine is bundled into the page and exposes its three functions', async () => {
  const h = await openClay(browser, srv.base);
  const api = await h.page.evaluate(() => ({
    t: typeof window.ClayII,
    fns: Object.keys(window.ClayII.engine).sort(),
    adapter: typeof window.ClayII.toEngineProduct,
    version: window.ClayII.version,
  }));
  assert.equal(api.t, 'object');
  assert.deepEqual(api.fns, ['evaluateProductPair', 'evaluateRoutine', 'normalizeIngredient']);
  assert.equal(api.adapter, 'function');
  assert.match(api.version, /^\d+\.\d+\.\d+/);
  await h.close();
});

test('[invariant] every shelf record has the expected shape and a unique id after boot', async () => {
  const h = await openClay(browser, srv.base);
  const mp = await h.mp();
  const areas = ['face', 'body', 'hair', 'under', 'intimate', 'oral'];
  const stats = ['cur', 'have', 'past', 'next'];
  assert.ok(mp.length > 0);
  for (const r of mp) {
    assert.ok(Number.isInteger(r.id), 'id');
    assert.ok(areas.includes(r.a), 'area ' + r.a);
    assert.ok(stats.includes(r.s), 'status ' + r.s);
    assert.equal(typeof r.n, 'string');
    assert.equal(typeof r.st, 'string');
  }
  assert.equal(new Set(mp.map((r) => r.id)).size, mp.length);
  await h.close();
});

test('[invariant] the five shelf categories (face, body, hair, underarm, intimate) stay available', async () => {
  const h = await openClay(browser, srv.base);
  const areas = await h.page.evaluate(() => MP_AREAS.map((a) => a[0]));
  for (const a of ['face', 'body', 'hair', 'under', 'intimate']) assert.ok(areas.includes(a), a);
  await h.close();
});

test('[invariant] with outside network blocked, only font hosts are attempted', async () => {
  const h = await openClay(browser, srv.base);
  await h.settled();
  const hosts = [...new Set(h.blocked)].filter((x) => !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(x));
  assert.deepEqual(hosts, []);
  await h.close();
});
