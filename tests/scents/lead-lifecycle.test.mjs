import test from "node:test";
import assert from "node:assert/strict";
import { validateLead, validateLeads } from "../../scripts/scents-leads.mjs";

const valid = {
  id: "toke-makinwa-beauty", status: "checking", name: "Toke Makinwa Beauty",
  country: "Nigeria", cc: "NG", lead: "Founder-associated fragrance brand.",
  src: "https://tokemakinwabeauty.com/", checked: "2026-11-25",
  sources: [{ url: "https://tokemakinwabeauty.com/", evidence: "brand", checked: "2026-11-25", supports: "Official catalogue" }]
};

test("accepts a well-formed discovery lead", () => assert.deepEqual(validateLead(valid), []));
test("rejects malformed IDs, country codes, statuses and source records", () => {
  const bad = { ...valid, id: "Toke Makinwa", cc: "ng", status: "verified", sources: [{ url: "javascript:alert(1)", evidence: "rumour", checked: "yesterday" }] };
  const errors = validateLead(bad);
  assert.ok(errors.some((x) => x.includes("stable lowercase slug")));
  assert.ok(errors.some((x) => x.includes("ISO 3166")));
  assert.ok(errors.some((x) => x.includes("status")));
  assert.ok(errors.some((x) => x.includes("http(s) url")));
  assert.ok(errors.some((x) => x.includes("evidence type")));
  assert.ok(errors.some((x) => x.includes("checked date")));
});
test("qualified leads require source records", () => {
  assert.ok(validateLead({ ...valid, status: "qualified", sources: [] }).some((x) => x.includes("qualified leads")));
});
test("dataset rejects duplicate IDs and malformed records", () => {
  assert.ok(validateLeads([valid, valid]).some((x) => x.includes("duplicate lead id")));
});
