# Scent Atlas geography schema and migration plan

**Status:** additive schema implemented on PR #14 review branch; not merged or released  
**Date:** 2026-11-21

## Current canonical status — 23 November 2026

This block is authoritative for the live PR branch. Older dated snapshots and audit batches below are retained as historical evidence; their counts are superseded by this status.

- PR [#14](https://github.com/Arnitah/Curated-Database-/pull/14) is open and unmerged. Current branch head is tracked directly in [PR #14](https://github.com/Arnitah/Curated-Database-/pull/14).
- 178 houses and 178 map points: **147 city, 7 region, 24 country precision**.
- **175 anchors are evidence-linked and validated; 3 remain explicitly unverified, all at country precision**: Cozy (Khamreya) / Egypt, Gerimist / Indonesia, and Eau So Dramatic / India.
- The original 66-pin audit is substantially complete: **63 evidence-backed anchors, 3 retained as unknown**. The three unresolved points are not defects to fill by inference.
- Typed geography covers **175/178 houses**. The three houses without typed geography are Cozy (Khamreya), Gerimist and Eau So Dramatic.
- Observation register: **655 records, 469 claims, 450 typed geography claims**. The 11 legacy `hq` / `made_in` records remain preserved for provenance.
- The map contract is one pin per house. Each verified pin references typed observation IDs and carries its own anchor-country ISO code; cards show the linked relationship role(s), evidence and precision. A pin may carry multiple roles only when they refer to the same mapped location.
- Country-only pins use representative country coordinates, not inferred capitals or cities. City and region precision require a matching typed city/region observation. Legal-notice addresses are not silently promoted to operating headquarters.
- The standalone snapshot now has a deterministic generator: `npm run build:scent-atlas`; CI verifies byte-for-byte freshness with `npm run check:scent-atlas`.
- The deterministic snapshot builder and byte-for-byte freshness check are part of CI. Latest-head data validation, geography schema tests and snapshot freshness must all pass before merge; full Clay and database tests have previously passed on the unchanged app implementation.
- No merge, release or deployment has occurred.

### Three retained unknowns

| House | Why the pin remains unverified |
|---|---|
| Cozy (Khamreya) | No reliable evidence ties the fragrance lead to Port Fouad or a specific Egyptian city; retained as an Egypt country-only fallback |
| Gerimist | The Indonesian trademark gazette names Singapore-based HEBE BEAUTY PTE. LTD. as applicant; its relationship to the Indonesian fragrance lead is unresolved |
| Eau So Dramatic / House of ESD | The official storefront uses INR pricing but does not identify a physical or registered business location |


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
- `apps/scent-atlas.html`: renders typed evidence claims and role-aware map cards; verified map filtering uses the anchor country, while unverified points remain visibly provisional and retain the legacy country only as a fallback.
- `scripts/build.mjs`: validates typed geography topics, location shape, country names and ISO alpha-2 codes through `scripts/scents-geography.mjs`.
- `scripts/check-scents.mjs` and `.github/workflows/scents.yml`: weekly checks update rates, links, live prices and fieldnotes; they do not write house geography.
- `.github/workflows/data.yml`: runs the data validator, geography/snapshot-builder tests, and byte-for-byte standalone snapshot verification on relevant pull-request paths.
- `docs/scent-intake.md`: now documents the typed relationship vocabulary, one source/relationship/place per observation, and the verified-house rule.
- `dist/scent-atlas.html`: self-contained snapshot generated from `apps/scent-atlas.html` and all statically referenced JSON datasets by `scripts/build-scent-atlas.mjs`; rebuild with `npm run build:scent-atlas` and verify with `npm run check:scent-atlas`. Do not hand-edit.
- `archive/scent-map.html`: archived map reader; retain compatibility during the additive phase.

## Dataset snapshot

**Main-branch baseline before the typed pilot (2026-11-21):**
- 178 houses and 178 map points.
- 205 observations, including 19 claims. The legacy claim topics were 8 `hq`, 3 `made_in`, 3 `owner`, 2 `history`, and 1 `founder`; two additional claim records had no topic.
- 7 houses had no observation of any kind.
- Map precision: 110 `city`, 1 `region`, 67 `country`. A first-pass review found 39 of the 67 `country`-precision points use city-named place labels and city-centre coordinates. Additional country-named labels also use city-centre coordinates (for example Canada/Ottawa, India/New Delhi, Indonesia/Jakarta, Sweden/Stockholm and UAE/Dubai). This is a release hold for a source-and-coordinate audit; no `geo.json` values have been changed. Precision is spatial granularity, not evidence confidence or relationship type.

**Earlier PR-branch data snapshot at commit `392db198f5dc3ee54fc47a94de30c7d9f9b244dc` (2026-11-23):**
- 621 observations total: 435 claim records, including 416 typed geography claims.
- Typed geography claims cover 156 of 178 existing houses and 3 research leads; 22 existing houses have no typed geography claim yet.
- The 11 legacy `hq` / `made_in` source records remain unchanged and are retained for provenance. All 11 have now been individually reviewed; typed reclassifications were appended where supported (see the legacy-claim review below).
- The 3 lead-linked records remain leads; they are not inserted into `houses.json` as established houses.
- Counts were recomputed directly from `observations.json`, `houses.json` and `leads.json` at the stated commit.

## Historical first-pass review register (superseded by the current canonical status above)

These are intentionally not bulk-corrected. They remain separate research and compatibility gates.

### Houses without typed geography claims — historical 22-house queue

At the first-pass snapshot, the 22 records were: Scentury Perfume & Co. (`scentury`), Henry Rose (`henry-rose`), Rogue Perfumery (`rogue-perfumery`), CYKLAR (`cyklar`), Meleg Perfumes (`meleg-perfumes`), Cozy (Khamreya) (`cozy-khamreya`), Libroaria (`libroaria`), Régime des Fleurs (`regime-des-fleurs`), Chujian (`chujian`), The Body Tale (`the-body-tale`), Kitschy (`kitschy`), Aroma Concepts (`aroma-concepts`), Celia Loves (`celia-loves`), Gerimist (`gerimist`), Liberation of Flowers (`liberation-of-flowers`), Paragraf Parfums (`paragraf-parfums`), Otter Haus (`otter-haus`), Indē Wild (`inde-wild`), Eau So Dramatic (`eau-so-dramatic`), Amouroud (`amouroud`), Maison Mataha (`maison-mataha`) and Muse Beauty (`muse-beauty`). Their legacy `houses.json` city/country display fields are not evidence of a typed relationship. Maison Mataha also remains held pending identification of its current legal operator.

### Legacy geography claims reviewed (2026-11-23)

The 11 unchanged legacy claims are grouped as follows: Saint d'Ici (3 `hq` claims), Maya Njie (2 `hq` claims), Beguile (1 `hq` and 1 `made_in` claim), Amouage (1 `made_in` claim), Scent of Africa (1 `made_in` claim), Mezel (1 `hq` claim) and Naisday (1 `hq` claim). Original records and source text are retained; the source-by-source decisions and additive typed replacements are documented below.

### Map precision and anchor audit

The first pass identified 39 map records whose `precision` is `country` while the place label and coordinates are city-level: `j-scent`, `pesade`, `to-summer`, `uttori`, `ichun`, `tadhana`, `gp-fragrances`, `toouch`, `maison-bagian`, `lattafa`, `scentury`, `beguile`, `goldfield-banks`, `hiram-green`, `reunrom`, `solure`, `skybottle`, `whipped`, `kst-scent`, `milky-mane`, `isak`, `naso-profumi`, `neesh`, `saff-and-co`, `janua`, `sana-jardin`, `sultan-pasha`, `areej-le-dore`, `bortnikoff`, `ensar-oud`, `asateer`, `paragraf-parfums`, `etre-parfums`, `otter-haus`, `inde-wild`, `forward-perfume`, `oaken-lab`, `son-venin` and `nostos`. A further first-pass concern is country-named place labels whose coordinates appear city-centred (Canada/Ottawa, India/New Delhi, Indonesia/Jakarta, Sweden/Stockholm and UAE/Dubai). These are flags for source and coordinate verification, not permission to relabel or move points. No `geo.json` coordinates or precision values were changed.

The complete map audit must check all 178 anchors against their source, intended role and actual coordinate granularity. Do not equate a typed geography observation with the existing single map anchor: the map currently supports only one anchor per house and cannot yet distinguish legal, retail, studio or manufacturing locations.

## UI and map behaviour

- House cards and map cards display typed relationships with their source evidence; legacy city/country is a compatibility fallback, not proof of origin.
- The evidence panel displays typed location beside the claim and source.
- `geo.json` remains one map anchor per house. `precision` means spatial granularity, while `anchor_observation_ids` establish the supported role(s).
- Multiple roles may appear on one pin only when they describe the same mapped location; different locations are not collapsed into one unsupported multi-role claim.

## Verification rule

A house is verified only when ownership, **manufacturing location**, and current catalogue each have an independent strength A or B claim. Formulation, filling, assembly, studio, sourcing and retail do not substitute for manufacturing. Legacy `made_in` claims do not qualify until source-reviewed and explicitly reclassified.

## Migration sequence

1. **Complete:** add and test the additive typed-geography schema; preserve legacy topics and fields.
2. **Complete for the 11-record legacy review:** review every historical `hq` / `made_in` claim; append typed replacements only where the source supports them.
3. **Complete:** implement the role-aware, one-pin-per-house contract, including anchor-country codes, evidence-linked role cards, country grouping/filtering and explicit unverified states.
4. **Substantially complete:** audit all 66 original unverified pins individually. Sixty-two are resolved; four remain deliberately unknown (Ellis Brooklyn, Cozy/Khamreya, Gerimist and Eau So Dramatic).
5. **Complete on the PR branch:** establish a deterministic source-led standalone snapshot build and CI freshness check for `dist/scent-atlas.html`.
6. **In progress:** consolidate historical documentation and finish exact-head CI review. Keep PR #14 open until the advisory Clay tests and all required release checks pass.
7. **Release hold:** do not merge, publish or deploy until the four unresolved records have explicit dispositions, the documentation is reconciled, the standalone snapshot check is green, and the final review gates are satisfied.

## Acceptance criteria

- No existing house or map record is silently reinterpreted.
- Every new geography claim has one topic, one location, a source, evidence type, strength and checked date.
- Validator rejects missing or malformed location metadata.
- Legacy records continue to validate and render.
- Weekly scent workflow never changes geography facts.
- Unit tests cover valid, incomplete, malformed, legacy and non-geography records.
- All 178 houses are reviewed before bulk reclassification; unknown facts remain empty.


### Map anchor source cross-check — batch 1 (2026-11-23)

This first source-level pass checked 20 of the 67 country-precision map points. It confirms that a city-named label is not necessarily a supported city anchor, and that a city may be supported only for one relationship (for example manufacturing or retail). Because the current map has no relationship-role field, a location match alone is not permission to promote a point to city precision.

| House | Existing map anchor | Source cross-check | Audit disposition |
|---|---|---|---|
| J-Scent | Tokyo, Japan | LUZ's official page lists its Japan head office and Tokyo Lab in Tokyo, while separately identifying factories in Shizuoka and Karatsu. | Tokyo is supported as office/studio, not as the stated brand-origin city. Anchor role must be explicit. [Source](https://luzfragrance.com/j-scent-global/aboutus) |
| Pesade | Seoul, South Korea | The official About page says the brand was established in Seoul in 2022. | City supported for brand origin. [Source](https://en.pesade.kr/shopinfo/company.html) |
| To Summer | Shanghai, China | InvestHK reports the brand was founded in Beijing in 2018 and opened its first store outside Mainland China in Hong Kong. | Shanghai is not supported by the checked source; if the map is an origin map, Beijing is the evidence-backed candidate. Do not change until map-anchor role is settled. [Source](https://www.investhk.gov.hk/en/news/mainland-perfume-brand-establishes-foothold-in-hong-kong/) |
| Uttori | Hangzhou, China | The ledger source identifies a China-founded brand and a registered company address in Shanghai, not Hangzhou. | Hangzhou unsupported; Shanghai is a legal-base candidate only. [Source](https://pitchhub.36kr.com/project/1713112315636232) |
| ICHUN | Taipei, Taiwan | The ledger source is a Taiwan retailer listing; it does not identify a Taipei office, studio or founding location. | Taipei unsupported; Taiwan retail presence does not justify a Taipei pin. [Source](https://www.yanyantang.tw/products/ichun-perfume) |
| TADHANA | Manila, Philippines | The brand's press page explicitly says headquartered in Toronto and manufacturing in Manila. | Manila is supported for manufacturing only; Toronto is supported for commercial base. The pin must not imply one role without a role label. [Source](https://www.tadhana.co/pages/press) |
| GP Fragrances | Manila, Philippines | The cited editorial profile describes a Filipino fragrance label but does not identify a city. | Manila unsupported by the checked claim. [Source](https://www.tatlerasia.com/style/beauty/filipino-fragrance-brands-to-know-pt) |
| Toouch | Ho Chi Minh City, Vietnam | The ledger records HCMC legal, commercial and retail relationships. The current rendered official contact page did not expose the registered address during this check. | Provisional city match; re-open the underlying legal/address source before treating the exact address as reverified. [Source](https://toouchscent.com/vi-vn/pages/contact) |
| Maison Bagian | Hanoi, Vietnam | The official About page describes it as a Vietnamese perfume brand and says products are produced and perfected in Grasse; it does not identify Hanoi. | Hanoi unsupported by this source; do not infer the city from Vietnamese brand identity. [Source](https://maisonbagian.com/en/about/) |
| Lattafa | Ajman, UAE | The official About page says established in the UAE and describes in-house manufacturing, without naming Ajman. | UAE is supported; Ajman is not established by the checked source. [Source](https://lattafa.com/about-us/) |
| Scentury | Durban, South Africa | No typed geography observation is present for this house. | Durban remains unsupported; do not backfill from the legacy display fields. |
| Beguile | Lagos, Nigeria | The ledger records fragrance formulation with perfumers in Dubai; no checked source establishes Lagos as the map location. | Lagos unsupported by current typed evidence; Dubai is formulation only. [Source](https://beguile.com/pages/about-us) |
| Goldfield & Banks | Sydney, Australia | The brand's current official profile says it was founded in Sydney in 2016. | City supported for brand origin. [Source](https://us.goldfieldandbanks.com/blogs/news/the-nightly-australian-perfume-the-world-wanted) |
| Hiram Green | Amsterdam, Netherlands | The official biography says the perfumer lives and works just outside Amsterdam and develops/handcrafts fragrances in his studio. | Amsterdam is an approximate nearby reference, not a confirmed city address. Retain as a country-level/approximate-location hold unless the map explicitly labels the approximation. [Source](https://hiramgreen.com/pages/about) |
| Reunrom | Bangkok, Thailand | The official store locator identifies REUNROM Song Wat as its flagship in Bangkok. | City supported for retail only; do not imply brand origin or headquarters. [Source](https://reunrom.com/pages/store-locator) |
| Solure | Bangkok, Thailand | The cited Watsons page is an online Thai retail listing, not evidence of a Bangkok store, office or origin. | Bangkok unsupported; Thai retail availability is not a city location. [Source](https://watsons.co.th/en/solure-body-oil-65ml.-anniversary/p/BP_304630) |
| Skybottle | Seoul, South Korea | The official company-information page gives a Yongsan-gu, Seoul business address. Another page on the same domain gives a different company/address, so the precise address is not harmonized. | Seoul supported at city level for business presence; retain the address conflict and do not select a specific address from the conflicting page. [Source](https://www.skybottle.co.kr/shopinfo/company.html) |
| WHIPPED | Seoul, South Korea | The official company page identifies the operator and an address in Seongdong-gu, Seoul. | City supported for legal/commercial base. [Source](https://whipped.co.kr/shopinfo/company.html) |
| KST Scent | New York, United States (map cc currently KR) | The official site describes an LV1 Studio creative project by its creators and discusses Korean/Vietnamese cultural origins; the checked contact page does not establish New York as a base. | New York coordinates and KR country code are not supported by the checked source. Founder heritage is not a substitute for brand location; recheck the separate Los Angeles-base ledger claim before selecting a replacement. [Source](https://www.kstscent.com/pages/contact-us) |
| Milky Mane | Warsaw, Poland | The official contact page lists the business details at Rynek 9, Proszowice, Poland. | Warsaw is not supported; Proszowice is a legal/commercial address candidate. [Source](https://milkymane.shop/pl/i/Kontakt/13) |

#### Batch 1 conclusions

- **City relationship evidenced, but role-specific:** J-Scent (Tokyo office/studio), TADHANA (Manila manufacturing), Reunrom (Bangkok retail), Skybottle (Seoul business presence), WHIPPED (Seoul legal/commercial base).
- **City anchor supported for brand origin:** Pesade (Seoul), Goldfield & Banks (Sydney).
- **Current city anchor contradicted or unsupported:** To Summer, Uttori, ICHUN, GP Fragrances, Maison Bagian, Lattafa, Scentury, Beguile, Solure, KST Scent and Milky Mane.
- **Approximate rather than exact city:** Hiram Green.
- **Requires underlying source recheck:** Toouch.

No `geo.json` values were changed in this batch. This is an evidence register, not a map-data correction. The remaining 47 country-precision points and the six country-named labels paired with city-centred coordinates (Canada/Ottawa, India/New Delhi, Indonesia/Jakarta, Japan/Tokyo, Sweden/Stockholm and UAE/Dubai) remain to be checked. The map-anchor role is still an open design/data contract: the one-pin-per-house model must state whether the pin represents brand origin, legal/commercial base, studio, manufacturing, retail, or a clearly labelled approximate location before a point is moved or promoted to city precision.


### Map anchor source cross-check — remaining points (batches 2–4, 2026-11-23)

The remaining 47 country-precision records were reconciled against the typed geography ledger and their linked sources. The rows below distinguish a supported location from a supported **map anchor**: where a city is supported only as a stockist, manufacturing site, legal address or studio, that relationship must be visible before the map uses it as the house pin.

#### Batch 2

| House | Existing map point | Source-led finding | Disposition |
|---|---|---|---|
| ISAK | Delhi, India | Official story says the modern house was founded in 2018, remains based in Lucknow, and makes/extracts many essences there. | Delhi is contradicted; Lucknow is a strong origin/commercial/manufacturing candidate if the map is origin-first. [Source](https://www.isakfragrances.com/pages/our-story) |
| Naso Profumi | Delhi, India | Official stockist page lists Evoluzione in New Delhi, but also stores in Lucknow and Gurugram and stockists elsewhere. Manufacturing is described only as North India. | Delhi is retail-only and not a unique primary location; keep the map anchor unresolved. [Source](https://www.nasoprofumi.com/pages/our-stockists-1) |
| NEESH | Mumbai, India | Official About page says headquarters in Paris and India; official contact page gives the Indian company address in Ambala; traditional attar oils are distilled by M.L. Ramnarain in Kannauj. | Mumbai unsupported. Keep Paris, Ambala and Kannauj as separate relationship locations. [About](https://neeshperfumes.com/pages/about-us) · [Contact](https://neeshperfumes.com/pages/support) |
| SAFF & Co. | Bandung, Indonesia | Official offline-store page lists Bandung, but also Jakarta, Bekasi, Surabaya, Bali, Medan and other retail locations. | Bandung is a verified retail point, not a unique house base. [Source](https://saffnco.com/pages/offline-store) |
| JANUA | Bangkok, Thailand | Official contact page identifies WERIN WEALTH INTERTRADE CO., LTD. and its registered address in Mae Suai, Chiang Rai. | Bangkok unsupported by the current legal-address source. [Source](https://www.januathailand.com/en/contact) |
| Michael Malul | United States (country centroid) | Company profile identifies Columbus, Ohio as headquarters; this is secondary company-profile evidence. | Country pin is spatially appropriate; Columbus is a commercial-base candidate only if the map adopts that role. [Source](https://www.linkedin.com/company/michael-malul) |
| Sana Jardin | Marrakech, Morocco | Companies House records London registered offices for the active Sana Jardin Limited and a separate Sana Jardin (UK) Limited in liquidation. The brand describes a rural flower-growing region in Morocco, without naming Marrakech. | Marrakech is unsupported; keep London legal-base and Morocco sourcing-region claims distinct. [Companies House](https://find-and-update.company-information.service.gov.uk/company/09507539) · [Brand page](https://sanajardin.com/pages/about) |
| Rogue Perfumery | United States (country centroid) | No typed geography observation is present. | Country-only pin; no city promotion. |
| Sultan Pasha | London, United Kingdom | Official biography describes Sultan Pasha as a London-based independent perfumer. | London supported as perfumer/commercial base, not automatically as a legal or manufacturing address. [Source](https://sultanpashaperfumes.com/pages/about-sultan-pasha) |
| Areej Le Doré | Moscow, Russia | The specialist profile reports UK registration and Indonesia production, but its page is internally inconsistent: the summary says origin is not established, while the history describes creation in the UK and launch from Thailand. It does not support Moscow. | Moscow unsupported; country/origin claim needs correction review. Do not promote UK or Thailand as settled origin until the source conflict is reconciled. [Source](https://osmetheca.be/en/houses/areej-le-dore.html) |
| Bortnikoff | Moscow, Russia | Official About page says the house was founded in Thailand; official contact page gives its company address in Bangkok. | Moscow and RU map country code are contradicted; Thailand/Bangkok are the evidence-backed origin and business-address candidates. [About](https://bortnikoff.com/aboutus/) · [Contact](https://bortnikoff.com/contact/) |
| Ensar Oud | Phnom Penh, Cambodia | Official imprint identifies Oriscent LLC and an address in Glendale, New York. The map's Cambodia point is not evidence of the house's base; material sourcing does not establish a Phnom Penh operation. | Phnom Penh unsupported; the map country code appears to conflate raw-material origin with house location. [Source](https://www.ensaroud.com/imprint/) |
| PHLUR | United States (country centroid) | Official terms identify a Delaware LLC and a West Hollywood business/legal-notice address. | Country-only pin is appropriate at current precision; West Hollywood is a commercial-address candidate, not the legal jurisdiction. [Source](https://phlur.com/en-ca/pages/terms-of-service) |
| CYKLAR | United States (country centroid) | No typed geography observation is present. | Country-only pin; no city promotion. |
| STORIES Parfums | County Down, United Kingdom | Official terms identify the operator at Newtownards, County Down and say refills are carried out by hand at its headquarters in Newtownards. | County Down is a supported region label; the current point should be audited as region precision, with coordinates checked against the region/operating location. [Source](https://storiesparfums.com/pages/terms-conditions) |
| Inis | Ireland (country point) | Official terms identify Fragrances of Ireland Limited's registered office and main trading address at Kilmacanogue, County Wicklow. | Country-level Ireland point is defensible; do not imply a Dublin or other city location. [Source](https://inis.com/policies/terms-of-service) |
| Meleg Perfumes | Canada (Ottawa-centred coordinates) | No typed geography observation is present. | Country label is consistent with country-level knowledge, but Ottawa-centred coordinates are not a country centroid and are unsupported. |

#### Batch 3

| House | Existing map point | Source-led finding | Disposition |
|---|---|---|---|
| Libroaria | Japan (Tokyo-centred coordinates) | No typed geography observation is present. | Country label is acceptable; Tokyo-centred coordinates are unsupported and should not imply a Tokyo base. |
| Stardust & Stems | United States (country centroid) | Official page says a single perfumer formulates, blends and bottles in a home studio; the city is not disclosed. | Country-only pin is appropriate; do not infer the studio city. [Source](https://stardustandstems.com/pages/our-materials-process) |
| L'Epoque Parfums | United States (country centroid) | Official FAQ says the independent fragrance house was founded in Dallas, Texas in 2025. | Dallas is a supported brand-origin candidate; the country-level point is coarse but not geographically false. [Source](https://www.lepoqueparfums.com/pages/faq) |
| Chujian | China (country centroid) | No typed geography observation is present. | Country-only pin; current country-centred coordinates are appropriate. |
| The Body Tale | Indonesia (Jakarta-centred coordinates) | No typed geography observation is present. | Jakarta coordinates unsupported; retain country-only knowledge without a city-centred point. |
| Kitschy | Indonesia (Jakarta-centred coordinates) | No typed geography observation is present. | Jakarta coordinates unsupported; retain country-only knowledge without a city-centred point. |
| Gerimist | Indonesia (Jakarta-centred coordinates) | No typed geography observation is present. | Jakarta coordinates unsupported; retain country-only knowledge without a city-centred point. |
| Aroma Concepts | United States (country centroid) | No typed geography observation is present. | Country-only pin; no city promotion. |
| Belnu | United States (country centroid) | Company profile identifies Los Angeles as headquarters; evidence is a company profile, not manufacturing evidence. | Country pin is appropriate at current precision; Los Angeles is a commercial-base candidate if the map uses that role. [Source](https://www.linkedin.com/company/belnu) |
| Liberation of Flowers | United States (country centroid) | No typed geography observation is present. | Country-only pin; no city promotion. |
| Commodity | United States (country centroid) | The observation ledger records the brand's first flagship at 113 Crosby Street in New York. | New York is retail-only; country-level pin does not claim the flagship is the house origin. [Source](https://commodityfragrances.com/pages/nyc-store) |
| Paragraf Parfums | Jakarta, Indonesia | No typed geography observation is present. | Jakarta unsupported; do not infer it from Indonesian identity or market presence. |
| Être Parfums | Jakarta, Indonesia | Official About page and homepage claims identify Grasse for formulation/manufacturing and Indonesia for assembly; no Jakarta operation is identified. | Jakarta unsupported. Preserve Grasse manufacturing/formulation and Indonesia assembly as separate claims. [Source](https://etreparfums.com/pages/about-us) |
| Otter Haus | Manila, Philippines | No typed geography observation is present. | Manila unsupported; country-level Philippines only. |
| Indē Wild | Mumbai, India | No typed geography observation is present. | Mumbai unsupported; country-level India only. |

#### Batch 4

| House | Existing map point | Source-led finding | Disposition |
|---|---|---|---|
| Forward Perfume | Hanoi, Vietnam | Official contact page lists both a store and company office in Ho Chi Minh City. | Hanoi contradicted; HCMC is supported for retail and commercial base. [Source](https://forwardperfume.com/pages/contact) |
| Eau So Dramatic | India (New-Delhi-centred coordinates) | No typed geography observation is present. | Delhi-centred coordinates unsupported; retain country-only knowledge. |
| Fraganote | India (New-Delhi-centred coordinates) | Product legal information identifies Fraganote Fragrances Private Limited at an address in Okhla Industrial Estate, New Delhi. | New Delhi is supported for legal/commercial base; the map label and precision should reflect the relationship if selected. [Source](https://fraganote.com/pages/about-us) |
| Amouroud | United States (country centroid) | No typed geography observation is present. | Country-only pin; no city promotion. |
| L'Atelier Parfum | France (country centroid) | Official FAQ says its perfumes are manufactured in Grasse at Robertet. | France country point is coarse but not false; Grasse is a manufacturing location, not automatically the brand base. [Source](https://latelierparfum.com/pages/faq) |
| Maison Mataha | France (country centroid) | No current typed geography observation; the legal-operator identity remains a separate hold. | Keep country-only and preserve the operator hold. |
| Lydeen Parfums | Sweden (Stockholm-centred coordinates) | The observation ledger identifies LYDEEN PARFUMS AB at Donsö, Sweden, not Stockholm; the currently rendered legal-notice page did not expose the address during this pass. | Stockholm coordinates are unsupported; Donsö remains a ledger-backed legal-base candidate requiring source re-open. |
| Muse Beauty | India (New-Delhi-centred coordinates) | No typed geography observation is present. | Delhi-centred coordinates unsupported; retain country-only knowledge. |
| Lova | UAE (Dubai-centred coordinates) | Official About page says the Emirati brand is based in the UAE but does not name a city. | Dubai coordinates unsupported; retain country-level UAE only. [Source](https://lovaperfumes.com/pages/about-us) |
| Oaken Lab | Jakarta, Indonesia | Official store page lists stores in Ubud, Pererenan and Jakarta; Jakarta is one of several retail locations. | Jakarta is retail-only and not a unique primary base; the pin must not imply brand origin. [Source](https://oakenlab.com/pages/our-store) |
| Son Venin | Oslo, Norway | The observation ledger cites the Norwegian company register for SON VENIN AS at Dronningens gate 15, Oslo, with an industry code for manufacture of perfume and toilet preparations. | Oslo is supported for legal base; the register's industry code does not prove the physical factory is at the registered address. [Source](https://virksomhet.brreg.no/en/oppslag/enheter/918444726) |
| Zhiwuzhi | China (country centroid) | Independent profile identifies a Chinese fragrance brand; city of origin is not established in the typed observation. | Country-level pin and coordinates are appropriate. [Source](https://lechercheurdeparfum.com/en/zhiwuzhi/) |
| Zhufu | China (country centroid) | Independent profile describes the brand as from Shanghai, but the typed observation intentionally records only country-level origin and does not establish a registered office or factory. | Retain country-level pin pending a city-specific relationship source. [Source](https://lechercheurdeparfum.com/en/zhufu/) |
| Nostos | New York, United States (labelled “perfumer”) | Official information page lists New York, NY as the company's location and identifies its founder and perfumer. | New York supported as the company's location; use a neutral commercial/location role rather than implying the perfumer's personal residence. [Source](https://nostosworld.com/pages/info) |

#### Full audit reconciliation

- All 67 country-precision points have now been reviewed against the typed observation ledger, house records and linked evidence. This is a source-led audit, not an approval to change the map.
- Of the 67, 39 have city labels and city-centred coordinates; STORIES Parfums has a county/region label; 13 more points use a country label with city-centred coordinates across six label groups: Canada/Ottawa (1), India/New Delhi (3), Indonesia/Jakarta (6), Japan/Tokyo (1), Sweden/Stockholm (1), UAE/Dubai (1). The remaining 14 are country-labelled with country-level coordinates.
- Strong city/region candidates exist, but many are relationship-specific: brand origin, legal/commercial base, studio, manufacturing, assembly or retail. A single pin cannot silently combine these roles.
- Clear mismatches or unsupported city anchors include: To Summer, Uttori, ICHUN, GP Fragrances, Maison Bagian, Lattafa, Scentury, Beguile, Solure, KST Scent, Milky Mane, ISAK, NEESH, JANUA, Sana Jardin, Areej Le Doré, Bortnikoff, Ensar Oud, Asateer, Paragraf Parfums, Être Parfums, Otter Haus, Indē Wild, Forward Perfume, Oaken Lab and the unverified city-only points identified above.
- Source-backed but role-dependent city/region candidates include: J-Scent, Pesade, TADHANA, Toouch (exact address recheck), Goldfield & Banks, Hiram Green (approximate), Reunrom, Skybottle (address conflict), WHIPPED, Naso Profumi (one of multiple stockists), SAFF & Co. (one of multiple retail cities), Sultan Pasha, STORIES Parfums (region), Michael Malul (secondary HQ claim), PHLUR (commercial address), Inis (legal base), L'Epoque (brand origin), Belnu (secondary HQ claim), Commodity (retail), Fraganote (legal/commercial base), L'Atelier Parfum (manufacturing), Lydeen (ledger-backed legal base requiring source re-open), Son Venin (legal base) and Nostos (company location).
- Country-only points with no typed city evidence remain country-only; do not invent city pins from heritage, raw-material origin, retailers, stockists, founder nationality or a country-level company profile.

#### Recommended map-anchor contract (proposal for implementation)

The current one-pin-per-house map should remain one pin per house, but each pin needs an explicit relationship role. Recommended selection order:

1. `brand_origin` — when the house's origin is explicitly sourced.
2. `commercial_base` — when a current operating/headquarters location is sourced and brand origin is not.
3. `studio` — when the perfumer/house studio is the clearest sourced operational location.
4. `manufacturing` — when actual product manufacture is sourced and no higher-priority house location exists.
5. `filling` or `assembly` — only when no higher-priority role exists and the specific operation is sourced.
6. `legal_base` — only as an explicit administrative-location fallback; do not let a registered-office address masquerade as a production site.
7. `retail` — only a brand-operated flagship, never an ordinary stockist or third-party retailer.
8. `country_only` — country centroid when no supported city/region relationship is available. Do not use sourcing geography or founder heritage as the house pin.

The map card should display the selected role and evidence link. The `precision` field must describe the actual spatial granularity of the coordinates: city point for a sourced city relationship, region point for a sourced region, and country centroid for country-only. If the map cannot show the role, keep the pin at country precision rather than mixing location types invisibly.

This is a documentation recommendation only. No map coordinates, country codes or precision values have been changed. The next implementation step is to add role-aware map metadata and display it, then make individually sourced corrections. Keep the map release hold until this is complete and the self-contained `dist/scent-atlas.html` snapshot is safely regenerated or explicitly treated as a separate release artifact.


### City-precision and region-point screening — 2026-11-23

A first-pass comparison of all 110 `precision: "city"` points against typed geography observations found 91 exact or normalised city matches and 19 without a same-city typed observation. Normalisation accounts for accents and harmless label suffixes (for example Montréal/Montreal, Glandore/Glandore, West Cork, and Jaipur/Jaipur (Amer Fort)); it does not treat a different city or a founder's location as a match.

Across the 91 matched pins, the linked observations contain overlapping relationship roles: 31 brand-origin, 46 commercial-base, 29 legal-base, 35 retail, 13 manufacturing, 12 studio, 3 formulation, 4 founder-origin and 1 sourcing. These counts overlap by house and are not mutually exclusive. One pin, Pekji/Istanbul, has only a founder-origin match and therefore does not establish Istanbul as the house's own location.

#### The 19 city pins without a same-city typed observation

| House | Map point | Evidence review | Disposition |
|---|---|---|---|
| Wren Atelier | Manila, Philippines | Official site identifies a Filipino perfumer and lists retail partners, but the checked contact page does not give a Manila office, studio or manufacturing address. | Manila unsupported as a house location; founder nationality and retailer locations are not enough. [Source](https://wrenatelier.com.ph/pages/wren-atelier) |
| Swiss Arabian | Dubai, UAE | Official contact page gives the group head office at Shaqaeq Tower, Al Taawun Street, Sharjah. | Dubai contradicted; Sharjah is the current head-office candidate. [Source](https://swissarabian.com/pages/contact-us) |
| Saint d'Ici | Johannesburg, South Africa | The current official story says the botanical perfumery is located in Cape Town. | Johannesburg contradicted; Cape Town is supported as current location. [Source](https://www.saintdici.com/saint-dici/?v=eacb463a8002) |
| OCT | Kuwait City, Kuwait | No typed geography observation or city-specific source was found in this pass. | City pin unsupported; retain as a review hold. |
| Afnan | Dubai, UAE | Afnan's official profile says founded in the UAE; company profile and industry exhibitor record identify its head office in Ajman. | Dubai contradicted; Ajman is the supported headquarters candidate. [Official About](https://www.at.afnan.com/en/pages/about-us) · [Ajman head office](https://exhibitor.beautyworldme.com/exhibitor-search-en/exhibitor-search.detail.html/afnan-perfumes-llc.html) |
| L'Artisan Parfumeur | Paris, France | The official store finder lists several Paris boutiques; current terms identify the registered office in Chartres. | Paris is supported for retail, not for the current registered office. Do not treat boutiques as brand origin. [Terms](https://www.artisanparfumeur.com/eu/en_GB/terms-and-conditions) · [Store finder](https://www.artisanparfumeur.com/fr/fr/store-finder) |
| Agonist | Stockholm, Sweden | No typed geography observation or current city-specific source was verified in this pass. | Stockholm remains unsupported pending a primary source. |
| Floraïku | Paris, France | Official store pages list Paris boutiques; legal notice and FAQ identify the head office in Geneva. The brand story discusses Paris as a design context but does not establish a Paris operating address or founding site. | Paris is supported for retail only; Geneva is legal/head-office location. [Story](https://www.floraiku.com/pages/our-story) · [FAQ/legal address](https://us.floraiku.com/pages/faq) |
| Arquiste | New York, United States | Official materials describe Carlos Huber as New York-based and Mexico-born, but do not establish New York as the house's commercial base. | Do not turn founder residence/origin into a house location. New York remains role-dependent and unsupported as a brand pin. [Brand](https://arquiste.com/pages/the-brand) · [Founder](https://arquiste.com/pages/carlos-huber) |
| Henry Rose | Los Angeles, United States | Official terms provide a Los Angeles contact address; the company also appears at a Santa Monica address in corporate/certification records. | Los Angeles is supported as a contact/business location, but the precise address and map coordinate need reconciliation with the Santa Monica record. [Official terms](https://henryrose.com/pages/terms-of-service) |
| Libertine Fragrance | Vancouver, Canada | No typed geography observation was found; the brand's About page could not be independently retrieved in this pass. | Vancouver remains unverified; do not infer from the house name or retailer presence. |
| Ellis Brooklyn | New York, United States | No typed geography observation was found; the official About page could not be independently retrieved in this pass. | New York remains unverified; do not infer from the brand name. |
| Zielinski & Rozen | Tel Aviv, Israel | The ledger supports brand origin in Old Jaffa and a commercial base in Tel Aviv–Jaffa; the legal base is Amsterdam. | The current Tel Aviv label is metro-adjacent but imprecise; use the source's Old Jaffa/Tel Aviv–Jaffa wording and verify the coordinate before city precision. [About](https://zielinskiandrozen.com/pages/about) · [Contact](https://zielinskiandrozen.com/pages/contact) |
| The Burren Perfumery | Carron, County Clare, Ireland | Official contact and directions pages locate the perfumery at Carron/Carran, County Clare; official and tourism sources describe on-site hand-making. | Location supported for studio/manufacturing. Check whether the stored coordinate is the actual perfumery site rather than the village centroid. [Contact](https://burrenperfumery.com/pages/contact-us) · [Directions](https://burrenperfumery.com/pages/directions) |
| Cozy (Khamreya) | Port Fouad, Port Said, Egypt | No typed geography observation or city-specific primary source was found in this pass. | City pin unsupported; retain as a review hold. |
| Régime des Fleurs | Los Angeles, United States | The official contact page gives an in-person address at 15 Maiden Lane, New York, NY; it does not establish Los Angeles. | Los Angeles unsupported; New York is a retail/contact location only. [Source](https://regimedesfleurs.com/pages/contact) |
| Celia Loves | Surf Coast, Victoria, Australia | Official brand story says candles and products are hand-poured on Victoria's Surf Coast. | The region is supported for production, but Surf Coast is not a city; this point should use region precision and a region-level coordinate. [Source](https://celialoves.com.au/pages/about-us) |
| Gabar | New York, United States | Official About page calls London its current home and describes its roots in Myanmar/Southeast Asia; its store page lists many third-party retailers in New York and elsewhere. | New York is unsupported as the house base; London is the supported current-home/commercial candidate. [About](https://gabarworld.com/pages/about) · [Stores](https://gabarworld.com/pages/stores) |
| Aurra London | London, United Kingdom | Official brand story says perfumes are handcrafted in Kannauj; Companies House lists the UK company's registered office in Uxbridge, Greater London. | Central-London city coordinates are not verified. Separate Uxbridge legal base from Kannauj manufacturing; do not infer location from the brand name. [Brand story](https://aurralondon.com/pages/brand-story) · [Companies House](https://find-and-update.company-information.service.gov.uk/company/15284822) |

#### The existing region-precision point

| House | Map point | Evidence review | Disposition |
|---|---|---|---|
| SHIRO | Sapporo, Japan (precision: region) | Official sources identify Sunagawa, Hokkaido as brand birthplace and factory/manufacturing location, and Tokyo as the company head office. No checked source supports Sapporo as the house location. | Sapporo is unsupported; the point is also labelled region while the place is a city. Select Sunagawa or Tokyo only after applying the documented map-anchor role policy. [Origin](https://note.shiro-shiro.jp/n/ncf86373a5d68?hl=en) · [Company](https://shiro-shiro.jp/ec/ext/policy/company/index.html) · [Factory](https://hello.shiro-shiro.jp/product/labo-vol02/) |

#### City-point screening conclusion

- 91/110 city pins have a same-city typed location after normalising spelling and labels; this confirms a relationship exists, not that the relationship is the map's chosen role or that the coordinate is exact.
- 19/110 city pins need role/source correction or further evidence. Clear current-map mismatches include Swiss Arabian (Sharjah, not Dubai), Saint d'Ici (Cape Town, not Johannesburg), Afnan (Ajman, not Dubai), Régime des Fleurs (New York contact/retail, not Los Angeles), and Gabar (London current home, not New York).
- SHIRO's Sapporo region point is unsupported; the source-backed locations are Sunagawa and Tokyo.
- Pekji/Istanbul is supported only by founder-origin, which must not be used as a house pin under the proposed map contract.
- These are source/ledger checks only. Coordinates have not yet been individually geocoded against source addresses or official location coordinates. City/region coordinate verification remains a release hold across the full 178-point map.

No `geo.json` values were changed. The next map step remains a role-aware schema/UI contract followed by point-by-point coordinate verification and only then targeted corrections.


## Legacy claim review and append-only reclassification — 2026-11-23

All 11 legacy records were reviewed individually. None was overwritten or deleted. Where the source supports a precise relationship, a new typed observation was appended; ambiguous claims remain as historical source records and must not be interpreted as a current single HQ or generic manufacturing fact.

| Legacy record(s) | What the source actually establishes | Typed disposition |
|---|---|---|
| Saint d'Ici `saint-dici-hq-1` (2018) and `saint-dici-hq-2` (2022) | Contemporary reporting placed the perfumery in Johannesburg at those dates. The current official story page says the botanical perfumery is located in Cape Town; the 2026 BellaNaija profile independently says it makes botanical perfume in Cape Town. The move date is not established. | Retain both Johannesburg records as historical. Existing typed `commercial_base` Cape Town record captures the current official location. |
| Saint d'Ici `saint-dici-hq-3` (2026 roundup) | The record's text says one roundup places the house in Cape Town but incorrectly concludes Johannesburg stands. The cited article explicitly identifies Saint d'Ici as making botanical perfume in Cape Town. | Treat the record's interpretation as corrected; keep the original source text unchanged. Current typed `commercial_base` Cape Town remains the usable location. |
| Maya Njie `maya-njie-hq-1` and `maya-njie-hq-2` | Sources support London-based activity and a Shoreditch studio. The current official contact page gives 91A Rivington Street, London as the studio; Companies House lists the same address as the registered office. The Oliver Spencer interview does not substantiate the old record's specific "fills bottles in house" assertion. | Existing typed `studio` London retained. New typed `legal_base` London appended from Companies House. Do not carry forward the in-house filling claim without a separate source. |
| Beguile `beguile-hq-1` | The official brand blog says founded by Ihuoma Eze in Lagos in 2021 and operates a local market/fulfilment base in Nigeria, the UK, the US and Canada. It does not identify cities for the four local bases or a single corporate HQ. | Five typed records appended: `brand_origin` Lagos plus country-only `commercial_base` records for Nigeria, UK, US and Canada. Each market base is explicitly not treated as a registered office or HQ. |
| Beguile `beguile-made-1` | The source says fragrances are developed with expert perfumers in Dubai; no filling or manufacturing location is stated. | Existing typed `formulation` Dubai record is the correct relationship. No manufacturing claim added. |
| Amouage `amouage-made-1` | WIPO says professional perfumers in Grasse create the fragrances, then the samples go to the Oman factory for larger-scale production, maceration, bottling and packaging. The current official site identifies its Muscat Manufacture. "Blended in Grasse" is an imprecise summary of formulation, not the manufacturing site. | Existing typed `formulation` Grasse and `manufacturing` Muscat records are the correct split. No new data record needed. |
| Scent of Africa `scentofafrica-made-1` | The cited BellaNaija article distinguishes composition in France from production in Ghana. The brand's official page calls it a fine fragrance house made in Ghana; its Values page places an end-to-end production chain in Accra. | Existing typed `brand_origin` Ghana and `manufacturing` Accra retained. New typed `formulation` France record appended. The old generic `made_in` label must not be read as manufacturing in France. |
| Mezel `mezel-hq-1` | Pitti's phrase "born between Casablanca and Paris" is brand narrative, not a physical HQ address. Current consumer terms identify SGJ COSMETICS SAS as headquartered and registered at 229 rue Saint Honoré, Paris. | Existing typed `legal_base` and `commercial_base` Paris records are supported by the official terms. Do not convert the Casablanca/Paris narrative into brand origin. |
| Naisday `naisday-hq-1` | The cited Tokopedia result identifies an East Jakarta marketplace storefront/seller location, not a verified headquarters. A Bekasi City government product directory lists a public business contact address in Bekasi; official Shopee evidence is an online storefront, not a physical shop. The relationship between the East Jakarta and Bekasi addresses remains unresolved. | Existing typed `commercial_base` Bekasi remains a public business-contact candidate, not a registered office or factory. Existing country-only `retail` Indonesia records the online storefront. No physical retail or HQ claim added. |

### New typed observations added in this review

Seven append-only claims were added to `observations.json`:

- Beguile: brand origin Lagos, Nigeria.
- Beguile: local commercial/fulfilment bases in Nigeria, the United Kingdom, the United States and Canada (country precision only; no cities inferred).
- Maya Njie: legal base London, United Kingdom.
- Scent of Africa (research lead): formulation France.

Existing typed claims already cover Saint d'Ici's current Cape Town commercial base; Maya Njie's London studio; Beguile's Dubai formulation; Amouage's Grasse formulation and Muscat manufacturing; Scent of Africa's Ghana origin and Accra production; Mezel's Paris legal/commercial base; and Naisday's Bekasi public business-contact candidate and online retail channel.

### Updated PR-branch dataset snapshot (2026-11-23)

- 628 observations total.
- 442 claim records, including 423 typed geography claims.
- Typed geography claims cover 156 of 178 existing houses and 3 research leads.
- 22 existing houses still have no typed geography claim.
- All 11 legacy `hq` / `made_in` records remain byte-for-byte preserved as historical source records; review completed and supported typed relationships appended.

Sources:
- [Saint d'Ici current story](https://www.saintdici.com/saint-dici/?v=eacb463a8002) · [2018 Johannesburg profile](https://www.sundaytimes.timeslive.co.za/sunday-times/lifestyle/fashion-and-beauty/2018-10-06-sa-perfumier-marie-aoun-on-why-it-makes-sense-to-wear-natural-scents/) · [2026 profile](https://www.bellanaija.com/2026/08/discover-african-fragrance/)
- [Maya Njie studio](https://www.mayanjie.com/pages/contact) · [Companies House](https://find-and-update.company-information.service.gov.uk/company/10213245) · [Oliver Spencer interview](https://oliverspencer.co.uk/blogs/journal/in-conversation-maya-njie)
- [Beguile official About](https://beguile.com/pages/about-us) · [Beguile official 2026 brand blog](https://beguile.com/blogs/news/what-is-beguile-the-luxury-fragrance-brand-you-need-to-know-in-2026)
- [Amouage WIPO case study](https://www.wipo.int/en/web/ip-advantage/w/stories/designs-fragrances-and-sustaining-traditions) · [Amouage official story](https://amouage.com/pages/our-story)
- [Scent of Africa 2026 article](https://www.bellanaija.com/2026/08/discover-african-fragrance/) · [official brand page](https://www.scentofafrica.com/brand) · [official production-chain page](https://www.scentofafrica.com/values)
- [Mezel Pitti profile](https://fragranze.pittimmagine.com/en/exhibitors/M/mezel) · [official consumer terms](https://mezelparfums.com/en/pages/cgv)
- [Naisday Tokopedia listing](https://www.tokopedia.com/find/parfum-naisday-ons) · [Bekasi City SIPTRI listing](https://sip3.bekasikota.go.id/katalog/produk/12/141/naisday) · [Naisday Shopee store](https://shopee.co.id/naisday?entryPoint=ShopByPDP)



## Review of the 22 houses without typed geography — batch 1 · 23 November 2026

The original 22-house gap list was reviewed against current brand pages, legal/registry records and contact/store pages. Nine houses now have at least one typed geography observation; thirteen remain without a typed geography claim. No location was inferred from a legacy display field, founder identity, retailer, marketplace contact address or parent-company address.

### Typed geography added in this review

| House | New typed relationship | Evidence and limitation |
|---|---|---|
| Scentury Perfume & Co. | `retail` — Johannesburg, Gauteng, South Africa | Its official returns page gives a store address at The Marc Shopping Centre, Sandton, Store 21. This is retail only, not HQ or manufacturing. The map point labelled Durban remains unsupported. [Source](https://scenturysa.co.za/refund_returns/) |
| Rogue Perfumery | `commercial_base` — Idaho Falls, Idaho, United States | Official contact page says the company is located in Idaho Falls. [Source](https://rogueperfumery.com/pages/contact) |
| Meleg Perfumes | `commercial_base` — Calgary, Alberta, Canada | Official contact page lists Calgary as its contact location; it is not separately verified as a registered office or manufacturing site. [Source](https://www.melegperfumes.com/pages/contact) |
| Libroaria | `commercial_base` — Tokyo, Japan | Blue Moment LLC identifies its head office in Shibuya, Tokyo. The official legal notice also gives a Tokyo seller address in Meguro; no city outside Tokyo is inferred. [Company profile](https://prtimes.jp/main/html/rd/p/000000001.000135352.html) · [Legal notice](https://libroaria.com/policies/legal-notice) |
| Régime des Fleurs | `retail` — New York, United States | Official contact page offers in-person shopping by appointment at 15 Maiden Lane, Suite 1003. This is retail/contact only; the Los Angeles map point is unsupported by this source. [Source](https://regimedesfleurs.com/pages/contact) |
| Aroma Concepts | `legal_base` — Leicester, United Kingdom; `commercial_base` — Orlando, Florida, United States | Companies House lists AROMA CONCEPTS LTD at 17 Brougham Street, Leicester. Florida's registry and the US brand site list AROMA CONCEPTS LLC at 4111 34th Street, Orlando. These are separate legal entities and must remain separate in the records. [UK registry](https://find-and-update.company-information.service.gov.uk/company/12291397) · [US registry](https://search.sunbiz.org/Inquiry/corporationsearch/SearchResultDetail?aggregateId=flal-l21000472917-2331dc1b-d7d8-45bf-96bf-13b321bd9158&directionType=PreviousList&inquirytype=EntityName&listNameOrder=AROMACOFFEE+S891880&searchNameOrder=AROMACONCEPTS+L210004729170&searchTerm=AROMA+MAMMA%27S+LLC) |
| The Body Tale | `commercial_base` — Ciputat, South Tangerang, Indonesia | Official careers page identifies Ciputat as its head office. [Source](https://www.thebodytale.com/careers) |
| Indē Wild | `legal_base` — New Delhi, India | Current LEI record for INDE WILD PRIVATE LIMITED records a legal/HQ address change effective 19 October 2026, recorded 29 October 2026 and fully corroborated against India's Ministry of Corporate Affairs. Its 2024 privacy policy still lists Mumbai; treat that as an earlier contact address, not the current legal base. [Current LEI](https://lei.bloomberg.com/leis/view/3358006GV1X9B1OG3295) · [2024 privacy policy](https://india.indewild.com/policies/privacy-policy) |
| Celia Loves | `manufacturing` — Surf Coast, Victoria, Australia | Official About page says its soy-wax scented candles are hand-poured on Victoria's Surf Coast. This claim is explicitly limited to candles; it does not establish Eau de Parfum manufacturing. [Source](https://celialoves.com.au/pages/about-us) |

Ten new typed observations were appended for these nine houses. No legacy record was overwritten.

### Thirteen houses still without typed geography (before the follow-on source check)

| House | Review result / reason retained as unknown |
|---|---|
| Henry Rose | Official terms give a Los Angeles legal-notice address for Henry Rose LLC, while a separate Henry Rose Inc. filing lists Santa Monica and is now inactive. The relationship between the entities and a current operational base is not established; do not convert a notice address into HQ. [Terms](https://henryrose.com/pages/terms-of-service) · [Florida registry record](https://search.sunbiz.org/Inquiry/corporationsearch/SearchResultDetail?aggregateId=forp-f23000005577-1dac45f4-6cb0-4309-841f-08b45bfaa3a9&directionType=ForwardList&inquirytype=EntityName&listNameOrder=HENRYRODRIGUEZPENA+L170000085810&searchNameOrder=HENRYROSE+F230000055770&searchTerm=HENRY+P.+TRAWICK%2C+P.A.) |
| CYKLAR | Official terms give a West Hollywood address for Center Brands LLC d/b/a Cyklar, but do not establish a registered office or operating site. Preserve as a legal-notice address, not a typed base. [Terms](https://cyklar.com/policies/terms-of-service) |
| Cozy (Khamreya) | A contact page found for Cozy Egypt belongs to a sleepwear/apparel retailer, not the Khamreya perfume entity, and was excluded. No primary source for the perfume brand's operator or Port Fouad address has been verified. |
| Chujian | Official brand pages reviewed do not identify a city, studio or legal address. Keep China at country level only. |
| Kitschy | Privacy policy gives a Jakarta contact address, but does not identify a registered entity or establish a physical office/manufacturing site. Do not turn a privacy contact address into HQ. [Privacy policy](https://kitschy.id/policies/privacy-policy) |
| Gerimist | No verifiable primary source establishing a city or operating address was found in this pass. |
| Liberation of Flowers | Official site describes the fragrance collection and founder/creative work but gives no operating city or registered address. [Official site](https://www.liberationofflowers.com/) |
| Paragraf Parfums | Official brand site gives no city or business address. Search results for Parag Fragrances International refer to a different business and were not used. [Official site](https://paragrafparfums.com/) |
| Otter Haus | Official store site provides product and shipping information but no city or operating address. [Official site](https://otterhausph.com/) |
| Eau So Dramatic | Official site/contact information reviewed does not establish a city or legal entity address. Keep India at country level only. |
| Amouroud | Official About page lists a New York address for parent company Perfumer's Workshop International, not a brand-specific Amouroud office or studio. Do not conflate the parent-company address with the house. [About](https://amouroud.com/pages/about-us) |
| Maison Mataha | Prior hold remains: named legal operator TK PARFUMS (SIREN 901395194) was dissolved/struck off on 9 January 2024; current operator has not been identified. |
| Muse Beauty | Official fragrance site says Muse Beauty is a sister company of House of Anaiza but gives no city. Search results for Muse Beauty India refer to a separate makeup-brush brand and were not conflated. [Privacy policy](https://www.musebeauty.in/pages/privacy-policy) |

### Updated PR-branch coverage snapshot

- 638 observations total.
- 452 claim records, including 433 typed geography claims.
- Typed geography claims now cover 165 of 178 houses and 3 research leads.
- 13 houses remain without typed geography: Henry Rose, CYKLAR, Cozy (Khamreya), Chujian, Kitschy, Gerimist, Liberation of Flowers, Paragraf Parfums, Otter Haus, Eau So Dramatic, Amouroud, Maison Mataha and Muse Beauty.
- The map and app were not changed. The nine new house-level claims are source evidence only; they do not authorize moving or promoting map pins.



#### Source-identity correction — Cozy (Khamreya), 23 November 2026

The earlier batch-1 note relied on a search result for `cozyegypt.com`. Opening that page shows sleepwear/apparel products (including sleep dresses), not a perfume or Khamreya business. It is not the Cozy (Khamreya) entity in this dataset and has been excluded. The perfume entity's operator, official web presence and Port Fouad location remain unverified; no typed geography is added. The 13-house unknown list is unchanged.


## Follow-on review of the remaining geography gaps — 23 November 2026

A further source check established country-level/product-operation claims for Maison Mataha and Otter Haus. Three new typed observations were appended:

- **Maison Mataha — formulation, France; manufacturing, France.** The current official site says its creations are conceived and crafted in France. This supports country-level formulation and manufacturing only; it does not establish a city or factory. The legal notice still names TK PARFUMS, struck off on 9 January 2024, so the current legal operator remains unresolved. A 2026 US trademark application names Taha Khalid at a Paris address, but that application does not by itself establish the website's current operator. [Official site](https://matahaparfums.com/en) · [Legal notice](https://matahaparfums.com/en/policies/legal-notice) · [2026 trademark application](https://uspto.report/TM/99720915) · [TK PARFUMS status](https://www.pappers.fr/entreprise/tk-parfums-901395194)
- **Otter Haus — brand origin, Philippines (country only).** Vogue Singapore includes Otter Haus in its coverage of Filipino fragrance brands. This supports country-level affiliation only; it does not support Manila as a city, nor any legal, studio or manufacturing location. [Source](https://vogue.sg/filipino-fragrances/)
- **Gerimist — no typed geography.** An Indonesian trademark bulletin lists HEBE BEAUTY PTE. LTD., Singapore, as applicant for the GERIMIST mark (application DID2025046052, filed 23 May 2025). This is a trademark-applicant address, not proof that the applicant is the current brand operator or that the brand's commercial base is Singapore. Keep it as a research lead, not a typed location. [DGIP trademark bulletin](https://www.dgip.go.id/berita-resmi/2121/download)

### Current no-typed-geography gap

After these three additions, **11 houses** remain without any typed geography claim:

1. Henry Rose — official terms give a Los Angeles legal-notice address for Henry Rose LLC, while a separate Henry Rose Inc. filing lists Santa Monica and is now inactive; entity/operational relationship unresolved.
2. CYKLAR — West Hollywood legal-notice address, not a verified registered office or operating site.
3. Cozy (Khamreya) — the Cozy Egypt sleepwear site is unrelated; no primary source for the Khamreya perfume entity or Port Fouad address is verified.
4. Chujian — no city, studio or legal address verified.
5. Kitschy — privacy policy gives a Jakarta contact address but no verified physical office or registered entity.
6. Gerimist — trademark applicant identified in Singapore, but current operator and operational base are unverified.
7. Liberation of Flowers — official site gives no operating city or registered address.
8. Paragraf Parfums — official site says it ships from Indonesia but does not identify a city or house base; shipping origin is not treated as HQ.
9. Eau So Dramatic — official site/contact does not establish a city or legal address.
10. Amouroud — New York address belongs to parent Perfumer's Workshop International, not a brand-specific office or studio.
11. Muse Beauty — official fragrance site identifies a sister-company relationship but no city; similarly named makeup-brush business is unrelated.

Maison Mataha and Otter Haus are removed from the no-typed list, but their limits remain: Maison Mataha's legal operator is unresolved; Otter Haus has only country-level Philippines evidence and no verified Manila location. No map point was changed.

### Updated PR-branch coverage snapshot

- 641 observations total.
- 455 claim records, including 436 typed geography claims.
- Typed geography claims now cover 167 of 178 houses and 3 research leads.
- 11 houses remain without typed geography.
- `geo.json`, `houses.json`, app code and `dist/scent-atlas.html` were not changed in this follow-on review.



## Role-aware map anchor contract and implementation

### Contract

- One map pin represents one house. A verified point references one or more typed geography observation IDs in `anchor_observation_ids`.
- Every referenced observation must be a typed geography claim for the same house. Its ISO alpha-2 country code must match the anchor's `cc`, not the house's legacy `cc`; legitimate cross-border legal, commercial, studio or retail relationships are supported.
- At city precision, the linked observation's city must match the map place. At region precision, its region must match. Country precision requires a country-only observation with matching country name and code.
- The map displays all supported roles only when they refer to the same mapped location. It does not infer a role priority. An anchor with no linked observation remains visibly unverified.
- The UI groups and filters verified pins by anchor country, displays the role(s), precision and evidence in the map card, and uses legacy house country only as an unverified fallback.
- Country-only coordinates are representative geographic centres, not capitals or implied commercial bases. City/region precision is used only where the typed source establishes that granularity.

### Validator and regression coverage

The build validator rejects dangling observation IDs, wrong-house references, non-geography claims, missing or malformed anchor country codes, country mismatches and precision/location mismatches. Tests cover valid city/region/country anchors, multiple roles, normalization, cross-border anchors and invalid references.

### Current audited state

- **178 map points:** 148 city, 7 region, 23 country precision.
- **174 evidence-linked anchors; 4 unverified.**
- **62 of the original 66 unverified points resolved.** The remaining four are Ellis Brooklyn, Cozy (Khamreya), Gerimist and Eau So Dramatic / House of ESD; their reasons are recorded in the current status block above.
- Typed geography covers 175 of 178 houses. Three houses have no typed geography: Cozy (Khamreya), Gerimist and Eau So Dramatic.
- The anchor-country correction is intentional: pin country represents the selected location relationship, not necessarily the house's origin country. The source app no longer groups verified pins by the legacy house country.
- Individual coordinates and precision values were corrected only when supported by the linked observation. The 66-point audit did not bulk-rewrite house metadata.

### Standalone snapshot

`dist/scent-atlas.html` is generated from the source app and its static JSON dependencies. The committed generator discovers the `load(...)` paths from `apps/scent-atlas.html`, embeds those datasets in a deterministic bundle and exposes a byte-for-byte `--check` mode. CI runs the snapshot check. Do not edit the generated file by hand.

### City-pin audit corrections — 23 November 2026

Ten of the 18 previously unverified city-level points have now been anchored to typed evidence. This is a point-by-point correction batch; it does not infer locations from house country metadata.

| House | Map anchor | Selected role(s) | Coordinate basis |
|---|---|---|---|
| Swiss Arabian | Dubai, UAE | Brand origin | UNGEGN city coordinates |
| Saint d'Ici / Saint VII | Cape Town, South Africa | Commercial base | UNGEGN city coordinates; current official story supersedes the unsupported Johannesburg pin while retaining the historical conflict note |
| Afnan | Ajman, UAE | Commercial base; legal base | UNGEGN city coordinates; the earlier city-level origin claim is explicitly corrected to UAE-level only |
| Floraïku | Geneva, Switzerland | Legal base | GeoNames/Mapcarta city coordinates; official legal notice identifies Rue du Lac 12 |
| ARQUISTE | New York, USA | Commercial base | City-level centre; company profile self-reports New York headquarters and official returns page corroborates a New York business address |
| Parfums Dusita | Paris, France | Commercial base | Geocoded Rue de la Sourdière office location |
| The Burren Perfumery | The Burren, County Clare, Ireland | Manufacturing | Official directions GPS; point precision downgraded from city to region while retaining the actual on-site production coordinate |
| Régime des Fleurs | New York, USA | Retail | City-level centre; official appointment retail address is 15 Maiden Lane |
| Gabar | London, UK | Commercial base; legal base | City-level centre; official brand story and Companies House support London |
| Aurra London | Kannauj, India | Manufacturing | City coordinates; official brand story says fragrances are handcrafted in Kannauj |

The Afnan correction is important: the official careers page says the house was founded in the UAE and lists Ajman as headquarters. The earlier city-level brand-origin interpretation is no longer used as an anchor. The map instead uses the independently supported Ajman commercial and legal bases.

### Remaining city-level audit queue

Eight city-level pins remain unanchored: Wren Atelier, OCT, L'Artisan Parfumeur, Agonist, Henry Rose, Libertine, Ellis Brooklyn and Cozy (Khamreya).

- Wren Atelier, OCT, L'Artisan Parfumeur, Agonist and Libertine have country-level evidence but no defensible city relationship. Their existing city labels remain unverified pending country-level coordinate review.
- Henry Rose and Cozy (Khamreya) still lack typed geography.
- Ellis Brooklyn has product-specific USA manufacturing evidence for Apple Love EDP only; this is not generalized to all products or treated as a city claim.

### Updated map counts after the first city batch

- 178 total map points: 120 city, 6 region, 52 country precision.
- 122 anchored points: 112 city, 5 region, 5 country.
- 56 still unverified: 8 city, 1 region, 47 country.
- All 10 newly anchored points carry their own country code; cross-border anchors are validated independently of `houses.cc`.
- No house-country metadata was rewritten. The standalone `dist/scent-atlas.html` snapshot remains untouched.

Next: finish the remaining eight city-level dispositions, then audit the 47 country-level points and the single unverified region point.


### Country-only fallbacks for five city pins — 23 November 2026

Five additional city-level points had country-level evidence but no defensible city relationship. They have been downgraded to country precision, anchored to the matching typed claim, and moved to an approximate geographic-centre coordinate. The map card now displays a country-only label for country-precision pins rather than duplicating the country name or implying a city.

| House | Country-level anchor | Role | Geographic-centre coordinates |
|---|---|---|---|
| Wren Atelier | Philippines | Retail (country-level stockist presence) | 12.879721, 121.774017 |
| OCT | Kuwait | Retail (online-only presence) | 29.311660, 47.481766 |
| L'Artisan Parfumeur | France | Brand origin | 46.227638, 2.213749 |
| Agonist | Sweden | Brand origin | 60.128161, 18.643501 |
| Libertine | Canada | Brand origin | 56.130366, -106.346771 |

Country-centre references: [Philippines](https://www.geodatos.net/en/coordinates/philippines), [Kuwait](https://www.geodatos.net/en/coordinates/kuwait), [France](https://www.geodatos.net/en/coordinates/france), [Sweden](https://www.geodatos.net/en/coordinates/sweden), [Canada](https://www.geodatos.net/en/coordinates/canada). These are representative country-level geographic centres, not capitals, headquarters or precise legal centroids.

### Updated 18-city audit result

- 15 of the original 18 city-level unverified pins now have evidence-backed map anchors: 10 city/region role corrections and 5 country-only fallbacks.
- Three city-level points remain unresolved: Henry Rose (no typed geography), Ellis Brooklyn (only product-specific USA manufacturing evidence; no house-wide city relationship), and Cozy (Khamreya) (no typed geography).
- The single unverified region-level point and all 47 original country-level unverified points remain untouched for their respective audit passes.
- Updated map: 178 points — 115 city, 6 region, 57 country precision.
- 127 anchored — 112 city, 5 region, 10 country.
- 51 unverified — 3 city, 1 region, 47 country.

The country fallback pins are now genuinely country-level: no city name is inferred from the house's legacy country field, and the displayed card does not imply a city.


### Region-level audit closure — SHIRO · 23 November 2026

The sole unverified region-level point has been resolved. The previous `Sapporo` label and coordinates did not match the typed evidence. SHIRO's official 2026 recruitment material identifies Sunagawa, Hokkaido as the brand's birthplace; its official manufacturing page identifies the in-house factory in Sunagawa. The map point is now **Sunagawa, Japan**, city precision, with both brand-origin and manufacturing roles. Coordinates use the GeoNames Sunagawa city reference (43.48639, 141.90556).

Sources: [SHIRO HR Department Note (28 August 2026)](https://note.shiro-shiro.jp/n/ncf86373a5d68?hl=en), [SHIRO factory profile](https://hello.shiro-shiro.jp/product/labo-vol02/), [GeoNames Sunagawa coordinates](https://www.geonames.org/2127955/sunagawa.html).

Updated counts: 178 points — 116 city, 5 region, 57 country; 128 anchored and 50 unverified. The unverified set is now 3 city and 47 country points; no region-level unverified points remain. The three unresolved city points remain Henry Rose, Ellis Brooklyn and Cozy (Khamreya).


### Country-level audit — batch 1 (12 houses) · 23 November 2026

Twelve of the 47 previously unverified country-level pins have been promoted to evidence-backed city anchors. Each pin now represents one selected role; other relationships remain in the evidence register and are not silently merged into the map location.

| House | Corrected anchor | Selected role(s) |
|---|---|---|
| To Summer (观夏) | Beijing, China | Brand origin |
| Scentury Perfume & Co. | Johannesburg, South Africa | Retail |
| KST Scent | Los Angeles, USA | Commercial base |
| Milky Mane | Proszowice, Poland | Legal base; commercial base |
| ISAK Fragrances | Lucknow, India | Brand origin; commercial base; flagship retail |
| NEESH Perfumes | Paris, France | Commercial base |
| Janua | Mae Suai, Thailand | Legal base |
| Michael Malul | Columbus, Ohio, USA | Commercial base |
| Rogue Perfumery | Idaho Falls, Idaho, USA | Commercial base |
| Bortnikoff | Bangkok, Thailand | Commercial base |
| PHLUR | West Hollywood, California, USA | Commercial base |
| Inis (Fragrances of Ireland) | Kilmacanogue, Ireland | Legal base of parent company |

Coordinate references used: [Beijing — UNGEGN](https://ungegn.un.org/dashboard/cities/details?id=130), [Johannesburg — GeoNames](https://www.geonames.org/993800/johannesburg.html), [Los Angeles — GeoNames city-centre reference](https://coordlab.app/cities/los-angeles/), [Proszowice — GeoNames](https://www.geonames.org/761258/proszowice.html), [Lucknow — GeoNames](https://www.geonames.org/1264733/lucknow.html), [Paris — GeoNames](https://www.geonames.org/2988507/paris.html), [Mae Suai — Mapcarta](https://mapcarta.com/14650050), [Columbus — Mapcarta](https://mapcarta.com/Columbus), [Idaho Falls — US Census Geocoder](https://geocoding.geo.census.gov/geocoder/geographies/address?benchmark=4&city=idaho+falls&state=idaho&street=700linsay+blvd&vintage=4&zip=83402), [Bangkok — Mapcarta](https://mapcarta.com/Bangkok), [West Hollywood — GeoDatos](https://www.geodatos.net/en/coordinates/united-states/west-hollywood-ca), [Kilmacanogue — Visit Wicklow](https://visitwicklow.ie/listing/kilmacanogue/).

Role-selection notes:
- To Summer's Beijing founding claim is preferred over its separate Hong Kong retail expansion.
- Scentury's Johannesburg address is a retail point only; it does not establish headquarters or manufacturing.
- KST Scent's Los Angeles base is separate from its founder's South Korean upbringing.
- ISAK's Lucknow anchor uses brand origin, commercial base and its official flagship. The manufacturing claim remains separately caveated because the source does not identify a separate distillery address.
- NEESH uses the brand-stated Paris commercial base; its Ambala legal base and outsourced Kannauj attar production remain separate evidence, not a second pin.
- PHLUR uses West Hollywood as commercial base; Delaware legal formation remains a separate region-level legal fact.
- Inis uses the registered office of Fragrances of Ireland Limited; Inis is the company's signature collection, not a separate legal entity.

Historical batch snapshot (superseded by the current canonical status above): 178 points — 128 city, 5 region, 45 country precision; 140 anchored and 38 unverified. The unverified set is now 3 city and 35 country points. No region-level unverified point remains.


### Country-level audit — batch 2 (12 houses) · 23 November 2026

Twelve further country-level pins have been promoted to city anchors. The chosen map role is the strongest useful relationship for one pin per house; other relationships remain separately recorded.

| House | Corrected anchor | Selected role |
|---|---|---|
| Meleg Perfumes | Calgary, Alberta, Canada | Commercial base |
| Libroaria | Tokyo, Japan | Commercial base |
| L'Epoque Parfums | Dallas, Texas, USA | Brand origin |
| The Body Tale | Ciputat, South Tangerang, Indonesia | Commercial base |
| Aroma Concepts | Orlando, Florida, USA | Commercial base |
| BELNU | Los Angeles, California, USA | Commercial base |
| Commodity | New York, USA | Retail |
| Être Parfums | Grasse, France | Formulation |
| Fraganote | New Delhi, India | Commercial base |
| L'Atelier Parfum | Grasse, France | Manufacturing |
| Lydeen Parfums | Donsö, Sweden | Legal base |
| Maison Bagian | Grasse, France | Formulation; manufacturing |

Coordinate references: [Calgary — Canadian Geographical Names Database](https://geonames.nrcan.gc.ca/search-place-names/unique?id=IAKID), [Tokyo — Mapcarta](https://mapcarta.com/Tokyo), [Dallas — Mapcarta](https://mapcarta.com/Dallas), [Ciputat — GeoNames](https://www.geonames.org/1646194/ciputat.html), [Orlando — Mapcarta](https://mapcarta.com/Orlando), [Los Angeles — GeoNames city-centre reference](https://coordlab.app/cities/los-angeles/), [New York City — Mapcarta](https://mapcarta.com/New_York_City), [Grasse — GeoNames](https://www.geonames.org/6454920/grasse.html), [New Delhi — Mapcarta](https://mapcarta.com/New_Delhi), [Donsö — GeoNames](https://www.geonames.org/2717412/donsoe.html).

Role and uncertainty notes:
- Ensar Oud remains unanchored: the imprint identifies Oriscent LLC in Glendale, New York, while a separate UK company is also registered in London. The operator and the brand's legal entity cannot yet be collapsed into one legal-base pin.
- Aroma Concepts uses the US LLC's Orlando commercial base; the UK limited company and its Leicester legal base remain separate.
- Être Parfums is anchored to Grasse for formulation only. The brand's own pages conflict on Grasse manufacturing versus downstream manufacturing/assembly in Indonesia; that conflict is preserved rather than presented as one manufacturing site.
- Maison Bagian is anchored to Grasse for its stated formulation/production relationship; its Vietnamese brand origin remains a separate country-level claim.
- BELNU's Los Angeles location is a self-reported company headquarters/contact relationship, not a manufacturing claim.
- Meleg's Calgary point is a contact/business location, not a verified manufacturing site or registered office.

Historical batch snapshot (superseded by the current canonical status above): 178 points — 140 city, 5 region, 33 country precision; 152 anchored and 26 unverified. The remaining unverified set is 3 city and 23 country points.


### Country-level audit — batch 3 (12 houses) · 23 November 2026

Twelve further country-level pins are now evidence-anchored. Eight remain country-level because no defensible city relationship is available; four have a typed city relationship and are promoted to city precision.

| House | Corrected anchor | Selected role(s) |
|---|---|---|
| Uttori | China | Brand origin |
| ICHUN | Taiwan | Retail |
| GP Fragrances | Philippines | Brand origin |
| Lattafa | United Arab Emirates | Brand origin; manufacturing |
| Hiram Green | Netherlands | Studio; formulation; manufacturing |
| Solure | Thailand | Retail (online presence) |
| Asateer | Kuwait | Legal base |
| Otter Haus | Philippines | Brand origin |
| Sana Jardin | London, UK | Legal base |
| Indē Wild | New Delhi, India | Legal base |
| Forward Perfume | Ho Chi Minh City, Vietnam | Commercial base |
| Oaken Lab | Ubud, Indonesia | Retail |

The country-level points use geographic-centre coordinates rather than a capital or unsupported city: [China](https://www.geodatos.net/en/coordinates/china), [Taiwan](https://www.geodatos.net/en/coordinates/taiwan), [Philippines](https://www.geodatos.net/en/coordinates/philippines), [United Arab Emirates](https://www.geodatos.net/en/coordinates/united-arab-emirates), [Netherlands](https://www.geodatos.net/en/coordinates/netherlands), [Thailand](https://www.geodatos.net/en/coordinates/thailand), [Kuwait](https://www.geodatos.net/en/coordinates/kuwait). City coordinates: [New Delhi — UNGEGN](https://ungegn.un.org/dashboard/cities/details?id=100), [Ho Chi Minh City — GeoNames](https://www.geonames.org/1566083), [Ubud — Mapcarta](https://mapcarta.com/Ubud), [London — GeoNames](https://www.geonames.org/2643743/london.html).

Important distinctions:
- Sana Jardin is no longer accepting orders, but SANA JARDIN LIMITED (09507539) remains active at 71–75 Shelton Street, Covent Garden, London, with a 2026 confirmation statement. The map pin is legal base only, not an assertion of current trading activity. [Companies House](https://find-and-update.company-information.service.gov.uk/company/09507539) · [Brand contact page](https://sanajardin.com/policies/contact-information).
- Hiram Green's studio, formulation and manufacturing evidence is Netherlands-level; Amsterdam is not asserted as the exact site.
- Solure's Thailand evidence is online retail presence, not a physical store.
- Indē Wild's legal base is New Delhi; its founder and US distribution relationships remain separate.
- Oaken Lab's Ubud point is retail, not manufacturing.
- Areej Le Doré and Ensar Oud remain unresolved for distinct evidence/entity conflicts; neither has been assigned a guessed anchor.

Historical batch snapshot (superseded by the current canonical status above): 178 points — 144 city, 5 region, 29 country precision; 164 anchored and 14 unverified. The remaining unverified set is 3 city and 11 country points.


### Final three researched anchors from the 11-point unresolved set · 23 November 2026

Three more points have now been resolved from primary business/contact evidence:

| House | Anchor | Role | Evidence distinction |
|---|---|---|---|
| CYKLAR | Delaware, USA | Legal base | Official terms identify The Center Brands LLC d/b/a Cyklar as a Delaware LLC; West Hollywood is its legal-notice address, not the state of formation |
| AMOUROUD | New York, USA | Commercial base | Official brand page lists its parent company's New York address; parent-company page identifies New York headquarters |
| Muse Beauty | Mumbai, India | Commercial base | Official contact page lists Kurla West, Mumbai; brand story and company profile corroborate the Mumbai business relationship |

The Delaware point uses the state geographic centre documented by the [Delaware Public Archives](https://archives.delaware.gov/delaware-historical-markers/geographic-center-delaware/). AMOUROUD's New York address is listed on its [official about page](https://amouroud.com/pages/about) and corroborated by [Perfumer's Workshop](https://www.perfumersworkshopinternational.com/pages/amouroud). Muse Beauty's Mumbai location is listed on its [official contact page](https://musebeautyindia.com/contact-us/).

The remaining unverified country-level points are now limited to Areej Le Doré (origin conflict), Ensar Oud (separate legal entities), Chujian, Kitschy, Gerimist, Liberation of Flowers, Paragraf Parfums and Eau So Dramatic. The remaining city-level unverified points are Henry Rose, Ellis Brooklyn and Cozy (Khamreya). No location has been inferred for these records.


### Resolution of the two remaining evidence conflicts — 23 November 2026

Two previously unanchored country-level points now have defensible primary roles:

- **Areej Le Doré — United Kingdom, brand origin (country-level).** The founder's first-person 2022 interview explicitly says the brand was founded in the United Kingdom. This resolves the earlier UK-versus-Russia/Moscow conflict. The founder's Russian background is not treated as the brand's origin, and no UK city is inferred. Indonesia remains a separate reported production relationship. [Founder interview](https://www.fragrantica.com/news/BWME-2022-Russian-Adam-of-Areej-le-Dore-Interview-17407.html).
- **Ensar Oud — Glendale, New York, USA, legal base (city-level).** The official imprint identifies Oriscent LLC as the website owner and gives its Glendale address. The map pin represents that primary website operator/legal entity. ENSAR OUD LIMITED (Company No. 13539356) remains a separate UK entity and is not collapsed into the same company. [Official imprint](https://www.ensaroud.com/imprint/) · [UK Companies House record](https://find-and-update.company-information.service.gov.uk/company/13539356) · [Glendale coordinates](https://www.geonames.org/5118670/glendale.html).

Historical batch snapshot (superseded by the current canonical status above): 178 points — 147 city, 6 region, 25 country precision; 169 anchored and 9 unverified. The remaining unverified set is 3 city and 6 country points. The remaining country-level research queue is Chujian, Kitschy, Gerimist, Liberation of Flowers, Paragraf Parfums and Eau So Dramatic. The remaining city-level queue is Henry Rose, Ellis Brooklyn and Cozy (Khamreya).


### Three previously untyped houses resolved — 23 November 2026

- **Kitschy — Jakarta, Indonesia, commercial base.** Fragrantica describes the house as based in Jakarta; the official store corroborates Indonesian online retail operations and Java/Bali shipping. No manufacturing claim is made. [Fragrantica](https://www.fragrantica.com/designers/Kitschy.html) · [Official store](https://kitschybeauty.com/).
- **Liberation of Flowers — Durham, North Carolina, USA, legal base.** A USPTO-derived 2026 trademark-owner record lists Liberation of Flowers LLC at 3712 St. Marks Road, Durham, NC 27707. This is a legal-entity address, not a factory or verified commercial headquarters. [Trademark record](https://www.trademarkelite.com/trademark/trademark-detail/99356011/LIBERATION-OF-FLOWERS).
- **ChuJian — China, brand origin (country-level).** An independent perfumery retailer explicitly describes the house as founded in China; the official about page corroborates its Chinese botanical and cultural focus. No city is inferred. [Passion Parfum](https://passion-parfum.com/en/collections/chujian) · [Official brand story](https://www.chujianparfums.com/pages/about-us).

Historical batch snapshot (superseded by the current canonical status above): 178 points — 149 city, 6 region, 23 country precision; 172 anchored and 6 unverified. The remaining unverified set is 3 city and 3 country points. Typed geography now covers 173 of 178 houses; five houses still have no typed geography.


### Two further primary-source resolutions — 23 November 2026

- **Henry Rose — California, USA, commercial base (region-level).** Its official terms identify Henry Rose LLC as the website owner/operator and state that the site is controlled, operated and administered from company offices in California. The Los Angeles address in the terms is used for legal notices; it is not promoted to a city HQ or studio claim. [Official terms](https://henryrose.com/pages/terms-of-service).
- **Paragraf Parfums — Indonesia, brand origin (country-level).** Its official homepage describes it as an Indonesian perfume house and states that orders ship from Indonesia. No city, headquarters or manufacturing site is inferred. [Official homepage](https://paragrafparfums.com/).

Coordinate references: [California geographic centre](https://www.geodatos.net/en/coordinates/united-states/california), [Indonesia geographic centre](https://www.coordmap.com/countries/indonesia).

Historical batch snapshot (superseded by the current canonical status above): 178 points — 148 city, 7 region, 23 country precision; 174 anchored and 4 unverified (2 city, 2 country). Typed geography now covers 175 of 178 houses; three houses remain without typed geography: Cozy (Khamreya), Gerimist and Eau So Dramatic.


### Reproducible standalone snapshot build — 23 November 2026

The previous `dist/scent-atlas.html` was a manually assembled, data-inlined snapshot with no committed generator. This is replaced by a deterministic source-led build:

- Source: `apps/scent-atlas.html`.
- Data: every static JSON path referenced by the source app's `load(...)` calls, discovered from the source rather than maintained as a second hand-written list.
- Output: `dist/scent-atlas.html`, with a generated `BUNDLE` object and a loader that reads bundled data first. Network fallback remains only for an unexpected path not included in the build inventory.
- Rebuild: `npm run build:scent-atlas`.
- Reproducibility check: `npm run check:scent-atlas`; CI runs this check and includes the dist file in its path filters.
- The builder has focused tests for complete static-path bundling, deterministic output and malformed-data rejection.

The snapshot is generated from the current source app and data. It is not hand-edited.


### Ellis Brooklyn location clarification — Stamford, Connecticut

The current official [Contact page](https://www.ellisbrooklyn.com/pages/contact-us) and [Privacy Policy](https://www.ellisbrooklyn.com/pages/privacy-policy) both list 4 Star Point, Suite 201, Stamford, CT 06902. The map now represents this as the house's **commercial/contact base** at city precision. The company is incorporated in Delaware; the Stamford pin is not a legal-domicile claim. The earlier Brooklyn address is not used as the current anchor, and the Apple Love Eau de Parfum manufacturing evidence remains SKU-specific. Coordinates use the [GeoNames Stamford reference](https://www.geonames.org/4843564/stamford.html).

Updated canonical map counts: 178 points — 148 city, 7 region, 23 country precision; 175 anchored and 3 unverified. The remaining unverified points are Cozy (Khamreya) at city precision, and Gerimist plus Eau So Dramatic at country precision.


### Country-only fallback for Cozy (Khamreya)

The unsupported Port Fouad city coordinate has been removed. Searches surfaced unrelated perfume retailers in Port Fouad but no evidence connecting them to Cozy (Khamreya). The point is now an **unverified Egypt country-only fallback** at representative country-centre coordinates. No city, role or source claim is inferred. This leaves no unverified city- or region-precision pins on the map.
