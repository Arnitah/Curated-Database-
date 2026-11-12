# Places to Smell: draft register and design proposal

**Status:** research and draft only (11 Nov 2026). Nothing here is read by the app or the build, and nothing is published to the live Atlas. Implementation waits for Nitah's approval of the structure and the evidence.

The Atlas already says *what* to smell. This layer would say *where* to experience the traditions, people, landscapes and craft behind scent.

## 1. What's in the draft

`register.draft.json` holds 44 places:
- the 19 from the Warpaint Journal × PulpCulture.in list
- the 4 balancing places
- 21 more found through research or named in comments on the list

| Region | Places | Notes |
| --- | --- | --- |
| Europe | 14 | 12 from the list, plus Kazanlak and Isparta rose harvests |
| Asia | 9 | Kannauj, Tokyo, Singapore, Guangzhou, Awaji, Kyoto, Seoul, Nha Trang, Mysuru |
| Africa | 8 | Morocco, Egypt ×2, Zanzibar, Comoros, Madagascar, Lagos, Addis Ababa |
| Middle East | 5 | Muscat, Taif, Dubai, Jabal Akhdar, Salalah |
| Caribbean | 3 | Grenada, Dominica, Haiti (not visitable) |
| Latin America | 3 | Papantla, Mexico City, Belém |
| North America | 1 | Los Angeles |
| Oceania | 1 | Perth (unverified) |

Verification:
- **8 verified:** operating, with an official source or two recent independent ones.
- **25 partly verified:** they exist, but some details are unconfirmed.
- **9 unverified:** a single weak or old source.
- **2 not visitable:** real places with no confirmed or safe visitor access.

Nothing is marked open just because it exists. Every record lists what is still unknown.

## 2. Record structure (one record per place)

| Field | Meaning |
| --- | --- |
| `id`, `name`, `country`, `cc`, `region` | Identity and where it is |
| `place` | Precise location: address or the most exact place found |
| `geo` | `lat`, `lon`, `precision` (`site` / `town` / `region`), so the map never pretends to be more exact than the evidence |
| `type` | One primary type: `museum_archive`, `workshop_atelier`, `harvest_region`, `souk_market`, `bespoke`, `cultural_demonstration`, `visitor_centre` |
| `also` | Secondary types |
| `can_do` | What a visitor can actually do, in plain words |
| `status.operating`, `status.accepts_visitors` | Kept separate. A distillery can operate without receiving visitors. Values include `yes`, `seasonal`, `time-limited`, `likely`, `unknown`, `no` |
| `booking` | Whether it's required and how |
| `cost` | Amount and currency where verifiable, otherwise a note |
| `season` | Opening days, harvest months or event dates |
| `links` | `traditions`, `materials`, `houses`, `leads`. Ids are checked against existing Atlas records |
| `sources` | Each with `kind` (official / editorial / listing / database / creator), `strength` A–D and `published` where known |
| `verification` | `status`, `checked` date and `open` questions |
| `origin` | Where the lead came from: the list, WS6, our research, or a comment |

**Proposed additions at implementation time:**
- `valid_until`, for time-limited events like the Seoul incense talks, so they disappear on their own afterwards.
- Changeable facts (price, hours, open or closed) stored as dated records in `observations.json`, under a new `place` key, with the topics `status`, `booking`, `price` and `season`. The weekly check could then flag stale prices (over 180 days) and broken links, exactly as it does for houses.

## 3. Relationships to what the Atlas already has

| From a place | To | What it enables |
| --- | --- | --- |
| `links.traditions` | `traditions.json` | A tradition panel gains "Where to experience it". For example, Dades rose leads to the Kelâat M'Gouna fair, and Dhofar frankincense leads to Al Haffa and Amouage |
| `links.materials` | `materials.json` | A material panel gains "Where it grows / where to smell it". For example, vanilla leads to Papantla and the SAVA coast, and ylang leads to Anjouan |
| `links.houses` | `houses.json` | A house card gains "Visit": Amouage, Serge Lutens, Santa Maria Novella, Sifr Aromatics |
| place `cc` / city | `travel.json` | Destination guides list nearby places automatically |
| (future) | Passport | "Visited" stamps for places, the same as "smelled" stamps for perfumes |

Places never become houses. Big-brand boutiques (Guerlain, Serge Lutens) can be places without entering the house register. Seinde Signature, already excluded as a house, fits here as a place.

**Gaps found while linking:**
- No material records exist yet for nutmeg, bay leaf or agarwood. Agarwood is filed as oud.
- No tradition record exists for Omani rose water (golab is Iranian) or for Amazonian *cheiro do Pará*.

## 4. How the map would work (proposal only)

- **A separate layer, off by default.** A "Places to smell" toggle sits beside "Hot spots" and "Traditions". Houses and places never mix in the same list.
- **Shape, not colour.** Places use a doorway-shaped pin, and houses keep their dots. A small glyph shows the type: a column for a museum, a flask for a workshop, a flower for a harvest, a lantern for a souk, a monogram for bespoke, a curl of smoke for a cultural demonstration, a door for a visitor centre. The palette stays muted.
- **Honest precision.** A place known only to region level shows as a soft area rather than a sharp pin. Not-visitable places, such as Haiti's vetiver fields, appear as a landscape outline with a "where it grows, not visitable now" note.
- **The signature moment: a harvest calendar.** A ring of twelve months sits on the map. Turn it to May and Kazanlak, Kelâat M'Gouna, Taif and Jabal Akhdar glow; turn it to June and the Nile Delta jasmine starts. This answers "when should I go?", the question a traveller actually asks.
- **The place card, like a museum wall label:**
  - type and status chips, with the checked date
  - "What you can do"
  - a season strip
  - cost and booking
  - links to "The tradition", "The material" and "Smell it in" (houses)
  - a light evidence line ("3 sources · A, B, B"), with the full drawer only on tap
- **Visibility rules.** Verified and partly verified places show by default. Unverified places sit behind a "still checking" filter. Expired events hide themselves.
- **A balance strip.** A small honest count per region ("Caribbean 3 · 1 not visitable"), shown so the gaps are visible rather than hidden.

## 5. Research still to do before approval
- **Latin America and the Caribbean** are still thin:
  - Paraguay petitgrain
  - Peru and Colombia aromatic plants
  - Guatemala
  - Martinique and Jamaica
- **Asia:**
  - Java (patchouli and vetiver around Garut)
  - Sri Lanka spice gardens
  - the Philippines (ylang-ylang)
  - Central Asia
- **Africa:**
  - South Africa (buchu)
  - Kenya
  - named Egyptian perfume shops
  - an Ethiopian heritage source
- **Iran:** Kashan rose-water festival, with current travel advisories.
- **Missing official pages** for several places (Molinard, Villoresi, Osmothèque calendar, Xuelei admissions).
