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
- Map precision: 110 `city`, 1 `region`, 67 `country`. A first-pass review found 39 of the 67 `country`-precision points use city-named place labels and city-centre coordinates. Additional country-named labels also use city-centre coordinates (for example Canada/Ottawa, India/New Delhi, Indonesia/Jakarta, Sweden/Stockholm and UAE/Dubai). This is a release hold for a source-and-coordinate audit; no `geo.json` values have been changed. Precision is spatial granularity, not evidence confidence or relationship type.

**Current PR branch at commit `392db198f5dc3ee54fc47a94de30c7d9f9b244dc` (2026-11-23):**
- 621 observations total: 435 claim records, including 416 typed geography claims.
- Typed geography claims cover 156 of 178 existing houses and 3 research leads; 22 existing houses have no typed geography claim yet.
- The 11 legacy `hq` / `made_in` claims remain unchanged and un-reclassified.
- The 3 lead-linked records remain leads; they are not inserted into `houses.json` as established houses.
- Counts were recomputed directly from `observations.json`, `houses.json` and `leads.json` at the stated commit.

## Open review holds (first-pass register, 2026-11-23)

These are intentionally not bulk-corrected. They remain separate research and compatibility gates.

### Houses without typed geography claims

The current 22 records are: Scentury Perfume & Co. (`scentury`), Henry Rose (`henry-rose`), Rogue Perfumery (`rogue-perfumery`), CYKLAR (`cyklar`), Meleg Perfumes (`meleg-perfumes`), Cozy (Khamreya) (`cozy-khamreya`), Libroaria (`libroaria`), Régime des Fleurs (`regime-des-fleurs`), Chujian (`chujian`), The Body Tale (`the-body-tale`), Kitschy (`kitschy`), Aroma Concepts (`aroma-concepts`), Celia Loves (`celia-loves`), Gerimist (`gerimist`), Liberation of Flowers (`liberation-of-flowers`), Paragraf Parfums (`paragraf-parfums`), Otter Haus (`otter-haus`), Indē Wild (`inde-wild`), Eau So Dramatic (`eau-so-dramatic`), Amouroud (`amouroud`), Maison Mataha (`maison-mataha`) and Muse Beauty (`muse-beauty`). Their legacy `houses.json` city/country display fields are not evidence of a typed relationship. Maison Mataha also remains held pending identification of its current legal operator.

### Legacy geography claims awaiting individual source review

The 11 unchanged legacy claims are grouped as follows: Saint d'Ici (3 `hq` claims), Maya Njie (2 `hq` claims), Beguile (1 `hq` and 1 `made_in` claim), Amouage (1 `made_in` claim), Scent of Africa (1 `made_in` claim), Mezel (1 `hq` claim) and Naisday (1 `hq` claim). Keep each original source and text; reclassify only after deciding which typed relationship the source actually supports.

### Map precision and anchor audit

The first pass identified 39 map records whose `precision` is `country` while the place label and coordinates are city-level: `j-scent`, `pesade`, `to-summer`, `uttori`, `ichun`, `tadhana`, `gp-fragrances`, `toouch`, `maison-bagian`, `lattafa`, `scentury`, `beguile`, `goldfield-banks`, `hiram-green`, `reunrom`, `solure`, `skybottle`, `whipped`, `kst-scent`, `milky-mane`, `isak`, `naso-profumi`, `neesh`, `saff-and-co`, `janua`, `sana-jardin`, `sultan-pasha`, `areej-le-dore`, `bortnikoff`, `ensar-oud`, `asateer`, `paragraf-parfums`, `etre-parfums`, `otter-haus`, `inde-wild`, `forward-perfume`, `oaken-lab`, `son-venin` and `nostos`. A further first-pass concern is country-named place labels whose coordinates appear city-centred (Canada/Ottawa, India/New Delhi, Indonesia/Jakarta, Sweden/Stockholm and UAE/Dubai). These are flags for source and coordinate verification, not permission to relabel or move points. No `geo.json` coordinates or precision values were changed.

The complete map audit must check all 178 anchors against their source, intended role and actual coordinate granularity. Do not equate a typed geography observation with the existing single map anchor: the map currently supports only one anchor per house and cannot yet distinguish legal, retail, studio or manufacturing locations.

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
