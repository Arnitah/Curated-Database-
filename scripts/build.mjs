// Validates every dataset and rebuilds version.json.
//   node scripts/build.mjs           validate + write version.json (bumps version if data changed)
//   node scripts/build.mjs --check   validate only (used on pull requests)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'data');
const check = process.argv.includes('--check');
const errors = [], warnings = [];
const sets = {};

for (const app of fs.readdirSync(DATA).filter((d) => fs.statSync(path.join(DATA, d)).isDirectory()).sort()) {
  for (const f of fs.readdirSync(path.join(DATA, app)).filter((f) => f.endsWith('.json')).sort()) {
    const p = path.join(DATA, app, f), raw = fs.readFileSync(p, 'utf8');
    try {
      const data = JSON.parse(raw);
      sets[`${app}/${f.replace(/\.json$/, '')}`] = { data, bytes: Buffer.byteLength(raw), hash: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12) };
    } catch (e) { errors.push(`${app}/${f}: not valid JSON (${e.message})`); }
  }
}

// Cross-checks for Safe Batch
const ing = sets['safe-batch/ingredients']?.data;
if (ing) {
  const ids = new Set(), lv = new Set(['ok', 'care', 'stop']);
  for (const i of ing) {
    if (!i.id || !i.name) errors.push(`ingredient missing id or name: ${JSON.stringify(i).slice(0, 80)}`);
    if (ids.has(i.id)) errors.push(`duplicate ingredient id: ${i.id}`);
    ids.add(i.id);
    if (!lv.has(i.lvl)) errors.push(`ingredient ${i.id}: lvl must be ok, care or stop`);
  }
  for (const name of ['recipes_checked', 'recipes_starter']) {
    for (const r of sets[`safe-batch/${name}`]?.data || []) {
      if (!r.name || !Array.isArray(r.rows)) { errors.push(`${name}: recipe without name or rows`); continue; }
      for (const [id] of r.rows) if (!ids.has(id)) errors.push(`${name} "${r.name}": unknown ingredient "${id}"`);
    }
  }
  for (const [pat, id] of sets['safe-batch/synonyms']?.data || []) {
    if (!ids.has(id)) errors.push(`synonyms: "${pat}" points to unknown ingredient "${id}"`);
    try { new RegExp(pat); } catch { errors.push(`synonyms: bad regex "${pat}"`); }
  }
  const names = (sets['safe-batch/recipes_checked']?.data || []).map((r) => r.name);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) warnings.push(`${dup.length} duplicate recipe names (allowed): ${[...new Set(dup)].slice(0, 5).join('; ')}`);
}

// Never allow personal data in this repo
for (const k of Object.keys(sets)) if (/user|profile|log|saved|personal/i.test(k.split('/')[1]) && !/^safe-batch\/(year_|qy_)/.test(k)) errors.push(`${k}: personal data doesn't belong in this repo`);

warnings.forEach((w) => console.log('warn  ' + w));
if (errors.length) { errors.slice(0, 50).forEach((e) => console.log('ERROR ' + e)); console.log(`\n${errors.length} error(s)`); process.exit(1); }
console.log(`OK  ${Object.keys(sets).length} datasets valid`);
if (check) process.exit(0);

const vPath = path.join(ROOT, 'version.json');
const prev = fs.existsSync(vPath) ? JSON.parse(fs.readFileSync(vPath, 'utf8')) : { version: 0, datasets: {} };
const datasets = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, {
  count: Array.isArray(v.data) ? v.data.length : Object.keys(v.data).length, bytes: v.bytes, hash: v.hash,
  updated_at: prev.datasets?.[k]?.hash === v.hash ? prev.datasets[k].updated_at : new Date().toISOString(),
}]));
const changed = JSON.stringify(Object.fromEntries(Object.entries(datasets).map(([k, v]) => [k, v.hash]))) !==
                JSON.stringify(Object.fromEntries(Object.entries(prev.datasets || {}).map(([k, v]) => [k, v.hash])));
if (!changed) { console.log(`version.json unchanged (v${prev.version})`); process.exit(0); }
const next = { version: prev.version + 1, updated_at: new Date().toISOString(), datasets };
fs.writeFileSync(vPath, JSON.stringify(next, null, 2) + '\n');
console.log(`version.json -> v${next.version}`);
