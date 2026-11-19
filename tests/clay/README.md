# Clay tests (Phase 1 safety foundation)

These tests watch the Clay page (`apps/clay.html`) and the ingredient engine. They change nothing in the app, the data, the catalogue or the deployment.

## Run

```
npm ci
npx playwright install chromium
npm run test:ci        # engine suites + Clay tests
npm run test:clay      # Clay tests only
npm run test:engine    # engine suites only
```

## How they stay away from real data

- The page runs in a fresh browser profile on a local server bound to 127.0.0.1.
- Every request to any other host is blocked. Only the font hosts are ever attempted.
- `window.claude` is replaced by an in-memory fake (`helpers/fake-platform.mjs`). It only accepts the signed-in test user's own five documents and records anything else as a violation.
- Test user ids always start with `test-`. Product data comes from the public starter list already inside the app, or from invented records whose names start with `Synthetic `.
- `isolation.test.mjs` scans fixtures, helpers, logs and stored documents for real-looking ids and emails, and `helpers/launch.mjs` refuses to take a screenshot if the shelf holds anything else.
- Screenshots exist only when a page check fails, go to `test-results/` (git-ignored) and are uploaded as a CI artifact for 7 days.

## What the three labels mean

Each test name starts with one of these:

- **[invariant]** must always hold. A failure is a real problem.
- **[current-behaviour]** how things work today, written down so a change is noticed. Not a product requirement. If the behaviour is changed on purpose, update the test.
- **[known-limitation]** a documented gap. A pass means the gap still exists. Never treat it as a requirement; when the gap is fixed, the test is meant to be replaced.

Known limitations recorded today:

1. Sync still uses device timestamps when both copies contain data, but empty/missing snapshots are no longer authoritative over non-empty saved data. Whole-document concurrent edits and device-clock skew between two non-empty copies remain limitations; the current data model has no per-record revision or tombstone.
2. The engine now withholds full-product classifications when either list is unverified, explicitly partial, contains unrecognised labels, or includes registry entries pending review. A provisional matched pattern may be retained for transparency, but the result is `insufficient_data` with unknown confidence.

## Files

- `helpers/` server, fake platform, browser launcher, leak scanner
- `fixtures/synthetic-shelf.json` invented records
- `boot`, `pages`, `sync`, `migrations`, `shelf-actions`, `engine-integration`, `bundle-parity`, `isolation` test files

## Hosted preview tests

`hosted.test.mjs` builds the static Cloudflare Pages preview into a temp folder and checks it with no fake platform at all: no `window.claude`, no artifact database, synthetic data only, same-origin network only. See `docs/clay-hosted-preview.md`.

## Limits

The fake cannot prove the real platform's rules, listener timing or device-clock skew. The tests read `apps/clay.html` from the repository, so they only describe the published page if the two match.

## Rollback

Delete `tests/clay/`, `.github/workflows/clay-tests.yml`, `package-lock.json`, the three `test:*` lines in `package.json` and the `test-results/` line in `.gitignore`, or revert the commit. Nothing else depends on them.
