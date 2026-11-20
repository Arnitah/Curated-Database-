// Synthetic-data audit of the hosted Clay preview, beyond the starter shelf: every hard-coded example block
// across the nine sections is registered, classified, and (when invented) visibly labelled where it shows.
// Registry: apps/clay-hosted/example-data-audit.json. Built into a temp folder; nothing is deployed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/launch.mjs';
import { buildToTemp, startHostedServer, openHosted, appScript, topLevelBlocks, brandRegex, runSteps } from './helpers/hosted.mjs';
import { REPO_ROOT } from './helpers/server.mjs';

const audit = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'apps', 'clay-hosted', 'example-data-audit.json'), 'utf8'));
const CLASSES = Object.keys(audit.classes);
const DENY = brandRegex(audit.deny_brands);

let built, srv, browser, html, blocks;
before(async () => {
  built = buildToTemp();
  html = fs.readFileSync(path.join(built.out, 'index.html'), 'utf8');
  blocks = topLevelBlocks(html);
  srv = await startHostedServer(built.out);
  browser = await launchBrowser();
});
after(async () => { await browser.close(); await srv.close(); built.cleanup(); });

test('[invariant] the audit registry is well formed: known classes, and every invented entry names a view, a sample line and a label', () => {
  for (const [n, e] of [...Object.entries(audit.entries), ...Object.entries(audit.functions)]) {
    assert.ok(CLASSES.includes(e.class), `${n}: unknown class ${e.class}`);
    assert.ok(e.where, `${n}: where`);
    if (e.class === 'illustrative-invented') {
      assert.ok(Array.isArray(e.views) && e.views.length, `${n}: invented content needs at least one view that shows its label`);
      for (const v of e.views) assert.ok(v.steps.length && v.contains && v.label, `${n}: incomplete view`);
    }
    if (e.class === 'reference-real') assert.ok(e.note, `${n}: real-world reference content needs a note`);
  }
});

test('[invariant] coverage: every top-level example/data block in the hosted page is registered, and every registered name exists', () => {
  const big = Object.entries(blocks).filter(([, t]) => t.length >= 120).map(([n]) => n);
  const missing = big.filter((n) => !(n in audit.entries));
  assert.deepEqual(missing, [], 'unregistered data blocks (classify them in example-data-audit.json): ' + missing.join(', '));
  for (const n of Object.keys(audit.entries)) assert.ok(n in blocks, `registry lists ${n} but the hosted page has no such declaration`);
  for (const n of Object.keys(audit.functions)) assert.match(appScript(html), new RegExp(`function ${n}\\(`), `registry lists function ${n} but it is missing`);
});

test('[invariant] unreferenced sample blocks are emptied in the hosted page and never called', () => {
  for (const [n, e] of Object.entries(audit.entries).filter(([, e]) => e.class === 'unreferenced')) {
    assert.ok(blocks[n].length < 120, `${n} should be emptied`);
    assert.match(blocks[n], /=\s*(\[\]|\{\});/);
  }
  assert.equal((html.match(/\bshelfViz\(/g) || []).length, 1, 'shelfViz is only declared, never called');
  for (const gone of ['Gentle Gel Cleanser', 'Yuja Honey Cream']) assert.ok(!html.includes(gone), `${gone} should not ship`);
});

test('[invariant] no real brand appears in any block classed as invented, generic or config; the detector does fire on the real-reference blocks', () => {
  for (const [n, e] of Object.entries(audit.entries)) {
    const hit = DENY.exec(blocks[n] || '');
    if (e.class === 'reference-real') continue;
    assert.equal(hit, null, `${n} (${e.class}) names a real brand: ${hit && hit[0]}`);
  }
  for (const n of ['CM', 'CM_WASH', 'TRIP_HOME', 'SA']) assert.ok(DENY.test(blocks[n]), `control: the brand detector should flag ${n}`);
});

test('[invariant] hard-coded claims about the user are gone: no "you own", no fabricated scan date', () => {
  for (const s of ["you own both", "you own one", "From your Oct 13 scan", "Combination · barrier recovering"]) assert.ok(!html.includes(s), `still present: ${s}`);
  assert.match(html, /Sample profile \(demo\)/);
});

test('[invariant] the banner stays accurate after a user edits the demo, and says nothing about all entries being synthetic', async () => {
  const h = await openHosted(browser, srv.base);
  const text = (b) => h.page.$eval('#demo-banner', (e) => e.textContent);
  const expected = 'Demo preview · starts with synthetic sample data · your changes stay in this browser';
  assert.equal(await text(), expected);
  assert.ok(!/\b(every|all)\b/i.test(expected));
  await h.page.evaluate(() => document.querySelector('#nav button[data-v="shelf"]').click());
  await h.page.waitForTimeout(200);
  await h.page.evaluate(() => { document.querySelector('#mpName').value = 'My own real product'; document.querySelector('[data-act="mpadd"]').click(); });
  assert.ok((await h.mp()).some((r) => r.n === 'My own real product'), 'user content is accepted');
  assert.equal(await text(), expected, 'banner wording still true with user content present');
  await h.page.evaluate(() => document.querySelector('#nav button[data-v="shelf"]').click());
  await h.page.waitForTimeout(200);
  const main = await h.page.$eval('#main', (m) => m.innerText);
  assert.match(main, /this shelf starts with invented sample data\. Anything you add or change is saved only in this browser/);
  assert.ok(!/everything here is invented/i.test(main));
  await h.close();
});

test('[invariant] every invented example shows a visible label where it appears (views from the registry)', async () => {
  const h = await openHosted(browser, srv.base);
  const all = [...Object.entries(audit.entries), ...Object.entries(audit.functions)].filter(([, e]) => e.class === 'illustrative-invented');
  assert.ok(all.length >= 12);
  for (const [name, e] of all) for (const v of e.views) {
    const text = await runSteps(h.page, v.steps);
    assert.ok(text.includes(v.contains), `${name}: expected sample text not on screen: ${v.contains}`);
    assert.match(text, new RegExp(v.label, 'i'), `${name}: shown without its label (${v.label})`);
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

test('[invariant] seasonal pairings are labelled sample data in all four seasons and name no real brand', async () => {
  const h = await openHosted(browser, srv.base);
  for (const season of ['spring', 'summer', 'fall', 'winter']) {
    const text = await runSteps(h.page, [['nav', 'Pairs & scent'], ['act', 'season', season]]);
    assert.match(text, /Sample data/, season);
    assert.match(text, /sample pairing/, season);
    assert.ok(!DENY.test(text), `${season} pairings name a real brand`);
  }
  await h.close();
});

test('[invariant] no real brand or product reaches the default view of any section (reference-only views are separate and documented)', async () => {
  const h = await openHosted(browser, srv.base);
  const views = [
    [['nav', 'Today']], [['nav', 'Routine']], [['nav', 'Your year']], [['nav', 'My Shelf']], [['nav', 'Discover']], [['nav', 'Discover'], ['act', 'ing', 'niacinamide']],
    [['nav', 'Pairs & scent']], [['nav', 'Learn']], [['nav', 'Travel']], [['nav', 'Scan']], [['nav', 'Scan'], ['act', 'scanStep', 'take']], [['nav', 'Scan'], ['act', 'scanStep', 'apply']],
  ];
  for (const steps of views) {
    const text = await runSteps(h.page, steps);
    const hit = DENY.exec(text);
    assert.equal(hit, null, `${JSON.stringify(steps)} shows a real brand: ${hit && hit[0]}`);
  }
  await h.close();
});
