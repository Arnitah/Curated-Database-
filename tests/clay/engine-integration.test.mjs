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
const verified = (p) => ({ ...p, ingredient_list_verified: true });

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
      pairs.push(ClayII.engine.evaluateProductPair({ ...P[i], ingredient_list_verified: true }, { ...P[j], ingredient_list_verified: true }));
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
  assert.equal(await h.page.getByText('Use with care').count(), 1, 'My Shelf shows the engine finding');
  assert.match(await h.page.locator('text=checked against packaging').first().textContent().catch(() => ''), /checked against packaging/i);

  await h.page.locator('#nav button[data-v="routine"]').click();
  await h.page.getByRole('heading', { name: 'Ingredient intelligence' }).waitFor();
  assert.equal(await h.page.getByText('Use with care').count(), 1, 'Routine consumes the same engine result');

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
