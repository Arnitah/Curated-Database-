# Scent Atlas geography schema and migration plan

**Status:** additive schema implemented on PR #14 review branch; not merged or released  
**Date:** 2026-11-21

Use `data/scents/observations.json` as the single source of truth for sourced geography facts. Do not create a parallel `geography.json` that duplicates the same sources and claims. Each geography observation is one dated source claim about one relationship and one place. A house can therefore have several locations for one relationship, and the same city can legitimately appear under different relationships.

A typed geography observation has `kind: "claim"`, a relationship-specific `topic`, `location: { country, cc, city?, region?, entity?, site? }`, and the existing `src`, `evidence`, `strength`, `seen`, optional `published`, optional `open`, and `text` fields. `cc` is an uppercase ISO 3166-1 alpha-2 country code. Country-only facts are valid; do not invent a city. One observation contains one location. Use `entity` for a named legal entity and `site` for a named physical studio, factory or other facility. If a source establishes multiple locations for the same relationship, create one observation per location, all citing that source.

## Topic vocabulary

| Topic | Meaning |
|---|---|
| `brand_origin` | Where the house itself was founded or created |
| `founder_origin` | A founder's place of origin or heritage; never substitute for brand origin |
| `legal_base` | Registered legal entity or legal address |
| `commercial_base` | Principal operating or commercial base |
| `studio` | Perfumer, creative or brand studio |
| `formulation` | Where the composition is developed |
| `manufacturing` | Where the fragrance product is manufactured |
| `filling` | Where finished product is filled or bottled |
| `assembly` | Where components or filled products are assembled into the finished offer |
| `sourcing` | Where a named raw material is grown, harvested or sourced |
| `retail` | Official shop, boutique, flagship or retail presence |

Historical `hq` and `made_in` topics remain accepted for backwards compatibility but are ambiguous and deprecated for new claims. They must not be silently reinterpreted as any one new topic. Founder, owner, catalogue, status and history claims remain non-geographic unless the source establishes a distinct location relationship.

## Evidence and inference rules

- Never infer origin from a founder's birthplace, cultural heritage, currency, shipping origin, fulfilment address, store location or raw-material sourcing.
- Never infer legal or commercial headquarters from a retail address, studio, founder residence or manufacturing site.
- Never infer formulation from manufacturing, filling or assembly, or vice versa. Record assembly separately; it does not by itself establish where the fragrance was formulated or manufactured.
- A source saying "developed in Dubai" supports formulation, not manufacturing.
- If a source says "made in" without clarifying the stage, retain a legacy claim or leave the relationship unresolved; do not guess.
- If sources conflict, retain each dated source claim and explain the conflict in `open`; do not overwrite the evidence history.
- A single source that mentions several distinct relationships should be split into separate observations with the same source URL and date.
- Unknown remains unknown. No blanket backfill from the legacy `houses.json` fields.

## Compatibility audit

- `houses.json`: 178 records; cards currently read `city`, `country` and `cc`.
- `geo.json`: 178 map points; one anchor per house with `lat`, `lon`, `place`, `precision`.
- `apps/scent-atlas.html`: loads `observations.json`, renders evidence claims, and uses legacy house city/country on cards.
- `scripts/build.mjs`: validates typed geography topics, location shape, country names and ISO alpha-2 codes through `scripts/scents-geography.mjs`.
- `scripts/check-scents.mjs` and `.github/workflows/scents.yml`: weekly checks update rates, links, live prices and fieldnotes; they do not write house geography.
- `.github/workflows/data.yml`: runs the data validator and the Scent Atlas geography unit tests on relevant pull-request paths.
- `docs/scent-intake.md`: now documents the typed relationship vocabulary, one source/relationship/place per observation, and the verified-house rule.
- `dist/scent-atlas.html`: self-contained snapshot with embedded data and no observations-ledger integration; no in-repository build script was found that safely regenerates it. Do not hand-edit this generated snapshot.
- `archive/scent-map.html`: archived map reader; retain compatibility during the additive phase.

## Dataset snapshot

**Main-branch baseline before the typed pilot (2026-11-21):**
- 178 houses and 178 map points.
- 205 observations, including 19 claims. The legacy claim topics were 8 `hq`, 3 `made_in`, 3 `owner`, 2 `history`, and 1 `founder`; two additional claim records had no topic.
- 7 houses had no observation of any kind.
- Map precision: 110 `city`, 1 `region`, 67 `country`. A first-pass review found 39 of the 67 `country`-precision points use city-named place labels and city-centre coordinates. Additional country-named labels also use city-centre coordinates (for example India/New Delhi, Indonesia/Jakarta, Ireland/Dublin, Sweden/Stockholm and UAE/Dubai). This is a release hold for a source-and-coordinate audit; no `geo.json` values have been changed. Precision is spatial granularity, not evidence confidence or relationship type.

**Current PR branch at commit `392db198f5dc3ee54fc47a94de30c7d9f9b244dc` (2026-11-23):**
- 621 observations total: 435 claim records, including 416 typed geography claims.
- Typed geography claims cover 156 of 178 existing houses and 3 research leads; 22 existing houses have no typed geography claim yet.
- The 11 legacy `hq` / `made_in` claims remain unchanged and un-reclassified.
- The 3 lead-linked records remain leads; they are not inserted into `houses.json` as established houses.
- Counts were recomputed directly from `observations.json`, `houses.json` and `leads.json` at the stated commit.

## UI and map behaviour

- House cards prefer a sourced `brand_origin` fact when one exists.
- Without typed origin, show legacy city/country only as a recorded location, not verified origin.
- The evidence panel displays typed location beside the claim and source.
- `geo.json` remains one map anchor per house. `precision` means spatial granularity only.
- Do not create multiple map pins until the map UI can label and filter each point by relationship role.

## Verification rule

A house is verified only when ownership, **manufacturing location**, and current catalogue each have an independent strength A or B claim. Formulation, filling, assembly, studio, sourcing and retail do not substitute for manufacturing. Legacy `made_in` claims do not qualify until source-reviewed and explicitly reclassified.

## Migration sequence

1. **Complete:** add and test the additive schema; retain old topics and fields.
2. **In progress:** re-open existing geography claims and split compound statements into one relationship/place per observation; retain unresolved claims rather than guessing.
3. **Complete for the current pilot:** pilot contrasting houses and expand source-reviewed batches; the latest batch is recorded in the observations ledger.
4. **In progress:** review all 178 houses by relationship. Current coverage is 156 houses with typed claims; 22 remain without typed geography. Add only sourced claims and preserve unknowns.
5. **Implemented on the PR branch:** migrate the live source app to typed origin/evidence display while retaining legacy fields as fallbacks. The self-contained `dist/scent-atlas.html` snapshot remains a separate compatibility/republication hold.
6. **Release hold:** complete the map coordinate and precision audit. The first pass identified 39 city-labelled/city-centred points still marked `country`, plus further country-labelled points whose coordinates appear city-centred. Do not bulk-change precision or coordinates without source review.
7. **Pending:** deprecate legacy city/country reliance only after all consumers, snapshots and exports migrate; keep the 11 legacy geography claims until individually source-reviewed and reclassified.

## Acceptance criteria

- No existing house or map record is silently reinterpreted.
- Every new geography claim has one topic, one location, a source, evidence type, strength and checked date.
- Validator rejects missing or malformed location metadata.
- Legacy records continue to validate and render.
- Weekly scent workflow never changes geography facts.
- Unit tests cover valid, incomplete, malformed, legacy and non-geography records.
- All 178 houses are reviewed before bulk reclassification; unknown facts remain empty.
