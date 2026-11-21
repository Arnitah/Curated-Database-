export const GEO_TOPICS = Object.freeze(["brand_origin","founder_origin","legal_base","commercial_base","studio","formulation","manufacturing","filling","assembly","sourcing","retail"]);
export const LEGACY_GEO_TOPICS = Object.freeze(["hq","made_in"]);
const LOCATION_KEYS = new Set(["city","region","country","cc","site"]);
export function validateGeographyObservation(observation) {
  const errors = [];
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) return ["observation must be an object"];
  if (!GEO_TOPICS.includes(observation.topic)) {
    if (observation.location !== undefined) errors.push("location is only valid with a typed geography topic");
    return errors;
  }
  if (observation.kind !== "claim") errors.push("geography topics must use kind: claim");
  const location = observation.location;
  if (!location || typeof location !== "object" || Array.isArray(location)) {
    errors.push("typed geography claims need a location object");
    return errors;
  }
  for (const key of Object.keys(location)) if (!LOCATION_KEYS.has(key)) errors.push('location has unsupported field "' + key + '"');
  for (const key of ["country","cc"]) if (typeof location[key] !== "string" || !location[key].trim()) errors.push("location." + key + " is required");
  if (typeof location.cc === "string" && !/^[A-Z]{2}$/.test(location.cc)) errors.push("location.cc must be an uppercase ISO 3166-1 alpha-2 code");
  for (const key of ["city","region","site"]) if (location[key] !== undefined && (typeof location[key] !== "string" || !location[key].trim())) errors.push("location." + key + " must be a non-empty string when supplied");
  return errors;
}
