// Weekly check for the scent atlas (data/scents/).
//   node scripts/check-scents.mjs
// 1. Refreshes data/scents/rates.json (CAD value of each currency) from a free rates API.
// 2. Visits every house's site, signature page and price source, and records pass / blocked / fail
//    in checks/scent-links.json.
// 3. For shops that expose product data (Shopify-style /products/... pages), reads the live variant
//    prices into checks/scent-prices.json and flags any that changed since the last run.
// Curated prices in houses.json are never overwritten: a changed live price is a to-do for review.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const P = (...a) => path.join(ROOT, ...a);
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n');
const today = new Date().toISOString().slice(0, 10);
const UA = 'Mozilla/5.0 (compatible; CuratedDatabaseScentCheck/1.0; +https://github.com/Arnitah/curated-database-)';

async function get(url, ms = 20000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.8' }, redirect: 'follow', signal: ac.signal }); }
  finally { clearTimeout(t); }
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// 1. Exchange rates
const ratesPath = P('data/scents/rates.json'), rates = read(ratesPath, null);
try {
  const r = await get('https://open.er-api.com/v6/latest/CAD');
  const j = await r.json();
  if (j.result === 'success' && rates) {
    for (const cur of Object.keys(rates.cad_per)) if (j.rates[cur]) rates.cad_per[cur] = +(1 / j.rates[cur]).toPrecision(4);
    Object.assign(rates, { on: today, source: 'open.er-api.com' });
    write(ratesPath, rates);
    console.log('rates  updated');
  } else console.log('rates  kept (api said ' + j.result + ')');
} catch (e) { console.log('rates  kept (' + e.message + ')'); }

// 2. Links
const houses = read(P('data/scents/houses.json'), []);
const status = async (url) => {
  try {
    const r = await get(url);
    if (r.ok) return 'pass';
    if ([401, 403, 405, 429, 503].includes(r.status)) return 'blocked';
    return 'fail ' + r.status;
  } catch (e) { return 'fail ' + (e.name === 'AbortError' ? 'timeout' : e.cause?.code || e.message); }
};
const urls = [...new Set(houses.flatMap((h) => [h.site, h.sig?.url, h.price?.src]).filter(Boolean))];
const res = Object.fromEntries((await pool(urls, 6, async (u) => [u, await status(u)])));
const links = { checked: today, summary: { pass: 0, blocked: 0, fail: 0 }, houses: {} };
for (const h of houses) {
  const row = { site: res[h.site], sig: h.sig?.url ? res[h.sig.url] : null, price: h.price?.src ? res[h.price.src] : null };
  links.houses[h.id] = row;
  const worst = Object.values(row).filter(Boolean).reduce((a, s) => (s.startsWith('fail') ? 'fail' : a === 'fail' ? a : s === 'blocked' ? 'blocked' : a), 'pass');
  links.summary[worst]++;
}
write(P('checks/scent-links.json'), links);
console.log(`links  ${links.summary.pass} pass, ${links.summary.blocked} blocked, ${links.summary.fail} fail`);

// 3. Live prices from shops with product JSON
const prevPrices = read(P('checks/scent-prices.json'), { houses: {} });
const prices = { checked: today, note: 'Live variant prices read from shop product data. Prices are in each shop\u2019s base currency, which can differ from the local price on the page (e.g. a store that shows CAD may report USD here). "changed" means different from the last run: review and update houses.json by hand.', houses: {} };
await pool(houses, 4, async (h) => {
  const src = [h.price?.src, h.sig?.url].find((u) => u && /\/products\/[^/?#]+/.test(u));
  if (!src) return;
  const u = new URL(src), json = `${u.origin}${u.pathname.replace(/\/$/, '')}.json`;
  try {
    const r = await get(json);
    if (!r.ok) { prices.houses[h.id] = { src: json, error: r.status }; return; }
    const p = (await r.json()).product;
    const variants = (p?.variants || []).map((v) => ({ title: v.title, price: +v.price, available: v.available ?? null }));
    const before = JSON.stringify(prevPrices.houses?.[h.id]?.variants?.map((v) => [v.title, v.price]));
    const changed = before !== undefined && before !== JSON.stringify(variants.map((v) => [v.title, v.price]));
    prices.houses[h.id] = { src: json, product: p?.title, variants, changed };
  } catch (e) { prices.houses[h.id] = { src: json, error: e.message }; }
});
write(P('checks/scent-prices.json'), prices);
const ch = Object.entries(prices.houses).filter(([, v]) => v.changed).map(([k]) => k);
console.log(`prices ${Object.keys(prices.houses).length} shops read${ch.length ? ', changed: ' + ch.join(', ') : ''}`);
