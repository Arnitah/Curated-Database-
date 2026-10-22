# Curated Database

Shared reference data for **Safe Batch** (DIY skincare safety checker) and **Clay** (routine and shelf app). Plain JSON files, validated on every push, served straight from GitHub.

> **No personal data here, ever.** Ratings, notes, logs, hair plans and profiles stay in each person's browser or Claude account (later, the backend's database). The validator rejects dataset names that look personal.

## Layout
```
data/
  safe-batch/   33 datasets: ingredients, recipes, myths, terms, traditions, proof grades, scent and layering data...
  clay/         16 datasets: product areas and steps, product seed list, hair plan options...
version.json    data version + per-dataset count, size, hash and last-changed date
scripts/build.mjs           validator + version builder
.github/workflows/data.yml  runs the validator; on main, bumps version.json automatically
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

Run the check yourself: `node scripts/build.mjs --check` (Node 20+, no installs needed).

## Key fields
| Dataset | Shape |
|---|---|
| `safe-batch/ingredients` | `{ id, name, grp, ph, lvl: ok/care/stop, good, care, flag?, d?, tsp?, max?, nut?, noFace?, never? }` |
| `safe-batch/synonyms` | `[regexSource, ingredientId, priority?]` (match against lowercased text) |
| `safe-batch/recipes_checked` | `{ name, claim, type, use: now/store/fridge, note?, rows: [[ingredientId, amount, unit]] }` |
| `safe-batch/proof_grades` | `{ active: { goal: [grade A-D, reason] } }` |
| `safe-batch/myths` | HTML strings |
| `safe-batch/terms` | `{ t, what, skin, how, when, season }` |
| `safe-batch/traditions` | `{ id, name, region, place, how, ev, does, watch, modern }` |
| `clay/my_products_seed` | `[area, step, name, status: cur/have/past]` |

## Reading the data from an app
This repo is **private**, so browsers can't read it directly. Pick one:
- **Make the repo public.** It holds only reference data. Files are then at
  `https://raw.githubusercontent.com/Arnitah/curated-database-/main/data/safe-batch/ingredients.json` (updates show within about 5 minutes).
- **Keep it private** and publish just the data with GitHub Pages (needs GitHub Pro for private repos) or by syncing to the backend (`skincare-api`), which can import from here.
