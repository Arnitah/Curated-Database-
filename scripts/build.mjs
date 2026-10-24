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
  for (const name of ['recipes_checked', 'recipes_starter']) {
    const seen = new Set();
    for (const r of sets[`safe-batch/${name}`]?.data || []) {
      if (!r.id || !/^[a-z0-9-]+$/.test(r.id)) errors.push(`${name} "${r.name}": needs an id (lowercase-with-dashes)`);
      else if (seen.has(r.id)) errors.push(`${name}: duplicate id ${r.id}`);
      seen.add(r.id);
      if (r.source && (typeof r.source !== 'object' || (r.source.url && !/^https?:\/\//.test(r.source.url)))) errors.push(`${name} ${r.id}: source.url must be a link`);
    }
  }
  const names = (sets['safe-batch/recipes_checked']?.data || []).map((r) => r.name);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) warnings.push(`${dup.length} duplicate recipe names (allowed): ${[...new Set(dup)].slice(0, 5).join('; ')}`);
}

// Swap traits: every id must be a real ingredient
const traits = sets['safe-batch/swap_traits']?.data;
if (traits && ing) { const ids = new Set(ing.map((i) => i.id)); for (const [k, t] of Object.entries(traits)) { if (!ids.has(k)) errors.push(`swap_traits: unknown ingredient "${k}"`); if (!['exfoliant', 'oil', 'butter'].includes(t.role)) errors.push(`swap_traits ${k}: role must be exfoliant, oil or butter`); } }

// Myths: structured records
const VERDICTS = new Set(['true', 'false', 'partly', 'unproven', null]);
const myths = sets['safe-batch/myths']?.data;
if (myths) {
  const seen = new Set();
  for (const m of myths) {
    const w = `myth ${m?.id || JSON.stringify(m).slice(0, 40)}`;
    if (typeof m !== 'object' || !m) { errors.push(`${w}: must be an object (see schemas/myth.md)`); continue; }
    if (!m.id || !/^[a-z0-9-]+$/.test(m.id)) errors.push(`${w}: needs an id`);
    else if (seen.has(m.id)) errors.push(`${w}: duplicate id`);
    seen.add(m.id);
    if (!m.title) errors.push(`${w}: needs a title`);
    if (!Array.isArray(m.topics) || !m.topics.length) errors.push(`${w}: needs at least one topic`);
    if (!m.claims && !m.body) errors.push(`${w}: needs claims or body`);
    for (const c of m.claims || []) if (!c.claim || !c.truth || !VERDICTS.has(c.verdict ?? null)) errors.push(`${w}: each claim needs claim, truth and a valid verdict`);
    for (const s of m.sources || []) if (!s.url || !/^https?:\/\//.test(s.url)) errors.push(`${w}: source needs a url`);
    if (m.format === 'v2') {
      if (!m.claims?.length || m.claims.some((c) => !c.verdict)) errors.push(`${w}: v2 records need claims with verdicts`);
      if (!m.sources?.length) errors.push(`${w}: v2 records need at least one source`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.checked || '')) errors.push(`${w}: v2 records need a checked date (YYYY-MM-DD)`);
    }
  }
  const legacy = myths.filter((m) => m.format === 'legacy').length;
  if (legacy) warnings.push(`${legacy} legacy myths still need verdicts and sources (upgrade to format v2 over time)`);
}

// Scents: perfume houses
const houses = sets['scents/houses']?.data;
if (houses) {
  const fam = new Set(Object.keys(sets['scents/families']?.data || {}).filter((k) => !k.startsWith('_')));
  const regionCc = new Set((sets['scents/regions']?.data || []).map((r) => r.cc));
  const rates = sets['scents/rates']?.data?.cad_per || {};
  const geo = sets['scents/geo']?.data;
  const ST = new Set(['verified', 'retailer', 'reported', 'unknown']), seen = new Set();
  const url = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
  for (const h of houses) {
    const w = `scents/houses ${h?.id || '?'}`;
    if (!h.id || !/^[a-z0-9-]+$/.test(h.id)) errors.push(`${w}: needs an id (lowercase-with-dashes)`);
    else if (seen.has(h.id)) errors.push(`${w}: duplicate id`);
    seen.add(h.id);
    for (const k of ['name', 'country', 'cc', 'continent', 'type', 'about']) if (!h[k]) errors.push(`${w}: missing ${k}`);
    if (!url(h.site)) errors.push(`${w}: site must be a link`);
    if (!Array.isArray(h.families) || !h.families.length) errors.push(`${w}: needs at least one family`);
    for (const f of h.families || []) if (fam.size && !fam.has(f)) errors.push(`${w}: unknown family "${f}"`);
    if (!h.sig?.name || !h.sig?.profile) errors.push(`${w}: signature needs name and profile`);
    if (h.sig?.url && !url(h.sig.url)) errors.push(`${w}: sig.url must be a link`);
    const p = h.price || {};
    if (!ST.has(p.status)) errors.push(`${w}: price.status must be verified, retailer, reported or unknown`);
    if (p.status !== 'unknown' && typeof p.amt !== 'number') errors.push(`${w}: price.amt must be a number unless status is unknown`);
    if (p.cur && !(p.cur in rates)) errors.push(`${w}: no exchange rate for ${p.cur}`);
    if (!url(p.src) || !/^\d{4}-\d{2}-\d{2}$/.test(p.on || '')) errors.push(`${w}: price needs src link and checked date`);
    if (regionCc.size && !regionCc.has(h.cc)) warnings.push(`${w}: no regions entry for ${h.cc}`);
    if (geo && !geo[h.id]) warnings.push(`${w}: no map coordinates in scents/geo`);
  }
}

// Scents: travel guides
const travel = sets['scents/travel']?.data;
if (travel) {
  const hid = new Set((houses || []).map((h) => h.id)), seen = new Set();
  const url = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
  for (const t of travel) {
    const w = `scents/travel ${t?.id || '?'}`;
    if (!t.id || !/^[a-z0-9-]+$/.test(t.id)) errors.push(`${w}: needs an id`); else if (seen.has(t.id)) errors.push(`${w}: duplicate id`);
    seen.add(t.id);
    for (const k of ['city', 'country', 'cc', 'intro']) if (!t[k]) errors.push(`${w}: missing ${k}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.on || '')) errors.push(`${w}: needs a checked date (on)`);
    for (const x of t.lookfor || []) { if (x.house && !hid.has(x.house)) errors.push(`${w}: unknown house "${x.house}"`); if (!x.house && !x.name) errors.push(`${w}: look-for item needs a house or a name`); }
    for (const sh of t.shops || []) if (!sh.name || !sh.what) errors.push(`${w}: each shop needs name and what`);
    for (const u of t.sources || []) if (!url(u)) errors.push(`${w}: source must be a link`);
    if (!(t.sources || []).length) warnings.push(`${w}: no sources listed`);
  }
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
