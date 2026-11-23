// Release-candidate regression gaps (added on the release-candidate branch). All records are invented; nothing here touches real data.
//  1. legacy records that hold only the original fields, or odd/unknown values, or unrelated legacy fields
//  2. record data and provenance survive everyday actions
//  3. editing a verified ingredient list invalidates the verification (and nothing else is lost)
//  4. identity and directions handling stays honest
//  5. the Check page no longer carries a hardcoded product count
//  6. layouts at 320, 375, 390, 430 px and desktop have no horizontal overflow
// Access-boundary note: the fake platform proves what the PAGE asks for (own five documents only; see isolation.test.mjs and sync.test.mjs).
// It cannot prove database privileges. Those are covered only by supabase/tests/*.sql, which need a local Supabase stack.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, REPO_ROOT } from './helpers/server.mjs';
import { launchBrowser, openClay, sleep, waitUntil } from './helpers/launch.mjs';
import { createEngine } from '../../apps/ingredient-intelligence/src/engine.js';
import { toEngineProduct } from '../../apps/ingredient-intelligence/src/clay-adapter.js';

const D = (f) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'apps/ingredient-intelligence/data', f), 'utf8'));
const E = createEngine({ ingredients: D('ingredients.json'), rules: D('pairing-rules.json'), sources: D('sources.json') });
const clone = (x) => JSON.parse(JSON.stringify(x));
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };

let srv, browser;
before(async () => { srv = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser.close(); await srv.close(); });

const act = (h, a, v) => h.page.evaluate(([x, y]) => { const b = document.createElement('button'); b.dataset.act = x; b.dataset.v = y; document.body.appendChild(b); b.click(); b.remove(); }, [a, v]);

// ---- 1. legacy shapes (engine adapter) --------------------------------------------------------------------------
const ORIGINAL_ONLY = { id: 1, a: 'face', st: 'Cleanser', n: 'Synthetic legacy cleanser', s: 'cur' };

test('[invariant] a legacy record with only the original five fields maps without invented data and is not mutated', () => {
  const frozen = deepFreeze(clone(ORIGINAL_ONLY));
  const p = toEngineProduct(frozen); // a frozen input throws in strict mode if the adapter writes to it
  assert.equal(p.name, 'Synthetic legacy cleanser');
  assert.equal(p.status, 'in_use');
  assert.equal(p.category, 'face_cleanser');
  assert.deepEqual(p.ingredient_list, []);
  assert.equal(p.ingredient_list_source, 'unknown');
  assert.equal(p.ingredient_list_verified, false);
  assert.equal(p.ingredient_list_completeness, 'unknown');
  for (const k of ['brand', 'directions_text', 'directions_source', 'directions_source_url', 'directions_checked_at', 'product_variant', 'market', 'identity_source', 'identity_source_url', 'identity_checked_at']) {
    assert.equal(p[k], null, `${k} must stay empty, not inferred`);
  }
  assert.deepEqual(p.clay_record, ORIGINAL_ONLY);
});

test('[invariant] unknown status, unknown area/category, missing list and unrelated legacy fields never throw and never become "in use" or "verified"', () => {
  const odd = [
    { id: 11, a: 'face', st: 'Cleanser', n: 'Synthetic odd status', s: 'archived-by-old-version' },
    { id: 12, a: 'feet', st: 'Soak', n: 'Synthetic unknown area', s: 'cur' },
    { id: 13, a: 'face', st: 'Peel mask', n: 'Synthetic unknown step', s: 'cur' },
    { id: 14, a: 'face', st: 'Serum', n: 'Synthetic extra legacy fields', s: 'cur', oldRating: 4, legacyNotes: ['a', 'b'], legacy: { nested: { deep: true } }, inci: 'Aqua, Glycerin' },
    { id: 15, a: 'face', st: 'Serum', n: 'Synthetic blank list', s: 'cur', inci: '   ' },
    { id: 16, a: 'face', st: 'Serum', n: 'Synthetic non-string fields', s: 'cur', inci: 42, brand: 7, directions_text: { x: 1 }, market: false, inci_verified: 'yes', inci_complete: 'no' },
  ];
  for (const r of odd) {
    const before = clone(r);
    const p = toEngineProduct(r);
    assert.deepEqual(r, before, 'input record is unchanged');
    if (!['cur', 'have', 'past', 'next'].includes(r.s)) assert.notEqual(p.status, 'in_use', `${r.n}: an unrecognised status is not treated as in use`);
    else assert.equal(p.status, { cur: 'in_use', have: 'owned_not_using', past: 'finished', next: 'wishlist' }[r.s]);
    assert.equal(p.ingredient_list_verified, false, `${r.n}: never verified without an explicit true`);
    assert.deepEqual(p.clay_record, before, `${r.n}: the whole original record, including unrelated fields, is kept`);
    assert.ok(Array.isArray(p.mapping_notes) || p.mapping_notes === undefined || typeof p.mapping_notes === 'object');
  }
  // non-string identity/directions values are dropped, not coerced
  const p16 = toEngineProduct(odd[5]);
  assert.equal(p16.brand, null);
  assert.equal(p16.directions_text, null);
  assert.equal(p16.market, null);
  // odd-but-valid records that were "current" status still give no verdict on their own
  const cur = toEngineProduct({ id: 20, a: 'face', st: 'Serum', n: 'Synthetic fine', s: 'cur', inci: 'Aqua, Retinol 0.3%' });
  const r = E.evaluateProductPair(toEngineProduct(odd[0]), cur);
  assert.equal(r.classification, 'insufficient_data');
  assert.doesNotThrow(() => E.evaluateRoutine(odd.map((x) => toEngineProduct(x))));
});

// ---- 2. the page with legacy records ------------------------------------------------------------------------------
const LEGACY = [
  { id: 1, a: 'face', st: 'Cleanser', n: 'Synthetic legacy cleanser', s: 'cur' },
  { id: 2, a: 'face', st: 'Toner', n: 'Synthetic legacy toner', s: 'have', oldRating: 4, legacyNotes: ['kept'], legacy: { nested: { deep: true } } },
  { id: 3, a: 'body', st: 'Lotion or cream', n: 'Synthetic legacy lotion', s: 'cur', inci: 'Aqua, Glycerin' },
];

test('[invariant] legacy records (original fields only, plus unrelated legacy fields) load and render on every section, and the in-memory records are exactly the seeded ones (storage write-back and reload are covered by persistence-rehydration.test.mjs)', async () => {
  const h = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': clone(LEGACY) } });
  try {
    const ids = await h.page.$$eval('#nav button', (bs) => bs.map((b) => b.dataset.v));
    for (const id of ids) {
      await h.page.evaluate((v) => document.querySelector(`#nav button[data-v="${v}"]`).click(), id);
      await sleep(100);
    }
    const mp = await h.mp();
    for (const r of LEGACY) {
      const now = mp.find((x) => x.id === r.id);
      assert.deepEqual(now, r, `record ${r.id} in memory is exactly as seeded (no fields added, none dropped)`);
    }
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

const SOURCED = {
  id: 31, a: 'face', st: 'Toner', n: 'Synthetic sourced toner', s: 'cur',
  inci: 'Aqua, Glycolic Acid (7%), Glycerin', inci_verified: true, inci_complete: true, inci_source: 'package_photo',
  brand: 'Example Brand', product_variant: '7% toner, 100 ml', market: 'Canada',
  identity_source: 'manufacturer', identity_source_url: 'https://example.test/p', identity_checked_at: '2026-11-21',
  directions_text: 'Use at night only.', directions_source: 'manufacturer', directions_source_url: 'https://example.test/d', directions_checked_at: '2026-11-21',
  oldRating: 5, legacy: { keep: ['me'] },
};

test('[invariant] status change, rename and removal of another product keep every field and all provenance of a sourced record', async () => {
  const h = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': [clone(SOURCED), clone(LEGACY[0])] } });
  try {
    await h.page.evaluate(() => document.querySelector('#nav button[data-v="shelf"]').click());
    await sleep(150);
    await act(h, 'mpset', '31:have');
    let r = (await h.mp()).find((x) => x.id === 31);
    assert.deepEqual({ ...r, s: 'cur' }, SOURCED, 'only the status changed');
    assert.equal(r.s, 'have');
    await act(h, 'mpedit', '31');
    await h.page.evaluate(() => { if (!document.querySelector('#mpRen')) { const i = document.createElement('input'); i.id = 'mpRen'; document.body.appendChild(i); } document.querySelector('#mpRen').value = 'Synthetic renamed sourced toner'; });
    await act(h, 'mpsave', '31');
    r = (await h.mp()).find((x) => x.id === 31);
    assert.deepEqual({ ...r, s: 'cur', n: SOURCED.n }, SOURCED, 'only status and name changed; provenance untouched');
    assert.equal(r.n, 'Synthetic renamed sourced toner');
    await act(h, 'mpdel', '1');
    assert.deepEqual((await h.mp()).find((x) => x.id === 31), r, 'removing another product leaves this record untouched');
    assert.deepEqual(await h.lsJson('clay-products'), await h.mp(), 'what is saved on the device is what is in memory');
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

// ---- 3. verification invalidation ----------------------------------------------------------------------------------
test('[invariant] editing the ingredient list clears packaging verification, keeps identity and directions provenance, and withholds a full verdict again', async () => {
  const other = { id: 32, a: 'face', st: 'Serum', n: 'Synthetic retinol serum', s: 'cur', inci: 'Retinol 0.3%', inci_verified: true, inci_complete: true };
  const acid = { ...clone(SOURCED), inci: 'Glycolic Acid (7%)' }; // only registry-recognised labels, so a full verdict is possible while verified
  const h = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': [acid, clone(other)] } });
  try {
    const verdict = () => h.page.evaluate(() => {
      const mp = MP.filter((p) => p.s === 'cur').map((p) => ClayII.toEngineProduct(p));
      return ClayII.engine.evaluateProductPair(mp[0], mp[1]).classification;
    });
    assert.equal(await verdict(), 'use_with_care', 'both lists verified: acid + retinoid is a full verdict');
    await act(h, 'cpopen', '31');
    // let the Check page finish its own start-up re-render (it re-renders once when the product list has loaded) before typing
    await h.page.evaluate(async () => { await pdbLoad(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
    await h.page.waitForFunction(() => document.querySelector('[data-cpl="a"]') && document.querySelector('[data-cpl="a"]').value === 'Glycolic Acid (7%)'); // wait until the saved list has loaded
    // type the new list; if the page's start-up re-render swallowed the keystrokes (seen about once in 100 runs), type again until the page has registered them
    await waitUntil(async () => { await h.page.locator('[data-cpl="a"]').fill('Glycolic Acid (7%), Panthenol'); return (await h.page.evaluate(() => S.cp.la)) === 'Glycolic Acid (7%), Panthenol'; });
    await h.page.locator('[data-act="cpgo"]').click();
    await h.page.locator('[data-act="cpsave"][data-v="a"]').click();
    const r = (await h.mp()).find((x) => x.id === 31);
    assert.equal(r.inci, 'Glycolic Acid (7%), Panthenol');
    assert.equal(r.inci_verified, false, 'verification cleared by the edit');
    const { inci, inci_verified, ...rest } = r;
    const { inci: _i, inci_verified: _v, ...restOrig } = acid;
    assert.deepEqual(rest, restOrig, 'every other field and all provenance is preserved');
    assert.equal(await verdict(), 'insufficient_data', 'with the edited list unverified, the full verdict is withheld again');
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('[invariant] an explicit "checked against packaging" tick can be undone, and unticking really clears it', async () => {
  const h = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': [{ id: 41, a: 'face', st: 'Serum', n: 'Synthetic serum', s: 'cur', inci: 'Aqua, Glycerin' }] } });
  try {
    await act(h, 'cpopen', '41');
    const box = h.page.locator('[data-iiverify="41"]');
    await box.waitFor();
    assert.equal((await h.mp())[0].inci_verified, undefined, 'a legacy record is not verified until someone ticks the box');
    await box.check();
    assert.equal((await h.mp())[0].inci_verified, true);
    await h.page.locator('[data-iiverify="41"]').uncheck();
    assert.equal((await h.mp())[0].inci_verified, false);
  } finally { await h.close(); }
});

// ---- 4. identity and directions ------------------------------------------------------------------------------------
test('[invariant] identity and directions fields are never inferred for a legacy record, and a sourced record shows its source links', async () => {
  const h = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': [clone(SOURCED), clone(LEGACY[0])] } });
  try {
    await h.page.evaluate(() => document.querySelector('#nav button[data-v="shelf"]').click());
    await h.page.getByRole('heading', { name: 'Ingredient intelligence' }).waitFor();
    assert.equal(await h.page.locator('a[href="https://example.test/d"]').count(), 1);
    assert.equal(await h.page.locator('a[href="https://example.test/p"]').count(), 1);
    assert.match(await h.page.locator('#main').innerText(), /Use at night only\./);
    const legacy = await h.page.evaluate(() => ClayII.toEngineProduct(MP.find((p) => p.id === 1)));
    assert.equal(legacy.directions_text, null);
    assert.equal(legacy.brand, null);
    assert.equal(legacy.identity_source, null);
    assert.deepEqual((await h.mp()).find((p) => p.id === 1), LEGACY[0], 'viewing never writes identity or directions onto a legacy record');
  } finally { await h.close(); }
});

// ---- 5. the stale "14,000" wording ---------------------------------------------------------------------------------
test('[invariant] the page source carries no hardcoded product count', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'apps/clay.html'), 'utf8');
  assert.equal(/14,000/.test(src), false, 'no hardcoded "14,000" in the live page');
  assert.equal(/\b\d{2},\d{3}\s+(store\s+)?products\b/i.test(src), false, 'no other hardcoded "NN,NNN products" claim');
});

test('[invariant] the Check page says "store products" with neutral wording first and the real count once the list has loaded', async () => {
  const h = await openClay(browser, srv.base, { noClaude: true });
  try {
    await h.page.evaluate(() => { S.page = 'check'; render(); });
    const intro = () => h.page.evaluate(() => [...document.querySelectorAll('#main p.muted')].map((p) => p.textContent).find((t) => /store products/.test(t)) || '');
    const first = await intro();
    assert.match(first, /^Search (?:[\d,]+ )?store products or paste an ingredient list/);
    // load the real list from the repo (served locally) and re-render
    const rows = await h.page.evaluate(async () => { const d = await pdbLoad(); render(); return d ? d.rows.length : 0; });
    const meta = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'index/clay/products/meta.json'), 'utf8'));
    assert.ok(rows > 0, 'the product list loads from the local index');
    assert.equal(rows, meta.products, 'the page count equals the index metadata');
    assert.equal(await intro(), `Search ${rows.toLocaleString()} store products or paste an ingredient list to see what actually does the work, how well it's proven for each goal, what's marketing, and cheaper matches.`);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('[invariant] while the product list loads the hint is neutral (no figure), and if it cannot be reached the paste route is offered', async () => {
  const h = await openClay(browser, srv.base, { noClaude: true });
  try {
    const hint = (state) => h.page.evaluate((st) => {
      S.page = 'check'; S.cp = { ...(S.cp || {}), qa: 'serum' }; render();
      PDB.names = null; PDB.err = st.err; PDB.loading = st.err ? null : Promise.resolve(null);
      pdbHits('a');
      const box = document.getElementById('cpHitsa');
      return box ? box.textContent : null;
    }, state);
    const loading = await hint({ err: false });
    assert.match(loading, /Loading the product list/);
    assert.doesNotMatch(loading, /\d{1,3},\d{3}/, 'no figure in the loading hint');
    const failed = await hint({ err: true });
    assert.match(failed, /Couldn't reach the product database\. Paste the list instead\./);
  } finally { await h.close(); }
});

// ---- 6. responsive layouts -----------------------------------------------------------------------------------------
const WIDTHS = [[320, 640], [375, 812], [390, 844], [430, 932], [1280, 900]];
const LONG = 'Synthetic-' + 'long-unbroken-name-'.repeat(6);
const RESP_SHELF = [
  { ...clone(SOURCED), id: 51, n: LONG, brand: 'Example Brand With A Fairly Long Name Indeed', identity_source_url: 'https://example.test/' + 'long-path-segment/'.repeat(8), directions_source_url: 'https://example.test/' + 'directions-segment/'.repeat(8) },
  { id: 52, a: 'face', st: 'Serum', n: 'Synthetic retinol serum', s: 'cur', inci: 'Aqua, Retinol 0.3%, Squalane' },
  { id: 53, a: 'face', st: 'Moisturizer', n: 'Synthetic barrier cream', s: 'cur', inci: 'Aqua, Glycerin, Ceramide NP' },
  { id: 54, a: 'hair', st: 'Shampoo', n: 'Synthetic shampoo', s: 'cur' },
  { id: 55, a: 'body', st: 'Wash or soap', n: 'Synthetic body wash', s: 'have' },
];

for (const [w, hgt] of WIDTHS) {
  test(`[invariant] every section and the Check page fit ${w}px wide with no horizontal overflow or script errors`, async () => {
    const h = await openClay(browser, srv.base, { noClaude: true, viewport: { width: w, height: hgt }, local: { 'clay-products': clone(RESP_SHELF) } });
    try {
      const overflow = () => h.page.evaluate(() => ({
        viewport: document.documentElement.clientWidth, doc: document.documentElement.scrollWidth,
        main: document.querySelector('#main').scrollWidth, mainClient: document.querySelector('#main').clientWidth,
      }));
      const ids = await h.page.$$eval('#nav button', (bs) => bs.map((b) => b.dataset.v));
      for (const id of ids) {
        await h.page.evaluate((v) => document.querySelector(`#nav button[data-v="${v}"]`).click(), id);
        await sleep(120);
        const o = await overflow();
        assert.ok(o.doc <= o.viewport + 1, `${id} @${w}: document overflows ${JSON.stringify(o)}`);
        assert.ok(o.main <= o.mainClient + 1, `${id} @${w}: main overflows ${JSON.stringify(o)}`);
      }
      // the Check page with a product open, and in compare mode
      await h.page.evaluate(() => { S.page = 'check'; S.cpMode = 'two'; render(); });
      await act(h, 'cpopen', '51');
      await sleep(150);
      const o = await overflow();
      assert.ok(o.doc <= o.viewport + 1, `check(compare) @${w}: document overflows ${JSON.stringify(o)}`);
      assert.ok(o.main <= o.mainClient + 1, `check(compare) @${w}: main overflows ${JSON.stringify(o)}`);
      assert.deepEqual(h.errors, []);
    } catch (e) {
      await h.shot(`rc-responsive-${w}-failure`).catch(() => {});
      throw e;
    } finally { await h.close(); }
  });
}
