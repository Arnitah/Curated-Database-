import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot } from "../../scripts/build-scent-atlas.mjs";

const source = [
  'const GH = "https://example.test/";',
  'const BASES = ["./", "../", GH];',
  "async function load(f, fallback) {",
  '  for (const b of BASES) { try { const r = await fetch(b + f, { cache: "no-cache" }); if (r.ok) return await r.json(); } catch (e) {} }',
  "  return fallback;",
  "}",
  'const houses = await load("data/scents/houses.json", []);',
  "const links = await load('checks/scent-links.json', {});"
].join("\n");

test("standalone snapshot embeds every statically referenced JSON dataset", () => {
  const html = buildSnapshot(source, (file) => JSON.stringify({ file }));
  const match = html.match(/const BUNDLE = (\{.*\});/);
  assert.ok(match, "generated bundle declaration exists");
  const bundle = JSON.parse(match[1]);
  assert.deepEqual(Object.keys(bundle), ["checks/scent-links.json", "data/scents/houses.json"]);
  assert.equal(bundle["checks/scent-links.json"].file, "checks/scent-links.json");
  assert.match(html, /Object\.prototype\.hasOwnProperty\.call\(BUNDLE, f\)/);
});

test("standalone snapshot generation is deterministic", () => {
  const read = (file) => JSON.stringify({ file });
  assert.equal(buildSnapshot(source, read), buildSnapshot(source, read));
});

test("snapshot builder rejects malformed JSON", () => {
  assert.throws(() => buildSnapshot(source, () => "{"), /Could not read valid JSON/);
});
