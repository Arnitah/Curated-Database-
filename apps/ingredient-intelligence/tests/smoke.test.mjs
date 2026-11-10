import { createEngine } from "../src/engine.js";
import ingredients from "../data/ingredients.json" with { type: "json" };
import rules from "../data/pairing-rules.json" with { type: "json" };
import sources from "../data/sources.json" with { type: "json" };
import assert from "node:assert/strict";

const engine = createEngine({ingredients,rules,sources});
const p=(id,name,inci,status="in_use",verified=true)=>({product_id:id,name,category:"serum",status,ingredient_list:inci.map(x=>({inci:x})),ingredient_list_source:"package_photo",ingredient_list_verified:verified});
assert.equal(engine.normalizeIngredient("Glycolic Acid").canonical_id,"glycolic_acid");
assert.equal(engine.normalizeIngredient("unknown botanical").matched,false);

const aha=p("a","AHA toner",["Glycolic Acid"]);
const ret=p("r","Retinol serum",["Retinol"]);
const ahaRet=engine.evaluateProductPair(aha,ret);
assert.equal(ahaRet.classification,"use_with_care");
assert.ok(ahaRet.evidence.length>0);

const niac=p("n","Niacinamide serum",["Niacinamide"]);
const vitc=p("c","Vitamin C serum",["Ascorbic Acid"]);
const unknown=engine.evaluateProductPair(niac,vitc);
assert.equal(unknown.classification,"insufficient_evidence");

const hum=p("h","Hydration serum",["Hyaluronic Acid"]);
const cer=p("d","Barrier cream",["Ceramide NP"]);
assert.equal(engine.evaluateProductPair(hum,cer).classification,"complementary");

const partial=p("u","Partial list",["Glycolic Acid"],"in_use",false);
assert.equal(engine.evaluateProductPair(partial,ret).classification,"use_with_care");
assert.ok(engine.evaluateProductPair(partial,ret).missing_data.includes("verified ingredient list"));

const routine=engine.evaluateRoutine([aha,ret],{a:"pm",r:"pm"});
assert.equal(routine.pair_findings.length,1);
assert.equal(routine.pair_findings[0].schedule_relation,"same_slot");

console.log("Clay Ingredient Intelligence Engine v0.1 tests passed.");
