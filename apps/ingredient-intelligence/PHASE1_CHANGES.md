# Phase 1 changes (Claude, 2026-11-10)
Engine v0.1 from ChatGPT, adjusted for Clay-shaped data. Clay itself (apps/clay.html) is untouched.

- Label clean-up: strips `*`, `7%`, `(7%)`; handles "Aqua (Water)". Raw label kept; a printed % is returned as `stated_pct`, informational only.
- `coverage` on every pair result: recognised vs not-assessed ingredients, also added to `limitations`.
- Empty ingredient list is now `insufficient_data` (reason names which product).
- Directions: absence listed in `missing_data`; presence noted as taking priority. Never interpreted.
- `insufficient_data` added to the rules classification list.
- Added zinc oxide, titanium dioxide, avobenzone (uv_filter) so the existing sun-protection rule can run. Marked `added_by_claude_pending_review`. No rules added or changed.
- `src/clay-adapter.js`: read-only mapping of Clay shelf records; nothing invented; original record kept in `clay_record`; gaps in `mapping_notes`.
- `tests/clay-shaped.test.mjs`: 52 checks on invented Clay-shaped records.

Not done: explainResult(), weekly counting, directions parsing, Safe Batch crosswalk, any UI.
