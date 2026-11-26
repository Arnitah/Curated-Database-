# Scent Atlas intake flow

How new material gets into the Scent Atlas, from Nitah's find to a checked record.

## 1. Capture: the Finds Inbox
Nitah drops finds into the **Scent Atlas Finds** artifact (https://claude.ai/artifact/T2LKr6V3ERknmXttRgYA6M):
screenshots, a link, one line, an optional price/currency/size, where it was seen, what kind it is and where it came from.
Research summaries go in the "Research results" tab. Everything lands in the artifact database, collection `finds`.

Each find has a `status`: `new` → `checking` → `added` | `excluded`, or `question` (needs Nitah). Claude writes a short `reply` on each.

## 2. Process (when Nitah says "check the inbox")
1. Read `finds` with `status == new` (ArtifactData `query`). Screenshots are assets: read them by id.
2. Mark each one `checking`.
3. Identify the brand; verify on the brand's own shop first (Shopify `/products/<handle>.json`, `/search/suggest.json`).
4. Rewrite everything in plain words (never copy text). Skip big designer brands, copy/"inspired by" sellers, bulk oil suppliers and AI-made posts; log those in `data/scents/exclusions.json`.
5. Write the result: a house (`houses.json` + `geo.json`), a lead (`leads.json`), a shop, bespoke studio, trend or twin.
6. Add **one record per price or claim** to `data/scents/observations.json` (never overwrite; add a new dated record).
7. Add a line to `data/scents/fieldnotes.json` for anything added, corrected, moved or excluded.
8. `node scripts/build.mjs`, commit, push; republish the Atlas artifact.
9. Set the find's `status` and `reply` (what was done, or the question for Nitah).

## 3. Evidence types (observations.evidence)
`checked` brand's own shop · `retailer` checked at a shop · `brand` the brand says so · `database` fragrance database · `registry` official company or government register ·
`editorial` press or industry article · `reported` marketplace, reseller or AI summary, not checked · `creator` one person's opinion ·
`nitah` confirmed by Nitah.

## 4. Research template
The inbox's "Research template" tab holds a prompt that makes research tools return JSON Lines in these same fields
(type, house, perfume, notes, price, currency, size, price_kind, text, evidence, source_url, seen, does_not_prove, confidence).

## 5. Weekly self-check (GitHub Action, Mondays)
`.github/workflows/scents.yml` runs `scripts/check-scents.mjs`: refreshes rates, tests every link, reads live shop prices,
and writes price changes, broken links, stale prices (no sighting in 6 months) and a summary into `fieldnotes.json`.
Changed prices are to-dos for review; curated prices are never overwritten automatically.

## Ownership, production and the verified-house rule (added 11 Nov 2026)

Facts about who a house is go in `data/scents/observations.json` as `kind: "claim"` records with a `topic`, one record per source:

| topic | what it records |
| --- | --- |
| `brand_origin` | where the house itself was founded or created |
| `founder_origin` | founder heritage / place of origin, not the house origin |
| `legal_base` | registered legal entity or legal address |
| `commercial_base` | principal operating or commercial base |
| `studio` | perfumer, creative or brand studio |
| `formulation` | where the composition is developed |
| `manufacturing` | where the fragrance product is manufactured |
| `filling` | where finished product is filled or bottled |
| `assembly` | where components or filled products are assembled into the finished offer |
| `sourcing` | where a named raw material is grown, harvested or sourced |
| `retail` | official store, boutique, flagship or retail presence |
| `hq` / `made_in` | legacy-only ambiguous topics; do not create new claims with these |
| `founder` | who founded it |
| `owner` | who owns it now (parent company, majority holder) |
| `catalogue` | what it currently sells |
| `status` | whether it is still trading |
| `history` | founding year, origin story, milestones |

Each topic claim needs `strength`: **A** official, registry, government or academic; **B** credible journalism or trade press; **C** brand self-description, retailer or lifestyle press; **D** unsourced. Add `published` (YYYY, YYYY-MM or YYYY-MM-DD) when the source shows a date, and `open` for anything still unresolved. `seen` is the access date. When two sources disagree, keep both and say which one stands and why.

For every new geography topic, add `location: { country, cc, city?, region?, entity?, site? }` using an uppercase ISO 3166-1 alpha-2 `cc`. One observation is one source, one relationship and one place. Country-only facts are valid; do not guess a city. Use `entity` for a named legal entity and `site` only for a named physical studio, factory or other facility. If a source establishes multiple sites, add one observation per site. Keep existing `hq` and `made_in` records as historical evidence until their source is re-reviewed; do not silently relabel them.

Houses can carry an optional `class`: `independent`, `artisan`, `commercial` (part of a larger company), `contract-made`, `diaspora` (rooted in one place, made in another), `retailer` or `tradition`. Set it only when the evidence supports it.

**Verified-house rule.** A house counts as verified only when `owner`, `manufacturing` and `catalogue` each have at least one correctly typed claim at strength A or B supported by an independent source. The verification gate currently accepts `registry`, `editorial` and `database` source classes; brand, retailer, creator, reported and Nitah-supplied observations do not qualify, even when a record is present. Each requirement is evaluated separately, against the exact topic and house ID, and a source URL is required. The gate reports each requirement as supported or missing and counts non-qualifying records without hiding them. Formulation, filling, studio, sourcing, retail, legal base, commercial base and brand origin do not substitute for manufacturing or ownership. Legacy `made_in` claims do not count until their source has been reviewed and the relationship explicitly reclassified. A website alone never promotes a lead. The validation build reports the current verified count and the number of houses missing each evidence dimension; missing evidence is a warning, not a dataset error.

Traditions take a `sources` list (`url`, `title`, `strength`, `published`, `accessed`) and a `verify` line for what is still unconfirmed. `scripts/build.mjs` checks all of these fields.


See [Scent Atlas geography schema and migration plan](scent-geography.md) for the full relationship vocabulary, compatibility rules and migration sequence.


## Lead identity and lifecycle (25 November 2026)

Every lead has a stable lowercase `id`, a `status`, display `name`, short `lead` description and optional primary `src`. New or actively reviewed leads must also have a `country` and ISO alpha-2 `cc`; legacy records whose geography is incomplete retain that gap while marked `unreviewed`. Existing records migrated to IDs receive status `unreviewed`; this preserves their unknown review state rather than implying they are new or checked.

Allowed statuses:
- `unreviewed`: legacy or imported record whose current review state is not established.
- `new`: newly captured and not yet checked.
- `checking`: research in progress; sources and open questions are being assessed.
- `question`: identity or evidence needs a decision from Nitah.
- `qualified`: sufficiently identified for a house-entry proposal, but not yet promoted.
- `added`: promoted to the houses register; retain the lead's history and ID mapping in the change record.
- `excluded`: not a fragrance house or fails inclusion criteria; retain why and the evidence.

Optional `aliases` preserve alternate names. Optional `sources` is an array of source records with `url`, `evidence`, `checked` (YYYY-MM-DD) and `supports`. A source record states exactly what it supports; it does not imply the source proves every aspect of the lead. The primary `src` remains for compatibility with existing Atlas lead cards.

Promotion is not automatic. A qualified lead must be checked for identity/duplicates, current catalogue, owner, manufacturing and relationship-specific geography. Only after the verified-house evidence rule is satisfied may it be promoted as a verified house. Otherwise it may be added as a house with an explicit non-verified evidence state only if the Atlas inclusion decision supports it. Never treat a brand's own statement as independent A/B evidence.
