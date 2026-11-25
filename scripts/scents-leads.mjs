export const LEAD_STATUSES = Object.freeze(["unreviewed","new","checking","qualified","added","excluded","question"]);
const EVIDENCE = new Set(["checked","retailer","brand","database","registry","editorial","reported","creator","nitah"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const URL = /^https?:\/\//;

export function validateLead(lead) {
  const errors = [];
  if (!lead || typeof lead !== "object" || Array.isArray(lead)) return ["lead must be an object"];
  if (typeof lead.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(lead.id)) errors.push("id must be a stable lowercase slug");
  for (const key of ["name","lead"]) if (typeof lead[key] !== "string" || !lead[key].trim()) errors.push(key + " is required");
  if (lead.status !== "unreviewed") {
    if (typeof lead.country !== "string" || !lead.country.trim()) errors.push("country is required for an actively reviewed lead");
    if (typeof lead.cc !== "string" || !/^[A-Z]{2}$/.test(lead.cc)) errors.push("cc must be an uppercase ISO 3166-1 alpha-2 code for an actively reviewed lead");
  }
  if (!LEAD_STATUSES.includes(lead.status)) errors.push("status must be one of " + LEAD_STATUSES.join(", "));
  if (lead.src != null && (typeof lead.src !== "string" || !URL.test(lead.src))) errors.push("src must be an http(s) URL when supplied");
  if (lead.aliases != null && (!Array.isArray(lead.aliases) || lead.aliases.some((a) => typeof a !== "string" || !a.trim()))) errors.push("aliases must be an array of non-empty strings");
  if (lead.sources != null) {
    if (!Array.isArray(lead.sources)) errors.push("sources must be an array");
    else for (const source of lead.sources) {
      if (!source || typeof source !== "object" || !URL.test(source.url || "")) errors.push("each source needs an http(s) url");
      if (!EVIDENCE.has(source?.evidence)) errors.push("each source needs a valid evidence type");
      if (!DATE.test(source?.checked || "")) errors.push("each source needs checked date YYYY-MM-DD");
      if (source?.supports != null && (typeof source.supports !== "string" || !source.supports.trim())) errors.push("source supports must be non-empty text");
    }
  }
  if (lead.status === "qualified" && !(lead.sources || []).length) errors.push("qualified leads need at least one source record");
  return errors;
}

export function validateLeads(leads) {
  const errors = [];
  if (!Array.isArray(leads)) return ["leads dataset must be an array"];
  const seen = new Set();
  for (const lead of leads) {
    for (const issue of validateLead(lead)) errors.push("lead " + (lead?.id || lead?.name || "?") + ": " + issue);
    if (lead?.id && seen.has(lead.id)) errors.push("duplicate lead id: " + lead.id);
    if (lead?.id) seen.add(lead.id);
  }
  return errors;
}
