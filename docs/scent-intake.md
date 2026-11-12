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
`checked` brand's own shop · `retailer` checked at a shop · `brand` the brand says so · `database` fragrance database ·
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
| `hq` | where the house is based |
| `made_in` | where it is formulated, made or filled |
| `founder` | who founded it |
| `owner` | who owns it now (parent company, majority holder) |
| `catalogue` | what it currently sells |
| `status` | whether it is still trading |
| `history` | founding year, origin story, milestones |

Each topic claim needs `strength`: **A** official, registry, government or academic; **B** credible journalism or trade press; **C** brand self-description, retailer or lifestyle press; **D** unsourced. Add `published` (YYYY, YYYY-MM or YYYY-MM-DD) when the source shows a date, and `open` for anything still unresolved. `seen` is the access date. When two sources disagree, keep both and say which one stands and why.

Houses can carry an optional `class`: `independent`, `artisan`, `commercial` (part of a larger company), `contract-made`, `diaspora` (rooted in one place, made in another), `retailer` or `tradition`. Set it only when the evidence supports it.

**Verified-house rule.** A house counts as verified only when `owner`, `made_in` and `catalogue` each have at least one claim at strength A or B that is not the brand's own site. The app shows this under "Where this comes from". A website alone never promotes a lead.

Traditions take a `sources` list (`url`, `title`, `strength`, `published`, `accessed`) and a `verify` line for what is still unconfirmed. `scripts/build.mjs` checks all of these fields.
