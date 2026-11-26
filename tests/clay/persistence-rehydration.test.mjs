// Persistence and rehydration, end to end in a real page, with synthetic data only:
//   legacy shelf data -> change a record through the real on-screen controls -> check what was written to storage ->
//   reload the page -> the record comes back with the change, and everything unrelated is exactly as it was.
// The page runs without the platform (noClaude), so storage here is the device's localStorage, the v1 store the page always writes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.mjs';
import { launchBrowser, openClay, waitUntil } from './helpers/launch.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
let srv, browser;
before(async () => { srv = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser.close(); await srv.close(); });

const LOTION = { id: 3, a: 'body', st: 'Lotion or cream', n: 'Synthetic legacy lotion', s: 'cur', oldRating: 4, legacyNotes: ['kept', 'as-is'], legacy: { nested: { deep: true, list: [1, 2, 3] } } };
const CLEANSER = { id: 1, a: 'face', st: 'Cleanser', n: 'Synthetic legacy cleanser', s: 'cur' };
const TONER = {
  id: 31, a: 'face', st: 'Toner', n: 'Synthetic sourced toner', s: 'cur', inci: 'Glycolic Acid (7%)', inci_verified: true, inci_complete: true, inci_source: 'package_photo',
  brand: 'Example Brand', product_variant: '7% toner, 100 ml', market: 'Canada', identity_source: 'manufacturer', identity_source_url: 'https://example.test/p', identity_checked_at: '2026-11-21',
  directions_text: 'Use at night only.', directions_source: 'manufacturer', directions_source_url: 'https://example.test/d', directions_checked_at: '2026-11-21', oldRating: 5, legacy: { keep: ['me'] },
};
const stored = (h) => h.lsJson('clay-products');
const byId = (list, id) => list.find((r) => r.id === id);

test('[invariant] a legacy record changed through the on-screen controls is written to storage, survives a reload, and nothing unrelated changes', async () => {
  const seed = [clone(LOTION), clone(CLEANSER), clone(TONER)];
  const h = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': clone(seed) } });
  try {
    // 1. starts from synthetic legacy data
    const mine = (list) => list.filter((r) => [1, 3, 31].includes(r.id));
    const seedNames = new Set(await h.page.evaluate(() => MP_SEED.map((r) => r[2])));
    const onlyStarters = (list) => list.filter((r) => ![1, 3, 31].includes(r.id)).every((r) => seedNames.has(r.n));
    assert.deepEqual(mine(await stored(h)).sort((x, y) => x.id - y.id), clone(seed).sort((x, y) => x.id - y.id), 'storage holds exactly the three legacy records before any action');
    assert.ok(onlyStarters(await stored(h)), 'anything else is a public starter item the app adds itself');

    // 2. mutate through the real UI: My Shelf -> Body -> Edit -> star rating, brand (product details), "Used before"
    await h.page.evaluate(() => document.querySelector('#nav button[data-v="shelf"]').click());
    await h.page.locator('[data-act="mpa"][data-v="body"]').click();
    await h.page.locator('[data-act="mpopen"][data-v="3"]').click();

    await h.page.locator('[data-act="mprate"][data-v="3:5"]').click();
    let rec = byId(await stored(h), 3);
    assert.deepEqual(rec, { ...LOTION, r: 5 }, 'step 1: the rating is stored; every legacy field is intact');

    await h.page.locator('details:has(#iiBrand) > summary').click();
    await h.page.locator('#iiBrand').fill('Example Brand');
    await h.page.locator('[data-act="iisave"][data-v="3"]').click();
    rec = byId(await stored(h), 3);
    assert.deepEqual(rec, { ...LOTION, r: 5, brand: 'Example Brand' }, 'step 2: the brand is stored next to the rating');

    await h.page.locator('[data-act="mpset"][data-v="3:past"]').click();
    const EXPECT = { ...LOTION, r: 5, brand: 'Example Brand', s: 'past' };

    // 3. the updated persisted storage
    const afterEdit = await stored(h);
    assert.deepEqual(byId(afterEdit, 3), EXPECT, 'step 3: storage holds the edited record');
    assert.deepEqual(await h.mp(), afterEdit, 'what is stored is exactly what the page holds in memory');
    assert.deepEqual(byId(afterEdit, 1), CLEANSER, 'an untouched original-fields-only record is unchanged in storage');
    assert.deepEqual(byId(afterEdit, 31), TONER, 'an untouched sourced record keeps every field and all provenance in storage');
    assert.ok(onlyStarters(afterEdit), 'the only other records are the public starter items the app adds itself');

    // 4. reload
    await h.reload();

    // 5. rehydrated record retains the mutation
    const afterReload = await h.mp();
    assert.deepEqual(byId(afterReload, 3), EXPECT, 'after reload the record still has the rating, the brand and the new status');
    assert.deepEqual(await stored(h), afterEdit, 'reload does not rewrite or alter stored data');
    // ...and it is what the page shows, not just what it holds
    await h.page.evaluate(() => document.querySelector('#nav button[data-v="shelf"]').click());
    await h.page.locator('[data-act="mpa"][data-v="body"]').click();
    await h.page.locator('details:has([data-act="mpopen"][data-v="3"]) > summary').click(); // "Used before (1)" is collapsed by default
    await h.page.locator('[data-act="mpopen"][data-v="3"]').click();
    assert.equal(await h.page.locator('#iiBrand').inputValue(), 'Example Brand', 'the editor shows the rehydrated brand');
    assert.match(await h.page.locator('#main').innerText(), /Used before \(1\)/, 'the page lists it under "Used before"');

    // 6. unrelated legacy fields remain unchanged
    const r3 = byId(afterReload, 3);
    assert.equal(r3.oldRating, 4);
    assert.deepEqual(r3.legacyNotes, ['kept', 'as-is']);
    assert.deepEqual(r3.legacy, { nested: { deep: true, list: [1, 2, 3] } });
    assert.deepEqual(byId(afterReload, 1), CLEANSER);
    assert.deepEqual(byId(afterReload, 31), TONER);

    // a second reload changes nothing (stable, no drift)
    await h.reload();
    assert.deepEqual(await stored(h), afterEdit);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('[invariant] clearing a verified ingredient list through the Check page is stored and still cleared after a reload, provenance intact', async () => {
  const acid = { ...clone(TONER), inci: 'Glycolic Acid (7%)' };
  const h = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': [clone(acid), clone(LOTION)] } });
  try {
    await h.page.evaluate(() => document.querySelector('#nav button[data-v="shelf"]').click());
    await h.page.evaluate(() => { S.page = 'check'; render(); });
    await h.page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'cpopen'; b.dataset.v = '31'; document.body.appendChild(b); b.click(); b.remove(); });
    // let the Check page finish its own start-up re-render (it re-renders once when the product list has loaded) before typing
    await h.page.evaluate(async () => { await pdbLoad(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
    await h.page.waitForFunction(() => document.querySelector('[data-cpl="a"]') && document.querySelector('[data-cpl="a"]').value === 'Glycolic Acid (7%)'); // the Check page has finished loading the saved list
    // type the new list; if the page's start-up re-render swallowed the keystrokes (seen about once in 100 runs), type again until the page has registered them
    await waitUntil(async () => { await h.page.locator('[data-cpl="a"]').fill('Glycolic Acid (7%), Panthenol'); return (await h.page.evaluate(() => S.cp.la)) === 'Glycolic Acid (7%), Panthenol'; });
    await h.page.locator('[data-act="cpgo"]').click();
    await h.page.locator('[data-act="cpsave"][data-v="a"]').click();
    const expect = { ...acid, inci: 'Glycolic Acid (7%), Panthenol', inci_verified: false };
    assert.deepEqual(byId(await stored(h), 31), expect, 'stored: new list, verification cleared, all other fields and provenance unchanged');
    await h.reload();
    assert.deepEqual(byId(await h.mp(), 31), expect, 'after reload the verification is still cleared');
    assert.deepEqual(byId(await stored(h), 31), expect);
    assert.deepEqual(byId(await h.mp(), 3), LOTION, 'the unrelated legacy record is unchanged');
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
