// Clay My Shelf record -> Ingredient Intelligence product record.
// Read-only: never mutates Clay data, never invents values. Anything Clay does not store stays null/unknown
// and is listed in mapping_notes so the UI can say "not on file" honestly.
const CAT_FACE = {
  Cleanser: "face_cleanser", Toner: "toner", "Skin conditioner": "other",
  Serum: "serum", Treatment: "treatment", Moisturizer: "moisturiser",
  Eye: "other", Sunscreen: "sunscreen", Other: "other"
};
const STATUS = { cur: "in_use", have: "owned_not_using", past: "finished", next: "wishlist" };
const AREA = { face: "face", body: "body", hair: "hair" };
const SOURCES = new Set(["package_photo", "manufacturer", "retailer", "user_entered", "unknown"]);

// Split a pasted INCI string on commas/newlines/semicolons/bullets, but not inside brackets.
export function parseInci(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const text = raw.replace(/^\s*(ingredients?|inci)\s*[:\-]\s*/i, "").replace(/[•·|]/g, ",");
  const out = []; let depth = 0, cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,;\n]/.test(ch)) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map(x => x.replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim()).filter(Boolean);
}

export function toEngineProduct(mp) {
  const notes = [];
  const area = AREA[mp.a] || "unknown";
  if (!AREA[mp.a]) notes.push(`area "${mp.a}" has no engine equivalent; stored as unknown`);
  let category;
  if (mp.a === "face") {
    category = CAT_FACE[mp.st];
    if (!category) { category = "other"; notes.push(`step "${mp.st}" has no engine category; stored as other`); }
  } else if (mp.a === "body" || mp.a === "hair") category = mp.a;
  else { category = "other"; notes.push(`area "${mp.a}" has no engine category; stored as other`); }
  const status = STATUS[mp.s];
  if (!status) notes.push(`status "${mp.s}" not recognised`);
  const list = parseInci(mp.inci).map((inci, i) => ({ inci, position: i + 1 }));
  if (!list.length) notes.push("no ingredient list on file");
  if (mp.inci_verified !== true && list.length) notes.push("ingredient list has not been confirmed against the product packaging");
  const source = SOURCES.has(mp.inci_source) ? mp.inci_source : (list.length ? "user_entered" : "unknown");
  const format = ["leave_on", "rinse_off", "wash_off", "unknown"].includes(mp.format) ? mp.format : "unknown";
  const frequency = Number.isFinite(mp.frequency_per_week) && mp.frequency_per_week >= 0 && mp.frequency_per_week <= 14 ? mp.frequency_per_week : null;
  const knownPh = Number.isFinite(mp.known_ph) && mp.known_ph >= 0 && mp.known_ph <= 14 ? mp.known_ph : null;
  if (!mp.directions_text) notes.push("product directions not on file");
  if (mp.directions_text && !mp.directions_source_url) notes.push("product directions have no source URL on file");
  if (mp.directions_text && !mp.directions_checked_at) notes.push("product directions checked date is not on file");
  if (!mp.product_variant) notes.push("exact product variant not on file");
  if (!mp.market) notes.push("product market or region not on file");
  if ((mp.product_variant || mp.market) && !mp.identity_source_url) notes.push("product identity source URL not on file");
  if (format === "unknown") notes.push("product format not on file");
  if (frequency === null) notes.push("use frequency not on file");
  if (knownPh === null) notes.push("product pH not on file; no value inferred");
  if (!mp.brand) notes.push("brand not on file");
  notes.push("concentration and product role are not inferred from the ingredient list or broad shelf category");
  return {
    product_id: String(mp.id),
    name: String(mp.n || ""),
    brand: typeof mp.brand === "string" ? mp.brand : null,
    category,
    status: status || "owned_not_using",
    area,
    format,
    frequency_per_week: frequency,
    ingredient_list: list,
    ingredient_list_source: source,
    ingredient_list_verified: mp.inci_verified === true,
    ingredient_list_completeness: mp.inci_complete === false ? "partial" : (mp.inci_verified === true ? "complete" : "unknown"),
    directions_text: typeof mp.directions_text === "string" ? mp.directions_text : null,
    directions_source: ["packaging", "manufacturer", "retailer", "user_entered"].includes(mp.directions_source) ? mp.directions_source : null,
    directions_source_url: typeof mp.directions_source_url === "string" ? mp.directions_source_url : null,
    directions_checked_at: typeof mp.directions_checked_at === "string" ? mp.directions_checked_at : null,
    product_variant: typeof mp.product_variant === "string" ? mp.product_variant : null,
    market: typeof mp.market === "string" ? mp.market : null,
    identity_source: ["packaging", "manufacturer", "retailer", "user_entered"].includes(mp.identity_source) ? mp.identity_source : null,
    identity_source_url: typeof mp.identity_source_url === "string" ? mp.identity_source_url : null,
    identity_checked_at: typeof mp.identity_checked_at === "string" ? mp.identity_checked_at : null,
    known_ph: knownPh,
    notes: [mp.note].filter(Boolean).join(" ") || null,
    mapping_notes: notes,
    clay_record: { ...mp }   // untouched copy, so nothing Clay stores is lost
  };
}

export const toEngineProducts = (mps) => (mps || []).map(toEngineProduct);
