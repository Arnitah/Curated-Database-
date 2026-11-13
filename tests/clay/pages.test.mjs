// Every section renders at phone, tablet and desktop widths without script errors.
// Screenshots are taken only if a check fails, only of synthetic/public-seed data, and only into test-results/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.mjs';
import { launchBrowser, openClay, sleep } from './helpers/launch.mjs';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser.close(); await srv.close(); });

const VIEWPORTS = [['phone', 390, 844], ['tablet', 768, 1024], ['desktop', 1280, 900]];

for (const [name, width, height] of VIEWPORTS) {
  test(`[invariant] all nine sections render with no script errors at ${name} (${width}px)`, async () => {
    const h = await openClay(browser, srv.base, { viewport: { width, height } });
    await h.settled();
    const ids = await h.page.$$eval('#nav button', (bs) => bs.map((b) => b.dataset.v));
    assert.equal(ids.length, 9);
    try {
      for (const id of ids) {
        await h.page.evaluate((v) => document.querySelector(`#nav button[data-v="${v}"]`).click(), id);
        await sleep(120);
        const len = await h.page.evaluate(() => document.querySelector('#main').innerText.trim().length);
        assert.ok(len > 20, `section ${id} rendered no content`);
      }
      assert.deepEqual(h.errors, []);
    } catch (e) {
      await h.shot(`pages-${name}-failure`).catch(() => {});
      throw e;
    } finally { await h.close(); }
  });
}

test('[current-behaviour] Scan is a prototype: analysing sends nothing anywhere and writes nothing', async () => {
  const h = await openClay(browser, srv.base);
  await h.settled();
  await h.page.evaluate(() => document.querySelector('#nav button[data-v="scan"]').click());
  await sleep(200);
  const before = (await h.log()).writes.length;
  const clicked = await h.page.evaluate(() => { S.scanStep = 'take'; S.photo = true; S.consent = true; render(); const b = document.querySelector('[data-act="analyze"]'); if (b) b.click(); return !!b; });
  await sleep(300);
  assert.ok(clicked, 'analyze button is present on the Scan page');
  assert.equal(await h.page.evaluate(() => S.scanStep), 'results', 'only the view switches');
  assert.equal((await h.log()).writes.length, before);
  assert.deepEqual([...new Set(h.blocked)].filter((x) => !x.startsWith('fonts.g')), []);
  assert.deepEqual(h.errors, []);
  await h.close();
});
