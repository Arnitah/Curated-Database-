import { createEngine } from "../src/engine.js";
import { toEngineProduct, parseInci } from "../src/clay-adapter.js";
import ingredients from "../data/ingredients.json" with { type: "json" };
import rules from "../data/pairing-rules.json" with { type: "json" };
import sources from "../data/sources.json" with { type: "json" };
import assert from "node:assert/strict";
const E = createEngine({ ingredients, rules, sources });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

// Fixtures are invented, Clay-shaped records (id/a/st/n/s/inci). No personal shelf data.
const R = (id, st, n, inci, s = "cur", a = "face") => ({ id, a, st, n, s, ...(inci ? { inci } : {}) });
const mp = {
  aha:   R(1, "Toner", "Glow toner", "Aqua (Water), Glycolic Acid (7%), Glycerin, Parfum"),
  ret:   R(2, "Serum", "Night retinol", "Aqua, Retinol 0.3%, Squalane"),
  ret2:  R(3, "Treatment", "Retinal drops", "Retinal, Squalane"),
  aha2:  R(4, "Serum", "Lactic serum", "Lactic Acid*, Sodium Hyaluronate"),
  bha:   R(5, "Treatment", "BHA liquid", "Salicylic Acid, Niacinamide"),
  none:  R(6, "Moisturizer", "Plain cream"),                      // no inci at all
  hum:   R(7, "Serum", "Hydration", "Sodium Hyaluronate, Panthenol"),
  cer:   R(8, "Moisturizer", "Barrier cream", "Ceramide NP, Glycerin"),
  spf:   R(9, "Sunscreen", "Daily SPF", "Zinc Oxide, Avobenzone, Aqua"),
  junk:  R(10, "Serum", "Mystery serum", "Aqua, Xanthan Gum, Rosa Canina Extract, Foo Bar Complex, Glycolic Acid"),
  old:   R(11, "Serum", "Finished retinol", "Retinol", "past"),
  body:  R(12, "Other", "Body wash", "Aqua", "cur", "body"),
  under: R(13, "Other", "Deodorant", "Aqua", "cur", "under"),
};
const P = Object.fromEntries(Object.entries(mp).map(([k, v]) => [k, toEngineProduct(v)]));
const verified = (p) => ({ ...p, ingredient_list_verified: true });

// adapter: preserves, never invents
eq(P.aha.product_id, "1"); eq(P.aha.name, "Glow toner"); eq(P.aha.clay_record.st, "Toner");
eq(P.aha.status, "in_use"); eq(P.old.status, "finished"); eq(P.aha.directions_text, null); eq(P.aha.brand, null);
eq(P.aha.ingredient_list_verified, false); eq(P.none.ingredient_list_source, "unknown");
eq(P.under.area, "unknown"); ok(P.under.mapping_notes.some(x => /no engine/.test(x)));
eq(P.bha.category, "treatment"); ok(!("role" in P.bha), "no role invented");
eq(parseInci("Ingredients: Aqua (Water, Eau), Glycerin; Retinol\nSqualane.").join("|"), "Aqua (Water, Eau)|Glycerin|Retinol|Squalane");
eq(parseInci("").length, 0); eq(parseInci(undefined).length, 0);

// normaliser on real label shapes
for (const [l, id] of [["Glycolic Acid (7%)", "glycolic_acid"], ["Retinol 0.3%", "retinol"], ["Lactic Acid*", "lactic_acid"], ["Sodium Hyaluronate", "hyaluronic_acid"], ["Avobenzone", "avobenzone"]]) eq(E.normalizeIngredient(l).canonical_id, id, l);
eq(E.normalizeIngredient("Glycolic Acid (7%)").stated_pct, 7); eq(E.normalizeIngredient("Foo Bar Complex").matched, false);

// unverified lists stay unverified
let r = E.evaluateProductPair(P.aha, P.ret);
eq(r.classification, "use_with_care"); ok(r.missing_data.includes("verified ingredient list"), "caution kept, unverified flagged");
eq(E.evaluateProductPair(P.bha, P.hum).classification, "insufficient_data", "no rule + unverified");
// verified -> screening result, with evidence and limitations kept
r = E.evaluateProductPair(verified(P.aha), verified(P.ret));
eq(r.classification, "use_with_care"); eq(r.confidence, "limited"); ok(r.evidence.length >= 1); ok(r.limitations.length >= 1);
ok(r.missing_data.includes("first product directions"), "directions absence reported");
// unknown pair never compatible
r = E.evaluateProductPair(verified(P.bha), verified(P.hum));
ok(!["compatible", "complementary"].includes(r.classification));
// duplicate actives
eq(E.evaluateProductPair(verified(P.ret), verified(P.ret2)).classification, "use_with_care");
ok(E.evaluateProductPair(verified(P.ret), verified(P.ret2)).matched_rules.includes("duplicate_retinoid_family"));
eq(E.evaluateProductPair(verified(P.aha), verified(P.aha2)).matched_rules.includes("duplicate_aha_family"), true);
// complementary, and sun-protection rule now reachable
eq(E.evaluateProductPair(verified(P.hum), verified(P.cer)).classification, "complementary");
ok(E.evaluateProductPair(verified(P.aha), verified(P.spf)).matched_rules.includes("aha_sun_sensitivity_context"));
// no list / not in use / finished
r = E.evaluateProductPair(verified(P.none), verified(P.aha)); eq(r.classification, "insufficient_data"); ok(/no ingredient list/.test(r.rationale));
r = E.evaluateProductPair(verified(P.old), verified(P.aha)); eq(r.classification, "insufficient_data"); ok(/not marked in use/.test(r.rationale));
// partial recognition is reported, not hidden
r = E.evaluateProductPair(verified(P.junk), verified(P.ret));
const c = r.coverage[0]; eq(c.total, 5); eq(c.recognised, 1); ok(c.unmatched.includes("Foo Bar Complex") && c.unmatched.includes("Rosa Canina Extract"));
ok(r.limitations.some(x => /1 of 5 ingredients recognised/.test(x)));
// empty verified list is insufficient_data, not insufficient_evidence
eq(E.evaluateProductPair({ ...verified(P.none), status: "in_use" }, verified(P.aha)).classification, "insufficient_data");
// multi-product routine: pairs only where rules exist, nothing mutated, no actions emitted
const shelf = Object.values(P).map(verified); const before = JSON.stringify(shelf);
const rt = E.evaluateRoutine(shelf, { 1: "pm", 2: "pm", 3: "am" });
eq(JSON.stringify(shelf), before, "input untouched");
ok(rt.pair_findings.length >= 4); ok(rt.pair_findings.every(f => f.matched_rules.length && f.evidence.length));
ok(rt.pair_findings.some(f => f.schedule_relation === "same_slot") && rt.pair_findings.some(f => f.schedule_relation === "different_slots"));
ok(!JSON.stringify(rt).match(/\b(buy|purchase|pause|stop using|remove)\b/i), "no purchase/pause/remove language");
eq(E.evaluateRoutine(Object.values(P), {}).unverified_products.length > 0, true);
console.log(`Clay-shaped tests passed (${n} checks).`);
