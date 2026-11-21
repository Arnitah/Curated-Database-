# Scent Atlas geography schema and migration plan

**Status:** approved additive schema design; implementation proposed on a review branch  
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
- `scripts/build.mjs`: previously validated claim topics and source metadata, but not typed locations.
- `scripts/check-scents.mjs` and `.github/workflows/scents.yml`: weekly checks update rates, links, live prices and fieldnotes; they do not write house geography.
- `.github/workflows/data.yml`: validates data and rebuilds dataset versions; add geography unit tests.
- `docs/scent-intake.md`: existing intake guide said one observation per claim but grouped HQ and made-in relationships too broadly.
- `dist/scent-atlas.html`: self-contained snapshot with embedded data and no observations-ledger integration; no in-repository build script was found that safely regenerates it. Do not hand-edit this generated snapshot.
- `archive/scent-map.html`: archived map reader; retain compatibility during the additive phase.

## Dataset snapshot

**Main-branch baseline before the typed pilot (2026-11-21):**
- 178 houses and 178 map points.
- 205 observations, including 19 claims. The legacy claim topics were 8 `hq`, 3 `made_in`, 3 `owner`, 2 `history`, and 1 `founder`; two additional claim records had no topic.
- 7 houses had no observation of any kind.
- Map precision: 110 `city`, 1 `region`, 67 `country`. Some entries marked `country` have city-named places such as Tokyo, Manila and Bangkok. This needs a separate precision audit; precision is spatial granularity, not evidence confidence or relationship type.

**Current PR branch after the pilot batches:**
- 529 observations total, including 324 typed geography claims across 92 existing houses and 3 research leads.
- 86 of the 178 existing house records still have no typed geography claim. Legacy `hq` / `made_in` claims have not been silently reclassified.
- The pilot's lead-linked records remain leads; they are not inserted into `houses.json` as established houses.

## UI and map behaviour

- House cards prefer a sourced `brand_origin` fact when one exists.
- Without typed origin, show legacy city/country only as a recorded location, not verified origin.
- The evidence panel displays typed location beside the claim and source.
- `geo.json` remains one map anchor per house. `precision` means spatial granularity only.
- Do not create multiple map pins until the map UI can label and filter each point by relationship role.

## Verification rule

A house is verified only when ownership, **manufacturing location**, and current catalogue each have an independent strength A or B claim. Formulation, filling, assembly, studio, sourcing and retail do not substitute for manufacturing. Legacy `made_in` claims do not qualify until source-reviewed and explicitly reclassified.

## Migration sequence

1. Add and test the additive schema; retain old topics and fields.
2. Re-open each existing geography claim and split compound statements into one relation/place per observation.
3. Pilot contrasting cases: TADHANA, KST Scent, Bortnikoff, Dusita, Gabar, Sana Jardin, Amouage, Maya Njie, Beguile and Etre Parfums.
4. Review all 178 houses by relationship. Add only sourced claims; preserve unknowns.
5. Migrate the UI after enough typed origin facts exist; keep legacy fields as fallback.
6. Audit map coordinates and precision separately, then add role-labelled multi-site pins only when evidence and UI support them.
7. Deprecate legacy city/country reliance only after all consumers, snapshots and exports migrate.

## Acceptance criteria

- No existing house or map record is silently reinterpreted.
- Every new geography claim has one topic, one location, a source, evidence type, strength and checked date.
- Validator rejects missing or malformed location metadata.
- Legacy records continue to validate and render.
- Weekly scent workflow never changes geography facts.
- Unit tests cover valid, incomplete, malformed, legacy and non-geography records.
- All 178 houses are reviewed before bulk reclassification; unknown facts remain empty.
