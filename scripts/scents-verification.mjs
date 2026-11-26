export const VERIFICATION_REQUIREMENTS = Object.freeze(["owner", "manufacturing", "catalogue"]);
export const INDEPENDENT_EVIDENCE = Object.freeze(["registry", "editorial", "database"]);
const QUALIFYING_STRENGTHS = new Set(["A", "B"]);
const URL = /^https?:\/\//;

function qualifies(record, topic) {
  return record?.kind === "claim" &&
    record.topic === topic &&
    QUALIFYING_STRENGTHS.has(record.strength) &&
    INDEPENDENT_EVIDENCE.includes(record.evidence) &&
    typeof record.src === "string" && URL.test(record.src);
}

export function evaluateHouseVerification(houseId, records = []) {
  const claims = records.filter((record) => record?.house === houseId && record?.kind === "claim");
  const requirements = VERIFICATION_REQUIREMENTS.map((topic) => {
    const relevant = claims.filter((record) => record.topic === topic);
    const qualifying = relevant.filter((record) => qualifies(record, topic));
    const rejected = relevant.filter((record) => !qualifies(record, topic)).map((record) => ({
      id: record.id || null,
      strength: record.strength || null,
      evidence: record.evidence || null,
      reason: !QUALIFYING_STRENGTHS.has(record.strength)
        ? "Evidence strength is below A/B"
        : !INDEPENDENT_EVIDENCE.includes(record.evidence)
          ? "Source is not an accepted independent evidence class"
          : "A valid source URL is required"
    }));
    return {
      topic,
      status: qualifying.length ? "supported" : "missing",
      qualifying: qualifying.map((record) => ({ id: record.id, strength: record.strength, evidence: record.evidence, src: record.src })),
      rejected
    };
  });
  const missing = requirements.filter((item) => item.status !== "supported").map((item) => item.topic);
  return {
    house: houseId,
    status: missing.length ? "not_verified" : "verified",
    verified: missing.length === 0,
    requirements,
    missing,
    reason: missing.length
      ? "Independent A/B evidence is missing for: " + missing.join(", ")
      : "Owner, manufacturing and current catalogue each have independent A/B evidence."
  };
}

export function summarizeVerification(houses = [], records = []) {
  const results = houses.map((house) => evaluateHouseVerification(house.id, records));
  return {
    total: results.length,
    verified: results.filter((item) => item.verified).length,
    not_verified: results.filter((item) => !item.verified).length,
    missing_by_topic: Object.fromEntries(VERIFICATION_REQUIREMENTS.map((topic) => [
      topic, results.filter((item) => item.missing.includes(topic)).length
    ])),
    results
  };
}
