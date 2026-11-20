// Hosted runtime: the static Cloudflare-Pages-style build of Clay has no Claude artifact runtime, uses only
// synthetic demo data, talks only to its own origin, and still works as a phone-width app.
// Everything is built into a temp folder and served from 127.0.0.1; nothing is deployed or written to the repo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { launchBrowser } from './helpers/launch.mjs';
import { buildToTemp, startHostedServer, openHosted, ALLOWED_BLOCKED_HOSTS } from './helpers/hosted.mjs';
import { REPO_ROOT } from './helpers/server.mjs';
import { COPY_FILES, COPY_DIRS, FORBIDDEN, readOriginalSeedNames, quotedLiteralPresent } from '../../scripts/build-clay-hosted.mjs';

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const SOURCES = ['apps/clay.html', 'apps/clay-web.html'].map((f) => path.join(REPO_ROOT, f));
const sourceHashesBefore = SOURCES.map(sha);

let built, srv, browser, html;
before(async () => {
  built = buildToTemp();
  html = fs.readFileSync(path.join(built.out, 'index.html'), 'utf8');
  srv = await startHostedServer(built.out);
  browser = await launchBrowser();
});
after(async () => { await browser.close(); await srv.close(); built.cleanup(); });

const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]).sort();
const NAV = ['Today', 'Routine', 'Your year', 'My Shelf', 'Travel', 'Discover', 'Pairs & scent', 'Learn', 'Scan'];

test('[invariant] building the hosted page never changes the two existing Clay HTML files', () => {
  assert.deepEqual(SOURCES.map(sha), sourceHashesBefore);
});

test('[invariant] the build is repeatable: two builds give byte-identical output', () => {
  const second = buildToTemp();
  try {
    const a = walk(built.out), b = walk(second.out);
    assert.deepEqual(a, b);
    for (const f of a) assert.equal(sha(path.join(built.out, f)), sha(path.join(second.out, f)), f);
  } finally { second.cleanup(); }
});

test('[invariant] the hosted page has no Claude artifact runtime, account or database dependency', () => {
  for (const re of FORBIDDEN) assert.ok(!re.test(html), `forbidden pattern present: ${re}`);
  assert.ok(!/window\.claude/.test(html));
  // The only remaining mentions of "claude" are a data label and two ordinary links to other published pages.
  const rest = html
    .replaceAll('added_by_claude_pending_review', '')
    .replaceAll('https://claude.ai/artifact/ABqnaz16S2bi1YmyspeEEY', '')
    .replaceAll('https://claude.ai/artifact/YbseUHCnoj4vsYsm3v3Q25', '');
  assert.ok(!/claude/i.test(rest), 'unexpected mention of claude: ' + (rest.match(/.{0,50}claude.{0,50}/i) || [''])[0]);
});

test('[invariant] the hosted page contains no real shelf records and its demo shelf is clearly synthetic', () => {
  const original = readOriginalSeedNames(fs.readFileSync(path.join(REPO_ROOT, 'apps', 'clay.html'), 'utf8'));
  assert.ok(original.length > 50);
  for (const n of original) assert.ok(!quotedLiteralPresent(html, n), 'real seed record left in hosted page: ' + n);
  const i = html.indexOf('const MP_SEED='), j = html.indexOf('];', i);
  const rows = JSON.parse(html.slice(i + 'const MP_SEED='.length, j + 1));
  assert.ok(rows.length >= 10);
  for (const r of rows) assert.ok(r[2].startsWith('Synthetic '), r[2]);
  assert.match(html, /id="demo-banner"/);
  assert.match(html, /name="robots" content="noindex,nofollow"/);
});

test('[invariant] the output folder holds only the page, its config, and the public reference files the page requests', () => {
  const allowed = new Set(['index.html', '_headers', 'robots.txt', 'build-info.json', '.clay-hosted-preview', ...COPY_FILES]);
  const files = walk(built.out);
  for (const f of files) {
    const ok = allowed.has(f) || COPY_DIRS.some((d) => f.startsWith(d + '/') && f.endsWith('.json'));
    assert.ok(ok, 'unexpected file in hosted output: ' + f);
  }
  assert.ok(!files.some((f) => /my_products_seed|users|backup|probe/i.test(f)));
  assert.ok(files.length < 20000, 'Cloudflare Pages allows 20,000 files');
  for (const f of files) assert.ok(fs.statSync(path.join(built.out, f)).size < 25 * 1024 * 1024, 'Pages allows 25 MiB per file: ' + f);
  const info = JSON.parse(fs.readFileSync(path.join(built.out, 'build-info.json'), 'utf8'));
  assert.equal(info.starts_with_synthetic_demo_data, true);
});

test('[invariant] the headers file locks the page to its own origin for network calls', () => {
  const h = srv.headers;
  const csp = h['Content-Security-Policy'];
  assert.match(csp, /connect-src 'self'(;|$)/);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.ok(!/https?:\/\/(?!fonts\.(googleapis|gstatic)\.com)/.test(csp), 'only the font hosts may be named');
  assert.match(h['X-Robots-Tag'], /noindex/);
});

test('[invariant] phone width: boots with no platform, no script errors, no policy violations, all nine sections, synthetic shelf', async () => {
  const h = await openHosted(browser, srv.base);
  await h.page.waitForTimeout(800);
  assert.deepEqual(h.errors, []);
  assert.equal(await h.page.evaluate(() => typeof window.claude), 'undefined');
  assert.deepEqual(await h.page.$$eval('#nav button', (bs) => bs.map((b) => b.textContent.trim())), NAV);
  const mp = await h.mp();
  assert.ok(mp.length >= 10);
  for (const r of mp) assert.ok(r.n.startsWith('Synthetic '), r.n);
  assert.deepEqual(await h.csp(), []);
  assert.deepEqual(h.blocked.filter((x) => !ALLOWED_BLOCKED_HOSTS.includes(x)), [], 'no request to any host but the page origin and the font hosts');
  assert.ok(await h.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll at 390px');
  await h.close();
});

test('[invariant] every section renders, makes no outside request, breaks no policy, and every data file it asks for exists', async () => {
  const h = await openHosted(browser, srv.base);
  for (const label of NAV) {
    await h.page.evaluate((l) => [...document.querySelectorAll('#nav button')].find((b) => b.textContent.trim() === l).click(), label);
    await h.page.waitForTimeout(250);
    assert.ok((await h.page.$eval('#main', (m) => m.textContent.trim().length)) > 40, 'section looks empty: ' + label);
  }
  await h.page.waitForTimeout(500);
  assert.deepEqual(h.errors, []);
  assert.deepEqual(await h.csp(), []);
  assert.deepEqual(h.notFound, [], 'the page asked for files the hosted build does not include');
  assert.deepEqual(h.blocked.filter((x) => !ALLOWED_BLOCKED_HOSTS.includes(x)), []);
  await h.close();
});

test('[invariant] store-product search reads its index from the same origin, never from GitHub', async () => {
  const h = await openHosted(browser, srv.base);
  await h.page.evaluate(() => { const i = document.createElement('input'); i.dataset.cpf = '1'; document.body.appendChild(i); i.focus(); });
  await h.page.waitForTimeout(1500);
  assert.ok(h.seen.includes('/index/clay/products/names.json'), 'product index requested from the page origin');
  assert.deepEqual(h.blocked.filter((x) => !ALLOWED_BLOCKED_HOSTS.includes(x)), []);
  assert.deepEqual(h.notFound, []);
  assert.deepEqual(await h.csp(), []);
  await h.close();
});

test('[invariant] saving works in this browser: a removed product stays removed after a reload, with no account involved', async () => {
  const h = await openHosted(browser, srv.base);
  await h.page.evaluate(() => document.querySelector('#nav button[data-v="shelf"]').click());
  await h.page.waitForTimeout(200);
  const before = await h.mp();
  await h.page.evaluate((id) => { const b = document.createElement('button'); b.dataset.act = 'mpdel'; b.dataset.v = String(id); document.body.appendChild(b); b.click(); b.remove(); }, before[0].id);
  const after = await h.mp();
  assert.equal(after.length, before.length - 1);
  assert.equal(JSON.parse(await h.ls('clay-products')).length, before.length - 1, 'saved to localStorage');
  await h.reload();
  assert.equal((await h.mp()).length, before.length - 1, 'still gone after reload');
  assert.ok(!(await h.mp()).some((r) => !r.n.startsWith('Synthetic ')));
  await h.page.evaluate(() => document.querySelector('#nav button[data-v="shelf"]').click());
  await h.page.waitForTimeout(200);
  assert.match(await h.page.$eval('#main', (m) => m.textContent), /starts with invented sample data\. Anything you add or change is saved only in this browser/);
  await h.close();
});
