# Scent Atlas material provenance model

**Status:** design proposal; documentation-only branch; not merged, not wired into the live data validator or app  
**Version:** 0.1  
**Baseline:** Scent Atlas `main` at `8297f8449d9e6f346040874bd28739a94e8fa865`

## Purpose

Represent the evidence behind the materials used in fragrance without confusing a material's native range, cultivation area, harvest location, extraction site, processing location, formulation site, perfume-house base or retail presence.

This model complements the existing role-aware house geography contract. It does not replace it, add ingredient pins to the one-pin-per-house map, or assert that a brand's marketing story is independently verified.

## Design decisions

1. **Keep house geography and material provenance separate.** The house map remains one pin per house, anchored by typed house-geography observations. Material origin does not become the house's origin.
2. **Keep evidence append-only.** Each source-backed statement is a separate dated claim. Corrections and conflicts create new claims or review notes; do not overwrite source history.
3. **Represent a chain as linked stages, not one vague "origin".** Native range, cultivation, harvest, extraction, processing, trade/aggregation, formulation, manufacture and filling are distinct relationships.
4. **Allow many-to-many links.** A fragrance can use many materials; a material can appear in many fragrances; each material can have several possible origins and processing sites.
5. **Separate claim strength from traceability.** A strong source can support a general regional fact without proving the origin of a specific batch used in a perfume.
6. **Preserve the scope of evidence.** Record species, material form, product/SKU, batch/lot and time period when the source provides them. Do not generalise SKU-specific or batch-specific claims.
7. **Do not infer missing stages.** A statement that an ingredient is "from Guatemala" does not establish the farm, harvest district, extractor, exporter or chain of custody.

## Conceptual entities and relationships

```text
House ──makes──> Fragrance / Product
                     │
                     └──uses──> Material Use ──references──> Material
                                      │                         │
                                      │                         └──has──> Botanical taxon
                                      │
                                      └──supported by──> Material Claim
                                                             │
                                                             ├──describes──> Stage / relationship
                                                             ├──occurs at──> Place
                                                             ├──qualifies──> Method / practice
                                                             └──cites──> Source
```

### Existing canonical resources

- `data/scents/houses.json`: house identity; do not add material sourcing as a house-origin shortcut.
- `data/scents/materials.json`: existing material catalogue and broad reference origins. Its current `origins` are regional reference context, not proof that a particular house or perfume sourced a specific batch there.
- `data/scents/observations.json`: existing append-only house claims and price sightings. Its current validator accepts `price` and `claim`; typed house-geography claims have a restricted topic/location contract.
- `data/scents/regions.json`: regional scent context, not a supplier or traceability register.

**Implementation constraint:** do not insert material claims into `observations.json` as ordinary house geography topics. That would either misclassify a material claim as a house claim or weaken the existing map-anchor validator. The implementation proposal is to extend the observation contract with a separately validated `kind: "material_claim"` record in the same append-only observation register, while keeping the existing `kind: "price"` and `kind: "claim"` contracts unchanged. The validator, fixtures and UI must explicitly discriminate the three kinds before any data is migrated.

## Proposed material-claim record

The following is a conceptual v0.1 shape, not yet accepted by the runtime validator:

```json
{
  "id": "nissaba-tierra-maya-cardamom-guatemala-brand-2026-06",
  "kind": "material_claim",
  "house": "nissaba",
  "product": "Tierra Maya",
  "material": "cardamom",
  "material_form": "green cardamom pods",
  "botanical": {
    "scientific_name": "Elettaria cardamomum"
  },
  "stage": "cultivation",
  "relationship": "cultivated_in",
  "location": {
    "country": "Guatemala",
    "cc": "GT",
    "region": null,
    "locality": null,
    "site": null
  },
  "method": null,
  "practice": "Smallholder cultivation on family plots",
  "scope": {
    "product": "Tierra Maya",
    "sku": null,
    "batch": null,
    "period": null
  },
  "evidence": "brand",
  "strength": "C",
  "src": "https://nissaba.com/products/tierra-maya",
  "published": null,
  "seen": "2026-11-23",
  "text": "Nissaba describes its cardamom as cultivated on small plots by farming families across Guatemala.",
  "does_not_prove": [
    "the exact farm or locality",
    "the identity of the supplier",
    "the origin of a specific batch",
    "chain of custody from farm to perfume"
  ],
  "open": "Seek independent agricultural or trade evidence; no supplier-level traceability established."
}
```

The example captures the scope of a brand statement only. It is not a verified supplier record. The scientific name is a taxonomic working identification and must be checked against a botanical authority before acceptance as a verified taxon link.

## Field contract

| Field | Required? | Meaning |
|---|---:|---|
| `id` | Yes | Stable unique claim ID; never reused |
| `kind` | Yes | Exactly `material_claim` for this record family |
| `house` | Conditional | Existing house ID only when the claim is attributable to that house |
| `product` | Conditional | Human-readable fragrance/product name; retain exact product scope |
| `material` | Yes | Canonical material ID from `materials.json`, or an explicitly queued unresolved material ID |
| `material_form` | Recommended | Pod, seed, root, leaf, flower, resin, wood, oil, absolute, extract, etc. |
| `botanical` | Conditional | Scientific name and, when available, accepted taxon identifier / authority |
| `stage` | Yes | One stage from the controlled vocabulary below |
| `relationship` | Yes | Precise relationship asserted, such as `native_range`, `cultivated_in`, `harvested_in`, `extracted_in`, `processed_in`, `traded_through`, `used_in` |
| `location` | Yes | Place attached to this relationship, with country and ISO alpha-2 code; finer precision only when supported |
| `method` | Optional | Extraction or processing method, e.g. steam distillation, CO₂ extraction, enfleurage |
| `practice` | Optional | Cultivation, harvesting, stewardship, community or processing practice as explicitly sourced |
| `scope` | Recommended | Product/SKU/batch/period scope; do not generalise beyond it |
| `evidence` | Yes | Reuse existing evidence labels: checked, retailer, brand, database, registry, editorial, reported, creator, nitah |
| `strength` | Yes | A–D source strength, separate from whether a batch is traceable |
| `src` | Yes | Direct source URL |
| `published` | Optional | Source publication date when shown |
| `seen` | Yes | Access/check date |
| `text` | Yes | Faithful concise paraphrase of exactly what the source states |
| `does_not_prove` | Recommended | Explicit limits to prevent overclaiming |
| `open` | Optional | Unresolved evidence gap, conflict or follow-up |

## Controlled vocabularies

### Stage

- `native_range` — native distribution / botanical origin, not commercial supply.
- `cultivation` — where the crop is grown.
- `wild_harvest` — where material is gathered from wild populations.
- `harvest` — where a crop or plant part is collected.
- `primary_processing` — curing, drying, fermentation, cleaning, sorting or other first processing.
- `extraction` — where oil, resin extract, absolute or other extract is produced.
- `secondary_processing` — refining, fractionation, rectification, blending or other later processing.
- `aggregation_trade` — collection, auction, export, import or trading hub; not necessarily origin.
- `formulation` — where the fragrance composition is developed.
- `manufacturing` — where the finished fragrance product is made.
- `filling` — where finished fragrance is bottled.
- `use_in_product` — a material is named as an ingredient in a specified fragrance/product.

### Relationship

Use a controlled, explicit predicate rather than inferring from the stage. Initial values: `native_to`, `cultivated_in`, `wild_harvested_in`, `harvested_in`, `cured_in`, `dried_in`, `fermented_in`, `extracted_in`, `distilled_in`, `processed_in`, `fractionated_in`, `traded_through`, `exported_from`, `imported_to`, `formulated_in`, `manufactured_in`, `filled_in`, `used_in`.

### Evidence and traceability

Retain the existing A–D strength convention and evidence labels. Add a separate traceability assessment only when needed:

- `not_assessed`
- `regional_claim_only`
- `independently_corroborated_region`
- `named_producer_or_cooperative`
- `documented_chain_of_custody`
- `batch_or_lot_traceable`

These are not automatic consequences of source strength. For example, a brand's official page may be a primary source for what the brand claims, but still only support `regional_claim_only`.

## Location and map rules

- Use the existing country + ISO alpha-2 convention. Region/locality/site are optional and require source support.
- Keep harvest location and extraction location as separate claims, even if they are in the same country.
- A trade hub, exporter address, processing facility or perfume-house office must not be substituted for crop origin.
- No ingredient map pins are added to the house map. A future material map should be a separate layer with its own point/claim model and uncertainty display.
- Do not place representative country coordinates on a material map until a dedicated map contract is agreed; a country label is not a farm location.

## Evidence workflow

1. Capture the source statement verbatim in notes, then paraphrase it without changing scope.
2. Resolve the canonical material ID and botanical identity. Keep unresolved taxonomy explicit.
3. Classify the exact stage, relationship and place.
4. Record source type, strength, publication/access dates and scope.
5. Add `does_not_prove` and `open` where a reader could otherwise infer supplier, batch or chain-of-custody facts.
6. Seek independent corroboration appropriate to the claim: botanical authorities for taxonomy; agricultural ministries, extension services, academic studies and trade bodies for cultivation/harvest; technical or producer documentation for extraction; official product/packaging or regulatory sources for product composition.
7. Preserve disagreements as separate dated claims. Do not average conflicting places into one coordinate.
8. Promote a claim to a higher traceability level only when the evidence directly supports that level.

## Pilot against the current Nissaba material

These are test cases for the schema, not production claims or approved dataset rows.

| Case | Source-derived statement | Proposed modelling | What remains unproven |
|---|---|---|---|
| Tierra Maya — cardamom | Nissaba says green cardamom is cultivated on small plots by farming families across Guatemala; another slide says the pods are selected for extraction and describes CO₂ extraction. | Separate cultivation claim and extraction-method claim; do not infer extraction location from method alone. | Farm/locality, cultivar, producer, extractor, actual extraction site, lot traceability |
| Tierra Maya — cardamom history | Nissaba says cardamom is native to India and introduced to Guatemala in the early 20th century. | A historical crop-diffusion claim, distinct from the contemporary cultivation claim. | Exact introduction date and pathway; independent history sources required |
| Alpine materials | Nissaba maps Roman chamomile, pine trees, sage, pino mugo, wild carrot, immortelle, juniper berries, hay and pine needles across an Alpine area; a separate slide says hay is collected from mountain meadows and pine needles from subalpine forests. | Each material gets its own stage/place claim. Keep map labels at the precision actually visible; do not assign a single Alpine coordinate to every item. | Exact harvesting locality, land manager, extraction location, species/form for each label |
| Provence — hyssop | Nissaba says hyssop is grown on the sunlit hills of Haute Provence and used in Provence. | Separate cultivation-in-region and used-in-product claims. | Farm, species/cultivar, harvest year, extractor and batch traceability |
| Chaco — guaiacwood | Nissaba describes guaiacwood as native to the Paraguayan Chaco and gives a woody profile. | Taxon + native-range claim; separate any commercial harvest or trade claim. | Exact species, lawful source, wild/cultivated status, permit and chain-of-custody evidence |
| Chaco — yerba maté | Nissaba describes yerba maté as harvested from South America's tea plant and used in its Chaco creation. | Separate species/taxonomy, harvest-origin and used-in-product claims. | Exact harvest location, producer/community, supply route, batch |
| Chaco — petitgrain | Nissaba says petitgrain is distilled from leaves and twigs of bitter orange trees. | Extraction/process claim; source image does not establish Paraguayan origin. | Actual botanical species, cultivation/harvest location and distillation site |

### Special conservation and cultural safeguards

- `Bulnesia sarmientoi` / palo santo / guaiacwood names must not be treated as interchangeable without taxonomic checking. Check current CITES appendices, national rules, permits and species identity before making trade or sustainability statements.
- Yerba maté cultural associations must be sourced and attributed carefully. Do not convert a broad regional or brand story into a claim that a named Indigenous community supplied a particular product.
- Community/family-farming statements are not proof of fair pay, ownership, consent, benefit-sharing or certification.
- "Natural", "sustainable", "responsibly sourced", "waste reducing" and similar claims require separate evidence and must not be inferred from a botanical origin story.

## Compatibility and implementation sequence

1. **Schema review:** settle field names, ID strategy, vocabularies and whether product identity needs a dedicated canonical table.
2. **Validator:** add a separate `material_claim` branch without changing existing house geography semantics; reject malformed material claims and ensure they cannot be used as map anchors.
3. **Fixtures/tests:** valid and invalid examples for each stage; tests for wrong country code, missing material, ambiguous trade hub, unsupported precision, and material claim mistakenly used as house anchor.
4. **Pilot data:** add only independently reviewed claims, one source/relationship/place per record; keep brand-authored claims at their proper evidence level.
5. **Reader/UI:** render material provenance as a chain with distinct stages, source links and confidence/traceability limits; never show a single "origin" label when the chain has multiple locations.
6. **Material map:** separate future decision after the claim model and map semantics are tested.

## Source notes from user-provided material

The following details are transcribed/paraphrased from the user's Nissaba Instagram screenshots and remain **brand-authored statements** until corroborated:

- Tierra Maya: green cardamom pods; CO₂ extraction; selected pods may lack visual perfection but retain olfactory richness; Nissaba says cardamom is cultivated on small plots by farming families across Guatemala; its carousel says cardamom was introduced to Guatemala in the early 20th century.
- The Alps: map labels include Roman chamomile, pine trees, sage, pino mugo, wild carrot, immortelle, juniper berries, hay and pine needles. A supporting slide describes juniper in high-altitude Alpine regions, hay from sun-dried mountain meadows and pine needles from subalpine forests.
- Provence: hyssop is described as grown on sunlit hills of Haute Provence and paired with Mediterranean botanicals.
- Chaco: guaiacwood is described as native to the Paraguayan Chaco; yerba maté is described as harvested from South America's tea plant; petitgrain is described as distilled from bitter orange leaves and twigs.

These are source leads only; the screenshots do not establish named farms, suppliers, exact lots, full chain of custody, or independent sustainability/social-impact outcomes.


## User-supplied research batch — Nissaba sourcing stories and Paris retail lead · 23 November 2026

**Source status:** screenshots supplied by the user from the `nissaba.fragrances` Instagram account and one Reel from `flaconneparis`. The claims below are brand/editorial statements visible in those screenshots, not independently verified agricultural, taxonomic, supplier or chain-of-custody facts. Dates shown in the screenshots are retained as displayed.

### 1. Provence — hyssop

**Screenshot:** Nissaba post dated July 11.

- Nissaba states that hyssop stands at the heart of its modern aromatic composition, is grown on the sunlit hills of Haute Provence, and is paired with Mediterranean botanicals.
- Caption describes the smell as aromatic/herbaceous with warm, slightly spicy tones.
- Proposed records: (a) hyssop cultivation in Haute Provence; (b) hyssop use in the fragrance `PROVENCE`; (c) sensory description as a brand/product claim, not a botanical provenance fact.
- Still unknown: botanical species/subspecies, named farm, harvest location/date, grower, distillation/extraction location, supplier, batch and independent corroboration.
- This extends the earlier Provence pilot example; do not create duplicate material identities or treat this screenshot as independent corroboration.

### 2. Perfumer interview — creative context, not provenance

**Screenshot:** Nissaba post dated July 18, carousel slides 2/5 and 4/5; caption congratulates Franck on a newly announced Master Perfumer title.

- On travel, the perfumer says landscapes, cultures and encounters inspire the stories told through fragrance.
- On creative intent, he wants fragrances to touch the soul and capture emotion, beauty and wonder that remain after the scent is gone.
- Classification: creative philosophy / perfumer interview context. This is useful for the Atlas' house and perfumer editorial layer, but it does not establish any material, place of sourcing, formulation site or manufacturing site.
- Keep the wording attributed to the interview; do not convert the sentiment into a factual claim about a particular journey or ingredient.

### 3. Chaco / Paraguay — guaiacwood, yerba maté and petitgrain

**Screenshots:** Nissaba post dated July 28; map slide 3/6 and sourcing-stories slide 4/6. Caption calls these the three Paraguay-sourced natural extracts used in the Chaco creation.

| Material | Exact source claim visible | Map/context signal | Modelled interpretation | Unresolved |
|---|---|---|---|---|
| Guaiacwood | Described as native to the Paraguayan Chaco; palo santo is said to reveal a smooth woody character with subtle smoky facets and calming warmth. | Label placed in the Chaco Forest area. | Native-range / regional origin claim, separate from commercial harvest and product-use claims. | Botanical identity, legal species name, exact harvest area, wild/cultivated status, permits, producer and chain of custody. |
| Yerba maté | Described as harvested from South America's iconic tea plant; green, herbaceous and slightly bitter. | Map label appears in the Guairá / Caazapá area of Paraguay; caption calls the extracts Paraguay-sourced. | Brand map implies a Paraguay regional sourcing association; keep map-level location as approximate, not a farm coordinate. | Exact harvest district, species/taxon, producer/community, harvest year, processing and lot traceability. |
| Petitgrain | Described as distilled from leaves and twigs of bitter orange trees. | Map label appears around the San Pedro area; post caption groups it among Paraguay-sourced extracts. | Separate plant-part / extraction-method claim from the map's apparent regional sourcing claim. | Citrus species, orchard/cultivation area, harvest location, distillation site, supplier and batch. |

**Important correction to avoid overstatement:** the text explicitly calls guaiacwood native to the Paraguayan Chaco. The text does not explicitly say petitgrain is cultivated in San Pedro or that its distillation occurs there. The map and caption together suggest a Paraguay sourcing story, but do not establish exact production coordinates or stage-specific traceability. The word "palo santo" is used in the brand copy alongside "guaiacwood"; do not assume a verified taxonomic equivalence without botanical and regulatory checking.

### 4. South India / Tamil Nadu — sandalwood, davana, vetiver, jasmine, tuberose

**Screenshots:** Nissaba post dated August 29; map slide 3/6 and sourcing-stories slide 4/6.

The map labels **sandalwood, davana, vetiver, grandiflorum, tuberose and sambac** across southern India, including Karnataka/Tamil Nadu and nearby place labels. The accompanying story states:

- **Jasmine sambac:** harvested daily at dawn across Tamil Nadu; described as luminous, creamy and intensely floral, deeply woven into South Indian culture and traditions.
- **Tuberose:** cultivated in fertile southern plains; described as rich and radiant while avoiding overly powdery or indolic facets.
- **Davana:** described as native to India, with a fruity-aromatic profile.
- The map labels sandalwood and davana around the Mysore/Ooty side of the map; vetiver farther east around the Villupuram area; grandiflorum, tuberose and sambac across the southern Tamil Nadu portion. These are approximate map placements, not exact farm locations.

Proposed separate claims:
- Jasmine sambac — harvest across Tamil Nadu; species/form is named by the brand.
- Tuberose — cultivation in the southern plains; the exact district is not stated in the text.
- Davana — native-range claim for India; do not treat native range as proof of Nissaba's supplier or batch origin.
- Sandalwood, vetiver, jasmine grandiflorum — map-level regional sourcing signals only until additional slide text or independent evidence supports a precise stage/place.

Still unknown: exact districts/farms, botanical identifiers for all map labels, cultivation versus wild harvest where not stated, extraction sites, suppliers, harvest seasons/years, chain of custody and independent corroboration.

### 5. Andalucía, Spain — cistus labdanum

**Screenshot:** Nissaba post dated September 6; map highlights Andalucía and places the Cistus labdanum label in the Huelva / Sierra de Aracena area. Caption states that `Cistus ladanifer` grows wild throughout the Mediterranean region, from Lebanon to Morocco, but is mainly harvested in Andalucía.

- Botanical name explicitly shown: `Cistus ladanifer`.
- Proposed distinct claims: (a) broad Mediterranean wild distribution / native-range statement; (b) main harvest region in Andalucía; (c) approximate map depiction around Huelva / Sierra de Aracena; (d) use in the relevant Nissaba fragrance only if the full post identifies that product.
- Do not collapse broad Mediterranean distribution into the commercial harvest origin.
- Still unknown: named harvest areas/land managers, exact collection locations, harvesting method, harvest year, resin extraction/processing site, producer, permissions and batch traceability.

### 6. Madagascar — Grande Île spice sourcing map

**Screenshot:** Nissaba post dated November 11. Caption says Grande Île gathers the finest spices of the big island in a single fragrance. Map labels the following materials with arrows across Madagascar:

- Ylang-ylang — arrow in the north/northwest, around the Ambilobe / Antsiranana area.
- Vanilla — northeast, around the Sambava / Antalaha area.
- Cloves — northeast/east coast, around the Mananara area.
- Cinnamon — at least one label/arrow around the east-central part of the island; a second cinnamon label appears farther south/east on the map.
- Blue ginger — east coast around the Brickaville area.
- Black pepper — southeast/east around the Mananjary / Farafangana side.
- Pink pepper — southern end of the island, around the Tolagnaro area.

**Model treatment:** these are map-caption associations, not verified farm coordinates. Preserve the two cinnamon labels as shown pending clarification; do not silently merge them into one locality. The post's caption establishes a single fragrance story using spices from Madagascar, but the screenshot alone does not identify the product name, exact species, farm, harvest stage, processing site, supplier or batch.

Open taxonomy questions include which species Nissaba means by "blue ginger" and "pink pepper", and whether the cinnamon labels represent two sourcing areas, a repeated map label or separate material types. Do not assume botanical identity from common names.

### 7. Paris — Jovoy display / flacon discovery lead

**Screenshot:** Reel from verified account `flaconneparis`, showing a display marked **JOVOY PARIS** with several sculptural, stone-like perfume bottles. On-screen text includes "find"; caption begins "I found a perfume in Paris that I still can't stop…".

- Classification: retail/discovery lead and possible distinctive flacon/product presentation.
- The screenshot does not identify the perfume house, fragrance name, bottle maker, product line, price or exact Jovoy branch/address.
- Do not create a new house or material record from the display alone. Keep as an unresolved retail lead until the Reel caption/product tag or another source identifies the fragrance.
- No procurement, supplier enquiry or sample request is implied.

### 8. Editorial and evidence handling

- Preserve all claims as user-supplied screenshot evidence with account attribution and displayed post dates; add direct post URLs only when supplied or independently retrieved.
- Evidence label should remain `reported` or an equivalent user-supplied-source status until the source URL and post are independently checked. Do not assign A/B strength based solely on a brand's visual map.
- Use separate claim records for each material × stage × place × product scope.
- The screenshots add research coverage for Provence, Paraguay, southern India, Andalucía and Madagascar; the July 18 perfumer interview enriches editorial context; the Jovoy Reel is a separate retail lead.
- No production dataset rows are created by this appendix. The current PR remains a documentation proposal pending review and implementation.

