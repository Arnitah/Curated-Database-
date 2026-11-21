// Helpers for the hosted-runtime tests: build the static preview into a temp folder, serve it the way
// Cloudflare Pages would (including the _headers file), and open it with NO Claude platform at all.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { buildHosted } from '../../../scripts/build-clay-hosted.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain', '.js': 'text/javascript' };

export function buildToTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-hosted-'));
  const out = path.join(dir, 'clay');
  const result = buildHosted({ outDir: out });
  return { dir, out, result, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Parses the "/*" block of a Cloudflare Pages _headers file.
export function parseHeaders(text) {
  const headers = {};
  let inAll = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) { inAll = line.trim() === '/*'; continue; }
    if (!inAll || !line.trim()) continue;
    const i = line.indexOf(':');
    headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return headers;
}

export function startHostedServer(root) {
  const headers = parseHeaders(fs.readFileSync(path.join(root, '_headers'), 'utf8'));
  const requests = [];
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    requests.push(urlPath);
    let rel = urlPath === '/' ? '/index.html' : urlPath;
    const f = path.join(root, rel);
    if (!f.startsWith(root)) { res.statusCode = 403; return res.end(); }
    fs.readFile(f, (e, b) => {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      if (e) { res.statusCode = 404; return res.end(); }
      res.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream');
      res.end(b);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    resolve({ base: `http://127.0.0.1:${port}/`, requests, headers, close: () => new Promise((r) => server.close(r)) });
  }));
}

export const ALLOWED_BLOCKED_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Opens the hosted page in a fresh isolated context. No fake platform is installed: window.claude stays undefined.
export async function openHosted(browser, base, { viewport = { width: 390, height: 844 }, local = null } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const blocked = [], notFound = [], seen = [];
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    blocked.push(new URL(u).host);
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [], csp = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.url().startsWith(base)) { seen.push(new URL(r.url()).pathname); if (r.status() >= 400) notFound.push(new URL(r.url()).pathname); } });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  if (local) await page.addInitScript((l) => { try { if (!sessionStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(l)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); sessionStorage.setItem('__seeded', '1'); } } catch (e) {} }, local);
  await page.goto(base);
  await page.waitForSelector('#nav button');
  return {
    page, errors, blocked, notFound, seen,
    csp: () => page.evaluate(() => window.__csp),
    mp: () => page.evaluate(() => JSON.parse(JSON.stringify(MP))),
    ls: (k) => page.evaluate((key) => localStorage.getItem(key), k),
    reload: async () => { await page.reload(); await page.waitForSelector('#nav button'); },
    close: () => ctx.close(),
  };
}

// ---- example-data audit helpers ---------------------------------------------------------------------
// The app script is the <script> after the bundled ingredient engine. These helpers only read text.
export function appScript(html) {
  const i = html.indexOf('</script>', html.indexOf('<script id="ii-engine">'));
  const j = html.indexOf('<script>', i);
  return html.slice(j);
}

// Top-level const/let/var whose value starts with [ { or a backtick. Returns { name: text }.
export function topLevelBlocks(html) {
  const L = appScript(html).split('\n');
  const blocks = {};
  for (let k = 0; k < L.length;) {
    const m = /^(?:const|let|var) ([A-Za-z_$][\w$]*)\s*=\s*([\[{`])/.exec(L[k]);
    if (!m) { k++; continue; }
    let n = k + 1;
    const buf = [L[k]];
    while (n < L.length && (!/^\S/.test(L[n]) || /^[\]\})];?/.test(L[n]))) buf.push(L[n++]);
    blocks[m[1]] = buf.join('\n');
    k = n;
  }
  return blocks;
}

export const brandRegex = (brands) => new RegExp('(?<![a-z0-9])(?:' + brands.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![a-z0-9])', 'i');

// Runs a view: ["nav", label] or ["act", name, value] (the app's own delegated action, same path as a tap).
export async function runSteps(page, steps) {
  for (const [kind, a, b] of steps) {
    if (kind === 'nav') await page.evaluate((l) => [...document.querySelectorAll('#nav button')].find((x) => x.textContent.trim() === l).click(), a);
    else await page.evaluate(([n, v]) => { const el = document.createElement('button'); el.dataset.act = n; el.dataset.v = v; document.body.appendChild(el); el.click(); el.remove(); }, [a, b]);
    await page.waitForTimeout(350);
  }
  return page.$eval('#main', (m) => m.innerText);
}
