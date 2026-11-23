import test from "node:test";
import assert from "node:assert/strict";
import { GEO_TOPICS, LEGACY_GEO_TOPICS, validateGeographyObservation, normaliseMapPlace, validateMapAnchors } from "../../scripts/scents-geography.mjs";

const base = {
  id: "sample-manufacturing-1", house: "sample-house", kind: "claim", topic: "manufacturing",
  text: "Finished fragrance is manufactured at the named site.", evidence: "editorial", strength: "B",
  src: "https://example.org/source", seen: "2026-11-21",
  location: { city: "Muscat", country: "Oman", cc: "OM" },
};

test("geography topic vocabulary is explicit and stable", () => {
  assert.deepEqual(GEO_TOPICS, ["brand_origin","founder_origin","legal_base","commercial_base","studio","formulation","manufacturing","filling","assembly","sourcing","retail"]);
  assert.deepEqual(LEGACY_GEO_TOPICS, ["hq","made_in"]);
});
test("accepts a sourced city-level geography claim", () => assert.deepEqual(validateGeographyObservation(base), []));
test("accepts country-only facts when city is not established", () => assert.deepEqual(validateGeographyObservation({ ...base, location: { country: "Oman", cc: "OM" } }), []));
test("accepts a named legal entity alongside its registered location", () => assert.deepEqual(validateGeographyObservation({ ...base, topic: "legal_base", location: { entity: "Example Ltd", city: "London", country: "United Kingdom", cc: "GB" } }), []));
test("requires a location object for every typed geography topic", () => {
  for (const topic of GEO_TOPICS) assert.ok(validateGeographyObservation({ ...base, topic, location: undefined }).some(x => x.includes("need a location object")), topic);
});
test("requires country name and ISO alpha-2 code", () => {
  const errors = validateGeographyObservation({ ...base, location: { city: "Muscat" } });
  assert.ok(errors.includes("location.country is required")); assert.ok(errors.includes("location.cc is required"));
});
test("rejects malformed country codes", () => assert.ok(validateGeographyObservation({ ...base, location: { country: "Oman", cc: "om" } }).includes("location.cc must be an uppercase ISO 3166-1 alpha-2 code")));
test("rejects blank optional place labels", () => assert.ok(validateGeographyObservation({ ...base, location: { ...base.location, city: " " } }).some(x => x.includes("location.city must be a non-empty string"))));
test("rejects location data on non-geography topics", () => assert.ok(validateGeographyObservation({ ...base, topic: "founder" }).includes("location is only valid with a typed geography topic")));
test("requires geography records to be claims", () => assert.ok(validateGeographyObservation({ ...base, kind: "price" }).includes("geography topics must use kind: claim")));
test("keeps legacy hq and made_in claims readable without reinterpreting them", () => {
  for (const topic of LEGACY_GEO_TOPICS) { const record = { ...base, topic }; delete record.location; assert.deepEqual(validateGeographyObservation(record), []); }
});
test("rejects unrecognized location properties", () => assert.ok(validateGeographyObservation({ ...base, location: { ...base.location, address_line: "1 Main St" } }).some(x => x.includes('unsupported field "address_line"'))));


const sampleHouse = { id: "sample-house", country: "Oman", cc: "OM" };
const sampleStudio = { ...base, id: "sample-studio-1", topic: "studio" };

test("normalises accents and parenthetical map labels without guessing aliases", () => {
  assert.equal(normaliseMapPlace("Montréal"), normaliseMapPlace("Montreal"));
  assert.equal(normaliseMapPlace("New York (perfumer)"), normaliseMapPlace("New York"));
});

test("validates one or multiple city-role anchors for the same house and place", () => {
  const geo = { "sample-house": { place: "Muscat", precision: "city", cc: "OM", anchor_observation_ids: [base.id, sampleStudio.id] } };
  assert.deepEqual(validateMapAnchors(geo, [sampleHouse], [base, sampleStudio]), []);
});

test("validates country-only map anchors without inferring a city", () => {
  const countryClaim = { ...base, id: "sample-country-1", topic: "brand_origin", location: { country: "Oman", cc: "OM" } };
  const geo = { "sample-house": { place: "Oman", precision: "country", cc: "OM", anchor_observation_ids: [countryClaim.id] } };
  assert.deepEqual(validateMapAnchors(geo, [sampleHouse], [countryClaim]), []);
});

test("validates region-level anchors", () => {
  const regionClaim = { ...base, id: "sample-region-1", location: { region: "Al Batinah", country: "Oman", cc: "OM" } };
  const geo = { "sample-house": { place: "Al Batinah", precision: "region", cc: "OM", anchor_observation_ids: [regionClaim.id] } };
  assert.deepEqual(validateMapAnchors(geo, [sampleHouse], [regionClaim]), []);
});

test("allows unverified pins without an anchor reference", () => {
  assert.deepEqual(validateMapAnchors({ "sample-house": { place: "Muscat", precision: "city" } }, [sampleHouse], [base]), []);
});

test("rejects dangling, cross-house and mismatched-place anchor references", () => {
  const dangling = validateMapAnchors({ "sample-house": { place: "Muscat", precision: "city", cc: "OM", anchor_observation_ids: ["missing"] } }, [sampleHouse], [base]);
  assert.ok(dangling.some(x => x.includes("unknown anchor observation")));
  const crossHouse = validateMapAnchors({ "sample-house": { place: "Muscat", precision: "city", cc: "OM", anchor_observation_ids: [base.id] } }, [sampleHouse], [{ ...base, house: "other-house" }]);
  assert.ok(crossHouse.some(x => x.includes("belongs to a different house")));
  const wrongPlace = validateMapAnchors({ "sample-house": { place: "Nizwa", precision: "city", cc: "OM", anchor_observation_ids: [base.id] } }, [sampleHouse], [base]);
  assert.ok(wrongPlace.some(x => x.includes("does not match map place")));
});

test("rejects a city-level observation as a country-only anchor", () => {
  const geo = { "sample-house": { place: "Oman", precision: "country", cc: "OM", anchor_observation_ids: [base.id] } };
  const errors = validateMapAnchors(geo, [sampleHouse], [base]);
  assert.ok(errors.some(x => x.includes("must be country-only")));
});


test("validates a cross-border city anchor against the anchor country, not the house country", () => {
  const paris = { ...base, id: "sample-paris-base-1", topic: "commercial_base", location: { city: "Paris", country: "France", cc: "FR" } };
  const foreignHouse = { id: "sample-house", country: "Thailand / France", cc: "TH" };
  const geo = { "sample-house": { place: "Paris", precision: "city", cc: "FR", anchor_observation_ids: [paris.id] } };
  assert.deepEqual(validateMapAnchors(geo, [foreignHouse], [paris]), []);
});

test("validates a cross-border country-only anchor independently of the house country", () => {
  const france = { ...base, id: "sample-france-origin-1", topic: "brand_origin", location: { country: "France", cc: "FR" } };
  const foreignHouse = { id: "sample-house", country: "Thailand / France", cc: "TH" };
  const geo = { "sample-house": { place: "France", precision: "country", cc: "FR", anchor_observation_ids: [france.id] } };
  assert.deepEqual(validateMapAnchors(geo, [foreignHouse], [france]), []);
});

test("rejects an anchor observation whose country differs from the map anchor country", () => {
  const geo = { "sample-house": { place: "Muscat", precision: "city", cc: "FR", anchor_observation_ids: [base.id] } };
  const errors = validateMapAnchors(geo, [sampleHouse], [base]);
  assert.ok(errors.some(x => x.includes("different map-anchor country code")));
});

test("requires an explicit country code for verified map anchors", () => {
  const geo = { "sample-house": { place: "Muscat", precision: "city", anchor_observation_ids: [base.id] } };
  const errors = validateMapAnchors(geo, [sampleHouse], [base]);
  assert.ok(errors.some(x => x.includes("needs its own valid cc country code")));
});
