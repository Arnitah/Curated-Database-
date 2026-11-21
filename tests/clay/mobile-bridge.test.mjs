// Mobile-width checks for the connected Clay ingredient intelligence surfaces.
// All shelf records are synthetic fixtures; no personal product data is used.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openClay } from './helpers/launch.mjs';
import { startServer } from './helpers/server.mjs';

let browser, server;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser.close(); await server.close(); });

const shelf = [
  { id: 901, a: 'face', st: 'Toner', n: 'Synthetic acid toner', s: 'cur', inci: 'Aqua, Glycolic Acid (7%), Glycerin', directions_text: 'Use sunscreen during use and for one week afterwards.', directions_source: 'manufacturer', directions_source_url: 'https://example.test/acid-directions', directions_checked_at: '2026-11-21', product_variant: '7% toner', market: 'Canada', identity_source_url: 'https://example.test/acid-product' },
  { id: 902, a: 'face', st: 'Serum', n: 'Synthetic retinol serum', s: 'cur', inci: 'Aqua, Retinol 0.3%, Squalane' },
  { id: 903, a: 'face', st: 'Moisturizer', n: 'Synthetic barrier cream', s: 'cur', inci: 'Aqua, Glycerin, Ceramide NP' },
];

async function assertNoPageOverflow(page, label) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    main: document.querySelector('#main')?.scrollWidth || 0,
    mainClient: document.querySelector('#main')?.clientWidth || 0,
  }));
  assert.ok(sizes.document <= sizes.viewport + 1, label + ': document has horizontal overflow ' + JSON.stringify(sizes));
  assert.ok(sizes.main <= sizes.mainClient + 1, label + ': main content has horizontal overflow ' + JSON.stringify(sizes));
}

test('[mobile] Scan, Learn, My Shelf and Routine fit a 390px viewport and share shelf intelligence', async () => {
  const h = await openClay(browser, server.base, { viewport: { width: 390, height: 844 }, noClaude: true, local: { 'clay-products': shelf } });
  try {
    const page = h.page;

    await page.locator('#nav button[data-v="scan"]').click();
    await page.getByRole('heading', { name: 'Example readings' }).waitFor();
    await page.getByRole('heading', { name: 'Your product context (separate from the scan)' }).waitFor();
    const scanResults = await page.locator('#main').innerText();
    assert.match(scanResults, /not yet analyse images/i);
    assert.match(scanResults, /not been checked against packaging\. Treat any findings as preliminary until verified/i, 'Scan discloses unverified ingredient lists');
    assert.match(scanResults, /Review example suggestions/);
    assert.match(scanResults, /Product-specific instructions come first/);
    assert.match(scanResults, /Use sunscreen during use and for one week afterwards/);
    assert.match(scanResults, /General screen/);
    assert.doesNotMatch(scanResults, /\bApply\b/, 'the progress step no longer promises an apply action');
    const scanRail = await page.locator('.rail').innerText();
    assert.match(scanRail, /Prototype status/);
    assert.doesNotMatch(scanRail, /camera guides light|reads six things|quiz offers an optional first scan|Clay reminds you/i, 'unimplemented scanner capabilities are not presented as available');
    await assertNoPageOverflow(page, 'Scan results');

    await page.locator('#nav button[data-v="learn"]').click();
    await page.getByRole('heading', { name: 'Your shelf ingredients' }).waitFor();
    assert.match(await page.locator('#main').innerText(), /starter registry/i);
    assert.match(await page.locator('#main').innerText(), /does not interpret them/i);
    await assertNoPageOverflow(page, 'Learn');

    await page.locator('#nav button[data-v="shelf"]').click();
    await page.getByRole('heading', { name: 'Ingredient intelligence' }).waitFor();
    assert.match(await page.locator('#main').innerText(), /Product-specific instructions come first/);
    assert.match(await page.locator('#main').innerText(), /Use sunscreen during use and for one week afterwards/);
    await assertNoPageOverflow(page, 'My Shelf');

    await page.locator('#nav button[data-v="routine"]').click();
    await page.getByRole('heading', { name: 'Ingredient intelligence' }).waitFor();
    assert.match(await page.locator('#main').innerText(), /Product-specific instructions come first/);
    assert.match(await page.locator('#main').innerText(), /Use sunscreen during use and for one week afterwards/);
    await assertNoPageOverflow(page, 'Routine');

    await page.locator('#nav button[data-v="scan"]').click();
    await page.getByRole('button', { name: 'Review example suggestions' }).click();
    await page.getByRole('button', { name: 'Open Routine to review' }).waitFor();
    assert.match(await page.locator('#main').innerText(), /No product, schedule or routine changes are made/i);
    await assertNoPageOverflow(page, 'Scan apply/review');

    await page.locator('#nav button[data-v="scan"]').click();
    await page.locator('[data-act="scanStep"][data-v="take"]').click();
    await page.getByRole('heading', { name: 'Choose a photo (preview only)' }).waitFor();
    const photoStep = await page.locator('#main').innerText();
    assert.match(photoStep, /does not upload or analyse the selected photo/i);
    await page.getByRole('button', { name: 'Continue to demo results' }).waitFor();
    assert.doesNotMatch(photoStep, /Analyze photo/i, 'the CTA does not imply image analysis');
    await page.getByRole('button', { name: 'Use demo placeholder' }).click();
    await page.locator('#consent').check();
    await page.getByRole('button', { name: 'Continue to demo results' }).click();
    await page.getByRole('heading', { name: 'Example readings' }).waitFor();
    await assertNoPageOverflow(page, 'Scan photo-preview step');
    assert.deepEqual(h.errors, [], 'no browser runtime errors');
  } finally {
    await h.close();
  }
});
