import test from "node:test";
import assert from "node:assert/strict";
import { GEO_TOPICS, LEGACY_GEO_TOPICS, validateGeographyObservation } from "../../scripts/scents-geography.mjs";

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
