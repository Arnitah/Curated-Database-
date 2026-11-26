import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHouseVerification, summarizeVerification } from "../../scripts/scents-verification.mjs";

const claim = (topic, overrides = {}) => ({
  id: topic + "-1", house: "sample-house", kind: "claim", topic,
  strength: "B", evidence: "editorial", src: "https://example.org/evidence",
  ...overrides
});

test("requires independent A/B evidence for owner, manufacturing and catalogue", () => {
  const result = evaluateHouseVerification("sample-house", [
    claim("owner"), claim("manufacturing"), claim("catalogue")
  ]);
  assert.equal(result.status, "verified");
  assert.deepEqual(result.missing, []);
});

test("brand claims never satisfy the independent evidence gate", () => {
  const result = evaluateHouseVerification("sample-house", [
    claim("owner", { evidence: "brand", strength: "C" }),
    claim("manufacturing"), claim("catalogue")
  ]);
  assert.equal(result.verified, false);
  assert.deepEqual(result.missing, ["owner"]);
  assert.equal(result.requirements[0].rejected[0].reason, "Evidence strength is below A/B");
});

test("wrong topics and unrelated houses cannot satisfy requirements", () => {
  const result = evaluateHouseVerification("sample-house", [
    claim("legal_base"), claim("manufacturing"), claim("catalogue"),
    claim("owner", { house: "another-house" })
  ]);
  assert.deepEqual(result.missing, ["owner"]);
});

test("retailer, creator and reported records do not qualify as A/B independent evidence", () => {
  for (const evidence of ["retailer", "creator", "reported", "brand", "nitah", "checked"]) {
    const result = evaluateHouseVerification("sample-house", [
      claim("owner", { evidence }), claim("manufacturing"), claim("catalogue")
    ]);
    assert.equal(result.verified, false, evidence + " must not pass");
  }
});

test("summary counts missing evidence dimensions without promoting any house", () => {
  const summary = summarizeVerification([{ id: "sample-house" }, { id: "other-house" }], [
    claim("owner"), claim("manufacturing"), claim("catalogue")
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.verified, 1);
  assert.equal(summary.not_verified, 1);
  assert.deepEqual(summary.missing_by_topic, { owner: 1, manufacturing: 1, catalogue: 1 });
});
