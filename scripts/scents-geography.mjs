export const GEO_TOPICS = Object.freeze(["brand_origin","founder_origin","legal_base","commercial_base","studio","formulation","manufacturing","filling","assembly","sourcing","retail"]);
export const LEGACY_GEO_TOPICS = Object.freeze(["hq","made_in"]);
const LOCATION_KEYS = new Set(["city","region","country","cc","site","entity"]);
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


export const GEO_PRECISIONS = Object.freeze(["city", "region", "country"]);

export function normaliseMapPlace(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/\\s*\\([^)]*\\)/g, "")
    .split(",")[0]
    .replace(/[–—]/g, "-")
    .trim()
    .replace(/\\s+/g, " ");
}

function normaliseCountry(value) {
  const key = String(value || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[.]/g, "").trim();
  return ({ uae: "united arab emirates", usa: "united states", us: "united states", uk: "united kingdom", "republic of korea": "south korea" })[key] || key;
}

export function validateMapAnchors(geo, houses, observations) {
  const errors = [];
  const houseById = new Map((houses || []).map((house) => [house.id, house]));
  const observationById = new Map((observations || []).map((observation) => [observation.id, observation]));
  for (const [houseId, point] of Object.entries(geo || {})) {
    const house = houseById.get(houseId);
    if (!house) { errors.push(houseId + ": map point has no matching house"); continue; }
    if (!GEO_PRECISIONS.includes(point.precision)) errors.push(houseId + ": precision must be city, region or country");
    const ids = point.anchor_observation_ids;
    if (ids === undefined) continue;
    if (!Array.isArray(ids) || ids.length === 0) { errors.push(houseId + ": anchor_observation_ids must be a non-empty array when supplied"); continue; }
    if (new Set(ids).size !== ids.length) errors.push(houseId + ": anchor_observation_ids must not contain duplicates");
    for (const id of ids) {
      const observation = observationById.get(id);
      if (!observation) { errors.push(houseId + ": unknown anchor observation " + id); continue; }
      if (observation.kind !== "claim" || !GEO_TOPICS.includes(observation.topic) || !observation.location) {
        errors.push(houseId + ": anchor " + id + " must reference a typed geography claim");
        continue;
      }
      if (observation.house !== houseId) errors.push(houseId + ": anchor " + id + " belongs to a different house");
      if (observation.location.cc !== house.cc) errors.push(houseId + ": anchor " + id + " has a different country code");
      if (point.precision === "city" && (!observation.location.city || normaliseMapPlace(observation.location.city) !== normaliseMapPlace(point.place))) {
        errors.push(houseId + ": city anchor " + id + " does not match map place " + point.place);
      }
      if (point.precision === "region" && (!observation.location.region || normaliseMapPlace(observation.location.region) !== normaliseMapPlace(point.place))) {
        errors.push(houseId + ": region anchor " + id + " does not match map place " + point.place);
      }
      if (point.precision === "country" && (observation.location.city || observation.location.region || normaliseCountry(observation.location.country) !== normaliseCountry(house.country) || normaliseCountry(point.place) !== normaliseCountry(house.country))) {
        errors.push(houseId + ": country anchor " + id + " must be country-only and match the map country");
      }
    }
  }
  return errors;
}
