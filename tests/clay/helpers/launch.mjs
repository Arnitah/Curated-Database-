// Opens apps/clay.html in a fresh, isolated browser context with all outside network blocked.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { platformInit } from './fake-platform.mjs';
import { REPO_ROOT } from './server.mjs';
import { disallowedNames } from './leak-scan.mjs';

export const OUT_DIR = path.join(REPO_ROOT, 'test-results');
export const ALLOWED_BLOCKED_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

export const launchBrowser = () => chromium.launch();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitUntil(fn, timeout = 8000, step = 50) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('timed out waiting for condition');
    await sleep(step);
  }
}

// opts: { base, uid, viewport, local: {storageKey: value}, remote, others, noClaude, noUser, setDelayMs, failSet }
export async function openClay(browser, serverBase, opts = {}) {
  const o = { uid: 'test-user-a', viewport: { width: 1280, height: 900 }, ...opts };
  const ctx = await browser.newContext({ viewport: o.viewport, serviceWorkers: 'block' });
  const blocked = [];
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(serverBase)) return route.continue();
    blocked.push(new URL(u).host);
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  const consoleText = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => consoleText.push(m.text()));
  await page.addInitScript(({ base, local }) => {
    window.CLAY_DATA_BASE = base;
    try {
      if (!sessionStorage.getItem('__seeded')) {
        for (const [k, v] of Object.entries(local || {})) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        sessionStorage.setItem('__seeded', '1');
      }
    } catch (e) {}
  }, { base: serverBase, local: o.local });
  await page.addInitScript(platformInit, { uid: o.uid, noClaude: o.noClaude, noUser: o.noUser, remote: o.remote, others: o.others, setDelayMs: o.setDelayMs, failSet: o.failSet });
  await page.goto(serverBase + 'apps/clay.html');
  await page.waitForSelector('#nav button');
  const h = {
    page, errors, consoleText, blocked,
    log: () => page.evaluate(() => window.__fake.log),
    store: () => page.evaluate(() => window.__fake.store()),
    ls: (k) => page.evaluate((key) => localStorage.getItem(key), k),
    lsJson: async (k) => JSON.parse(await h.ls(k)),
    mp: () => page.evaluate(() => JSON.parse(JSON.stringify(MP))),
    // sign-in handled: the app has read all five documents (or decided it is local-only)
    settled: async () => {
      if (o.noClaude || o.noUser) { await sleep(700); return; }
      await waitUntil(async () => (await h.log()).reads.length >= 5);
      await sleep(250);
    },
    reload: async () => { await page.reload(); await page.waitForSelector('#nav button'); },
    // screenshots are only ever taken of synthetic or public-seed data, and only into test-results/
    shot: async (name) => {
      const seed = await page.evaluate(() => MP_SEED.map((r) => r[2]));
      const bad = disallowedNames(await h.mp(), seed);
      if (bad.length) throw new Error('refusing to screenshot: shelf holds names outside the public seed');
      fs.mkdirSync(OUT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(OUT_DIR, name + '.png') });
    },
    close: () => ctx.close(),
  };
  return h;
}

export const rec = (id, a, st, n, s = 'cur') => ({ id, a, st, n, s });
