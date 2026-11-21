// The ingredient engine as the Clay page uses it. The engine itself is not changed here.
// (The engine's own suites, smoke.test.mjs and clay-shaped.test.mjs, run in the same CI job via `npm run test:engine`.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, REPO_ROOT } from './helpers/server.mjs';
import { launchBrowser, openClay } from './helpers/launch.mjs';
import { createEngine } from '../../apps/ingredient-intelligence/src/engine.js';
import { toEngineProduct } from '../../apps/ingredient-intelligence/src/clay-adapter.js';

const D = (f) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'apps/ingredient-intelligence/data', f), 'utf8'));
const E = createEngine({ ingredients: D('ingredients.json'), rules: D('pairing-rules.json'), sources: D('sources.json') });

// Invented Clay-shaped records. No personal shelf data.
const R = (id, st, n, inci, s = 'cur', a = 'face') => ({ id, a, st, n, s, ...(inci ? { inci } : {}) });
const RECS = [
  R(1, 'Toner', 'Synthetic acid toner', 'Glycolic Acid (7%)'),
  R(2, 'Serum', 'Synthetic retinol serum', 'Retinol 0.3%'),
  R(3, 'Moisturizer', 'Synthetic cream', 'Ceramide NP'),
  R(4, 'Serum', 'Synthetic hydrating serum', 'Sodium Hyaluronate, Panthenol'),
  R(5, 'Cleanser', 'Synthetic cleanser without a list'),
  R(6, 'Serum', 'Synthetic mystery serum', 'Aqua, Foo Bar Complex, Glycolic Acid'),
  R(7, 'Toner', 'Synthetic finished toner', 'Retinol', 'past'),
  R(8, 'Serum', 'Synthetic wishlist serum', 'Retinol', 'next'),
  R(9, 'Other', 'Synthetic deodorant', 'Aqua', 'cur', 'under'),
  R(10, 'Wash', 'Synthetic intimate wash', 'Aqua', 'cur', 'intimate'),
  R(11, 'Treatment', 'Synthetic BHA liquid', 'Salicylic Acid, Niacinamide'),
];
const verified = (p) => ({ ...p, ingredient_list_verified: true, ingredient_list_completeness: 'complete' });

let srv, browser;
before(async () => { srv = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser.close(); await srv.close(); });

test('[invariant] the engine inside the page gives the same answers as the engine source, for every pair and the whole routine', async () => {
  const h = await openClay(browser, srv.base, { noClaude: true });
  const inPage = await h.page.evaluate((recs) => {
    const P = recs.map((r) => ClayII.toEngineProduct(r));
    const pairs = [];
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      pairs.push(ClayII.engine.evaluateProductPair(P[i], P[j]));
      const checked = (p) => ({ ...p, ingredient_list_verified: true, ingredient_list_completeness: 'complete' });
      pairs.push(ClayII.engine.evaluateProductPair(checked(P[i]), checked(P[j])));
    }
    return { P, pairs, routine: ClayII.engine.evaluateRoutine(P) };
  }, RECS);
  const P = RECS.map((r) => toEngineProduct(r));
  const pairs = [];
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    pairs.push(E.evaluateProductPair(P[i], P[j]));
    pairs.push(E.evaluateProductPair(verified(P[i]), verified(P[j])));
  }
  assert.deepEqual(JSON.parse(JSON.stringify(inPage.P)), JSON.parse(JSON.stringify(P)));
  assert.deepEqual(JSON.parse(JSON.stringify(inPage.pairs)), JSON.parse(JSON.stringify(pairs)));
  assert.deepEqual(JSON.parse(JSON.stringify(inPage.routine)), JSON.parse(JSON.stringify(E.evaluateRoutine(P))));
  await h.close();
});

test('[invariant] the adapter keeps what Clay knows and invents nothing: lists are unverified, brand and directions are empty', () => {
  for (const r of RECS) {
    const p = toEngineProduct(r);
    assert.equal(p.ingredient_list_verified, false);
    assert.equal(p.brand, null);
    assert.equal(p.directions_text, null);
    assert.equal(p.name, r.n);
    assert.equal(p.ingredient_list_source, r.inci ? 'user_entered' : 'unknown');
  }
});

test('[invariant] product identity and directions provenance pass through without being inferred', () => {
  const source = {
    ...R(21, 'Toner', 'Synthetic sourced toner', 'Aqua, Glycolic Acid'),
    brand: 'Example Brand',
    product_variant: 'Glycolic Toner 7%, 100 ml',
    market: 'Canada',
    identity_source: 'manufacturer',
    identity_source_url: 'https://example.test/product',
    identity_checked_at: '2026-11-21',
    directions_text: 'Do not use with other direct acids in the same routine.',
    directions_source: 'manufacturer',
    directions_source_url: 'https://example.test/directions',
    directions_checked_at: '2026-11-21',
  };
  const p = toEngineProduct(source);
  assert.equal(p.brand, 'Example Brand');
  assert.equal(p.product_variant, source.product_variant);
  assert.equal(p.market, 'Canada');
  assert.equal(p.identity_source, 'manufacturer');
  assert.equal(p.identity_source_url, source.identity_source_url);
  assert.equal(p.identity_checked_at, '2026-11-21');
  assert.equal(p.directions_text, source.directions_text);
  assert.equal(p.directions_source, 'manufacturer');
  assert.equal(p.directions_source_url, source.directions_source_url);
  assert.equal(p.directions_checked_at, '2026-11-21');
  assert.deepEqual(p.clay_record, source, 'the original Clay record remains intact');
});

test('[invariant] status mapping: using, owned-not-using and finished map across; a wishlist item is never treated as in use', () => {
  assert.equal(toEngineProduct(RECS[0]).status, 'in_use');
  assert.equal(toEngineProduct(R(20, 'Toner', 'Synthetic', null, 'have')).status, 'owned_not_using');
  assert.equal(toEngineProduct(RECS[6]).status, 'finished');
  assert.notEqual(toEngineProduct(RECS[7]).status, 'in_use');
});

test('[current-behaviour] underarm and intimate records have no engine area yet (mapped to "unknown" with a note)', () => {
  assert.equal(toEngineProduct(RECS[8]).area, 'unknown');
  assert.equal(toEngineProduct(RECS[9]).area, 'unknown');
});

test('[invariant] a missing list, or no matching rule, gives "insufficient_data"; an unrecognised ingredient is never read as complementary', () => {
  const none = toEngineProduct(RECS[4]);
  assert.equal(E.evaluateProductPair({ ...none, status: 'in_use' }, toEngineProduct(RECS[0])).classification, 'insufficient_data');
  const bha = RECS.find((r) => r.n === 'Synthetic BHA liquid');
  assert.equal(E.evaluateProductPair(toEngineProduct(bha), toEngineProduct(RECS[3])).classification, 'insufficient_data');
  const r = E.evaluateProductPair(verified(toEngineProduct(RECS[5])), verified(toEngineProduct(RECS[2])));
  assert.notEqual(r.classification, 'complementary');
});

test('[invariant] two unverified lists never receive a full-product classification or confidence', () => {
  const r = E.evaluateProductPair(toEngineProduct(RECS[2]), toEngineProduct(RECS[3]));
  assert.equal(r.classification, 'insufficient_data');
  assert.equal(r.confidence, 'unknown');
  assert.equal(r.candidate_classification, 'complementary');
  assert.ok(r.limitations.length > 0);
});

test('[invariant] an explicitly partial list blocks a full-product verdict even if it was otherwise marked verified', () => {
  const a = { ...toEngineProduct(RECS[0]), ingredient_list_verified: true, ingredient_list_completeness: 'partial' };
  const b = { ...toEngineProduct(RECS[1]), ingredient_list_verified: true, ingredient_list_completeness: 'complete' };
  const r = E.evaluateProductPair(a, b);
  assert.equal(r.classification, 'insufficient_data');
  assert.equal(r.candidate_classification, 'use_with_care');
  assert.ok(r.missing_data.includes('complete ingredient list'));
});

test('[current-behaviour] golden verdicts for the shipped rules on invented products', () => {
  const v = (a, b) => E.evaluateProductPair(verified(toEngineProduct(a)), verified(toEngineProduct(b)));
  assert.equal(v(RECS[0], RECS[1]).classification, 'use_with_care');   // acid + retinoid
  assert.equal(v(RECS[2], RECS[3]).classification, 'complementary');   // ceramide + hyaluronic
});

test('[invariant] a finished product is not part of the active routine check', () => {
  const routine = E.evaluateRoutine([RECS[0], RECS[6]].map((r) => toEngineProduct(r)));
  assert.equal(JSON.stringify(routine).includes('Synthetic finished toner'), false);
});


test('[integration] My Shelf and Routine use the live shelf records; packaging verification is explicit and resets after edits', async () => {
  const shelf = [
    R(101, 'Toner', 'Synthetic shelf acid toner', 'Aqua, Glycolic Acid (7%), Glycerin'),
    R(102, 'Serum', 'Synthetic shelf retinol serum', 'Aqua, Retinol 0.3%, Squalane'),
  ];
  const h = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': shelf } });
  const act = (a, v) => h.page.evaluate(([x, y]) => {
    const b = document.createElement('button');
    b.dataset.act = x; b.dataset.v = y; document.body.appendChild(b); b.click(); b.remove();
  }, [a, v]);

  await h.page.locator('#nav button[data-v="shelf"]').click();
  await h.page.getByRole('heading', { name: 'Ingredient intelligence' }).waitFor();
  assert.equal(await h.page.getByText('Need product details').count(), 1, 'My Shelf withholds a full-product verdict while either list is unverified');
  assert.match(await h.page.locator('text=checked against packaging').first().textContent().catch(() => ''), /checked against packaging/i);

  await h.page.locator('#nav button[data-v="routine"]').click();
  await h.page.getByRole('heading', { name: 'Ingredient intelligence' }).waitFor();
  assert.equal(await h.page.getByText('Need product details').count(), 1, 'Routine consumes the same guarded engine result');

  await act('cpopen', '101');
  const verify = h.page.locator('[data-iiverify="101"]');
  await verify.waitFor();
  await verify.check();
  assert.equal((await h.mp()).find(p => p.id === 101).inci_verified, true, 'explicit packaging confirmation is saved');

  await h.page.locator('[data-cpl="a"]').fill('Aqua, Glycolic Acid (7%), Glycerin, Panthenol');
  await h.page.locator('[data-act="cpgo"]').click();
  await h.page.locator('[data-act="cpsave"][data-v="a"]').click();
  const updated = (await h.mp()).find(p => p.id === 101);
  assert.equal(updated.inci_verified, false, 'editing the ingredient list clears the previous verification');
  assert.equal(updated.inci, 'Aqua, Glycolic Acid (7%), Glycerin, Panthenol');
  assert.deepEqual(h.errors, [], 'no browser runtime errors');
  await h.close();
});

test('[integration] product-specific directions and provenance are saved and displayed ahead of generic ingredient screening', async () => {
  const shelf = [
    {
      ...R(201, 'Toner', 'Synthetic sourced acid toner', 'Aqua, Glycolic Acid (7%), Glycerin'),
      inci_verified: true, inci_complete: true,
      brand: 'Example Brand',
      product_variant: '7% Glycolic Toner, 100 ml',
      market: 'Canada',
      identity_source: 'manufacturer',
      identity_source_url: 'https://example.test/acid-product',
      identity_checked_at: '2026-11-21',
      directions_text: 'Do not use with strong retinoids in the same routine.',
      directions_source: 'manufacturer',
      directions_source_url: 'https://example.test/acid-directions',
      directions_checked_at: '2026-11-21',
    },
    { ...R(202, 'Serum', 'Synthetic retinol serum', 'Aqua, Retinol 0.3%, Squalane'), inci_verified: true, inci_complete: true },
  ];
  const h = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': shelf } });
  try {
    const page = h.page;
    await page.locator('#nav button[data-v="shelf"]').click();
    await page.getByRole('heading', { name: 'Ingredient intelligence' }).waitFor();
    let text = await page.locator('#main').innerText();
    assert.match(text, /Product-specific instructions come first/);
    assert.match(text, /Do not use with strong retinoids in the same routine\./);
    assert.match(text, /Manufacturer directions not on file for: Synthetic retinol serum/);
    assert.ok(text.indexOf('Product-specific instructions come first') < text.indexOf('General screen · Use with care'), 'manufacturer information is shown before generic screening');
    assert.equal(await page.locator('a[href="https://example.test/acid-directions"]').count(), 1);
    assert.equal(await page.locator('a[href="https://example.test/acid-product"]').count(), 1);

    await page.locator('#nav button[data-v="scan"]').click();
    await page.getByRole('heading', { name: 'Example readings' }).waitFor();
    const scanText = await page.locator('#main').innerText();
    assert.match(scanText, /Product-specific instructions come first/);
    assert.match(scanText, /Do not use with strong retinoids in the same routine\./);
    assert.match(scanText, /General screen/);

    await page.locator('#nav button[data-v="shelf"]').click();
    await page.getByRole('heading', { name: 'Ingredient intelligence' }).waitFor();
    await page.locator('[data-act="mpopen"][data-v="202"]').click();
    await page.locator('.mp-ii-details summary').click();
    await page.locator('#iiBrand').fill('Second Example Brand');
    await page.locator('#iiVariant').fill('Retinol 0.3%, 30 ml');
    await page.locator('#iiMarket').fill('Canada');
    await page.locator('#iiIdentitySource').selectOption('manufacturer');
    await page.locator('#iiIdentityUrl').fill('https://example.test/retinol-product');
    await page.locator('#iiIdentityDate').fill('2026-11-21');
    await page.locator('#iiDirections').fill('Use only as directed. Do not combine with other retinoids.');
    await page.locator('#iiDirectionsSource').selectOption('manufacturer');
    await page.locator('#iiDirectionsUrl').fill('https://example.test/retinol-directions');
    await page.locator('#iiDirectionsDate').fill('2026-11-21');
    await page.locator('[data-act="iisave"][data-v="202"]').click();
    const saved = (await h.mp()).find(p => p.id === 202);
    assert.equal(saved.brand, 'Second Example Brand');
    assert.equal(saved.product_variant, 'Retinol 0.3%, 30 ml');
    assert.equal(saved.market, 'Canada');
    assert.equal(saved.identity_source_url, 'https://example.test/retinol-product');
    assert.equal(saved.directions_text, 'Use only as directed. Do not combine with other retinoids.');
    assert.equal(saved.directions_source_url, 'https://example.test/retinol-directions');
    assert.equal(saved.directions_checked_at, '2026-11-21');
    text = await page.locator('#main').innerText();
    assert.match(text, /Use only as directed\. Do not combine with other retinoids\./);
    assert.match(text, /Second Example Brand/);
    assert.deepEqual(h.errors, [], 'no browser runtime errors');
  } finally {
    await h.close();
  }
});
