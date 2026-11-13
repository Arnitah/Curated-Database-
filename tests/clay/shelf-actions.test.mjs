// Everyday shelf actions keep working and are saved to this device (and, when signed in, queued for sync).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.mjs';
import { launchBrowser, openClay, sleep, rec } from './helpers/launch.mjs';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser.close(); await srv.close(); });

// Fires the app's own delegated action (same code path as a tap) from a throwaway button, so the test does not depend on which card is expanded.
const act = (h, a, v) => h.page.evaluate(([x, y]) => { const b = document.createElement('button'); b.dataset.act = x; b.dataset.v = y; document.body.appendChild(b); b.click(); b.remove(); }, [a, v]);

const start = async () => {
  const h = await openClay(browser, srv.base, { noClaude: true, local: { 'clay-products': [rec(1, 'face', 'Cleanser', 'Synthetic cleanser', 'cur'), rec(2, 'face', 'Toner', 'Synthetic toner', 'have')] } });
  await h.page.evaluate(() => document.querySelector('#nav button[data-v="shelf"]').click());
  await sleep(200);
  return h;
};

test('[invariant] adding a product saves a well-formed record with a new unique id', async () => {
  const h = await start();
  const before = await h.mp();
  await h.page.evaluate(() => { document.querySelector('#mpName').value = 'Synthetic new serum'; document.querySelector('[data-act="mpadd"]').click(); });
  const mp = await h.mp();
  const added = mp.find((r) => r.n === 'Synthetic new serum');
  assert.ok(added);
  assert.deepEqual(Object.keys(added).sort(), ['a', 'id', 'n', 's', 'st']);
  assert.ok(!before.some((r) => r.id === added.id));
  assert.deepEqual(await h.lsJson('clay-products'), mp, 'saved on this device');
  await h.close();
});

test('[invariant] changing status keeps the record and saves it', async () => {
  const h = await start();
  await act(h, 'mpset', '1:past');
  assert.equal((await h.mp()).find((r) => r.id === 1).s, 'past');
  assert.equal((await h.lsJson('clay-products')).find((r) => r.id === 1).s, 'past');
  assert.equal((await h.mp()).length > 2, true);
  await h.close();
});

test('[invariant] renaming changes only the name', async () => {
  const h = await start();
  const before = (await h.mp()).find((r) => r.id === 2);
  await act(h, 'mpedit', '2');
  await h.page.evaluate(() => { if (!document.querySelector('#mpRen')) { const i = document.createElement('input'); i.id = 'mpRen'; document.body.appendChild(i); } document.querySelector('#mpRen').value = 'Synthetic renamed toner'; });
  await act(h, 'mpsave', '2');
  const after = (await h.mp()).find((r) => r.id === 2);
  assert.equal(after.n, 'Synthetic renamed toner');
  assert.deepEqual({ ...after, n: before.n }, before);
  await h.close();
});

test('[invariant] removing one product removes only that product', async () => {
  const h = await start();
  const before = await h.mp();
  await act(h, 'mpdel', '1');
  const mp = await h.mp();
  assert.equal(mp.length, before.length - 1);
  assert.ok(!mp.some((r) => r.id === 1));
  assert.ok(mp.some((r) => r.id === 2));
  await h.close();
});
