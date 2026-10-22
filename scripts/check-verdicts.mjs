// Re-checks every recipe with the real Safe Batch checker (apps/safe-batch.html) against the data in this repo,
// and compares the verdicts to checks/verdicts.json.
//   node scripts/check-verdicts.mjs            fail if any verdict changed
//   node scripts/check-verdicts.mjs --update   accept the current verdicts as the new snapshot
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SNAP = path.join(ROOT, 'checks', 'verdicts.json');
const update = process.argv.includes('--update');
const acceptNew = process.argv.includes('--accept-new');

// Serve the repo so the app loads this branch's data, not GitHub's main branch.
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  fs.readFile(f, (e, b) => { res.setHeader('Access-Control-Allow-Origin', '*'); if (e) { res.statusCode = 404; return res.end(); } res.end(b); });
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((b) => { window.SB_DATA_BASE = b; try { localStorage.clear(); } catch {} }, base);
await page.goto('file://' + path.join(ROOT, 'apps', 'safe-batch.html'));
await page.waitForFunction(() => window.SB_DATA, null, { timeout: 30000 });
const now = await page.evaluate(() => {
  computeVRES();
  const out = {};
  VIRAL.forEach((r, i) => {
    const a = VRES[i]; if (!a) return;
    const key = r.id || r.name;
    out[key] = { verdict: a.verdict, flags: a.iss.filter((x) => x.sev !== 'info').map((x) => `${x.sev}: ${x.title}`).sort() };
  });
  return out;
});
await browser.close(); server.close();
if (errors.length) { console.log('App errors:\n' + errors.join('\n')); process.exit(1); }

const counts = Object.values(now).reduce((c, v) => ((c[v.verdict] = (c[v.verdict] || 0) + 1), c), {});
console.log(`Checked ${Object.keys(now).length} recipes:`, counts);
if (update || !fs.existsSync(SNAP)) {
  fs.mkdirSync(path.dirname(SNAP), { recursive: true });
  fs.writeFileSync(SNAP, JSON.stringify(now, null, 1) + '\n');
  console.log('Snapshot saved to checks/verdicts.json');
  process.exit(0);
}
const old = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const diffs = [];
for (const [k, v] of Object.entries(now)) {
  const o = old[k];
  if (!o) diffs.push(`NEW      ${k}: ${v.verdict}`);
  else if (o.verdict !== v.verdict) diffs.push(`CHANGED  ${k}: ${o.verdict} -> ${v.verdict}  ${JSON.stringify(v.flags)}`);
  else if (JSON.stringify(o.flags) !== JSON.stringify(v.flags)) diffs.push(`FLAGS    ${k}: ${JSON.stringify(o.flags)} -> ${JSON.stringify(v.flags)}`);
}
for (const k of Object.keys(old)) if (!now[k]) diffs.push(`REMOVED  ${k}`);
if (!diffs.length) { console.log('No verdict changes.'); process.exit(0); }
console.log(diffs.join('\n'));
const real = diffs.filter((d) => !d.startsWith('NEW'));
if (real.length) {
  console.log(`\n${real.length} existing recipe(s) changed verdict or flags. If that's intended, run: npm run verdicts:update`);
  process.exit(1);
}
if (acceptNew) {
  const merged = { ...old };
  for (const [k, v] of Object.entries(now)) if (!old[k]) merged[k] = v;
  fs.writeFileSync(SNAP, JSON.stringify(merged, null, 1) + '\n');
  console.log('\nOnly new recipes; added them to the snapshot.');
  process.exit(0);
}
console.log('\nOnly new recipes. Run npm run verdicts:update to record them.');
process.exit(1);
