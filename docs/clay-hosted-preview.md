# Clay hosted preview (Cloudflare Pages)

A standalone, static build of Clay that can run on Cloudflare Pages, separate from the Claude artifact.

**Status: preview preparation only.** Synthetic demo data. No Supabase, no account, no live Clay documents, no credentials. Nothing is deployed or published by this change, and `apps/clay.html`, `apps/clay-web.html` and the published artifact are untouched.

## What it is

`scripts/build-clay-hosted.mjs` reads `apps/clay.html` (read-only) and writes a generated folder, `hosted/clay/` (git-ignored). The page is **derived, not forked**: ten exact, asserted patches are applied to `clay.html`. If `clay.html` changes so a patch no longer matches exactly once, the build fails instead of shipping something unreviewed. Fixes to Clay therefore flow into the hosted preview automatically.

Why `clay.html` and not `clay-web.html`: `clay.html` is the file the existing Clay tests cover and it carries the bundled ingredient engine. `clay-web.html` is a smaller variant with the same artifact hooks, no engine and no tests, so it was left alone.

```
apps/clay.html ──(10 asserted patches, scripts/build-clay-hosted.mjs)──▶ hosted/clay/index.html
apps/clay-hosted/demo-seed.json (synthetic shelf) ─────────────────────▶ inlined as the starter shelf
version.json, data/…, index/clay/products/… (public reference files) ──▶ copied, same relative paths
```

## Dependency audit of `apps/clay.html`

Line numbers are for `main` at commit `24f3505`. `clay-web.html` has the same hooks (7 `window.claude` references, one `db` and one `user` call).

| Dependency | Where | Outside Claude today | Hosted build |
|---|---|---|---|
| `window.claude.use('db')`, `use('user')`, `user.id()` | boot block, 2843–2871 | Already degrades to local-only (`CSYNC.status='local'`) | Block removed |
| Artifact database: `csRef()` `.collection().doc()`, `.get()`, `.set()`, `.onSnapshot()` | sync layer, 1075–1121 and the boot block | Unreachable without a db | Replaced by a stub that only stamps a local timestamp |
| `window.claude.use('comments')` and the comment-click handler | 2663–2670, 2800 | Toast says "use the comment button in the Claude toolbar" | Hook removed, neutral toast. The Comment buttons are hidden by CSS unless feedback mode is on |
| Save-status wording ("Saved to your Claude account…", "Open Clay in Claude…") | 1251 | Misleading | Replaced with demo wording |
| Personal starter shelf `MP_SEED` (61 records) | 1065 | Seeds a fresh browser with the real shelf | Replaced with 16 synthetic records (`apps/clay-hosted/demo-seed.json`) |
| Load-time migrations that name real products: rename map, Summer's Eve / Vagisil re-add, one-off "hato" migration | 1123–1127 | Would re-inject real product names into any shelf | Removed |
| Hard-coded sidebar profile chip ("Combination · barrier recovering") | 346 | Personal-looking placeholder | Generic "Demo profile · Synthetic sample data" |
| `localStorage`, 12 keys (`clay-products`, `-hair`, `-log`, `-scents`, `-am-tone`, `-web`, `-trip*`, `-sync-ts`, `-sync-empty-intent`, `-mig-hato`) | throughout | Works; on a normal origin it is persistent and per-browser | **Reused as is.** This is the hosted build's only store |
| Remote reference data: `version.json`, `data/clay/*`, `data/safe-batch/scent_families.json`, `data/scents/*`, product index `index/clay/products/names.json` plus shards | `clayFetch`, 1741–1790, 2812–2841 | Same-origin first, then `raw.githubusercontent.com/…/main/` | Same-origin only. GitHub fallback removed. The needed files are copied into the output |
| Google Fonts (Fraunces, Nunito Sans, IBM Plex Mono) | `<head>` | Works | Kept to preserve the look. Allowed in the CSP. See decisions below |
| Links to two published Claude artifacts (Safe Batch 1613, Scent Atlas 2233) | 1613, 2233 | Ordinary links | Kept. They are navigation, not runtime dependencies |
| Engine data label `added_by_claude_pending_review` | bundled engine | Data value | Kept. It is a registry status, not a dependency |

**Reusable unchanged:** all rendering and state (nine sections), the ingredient engine, `localStorage` persistence, the shelf, hair, log and scent logic, product search, themes and the responsive layout. **Replaced:** the sync layer, the boot hook, the comments hook, the seed and personal migrations, the save wording, the data fallback. The UI separates cleanly; no redesign was needed.

## Example-data audit (all nine sections)

The 16-record shelf is not the only hard-coded content. Every top-level data block in the hosted page (80, found by a script, not by eye) is registered in `apps/clay-hosted/example-data-audit.json` with a class. `tests/clay/hosted-examples.test.mjs` fails if a block is added without being classified, if an invented block is shown without a visible label, or if a real brand name appears in a block classed as invented, generic or config.

| Class | Meaning | Blocks |
|---|---|---|
| `illustrative-invented` | Invented products, figures, reviews, scan readings, pairings. Each shows a visible "Sample data" / "DEMO DATA" / "demo" / "not applied" label where it appears | PICKS, INGS, REVIEWS, PROD, P, PAIRS, SCENT, METRICS, ZONES, CHANGES (+ functions `ySample`, `segStats`) |
| `demo-seed` | The 16 synthetic starter shelf rows | MP_SEED |
| `unreferenced` | Never rendered by any code. Emptied in the hosted build | ROUTINE, SHELF, SHELFVIZ |
| `generic-editorial` | General advice or education. No brand, product or person, no claim about the user | 16 blocks |
| `ui-config` | Option lists, icons, palettes, rules | 44 blocks |
| `reference-real` | **Real-world reference content that names real products, brands, perfumes or places.** Not synthetic, not user data | TRIP_WHERE, TRIP_HOME, CM, CM_WASH, SA, PDB_SRC |

Changes made from this audit: the hard-coded "From your Oct 13 scan" and "you own both / one" claims are replaced by neutral "Sample profile (demo)" and "sample pairing" tags; the Pairs and scent-of-the-season cards and the Today scent idea now carry the same sample label the other examples already had; `ROUTINE`, `SHELF` and `SHELFVIZ` (which held a personal-looking routine and shelf and were never rendered) are emptied.

**Decision for the reviewer: `reference-real`.** The brand-comparison lists (`CM`, `CM_WASH`), travel advice by city (`TRIP_WHERE`, `TRIP_HOME`) and the scent-family reference (`SA`), plus the copied product index and scent houses, name real brands and places. They are reference content, not invented samples, and they are not presented as synthetic. They are kept because removing them removes the Check, Travel and Scent features. If the preview must contain no real brand at all, these need to be replaced or hidden; say so and that is a follow-up. A brand denylist in the tests is a guard, not a proof, because the product index has no usable brand column.

### Banner wording

The banner reads "Demo preview · starts with synthetic sample data · your changes stay in this browser", and the shelf note says the shelf starts with invented sample data and that anything the user adds is saved only in this browser. Neither claims that every entry stays synthetic once a user adds their own. A test adds a product and checks both texts are still true. `build-info.json` records `starts_with_synthetic_demo_data`.

### Build output safety

`node scripts/build-clay-hosted.mjs [--out <folder>]` never deletes an arbitrary folder:

- `assertSafeOutDir` runs before anything is read. It resolves symlinks and refuses the repository root, any parent of it, a filesystem root, an empty path, a file, a symlink, and anything inside the repository other than `hosted/<name>` (so `apps`, `data`, `tests`, `.git` and the like are refused).
- A new or empty folder is accepted. A non-empty folder is accepted only if it carries the marker file `.clay-hosted-preview` (id `clay-hosted-preview/v2`) whose `files` list is the exact manifest of what the previous build wrote.
- Before anything is deleted, every descendant of the folder is enumerated without following symlinks and checked against that manifest at every depth. Any unlisted file, unlisted folder (even an empty one), symlink or special file anywhere, including inside `data/` and `index/`, rejects the rebuild and nothing is deleted. A marker listing an absolute, `..`, empty-segment or marker path is also rejected.
- The marker is a record, never the authority. `permittedPaths()` derives, from the builder's own output files, its copied reference files and the repo's current product-index files, the only paths it can generate. A marker entry outside that set (even a valid relative path such as `notes.txt` or `data/clay/unexpected.txt`) refuses the rebuild, and so does any file in the folder that is not both listed and permitted. An older generated file that is no longer permitted is refused too, so it needs manual cleanup rather than being deleted unverified.
- The marker itself is protected. It is checked with `lstat` before it is read and must be a regular file (not a symlink, folder or special entry), and it is written with `O_NOFOLLOW`, so it can never be followed or overwritten through a link.
- Cleanup then removes only the verified manifest files one at a time and the folders left empty. The script contains no recursive removal at all, and a test pins the order (check, then delete). A marker from the earlier format, or one left by an interrupted build, is refused rather than trusted; delete that generated folder yourself and rebuild.
- An unsafe `--out` exits with code 2 and a message.
- The marker file `.clay-hosted-preview` is part of the output and is deployed with it. It holds only a generator id and note.

### Seed inspection

The build no longer evaluates source code. `readOriginalSeedNames` and the seed patch use a small parser for the known `MP_SEED` shape (rows of four quoted strings). It rejects code, concatenation, template strings, comments, numbers and unterminated input, and tests show hostile text is inert.

## Files changed

| File | Purpose |
|---|---|
| `scripts/build-clay-hosted.mjs` (new) | The build. Node built-ins only |
| `apps/clay-hosted/demo-seed.json` (new) | Synthetic demo shelf, every name starts "Synthetic " |
| `tests/clay/hosted.test.mjs`, `tests/clay/helpers/hosted.mjs` (new) | 10 tests, run by the existing `npm run test:clay` |
| `package.json` | `build:clay-hosted` script |
| `.gitignore` | `hosted/` |
| `.github/workflows/clay-tests.yml` | Add the new paths to the trigger filters |
| `docs/clay-hosted-preview.md`, `tests/clay/README.md` | This document and a pointer |

## Output (`hosted/clay/`)

- `index.html`: the page. Noindex meta, a visible "Demo preview" banner.
- `_headers`: Content-Security-Policy with `connect-src 'self'` (the page can call only its own origin), `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, `nosniff`, `frame-ancestors 'none'`.
- `robots.txt`: disallow all.
- `build-info.json`: source hash, list of patches, synthetic-data flag (`starts_with_synthetic_demo_data`), and the marker `.clay-hosted-preview`.
- 54 public reference files (about 13 MB, almost all the product index). **Not** copied: `data/clay/my_products_seed.json`, anything under `data/users`, `index/added_products.json`.

## Cloudflare Pages configuration

Cloudflare's docs say the build starts from the repository root unless a root directory is set, and that the build command is what produces the output directory.

| Setting | Value |
|---|---|
| Production branch | leave unset until a decision is made. Preview builds work from `feat/clay-cloudflare-preview` |
| Root directory | `/` (repository root; leave blank) |
| Framework preset | None |
| Build command | `node scripts/build-clay-hosted.mjs` |
| Build output directory | `hosted/clay` |
| Environment variables | `NODE_VERSION` = `20` (the script needs Node 18 or newer). Optional: `SKIP_DEPENDENCY_INSTALL` = `1`, because the build uses no packages and the repo's only dependency is the Playwright test runner |
| Secrets | none. Do not add any |

Local check before connecting anything: `node scripts/build-clay-hosted.mjs && npx serve hosted/clay` (or any static server). Cloudflare Pages applies `_headers` automatically.

Limits to keep in mind (from memory of Cloudflare's published limits, not re-checked in this session): about 20,000 files per deployment and 25 MiB per file on the Free plan. This build has 58 files and the largest is about 1.2 MB. A test enforces both numbers.

## Tests

`npm run test:clay` (the new file is picked up by the existing glob; `npm run test:ci` runs everything). The new tests build into a temp folder, serve it like Cloudflare would (applying `_headers`), and open it at phone width **with no fake platform installed**. They check that:

1. the two existing Clay HTML files are never changed by the build, and that the build is repeatable;
2. the output has no `window.claude`, `claude.use`, `onSnapshot`, `.collection(`, `data/users`, GitHub raw, Supabase or `claudeusercontent`;
3. none of the 61 real seed records survive, and every demo record is named "Synthetic …" (further example-data tests are in `hosted-examples.test.mjs`, output-path and parser tests in `hosted-build-safety.test.mjs`);
4. the output holds only the allowed files and stays inside the Pages limits;
5. the CSP is origin-only;
6. the page boots at 390 px with no script errors, no policy violations, nine sections, no sideways scroll, and no outside request except the font hosts;
7. every section renders and every data file it requests exists;
8. product search reads its index from the page's own origin;
9. a change saved to `localStorage` survives a reload.

## Outstanding limitations and decisions

1. **No sync, no accounts.** Data lives only in each browser. That is deliberate for this step.
2. **Supabase later needs two changes here:** replace the stubbed `claySyncPush` and boot block with the existing, separately tested adapter, and widen `connect-src` in `_headers` to the project's host. Neither is done now.
3. **Fonts.** Google Fonts are kept for fidelity, so visitors' browsers contact Google. Self-hosting them removes that; it is a decision, not a requirement.
4. **Two links still point to Claude artifacts** (Safe Batch, Scent Atlas) until those apps have their own hosted addresses.
5. **Reference data freshness.** The data files are copied at build time from the branch. A Cloudflare build picks up whatever is on the connected branch.
6. **Product-name search** uses a 13 MB index. It loads on demand, but first use on a slow phone connection is the thing to watch in a real-device check.
7. **Not yet tested on a real phone or on Cloudflare itself.** Everything above is verified in a local Chromium at 390 px.
8. **The demo profile chip, the banner and noindex are preview-only.** A real launch needs its own decisions on name, domain, analytics and privacy wording.
