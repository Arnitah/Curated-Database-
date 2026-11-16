# clay-data: the Clay v2 data-contract library (PR A)

Offline, synthetic-only. Nothing in `apps/clay.html` imports this folder, no live data is read or written, and CI for it is advisory and read-only. It defines the shapes, identifiers, hashes and checks that a later, separately approved stage (PR B) will use to migrate Clay's v1 data. PR A contains no migration code.

Specification: PR A implementation specification Revision 4.2 (approved 16 Nov 2026). Labels used below: RECORDED means stated in Handoff - Clay; DECISION means a design decision made on 15 and 16 Nov 2026; neither is a claim about any historical implementation.

## Contents

| Path | What it is |
|---|---|
| `src/states.js` | The six value states and the presence rules for a state field |
| `src/canonical.js` | Restricted canonical JSON, content hash, and the `ck1-unicode-15.0.0` comparison key |
| `src/ids.js` | Event ids, migration ids, collision detection, the diagnostic snapshot locator |
| `src/validate.js` | A small validator for the restricted JSON Schema subset the shipped schemas use |
| `schema/*.schema.json` | Seven schemas: `common`, `manifest`, `product-identity`, `owned-item`, `ingredient-observation`, `correction`, `directions` |
| `data/unicode-15.0.0.json` | Pinned Unicode 15.0.0 data: case folding, assigned ranges, canaries, licence notice |

Tests are in `tests/clay-data/` (`npm run test:data`) and `tests/clay/ci-paths.test.mjs` (part of `npm run test:clay`). Node built-ins only; no dependency was added. Runtime needs Unicode 15 or later (Node 20 or later); an older runtime returns `unavailable` with the reason `runtime_unicode_older_than_15_0` and never a key.

## Value states

Every optional fact is a field `{ state, value?, source?, candidates?, reason?, setBy }`. The state describes our record of the fact, not the real world. The six states are `stated`, `not_stated`, `unknown`, `missing`, `not_applicable` and `conflicting`.

| State | Requires | Allows | Forbids |
|---|---|---|---|
| stated | value, source | | candidates, reason |
| not_stated | source | | value, candidates, reason |
| unknown | reason | source | value, candidates |
| missing | reason | | value, source, candidates |
| not_applicable | reason | | value, source, candidates |
| conflicting | candidates (two or more, each with value and source) | | value, source, reason |

`setBy` is always required (`user`, `rule` or `migration`). `missing`, `unknown`, `not_stated` and `conflicting` are insufficient information: screening and pairing must never read them as absent or safe.

## Identifiers

- Event id: `e_` plus a random UUIDv4. Used for every record the user creates.
- Migration id: `m_` plus the first 32 lowercase hex characters of SHA-256 over the canonical JSON of `{kind:"clay-v1-migration", v1_doc, v1_id, part, ordinal}`. This is the RECORDED formula and it is frozen; a change needs its own approval. `kind` is a constant. `v1_doc` is one of `clay-products`, `clay-hair`, `clay-log`, `clay-prefs`, `clay-scents`; `part` is one of `identity`, `owned_item`, `observation`, `legacy_raw`; `v1_id` and `ordinal` are non-negative safe integers.
- The id depends only on where the data came from in v1, never on its content. `ordinal` is the zero-based output index within (`v1_doc`, `v1_id`, `part`), assigned by position in the v1 source and never by content.
- Collisions. Truncating to 128 bits means distinct inputs are expected, but not mathematically guaranteed, to give distinct ids. Detection is therefore a failure condition: `checkMigrationIds` throws `migration_id_collision`, naming positions only. No guarantee of collision-freedom is claimed, and the tests exercise detection by deliberate injection.
- Records with no valid migration id (a missing or invalid v1 id, and every copy of a duplicate valid v1 id) get no migration id. They are reported by a diagnostic locator `{ v1SnapshotHash, v1_doc, index }` (zero-based index). The locator is never an id, never hashed into one, never stored as identity, and means nothing outside its snapshot. `v1SnapshotHash` is `sha256:` plus exactly 64 lowercase hex characters.
- Limit: if v1 reused one id number for two different products across time, a single snapshot cannot show it.

## Schemas and the partition

| Schema | Classification |
|---|---|
| product-identity, owned-item, ingredient-observation | Migrated (parts `identity`, `owned_item`, `observation`) |
| common | Shared definitions only; not an entity |
| correction, directions | Created by the user, not by migration; `e_` ids only; never migrated (DECISION) |
| manifest | Not an entity; no `id`; identified by the path `clay2/manifest` and each run's `runId` (DECISION) |

Manifest contract: `schemaVersion` (integer, at least 1; the concrete value stays open until the manifest-writing contract is approved) and `runs`, an array of `{ runId, mappingVersion, v1SnapshotHash, counts }`. `runId` is a lowercase UUIDv4 (a new design decision approved with Revision 4.2). `counts` is a closed object of four non-negative integers: `input`, `migrated`, `migrated_with_flags`, `quarantined`. The manifest has no `id`, `idKind`, `entityType`, `origin`, `createdAt` or `contentHash`. Because `runId` differs on every run, the manifest is outside the rule that a rerun on one frozen snapshot gives byte-identical output; that rule applies to the migrated records, their ids and hashes, and the report content.

The schemas are written as Draft 2020-12 documents using only these keywords: `$schema`, `$id`, `$defs`, `$ref`, `$comment`, `title`, `description`, `type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `items`, `minItems`, `maxItems`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`, `oneOf`. A node with `$ref` may carry only annotation siblings. Integer limits: `type: integer` accepts safe integers only and rejects negative zero (`-0`), matching canonical JSON, which also rejects it; every other integer behaves as before. A float, `NaN`, `Infinity` and a value beyond 2^53-1 in magnitude are rejected. Limits: PR A has no second validator to cross-check that the schemas are valid 2020-12; no `format` validation is performed. Two things the subset cannot express are not enforced by the schemas: that an `id` prefix agrees with `idKind`, and that `createdAt` agrees with its `clock`. They are PR B runtime checks.

## Quarantine-class records, flags and the migration block

Option C (DECISION): PR A defines no persisted quarantine entity and no `legacy_raw` schema. `legacy_raw` is one of the four migration parts for the id formula and for report references only. This defers part of the recorded design, which keeps quarantined records verbatim in an envelope.

A record is quarantine-class when it has one of the recorded reason codes `invalid_area`, `invalid_status`, `empty_name`, `duplicate_id` or `unsupported_status_next`; when its v1 id is missing or not a valid integer; when it is flagged `needs_decision` or unmapped, which includes the rows the recorded design calls "rows 24 and 56"; or when a value cannot be safely and faithfully preserved. Whether rows 24 and 56 are v1 ids, source-row numbers or snapshot positions is unresolved and is not inferred here; no fixture, test or schema uses those numbers.

Departure from the recorded text: the recorded design lists `unknown_field` among example quarantine reason codes. By decision of 16 Nov 2026, unknown v1 fields are preserved losslessly under `legacyExtras` and `unknown_field` is a non-blocking flag. A record that carries only flags is counted under `migrated_with_flags`, never `quarantined`.

Every v1 record ends in exactly one category: `migrated`, `migrated_with_flags` or `quarantined`. Count conservation: input = migrated + migrated_with_flags + quarantined. "Quarantined" means reported and blocked, not stored.

Migration block (a requirement for PR B and later; PR A has no migration code): a quarantine-class record must not be silently discarded, repaired or migrated as though valid. A real migration must stop, or finish only as a report-only dry run, and none may complete while any quarantine-class record exists, until an approved quarantine destination exists and the records are correctly classified. Reports carry counts, reason codes and locators only; raw v1 records never enter fixtures, repository files, CI output, logs or handoffs.

## Hash definitions

All digests are SHA-256, lowercase hex, over the UTF-8 bytes of the text defined here, with LF line ends and no BOM. `hx(x)` is code points as lowercase hex without leading zeros, space-separated. The tests hash the named property or computed text, never a whole JSON file.

| Name | Definition | SHA-256 |
|---|---|---|
| FOLD | `JSON.stringify(data.fold)`: 1,530 entries, status C and F only | `39172e88d33502decbd71f4c1da95ab90b69168189a21c1798855fa730b87e2d` |
| RANGES | `JSON.stringify(data.ranges)`: 707 ranges covering 286,719 code points assigned in Unicode 15.0 | `78bd1641f1e8e3d5b9f1d764e1ee61223acb5ae5a8f33d0fccebe1a71e2aab75` |
| CANARY-62 | per single canary, ascending: `hx(cp):hx(NFD)\|hx(NFKD)` plus LF | `af13a49a856b3da6a5e84e640d87091b6936e44bf9c45507dbbe5cbc7009d00b` |
| ND15 | the same line for every code point in RANGES, concatenated | `a303eb900b4477807380849b26a11c62d194a496e72573ffa2f718498a86ceb6` |
| SEQ-CANARY | 20 lines `hx(NFD(sequence))` joined by LF, no trailing LF | `9167df06615cfeccb39e5a3f73d46f8ef245fb9386d71136c257fe5be01fa430` |
| V24 | 24 vectors, each `U+XXXX ... => U+.. or UNAVAILABLE(reason)`, joined by LF | `b6bc5f0f430c1b7878004d5ebfc89b736d8255f973bb4382270d9dec52354a5b` |
| O2 fixture | the committed conformance file (831,164 bytes, 2,045 test lines) | `c646d8932aca270c494f99b9d3a1396e1c344de1d36e7ad442e062f211048833` |

CI asserts ND15, SEQ-CANARY and V24 on a Unicode 15 or later runtime. For contrast only (documented, never asserted): on Node 18.0.0 (Unicode 14) ND15 is `27c8a27655ba6b04dabd1cc16c9b8ebcbcfe705d6445804a108d79c039eccba5`, SEQ-CANARY is `04d1249d2220ed71e67512daef98cdc3ba001556373667114297e7b957c04003` and V24 is `4510db92f209cf5e8f83bdf670180348bce4d3e8a260ecf88ea0b5a7001c1dc9`. On an older runtime the tests assert the `unavailable` behaviour instead of skipping.

The set of 20 sequence canaries has 6 older-runtime reordering detectors and 14 no-reorder controls. The start-up self-test checks 62 single canaries and these 20 sequences. It is a canary, not a conformance test: it cannot detect partial or custom Unicode data and does not test folding or the guard.

The comparison key `ck1-unicode-15.0.0` converts CR and CRLF to LF, then applies NFD, case fold, NFKD, case fold, NFKD, then collapses White_Space and trims. Guard N1 returns `{ state: "unavailable", version, reason }` with no key when the text has an unassigned code point (`code_point_not_assigned_in_unicode_15_0`), a lone surrogate (`lone_surrogate`) or the runtime is older than Unicode 15.0 (`runtime_unicode_older_than_15_0`). Unavailable keys are never compared.

## Unicode provenance and licence

All data is from Unicode release 15.0.0, directory `https://www.unicode.org/Public/15.0.0/ucd/`. The hashes are of the files as retrieved and re-downloaded at implementation; all four matched.

| File | SHA-256 |
|---|---|
| `CaseFolding.txt` | `cdd49e55eae3bbf1f0a3f6580c974a0263cb86a6a08daa10fbf705b4808a56f7` |
| `UnicodeData.txt` | `806e9aed65037197f1ec85e12be6e8cd870fc5608b4de0fffd990f689f376a73` |
| `NormalizationTest.txt` | `fb9ac8cc154a80cad6caac9897af55a4e75176af6f4e2bb6edc2bf8b1d57f326` |
| `ReadMe.txt` | `53672c0d0b5185e3cf04c8e970d544c3af81ae7c8eeba0b9cf6d355aa954ae1f` |

The committed conformance fixture is `NormalizationTest.txt` with every line between the `@Part1` and `@Part2` header lines removed; nothing else is altered. Part 1 was run during review, not in CI. The current licence text at `https://www.unicode.org/license.txt` (SHA-256 `e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96`) is not the release-time notice. The release-time notice is reproduced in the Oracle Java SE 21 Licensing Information User Manual (`https://docs.oracle.com/en/java/javase/21/licensing/java-se-licensing-information-user-manual.pdf`, SHA-256 `cf93d61908160840496c44f4ad1ea63f7e234ec0a86416560ccf67b12d5f4114`), and the notice stored in `data/unicode-15.0.0.json` follows it. That Oracle text is a third-party reproduction used as corroboration only. It is not verification against the Unicode archive, the archived 2022 Unicode terms page could not be retrieved, and none of this is legal advice or a legal guarantee; it is provenance.

## Reviewer evidence (review evidence, not a CI guarantee)

Produced in a scratch environment on 13 Nov 2026 with scripts and a corpus generator (seed 20261113) that are not committed and that CI does not run. They show what was observed during review on the named runtimes. Nothing in PR A claims them as ongoing guarantees, and none is asserted by any test.

| Evidence | Result |
|---|---|
| NormalizationTest Part 1 (17,029 lines) | 0 NFD/NFKD failures on Node 20.0.0, 20.20.2, 22.23.4, Chromium 131, Firefox 132, Playwright Linux WebKit and Python 3.13; 82 on Node 18.0.0 (Unicode 14). Run during review, not in CI |
| Corpus A, 400,000 strings (400,000 ok, 0 unavailable, 0 idempotence violations) | Unicode 15+ digest `00b035cec4e23b1bc90f76c052fe0e3f9001a29bd58d00add1e56f4208c6402c`; Node 18 `a3347d90013cc81745a8f21cc0b02184b43fdecc1d1d9d8b32e7f39e3ea9fbf4` (all unavailable); matches an independent Python reference |
| Corpus B, 100,000 strings (8,357 ok, 91,643 unavailable; the ok ones are exactly those containing U+1FAE8, assigned in 15.0) | Unicode 15+ `53a37b27733e462cba178aeb9fb7dd39865872c7c2378748b26842e65b0f0bbb`; Node 18 `6c1b8f9c96e91ef94ae5e46cd90b182abbe302e4e96f9ce07bfe8cce1870c8d4` |
| 850,084 ordered mark pairs (922 marks with non-zero combining class) | Unicode 15+ `3ed428ed94f18995285f44ed8bcb90fc62602ab035b5f4f891b9341a57a8f416`; Node 18 `b6883fb1a17f33a9506570ff21cbe8d1a79ace87eb9a5c5966a34ce7c9a427ea` |

## CI path filters (D9, D13): what is and is not covered

The workflow `clay-tests.yml` is advisory and read-only. It now lists twelve path filters, identical under `pull_request` and `push`: the original six (`apps/clay.html`, `apps/ingredient-intelligence/**`, `tests/clay/**`, `package.json`, `package-lock.json`, `.github/workflows/clay-tests.yml`) and six added by PR A (`apps/clay-data/**`, `tests/clay-data/**`, `data/clay/**`, `data/safe-batch/**`, `data/scents/**`, `version.json`). `tests/clay/ci-paths.test.mjs` checks the lists, that the files the harness loads or the app references are covered, and that the one documented gap is not.

Limits, which are different conditions with different effects:

- GitHub documents three conditions for path-filtered workflows: a push of more than 1,000 commits and a diff that times out both always run the workflow (an extra run, harmless here); a diff of more than 3,000 files whose matching files are not among the first 3,000 returned means the workflow does not run (a possible missed run). The page can change; it was read on 14 Nov 2026.
- A path-filtered workflow does not run when every changed path is outside its filters, so it cannot run its own coverage test then. The test sees only the files the harness declares and cannot detect a new loaded dependency or application-referenced path that nobody adds to its list (no static scan, D13).
- Commits made with `[skip ci]` never run CI. The `version.json` and `data/**` filters principally affect human edits, because the workflows that write those paths automatically (the data version bump, the daily hub pull, the weekly scent check and the verdict record) commit with `[skip ci]`. Human edits to those paths still run CI.
- How GitHub treats renamed and deleted files for path matching is unconfirmed. The matcher in the test models GitHub's documented behaviour; it does not prove it. A skipped, path-filtered workflow would leave a required check pending, which would matter only if the workflow were required, and it is not.
- Known gap: `index/clay/products/names.json` is referenced by the app (product search) but is outside the twelve filters, so a hand edit to it will not trigger this workflow, and bot commits to `index/` carry `[skip ci]`. A test asserts that the gap stays documented.
- Branch restriction: `push` runs only for pushes to `main` (`push.branches: [main]`); `pull_request` has no equivalent restriction and runs for pull requests targeting any base branch. A push to another branch does not run this workflow whatever paths it touches, so work on a branch is covered only through its pull request.
- Maintenance: the harness list in `ci-paths.test.mjs` is hand-maintained. Any change to `tests/clay/helpers/`, to what `apps/clay.html` fetches, or to the engine bundle inputs means re-deriving and updating that list in the same PR (a review checklist item). New or removed files in `tests/clay/` are detected by the directory check.

## Privacy (D11) and limits

No deny-list, allow-list of real names, reference list or hash list of private values exists anywhere in this library or its tests. All fixtures are hand-authored and marked `"synthetic": true`; every free-text value begins with `Synthetic ` or `Synthetic-`, or is a structural token. Digests that appear in files must be pinned public digests, and migration ids must be recomputable from the synthetic inputs beside them. Shape checks cannot prove that arbitrary text is not private; they block the obvious shapes, and review remains the control. Any comparison against live records is a separate, separately approved local process.

Other limits: the Unicode data check at start-up is a canary; real Apple Safari is untested (Playwright Linux WebKit only); the whole-domain digests assume a Unicode 15 or later runtime, which CI's Node 20 provides, though the exact patch version resolves at run time.

## Rollback

Delete `apps/clay-data/`, `tests/clay-data/` and `tests/clay/ci-paths.test.mjs`; remove the six added lines from both path lists in `.github/workflows/clay-tests.yml`; remove the `test:data` script and the `&& npm run test:data` part of `test:ci` in `package.json`; or revert the PR A commit. Nothing else depends on them. Known and accepted: `tests/clay/README.md` line 49 ("the three `test:*` lines") describes the Phase 1 rollback and will be one line short after PR A; this note supersedes it for PR A, and that file is not edited.
