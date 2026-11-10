# Claude integration handoff — Clay Ingredient Intelligence Engine v0.1

**This is a handoff for review and integration planning, not permission to modify the app.** Nitah asked ChatGPT to build the engine and hand it to Claude to plug in. Before touching `apps/clay.html`, Claude should inspect the package and report any mismatch with the current Clay product data model.

## Deliverables
- `SPEC.md`: engine purpose, safety boundaries, evidence model, rules, data model, API and acceptance criteria.
- `src/engine.js`: deterministic reference implementation.
- `data/ingredients.json`: starter canonical ingredient registry.
- `data/pairing-rules.json`: starter evidence-linked pairing rules.
- `data/sources.json`: source registry.
- `data/product.schema.json`: proposed product record contract.
- `tests/smoke.test.mjs`: basic test suite.

## Integration sequence
1. Inspect current My Shelf product storage and ingredient parsing. Do not migrate or rename existing fields.
2. Map current product records to the proposed product contract in an adapter. Preserve raw INCI labels, source and verification state.
3. Report missing fields and ambiguous category/role mappings. Do not silently infer product role from a broad category.
4. Keep the engine independent of UI and `pageToday()`. Load the JSON rule data as versioned assets.
5. First integrate as read-only analysis in My Shelf or Pairs & Scent. Do not auto-edit routines, pause products, or suggest purchases.
6. Keep evidence and limitations visible in the result model.
7. Add tests against real Clay-shaped product fixtures, partial/unverified lists, unknown ingredients, directions, duplicates and same/different routine slots.
8. Return a proposed integration diff and test plan for Nitah's approval before implementation.

## Important safety requirements
- Never classify an unknown pair as compatible.
- Do not infer concentration or pH from INCI order.
- Do not treat all family-level cautions as chemical incompatibilities.
- Product directions and regulatory warnings take precedence.
- `avoid_combination` requires exact, high-quality evidence and context; no blanket bans.
- Do not present user tolerance notes as clinical proof.
- No diagnosis, prescribing, or automatic changes to a user's routine.

## Prototype verification
The smoke tests passed locally on Node v22.16.0. This does not constitute integration testing or clinical validation.
