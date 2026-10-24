# Curated Database

Shared reference data for **Safe Batch** (DIY skincare safety checker) and **Clay** (routine and shelf app). Plain JSON files, validated on every push, served straight from GitHub.

> **No personal data here, ever.** Ratings, notes, logs, hair plans and profiles stay in each person's browser or Claude account (later, the backend's database). The validator rejects dataset names that look personal.

## Layout
```
data/
  safe-batch/   33 datasets: ingredients, recipes, myths, terms, traditions, proof grades, scent and layering data...
  clay/         16 datasets: product areas and steps, product seed list, hair plan options...
  scents/       Scent Atlas: perfume houses (houses), scent families glossary, country scent cultures (regions), houses still to research (leads), exchange rates to CAD (rates)
index/clay/products/   Clay's store-product search, built daily from the Skincare Data Hub (names.json + 500-product files)
apps/           the current Safe Batch and Clay app files (single HTML each), plus scent-atlas.html (explorer for data/scents)
checks/verdicts.json  every recipe's verdict and flags from the real checker
checks/hub-coverage.json  ingredients common in real products that the apps don't explain yet (to-do list)
checks/scent-links.json   weekly pass / blocked / fail for every perfume house link
checks/scent-prices.json  weekly live prices read from shops that expose product data
schemas/myth.md       the myth and recipe record formats
version.json    data version + per-dataset count, size, hash and last-changed date
scripts/build.mjs             validator + version builder
scripts/bridge-hub.mjs        pulls the Skincare Data Hub into index/ and data/safe-batch/ingredient_facts.json
scripts/check-scents.mjs      weekly scent atlas check: rates, links, live prices
scripts/check-verdicts.mjs    re-runs every recipe through apps/safe-batch.html and compares to checks/verdicts.json
scripts/migrations/           one-off data conversions (kept for the record)
.github/workflows/data.yml      validator; on main, bumps version.json
.github/workflows/verdicts.yml  verdict regression check
.github/workflows/hub-bridge.yml  daily pull from the hub (11:23 UTC, after the hub's 09:17 run)
.github/workflows/scents.yml      weekly scent atlas check (Mondays 12:47 UTC)
```

## How updates flow
1. Change or add any file under `data/` (by hand, from a scraper, or from a refresh workflow) and push to `main`.
2. The **Validate data and bump version** workflow checks every file:
   - valid JSON
   - unique ingredient ids, levels ok/care/stop
   - every recipe ingredient and synonym points to a real ingredient
   - working regexes
3. If any dataset changed, it bumps `version.json` and commits it.
4. The apps check `version.json` on load and only download datasets whose hash changed.

On a pull request it only validates, so a broken file can't reach `main`.

Run the checks yourself (Node 20+):
- `npm run check`: validate the data (no installs needed)
- `npm install && npx playwright install chromium`, then `npm run verdicts`: re-check every recipe; `npm run verdicts:update` accepts intended changes

### Verdict regression check
Every recipe's verdict (ok, care or stop) and its flags are recorded in `checks/verdicts.json`. Whenever the data or the checker in `apps/safe-batch.html` changes, the workflow re-checks all recipes. If a rule change quietly flips an existing recipe, the run fails and lists exactly which ones changed, so nothing shifts without you seeing it. New recipes are simply recorded.

## Where the Skincare Data Hub fits
[skincare-data-hub](https://github.com/Arnitah/skincare-data-hub) collects **facts** every day: store products with full ingredient lists, supplier raw materials, and regulations. This repo holds the **judgment**: plain-English verdicts, myths with sources, checked recipes. The apps only read this repo.

Each day `scripts/bridge-hub.mjs` turns the hub into:
- **Clay product search** (`index/clay/products/`): about 14,000 products, oral care left out. The names file is ~290 KB gzipped. Each 500-product ingredient file loads only when someone picks a product from it. Products that are still `candidate` in the hub show a "make sure it matches your bottle" note. Mark them `verified` in the hub's `reviews/record_reviews.csv` to drop the note.
- **Safe Batch supplier facts** (`data/safe-batch/ingredient_facts.json`): for each Safe Batch ingredient that matches single-ingredient supplier listings, the typical use-level range, pH, shelf life and up to three listing links (one per supplier). Essential oils and fragrance don't show supplier use levels, because those figures usually mean a whole blend. Regulatory flags are left out until the hub's matching is reviewed.
- **Coverage to-do** (`checks/hub-coverage.json`): the most common ingredients in real products that neither app explains yet, with common fillers removed.

Screenshots and links still go through review by hand. Those are viral claims, recipes and myths, which need judgment rather than scraping.

## Key fields
| Dataset | Shape |
|---|---|
| `safe-batch/ingredients` | `{ id, name, grp, ph, lvl: ok/care/stop, good, care, flag?, d?, tsp?, max?, nut?, noFace?, never? }` |
| `safe-batch/synonyms` | `[regexSource, ingredientId, oilOnly?]`: matched in order against lowercased text; `oilOnly` = 1 means only match when the line reads like an oil (drops, essential) |
| `safe-batch/recipes_checked` | `{ id, name, claim, type, use: now/store/fridge, note?, inspired?, source?, rows: [[ingredientId, amount, unit]] }`. Titles stay generic: brand or product names go in `inspired` (shown as "Inspired by … · not affiliated"), never in `name` |
| `safe-batch/proof_grades` | `{ active: { goal: [grade A-D, reason] } }` |
| `safe-batch/myths` | Structured records: `id`, `title`, `topics`, `claims` (claim, verdict, truth) or `body`, `sources`, `checked`, `format`. See schemas/myth.md |
| `safe-batch/terms` | `{ t, what, skin, how, when, season }` |
| `safe-batch/traditions` | `{ id, name, region, place, how, ev, does, watch, modern }` |
| `safe-batch/ingredient_facts` | `{ ingredientId: { listings, suppliers[], use_pct?: [lo, hi], use_n?, ph?: [min, max], shelf_months?, links: [{ s, u }] } }` |
| `safe-batch/swap_traits` | `{ ingredientId: { role: exfoliant/oil/butter, ...traits, note } }`. Exfoliant: grit 0-3, dissolves, face, drain. Oil: weight, absorb, clog, shelf, special. Butter: hard, melts, scent. Drives Safe Batch's Swap ideas |
| `clay/my_products_seed` | `[area, step, name, status: cur/have/past]` |

## How the apps read it

**Inside Claude, artifacts can't reach GitHub.** So each app is published with its data files alongside it, and loads them from the same place as the page. GitHub is the fallback when the apps run anywhere else. That means a data change reaches the live apps only when they're republished with the latest files.

Safe Batch and Clay fetch `version.json` and the datasets from
`https://raw.githubusercontent.com/Arnitah/curated-database-/main/` on each load (GitHub caches files for about 5 minutes).
They show their built-in data first, then merge in anything new or changed from here. If GitHub can't be reached, they keep working offline.

What the apps merge today:
- **Safe Batch:** ingredients (new and edited), synonyms (new), recipes_checked (new and edited), myths, terms, traditions, layering_presets (new), ingredient_facts (shown on ingredient cards)
- **Clay product search:** loads `index/clay/products/names.json` when someone first uses the search box
- **Clay:** hair_tips, hair_wash_steps, product_steps, feel_words

Deleting an item here doesn't remove it from the apps' built-in copy until the app files are next republished.

## Scent Atlas (data/scents)
A curated guide to perfume houses outside the usual Western names, Asia first. Each house in `houses.json` has its country and city, kind (niche, indie, attar, incense, affordable, inspired-by), scent families that match Clay's (`citrus, fruity, floral, green, gourmand, woody, amber, musk, aquatic, spicy`) plus free-form accents (tea, oud, incense...), one signature scent with top/heart/base notes and a plain-English profile, and a price with its status:

| status | meaning |
|---|---|
| verified | read on the brand's own shop on the `on` date |
| retailer | read on a reseller's page |
| reported | taken from an article |
| unknown | not published or not yet read |

All descriptions are written in our own words. Every Monday the scent check refreshes `rates.json`, tests every link and reads live shop prices into `checks/`. It never edits `houses.json`: a price marked `changed` in `checks/scent-prices.json` is a to-do to review by hand. Houses found but not yet verified live in `leads.json`.

Planned Clay link: `families` already uses Clay's scent family names, so scent stacks and dupe comparisons (`type: inspired-by`, `mass`) can read this file directly.
