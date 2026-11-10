// Clay Ingredient Intelligence Engine v0.1
// Deterministic, explainable prototype. No network calls, diagnosis, or automatic routine edits.
export function createEngine({ ingredients, rules, sources }) {
  const byId = new Map((ingredients.ingredients || []).map(x => [x.id, x]));
  const aliasMap = new Map();
  for (const item of byId.values()) {
    for (const alias of [item.inci, ...(item.aliases || [])]) {
      aliasMap.set(norm(alias), item.id);
    }
  }

  function norm(value) {
    return String(value || "").trim().toLowerCase().replace(/[()]/g, "").replace(/\s+/g, " ");
  }

  // Label clean-up for real packaging text. Raw label is always preserved.
  // A percentage printed in the label is reported as stated_pct (informational only, never used for rules).
  function cleanLabel(label) {
    let t = String(label || "").trim();
    let stated = null;
    const m = t.match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (m) stated = parseFloat(m[1].replace(",", "."));
    t = t.replace(/\(?\s*\d+(?:[.,]\d+)?\s*%\s*\)?/g, " ")   // 7%, (7%)
         .replace(/[*\u2020\u2021\u00b9\u00b2]+/g, " ")             // asterisks, daggers
         .replace(/\s+/g, " ").trim();
    return { text: t, stated };
  }

  function normalizeIngredient(label) {
    const { text, stated } = cleanLabel(label);
    let id = aliasMap.get(norm(text));
    if (!id) {
      // "Aqua (Water)" style: try each side of a parenthetical, and the label without it
      const paren = text.match(/^(.*?)\(([^)]*)\)\s*$/);
      if (paren) id = aliasMap.get(norm(paren[1])) || aliasMap.get(norm(paren[2]));
    }
    return {
      raw_label: label,
      canonical_id: id || null,
      matched: Boolean(id),
      stated_pct: stated,
      ingredient: id ? byId.get(id) : null
    };
  }

  // What the engine could and could not recognise in one product. Unknown labels are listed, never dropped.
  function coverageFor(product) {
    const list = product?.ingredient_list || [];
    const unmatched = [];
    let recognised = 0;
    for (const entry of list) {
      const id = entry.canonical_id || normalizeIngredient(entry.inci).canonical_id;
      if (id && byId.get(id)) recognised++; else unmatched.push(entry.inci);
    }
    return { total: list.length, recognised, unmatched };
  }

  function familiesFor(product) {
    const out = new Set();
    for (const entry of (product.ingredient_list || [])) {
      const id = entry.canonical_id || normalizeIngredient(entry.inci).canonical_id;
      const item = id ? byId.get(id) : null;
      if (item) item.families.forEach(f => out.add(f));
    }
    return out;
  }

  function sourceRecords(ids) {
    const map = new Map((sources.sources || []).map(s => [s.id, s]));
    return (ids || []).map(id => map.get(id)).filter(Boolean);
  }

  function isUsableProduct(p) {
    return p && p.status === "in_use" && Array.isArray(p.ingredient_list) && p.ingredient_list.length > 0;
  }

  function matchRule(rule, famA, famB) {
    const [a, b] = rule.match.families;
    return (famA.has(a) && famB.has(b)) || (famA.has(b) && famB.has(a));
  }

  function evaluateProductPair(productA, productB, context = {}) {
    const base = {
      products: [productA?.product_id || null, productB?.product_id || null],
      classification: "insufficient_evidence",
      confidence: "unknown",
      matched_rules: [],
      rationale: "No curated rule was found for this pair. This does not establish that the combination is safe or unsafe.",
      recommendation: "Check both product directions. Clay does not have enough evidence to make a pairing recommendation.",
      evidence: [],
      limitations: [],
      missing_data: []
    };
    if (!isUsableProduct(productA) || !isUsableProduct(productB)) {
      const why = [];
      for (const [label, q] of [["first", productA], ["second", productB]]) {
        if (!q) why.push(`${label} product missing`);
        else if (q.status !== "in_use") why.push(`${label} product is not marked in use`);
        else if (!Array.isArray(q.ingredient_list) || !q.ingredient_list.length) why.push(`${label} product has no ingredient list`);
      }
      return {...base, classification:"insufficient_data", rationale:"Clay cannot compare these products yet: " + why.join("; ") + ". This is not a safety finding.", missing_data:["in-use status","ingredient list"], coverage: [coverageFor(productA), coverageFor(productB)]};
    }
    if (!productA.ingredient_list_verified || !productB.ingredient_list_verified) {
      base.missing_data.push("verified ingredient list");
    }
    const cov = [coverageFor(productA), coverageFor(productB)];
    base.coverage = cov;
    cov.forEach((c, i) => {
      if (c.unmatched.length) {
        base.limitations.push(`${i ? "Second" : "First"} product: ${c.recognised} of ${c.total} ingredients recognised; not assessed: ${c.unmatched.join(", ")}.`);
      }
    });
    for (const [i, q] of [productA, productB].entries()) {
      if (!q.directions_text) base.missing_data.push(`${i ? "second" : "first"} product directions`);
      else base.limitations.push(`${i ? "Second" : "First"} product has directions on file. Clay does not interpret them; they take priority over this screening.`);
    }
    const fa = familiesFor(productA), fb = familiesFor(productB);
    const found = (rules.rules || []).filter(r => matchRule(r, fa, fb));
    if (!found.length) {
      const unverified = base.missing_data.includes("verified ingredient list");
      return {...base, classification: unverified ? "insufficient_data" : "insufficient_evidence",
        rationale: unverified ? "At least one ingredient list is unverified. The comparison is incomplete." : base.rationale};
    }
    // Conservative resolution: most cautionary applicable rule wins; no automatic "compatible".
    const rank = {avoid_combination:6,separate:5,use_with_care:4,insufficient_data:3,insufficient_evidence:2,complementary:1,compatible:0};
    found.sort((x,y)=>(rank[y.classification]||0)-(rank[x.classification]||0));
    const chosen = found[0];
    const evidenceIds = [...new Set(found.flatMap(r => r.evidence || []))];
    return {
      ...base,
      classification: chosen.classification,
      confidence: chosen.confidence,
      matched_rules: found.map(r => r.id),
      rationale: found.map(r => r.reason).join(" "),
      recommendation: found.map(r => r.recommendation).join(" "),
      evidence: sourceRecords(evidenceIds),
      limitations: [...new Set([...base.limitations, ...found.flatMap(r => r.limitations || [])])],
      missing_data: [...new Set([...base.missing_data, ...found.flatMap(r => r.required_context || [])])],
      scope: chosen.scope
    };
  }

  function evaluateRoutine(products, schedule = {}, context = {}) {
    const active = (products || []).filter(isUsableProduct);
    const results = [];
    for (let i=0;i<active.length;i++) {
      for (let j=i+1;j<active.length;j++) {
        const a=active[i], b=active[j];
        const result=evaluateProductPair(a,b,context);
        if (result.matched_rules.length) {
          const slotA=schedule[a.product_id] || "unscheduled";
          const slotB=schedule[b.product_id] || "unscheduled";
          results.push({...result, schedule_relation:slotA===slotB?"same_slot":(slotA==="unscheduled"||slotB==="unscheduled"?"unknown":"different_slots")});
        }
      }
    }
    const unknownProducts = active.filter(p => !p.ingredient_list_verified).map(p => p.product_id);
    return {
      products_evaluated: active.length,
      pair_findings: results,
      unverified_products: unknownProducts,
      notice: "Routine findings are screening prompts, not a diagnosis or a guarantee of safety. Product directions and formulation details take priority."
    };
  }

  return { normalizeIngredient, evaluateProductPair, evaluateRoutine };
}
