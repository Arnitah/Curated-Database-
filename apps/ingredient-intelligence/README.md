# Clay Ingredient Intelligence Engine v0.1

Contents:
- `SPEC.md` — product, safety, evidence, architecture and integration specification.
- `src/engine.js` — deterministic JavaScript reference engine.
- `data/ingredients.json` — small canonical ingredient seed set.
- `data/pairing-rules.json` — source-linked starter rules.
- `data/sources.json` — evidence/source registry.
- `data/product.schema.json` — proposed Clay product record contract.
- `tests/smoke.test.mjs` — basic deterministic tests.

Run tests with Node 20+:
`node --experimental-json-modules tests/smoke.test.mjs`

This is a research prototype. It is not yet integrated into Clay and is not production medical software. Review the specification's limitations before using it in a user-facing feature.
