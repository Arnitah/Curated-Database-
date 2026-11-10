# Clay Ingredient Intelligence Engine — v0.1

**Status:** Research-backed prototype and integration specification; not production medical software.  
**Owner:** ChatGPT — research, rules, prototype and test pack.  
**Integrator:** Claude — app integration after Nitah's approval.  
**Date:** 2026-11-10.

## 1. Purpose

A reusable, deterministic intelligence layer that interprets verified product ingredient data, evaluates ingredient/product relationships, and produces cautious, explainable routine guidance. It is shared infrastructure; My Shelf is its first consumer, with Today, Routine, Pairs & Scent and Learn as later consumers.

## 2. Non-goals and safety boundaries

- Not a diagnostic, treatment, prescribing, or emergency-triage system.
- Never infer concentration, pH, stability, penetration, efficacy, or finished-product safety from an INCI list alone.
- Never treat ingredient order as a precise concentration estimate. In Canada, ingredients above 1% are generally listed in descending order; ingredients at or below 1% may appear in any order. Source: Health Canada labelling guide.
- Never convert absence of a known rule into “safe”. Return `insufficient_evidence` or `insufficient_data`.
- Never use `avoid_combination` unless a high-quality source or explicit product/regulatory instruction supports a clear prohibition for the exact context. The starter rule set intentionally contains no blanket avoid rule.
- Product directions and applicable regulatory warnings take precedence over generic pairing advice.
- User-reported tolerance is personal context, not proof of causation or a universal ingredient effect.
- Ask for no sensitive health information in this first release. Do not infer pregnancy, disease, medication use or diagnosis.
- Escalate severe, persistent or worsening reactions to qualified care; do not troubleshoot them with ingredient stacking suggestions.

## 3. Output classifications

| Code | User-facing label | Meaning |
|---|---|---|
| `compatible` | Generally compatible | Evidence supports ordinary co-use in the stated context |
| `complementary` | Complementary roles | Ingredients may serve different, complementary functions |
| `use_with_care` | Use with care | Cumulative irritation, redundancy or context requires caution |
| `separate` | Consider separating | A source/product direction supports different timing |
| `avoid_combination` | Do not combine | Exact, well-supported contraindication or product instruction |
| `insufficient_evidence` | Not enough evidence | No reliable rule for this pair/context |
| `insufficient_data` | Need product details | Missing or unverified product/formulation data prevents assessment |

Do not collapse `insufficient_evidence` and `insufficient_data`: one is a knowledge gap; the other is missing product facts.

## 4. Decision pipeline

1. **Resolve identity:** map exact INCI strings and synonyms to canonical ingredient IDs. Preserve the original label string and source.
2. **Verify product record:** product name, category, use status, body area, leave-on/rinse-off, ingredient-list source/verification, directions, known concentration/pH if explicitly supplied.
3. **Derive families and functions:** from a curated ingredient master. Family membership is versioned and reviewable.
4. **Evaluate direct rules:** match exact ingredient IDs or declared families; apply rule scope and required context.
5. **Evaluate product and routine load:** look for repeated active families across products and scheduled sessions, not only pairwise edges.
6. **Apply user context:** optional tolerance notes and declared preferences may increase caution; never downgrade an evidence-backed safety warning.
7. **Resolve conflicts:** product directions/regulatory warnings > high-quality specific evidence > general professional guidance > low-confidence hypothesis. If unresolved, return `insufficient_evidence`.
8. **Explain:** show what matched, why, evidence grade, missing details, what the user can do and what the engine cannot conclude.

## 5. Evidence grading

- **High:** regulatory authority or robust convergent evidence directly supports the exact claim and context.
- **Moderate:** professional guidance or peer-reviewed synthesis supports a cautious general recommendation, but product-specific context is missing.
- **Limited:** small, indirect, formulation-specific or conflicting evidence.
- **Unknown:** no reliable evidence located.

Evidence grade is not a numerical probability. Do not display “98% safe” or fabricated confidence percentages.

Each rule must include: source IDs, source type, publication/access date, exact claim supported, context, limitations, reviewer and review date. Brand marketing is not independent evidence.

## 6. Starter rules included

The JSON starter rules include:
- AHA + retinoid: limited-evidence, conservative cumulative-irritation caution; not a universal chemical incompatibility.
- AHA + BHA: limited-evidence caution to assess cumulative exfoliation and frequency.
- Duplicate AHA or retinoid families: assess redundant/cumulative use.
- AHA + UV protection context: surface sun-protection advice, not a neutralisation claim.
- Humectant + barrier lipid: potentially complementary functional roles, with limited evidence for any specific finished-product outcome.

The starter set is intentionally small. It does not encode simplistic internet myths such as “niacinamide and vitamin C must never be combined”. Unknown pairs remain unknown.

## 7. Data model

Files:
- `data/ingredients.json`: canonical ingredient identity, aliases, families, functions and caveats.
- `data/pairing-rules.json`: versioned, source-linked rules.
- `data/sources.json`: source registry.
- `data/product.schema.json`: proposed product record contract.

Product record minimums:
- `product_id`, `name`, `category`, `status`
- exact INCI ingredient strings and original order
- ingredient-list source and verification status
- leave-on/rinse-off format
- directions and frequency when known
- concentration and pH only when explicitly sourced

Keep raw product label and normalized ingredient IDs separately. A product with an unverified or partial ingredient list must not receive a high-confidence full-product assessment.

## 8. Engine API

`createEngine({ ingredients, rules, sources })`

- `normalizeIngredient(label)` → canonical match, original label, match status.
- `evaluateProductPair(productA, productB, context)` → matching rule(s), classification, rationale, recommendation, evidence, limitations, missing data.
- `evaluateRoutine(products, schedule, context)` → routine-level overlaps, repeated active families, timing conflicts, missing information and explanations.
- `explainResult(result)` → plain-language rendering data; UI owns visual design.

The included JavaScript prototype implements deterministic normalization, pair evaluation and a first routine-level cumulative-use check. It is a reference implementation, not yet integrated with Clay's state/database.

## 9. Routine-level logic

- Count active families by routine/session and across the week.
- Distinguish same-session co-use from use on different days.
- Do not infer a product is a “spot treatment” from a generic category. Product role requires explicit metadata or a verified product-specific mapping.
- Do not infer product compatibility from layer order alone.
- When product directions are missing, surface that limitation.
- A sunscreen pairing rule is contextual support guidance; sunscreen does not cancel irritation or make excessive exfoliation safe.
- No automatic product purchase suggestions. Prefer “you already have…” and “not enough information” over gap-filling.

## 10. UX contract

Every user-facing result should answer:
1. What did Clay compare?
2. What did it find?
3. Why does it matter?
4. What is the cautious next step?
5. What evidence supports it?
6. What information is missing?

Use supportive, non-alarmist language. Never label a person’s skin as damaged or diagnose a condition. Let the user dismiss, inspect sources and correct product data.

## 11. Integration plan for Claude

1. Read this package before implementation.
2. Map current Clay My Shelf product records to `product.schema.json`; report mismatches before changing storage.
3. Keep the engine as a standalone module (suggested `apps/ingredient-intelligence/engine.js` plus versioned JSON data); do not embed all rules in `pageToday()`.
4. Add an adapter from Clay's existing product records to the engine contract. Preserve current app database and existing fields; do not migrate schema without approval.
5. Integrate first as a read-only “why this pairing?” analysis in My Shelf/Pairs & Scent. Do not auto-edit routines or product status.
6. Add tests for missing/partial ingredient lists, unknown aliases, duplicate families, directions overrides, and routine scheduling.
7. Present proposed UI and storage changes for approval before implementation.
8. No supplier outreach, purchases or scraping of brand claims as evidence.

## 12. Acceptance criteria

- Unknown pair never silently becomes compatible.
- No hard avoid result without exact supporting evidence/context.
- Ingredient identity preserves raw label and canonical match separately.
- Pair rules return evidence references and limitations.
- Product directions can override generic guidance.
- Routine analysis detects repeated active families across products/sessions.
- Missing concentration/pH is reported as unknown, never guessed.
- Tests pass in browser/Node-compatible JavaScript.
- App remains unchanged until Nitah approves integration.

## 13. Known limitations of v0.1

- Small seed ingredient set; not a complete ingredient dictionary.
- Family-level rules are coarse and require expert review before production.
- No concentration-aware calculations.
- No formulation chemistry simulator.
- No validated clinical risk model.
- No database sync or Clay UI integration.
- No haircare/bodycare rules yet.
