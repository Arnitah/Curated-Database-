// Bridge: turns the daily Skincare Data Hub (github.com/Arnitah/skincare-data-hub) into small app-ready files.
//
//   node scripts/bridge-hub.mjs                 fetch the hub from GitHub
//   node scripts/bridge-hub.mjs --hub ../hub    read a local checkout instead
//
// Writes
//   index/clay/products/names.json      searchable list for Clay (name, brand, barcode, category)
//   index/clay/products/NNN.json        ingredient lists, 500 products per file, loaded only when picked
//   index/clay/products/meta.json       counts and when the hub last ran
//   data/safe-batch/ingredient_facts.json   supplier use levels, pH and shelf life per Safe Batch ingredient
//   checks/hub-coverage.json            ingredients common in real products that neither app explains yet
//
// Hub rows are "candidate" until reviewed in the hub; Clay shows a "check your label" note for those.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HUB_RAW = process.env.HUB_RAW || 'https://raw.githubusercontent.com/Arnitah/skincare-data-hub/main/';
const hubArg = process.argv.indexOf('--hub');
const HUB_DIR = hubArg > 0 ? path.resolve(process.argv[hubArg + 1]) : null;
const SHARD = 500;
const SKIP_CATS = new Set(['oral_care']);

async function hub(file) {
  if (HUB_DIR) return JSON.parse(fs.readFileSync(path.join(HUB_DIR, file), 'utf8'));
  const r = await fetch(HUB_RAW + file);
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return r.json();
}
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const write = (p, data, pretty = false) => {
  const full = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, (pretty ? JSON.stringify(data, null, 1) : JSON.stringify(data)) + '\n');
};
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(2); };

const [products, raws, status] = await Promise.all([hub('data/products.json'), hub('data/raw_materials.json'), hub('data/status.json').catch(() => ({}))]);
const hubRun = status.generated_at || status.last_run || status.updated_at || null;

// ---------- 1. Clay product search ----------
const seen = new Set();
const keep = products
  .filter((p) => p.listing_status !== 'removed' && p.record_status !== 'rejected' && !SKIP_CATS.has(p.category_group))
  .map((p) => ({ ...p, list: clean(p.ingredients_text) || (p.ingredients || []).join(', '), name: clean(p.name), brand: clean(p.brand) }))
  .filter((p) => p.name && (p.ingredients || []).length >= 3 && p.list.length < 6000)
  .filter((p) => { const k = p.barcode ? 'b' + p.barcode : 'n' + (p.brand + '|' + p.name).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
  .sort((a, b) => (a.brand || '~').localeCompare(b.brand || '~') || a.name.localeCompare(b.name));

const CATS = [...new Set(keep.map((p) => p.category_group || 'other'))].sort();
const SRCS = [...new Set(keep.map((p) => p.source_id))].sort();
const dir = 'index/clay/products';
fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
// names row: [name, brand, barcode, categoryIndex, sourceIndex, verified 0/1]; row number n lives in shard floor(n/500), slot n%500
write(`${dir}/names.json`, {
  cats: CATS, srcs: SRCS, shard: SHARD,
  rows: keep.map((p) => [p.name, p.brand, p.barcode || '', CATS.indexOf(p.category_group || 'other'), SRCS.indexOf(p.source_id), p.record_status === 'verified' ? 1 : 0]),
});
for (let i = 0; i < keep.length; i += SHARD) {
  // shard row: [hub id, ingredient list, size, countries sold, url]
  write(`${dir}/${String(i / SHARD).padStart(3, '0')}.json`, keep.slice(i, i + SHARD).map((p) => [p.id, p.list, clean(p.size), clean(p.countries_sold).slice(0, 120), p.url || '']));
}
const byCat = Object.fromEntries(CATS.map((c) => [c, keep.filter((p) => (p.category_group || 'other') === c).length]));
write(`${dir}/meta.json`, { built_at: new Date().toISOString(), hub_run: hubRun, products: keep.length, shards: Math.ceil(keep.length / SHARD), by_category: byCat, by_source: Object.fromEntries(SRCS.map((s) => [s, keep.filter((p) => p.source_id === s).length])) }, true);

// ---------- 2. Safe Batch ingredient facts ----------
const ING = read('data/safe-batch/ingredients.json');
const SYN = read('data/safe-batch/synonyms.json').map(([p, id, eo]) => [new RegExp(p, 'i'), id, eo]);
const byName = new Map(ING.map((i) => [i.name.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').trim(), i.id]));
const matchIng = (name) => {
  const low = name.toLowerCase(), oilish = /essential|\beo\b|\boils?\b|absolute/.test(low);
  const bare = low.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\b(organic|certified|refined|unrefined|virgin|cold[- ]pressed|natural|pure|cosmetic grade)\b/g, '').replace(/\s+/g, ' ').trim();
  if (byName.has(bare)) return byName.get(bare);
  for (const [re, id, eo] of SYN) if (re.test(low) && (!eo || oilish)) return id;
  return null;
};
const BLEND = /\b(grains?|beads?|scrub|lotion|cream|base|kit|blend|soap|shampoo|conditioner|balm|gel base|melt|pour|sample|set|bundle|gift)\b/i;
const acc = {};
for (const r of raws) {
  if (r.listing_status === 'removed' || r.record_status === 'rejected') continue;
  const keys = clean(r.ingredient_keys).split(';').map((s) => s.trim()).filter(Boolean);
  if (keys.length > 2 || BLEND.test(r.name)) continue;          // single raw materials only, not finished bases
  const id = matchIng(clean(r.name)) || matchIng(clean(r.inci));
  if (!id) continue;
  const a = (acc[id] ||= { lo: [], hi: [], ph: [], shelf: [], flags: new Set(), src: new Set(), n: 0, ex: [] });
  a.n++; a.src.add(r.source_id);
  const lo = +r.use_level_min_pct, hi = +r.use_level_max_pct;
  if (r.use_level_max_pct != null && hi > 0 && hi <= 100) { a.hi.push(hi); if (r.use_level_min_pct != null && lo >= 0 && lo <= hi) a.lo.push(lo); }
  if (r.ph_min != null) a.ph.push(+r.ph_min);
  if (r.ph_max != null) a.ph.push(+r.ph_max);
  if (r.shelf_life_months) a.shelf.push(+r.shelf_life_months);
  // Regulatory flags on raw materials are left out for now: the hub matches them loosely (water showed up as a UV filter),
  // so they need review in the hub before an app shows them.
  if (a.ex.length < 3 && r.url && !a.ex.some((e) => e.s === r.source_id)) a.ex.push({ s: r.source_id, u: r.url });
}
const facts = {};
for (const [id, a] of Object.entries(acc).sort()) {
  facts[id] = {
    listings: a.n, suppliers: [...a.src].sort(),
    ...(a.hi.length ? { use_pct: [median(a.lo.length ? a.lo : [0]), median(a.hi)], use_n: a.hi.length } : {}),
    ...(a.ph.length ? { ph: [Math.min(...a.ph), Math.max(...a.ph)] } : {}),
    ...(a.shelf.length ? { shelf_months: median(a.shelf) } : {}),
    links: a.ex,
  };
}
write('data/safe-batch/ingredient_facts.json', facts, true);

// ---------- 3. Coverage queue ----------
const ACT = read('data/safe-batch/product_actives.json').map((a) => new RegExp(a.re, 'i'));
const HYPE = read('data/safe-batch/product_hype_flags.json').map(([re]) => new RegExp(re, 'i'));
const BASE = /^(water|aqua|glycerin|butylene glycol|propylene glycol|propanediol|pentylene glycol|1,2-hexanediol|phenoxyethanol|ethylhexylglycerin|sodium (chloride|hydroxide|benzoate|citrate|lauryl sulfate|laureth sulfate)|citric acid|potassium sorbate|xanthan gum|carbomer|dimethicone|cetearyl alcohol|cetyl alcohol|stearyl alcohol|fragrance|parfum|disodium edta|tetrasodium edta|tocopherol|caprylic\/capric triglyceride|glyceryl stearate|cocamidopropyl betaine|polysorbate \d+|peg-\d+.*|ci \d+.*|mica|silica|titanium dioxide|talc|isopropyl myristate|sorbitol|alcohol|alcohol denat|triethanolamine|stearic acid|benzyl alcohol|methylparaben|propylparaben|linalool|limonene|citronellol|geraniol|hexyl cinnamal|coumarin|butylphenyl methylpropional|benzyl salicylate|eugenol|lactic acid|panthenol|allantoin)$/;
const count = new Map();
for (const p of keep) for (const raw of p.ingredients || []) {
  const k = clean(raw).toLowerCase().split(' / ')[0].replace(/\s*\(.*?\)\s*/g, ' ').replace(/[.*]+$/, '').trim();
  if (!k || k.length > 60 || BASE.test(k)) continue;
  count.set(k, (count.get(k) || 0) + 1);
}
const queue = [...count.entries()].filter(([k]) => !ACT.some((re) => re.test(k)) && !HYPE.some((re) => re.test(k)) && !matchIng(k))
  .sort((a, b) => b[1] - a[1]).slice(0, 150).map(([ingredient, products]) => ({ ingredient, products }));
write('checks/hub-coverage.json', { built_at: new Date().toISOString(), note: 'Most common ingredients in hub products that Clay\'s checker and Safe Batch do not explain yet (fillers removed). Work from the top.', explained_in_safe_batch: Object.keys(facts).length, queue }, true);

console.log(`Clay index: ${keep.length} products in ${Math.ceil(keep.length / SHARD)} files (${CATS.map((c) => `${c} ${byCat[c]}`).join(', ')})`);
console.log(`Safe Batch facts: ${Object.keys(facts).length} of ${ING.length} ingredients matched to supplier listings`);
console.log(`Coverage queue: top unexplained = ${queue.slice(0, 8).map((q) => q.ingredient).join('; ')}`);
