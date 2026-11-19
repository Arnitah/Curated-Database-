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
- `build-info.json`: source hash, list of patches, synthetic-data flag.
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
3. none of the 61 real seed records survive, and every demo record is named "Synthetic …";
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
