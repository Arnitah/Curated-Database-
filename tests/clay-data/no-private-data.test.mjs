// Test 12 of the PR A specification (Revision 4.2): nothing real can enter the data-contract library, its fixtures or its tests.
// There is no private deny-list. Fixtures must declare themselves synthetic, every free-text string must be visibly synthetic
// or a declared structural token, and no UUID-shaped text, email, user path or unexplained long token may appear.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { scanText, SYNTH_PREFIX } from '../clay/helpers/leak-scan.mjs';
import { loadShippedSchemas } from '../../apps/clay-data/src/validate.js';
import { migrationId, PARTS, V1_DOCS } from '../../apps/clay-data/src/ids.js';
import { contentHash } from '../../apps/clay-data/src/canonical.js';

const ROOTS = [new URL('../../apps/clay-data/', import.meta.url), new URL('./', import.meta.url)];
const SELF = new URL(import.meta.url).pathname;
const TEXT_EXT = /\.(mjs|js|json|md|txt)$/;
function walk(url, out = []) {
  for (const name of readdirSync(url)) {
    const u = new URL(name + (statSync(new URL(name, url)).isDirectory() ? '/' : ''), url);
    if (u.pathname.endsWith('/')) walk(u, out); else if (TEXT_EXT.test(name)) out.push(u);
  }
  return out;
}
const files = ROOTS.flatMap((r) => walk(r)).filter((u) => u.pathname !== SELF);

// Public, pinned digests that may appear as long tokens. Each is documented in the README (section "Hash definitions").
const PUBLIC_DIGESTS = new Set([
  '39172e88d33502decbd71f4c1da95ab90b69168189a21c1798855fa730b87e2d', '78bd1641f1e8e3d5b9f1d764e1ee61223acb5ae5a8f33d0fccebe1a71e2aab75',
  'af13a49a856b3da6a5e84e640d87091b6936e44bf9c45507dbbe5cbc7009d00b', 'a303eb900b4477807380849b26a11c62d194a496e72573ffa2f718498a86ceb6',
  '27c8a27655ba6b04dabd1cc16c9b8ebcbcfe705d6445804a108d79c039eccba5', '9167df06615cfeccb39e5a3f73d46f8ef245fb9386d71136c257fe5be01fa430',
  '04d1249d2220ed71e67512daef98cdc3ba001556373667114297e7b957c04003', 'b6bc5f0f430c1b7878004d5ebfc89b736d8255f973bb4382270d9dec52354a5b',
  '4510db92f209cf5e8f83bdf670180348bce4d3e8a260ecf88ea0b5a7001c1dc9', 'c646d8932aca270c494f99b9d3a1396e1c344de1d36e7ad442e062f211048833',
  'cdd49e55eae3bbf1f0a3f6580c974a0263cb86a6a08daa10fbf705b4808a56f7', '806e9aed65037197f1ec85e12be6e8cd870fc5608b4de0fffd990f689f376a73',
  'fb9ac8cc154a80cad6caac9897af55a4e75176af6f4e2bb6edc2bf8b1d57f326', '53672c0d0b5185e3cf04c8e970d544c3af81ae7c8eeba0b9cf6d355aa954ae1f',
  'cf93d61908160840496c44f4ad1ea63f7e234ec0a86416560ccf67b12d5f4114', 'e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96',
  '00b035cec4e23b1bc90f76c052fe0e3f9001a29bd58d00add1e56f4208c6402c', 'a3347d90013cc81745a8f21cc0b02184b43fdecc1d1d9d8b32e7f39e3ea9fbf4',
  '53a37b27733e462cba178aeb9fb7dd39865872c7c2378748b26842e65b0f0bbb', '6c1b8f9c96e91ef94ae5e46cd90b182abbe302e4e96f9ce07bfe8cce1870c8d4',
  '3ed428ed94f18995285f44ed8bcb90fc62602ab035b5f4f891b9341a57a8f416', 'b6883fb1a17f33a9506570ff21cbe8d1a79ace87eb9a5c5966a34ce7c9a427ea'
]);
// m_ ids that may appear are exactly those recomputable from declared inputs in the fixtures.
function recomputedMigrationIds() {
  const ids = new Set();
  const cv = JSON.parse(readFileSync(new URL('./fixtures/canonical-vectors.json', import.meta.url), 'utf8'));
  for (const v of cv.migrationIds) ids.add(migrationId(v.inputs));
  const va = JSON.parse(readFileSync(new URL('./fixtures/valid.json', import.meta.url), 'utf8'));
  for (const c of va.cases) if (c.idInputs) ids.add(migrationId(c.idInputs));
  const inv = JSON.parse(readFileSync(new URL('./fixtures/invalid.json', import.meta.url), 'utf8'));
  for (const c of inv.cases) if (c.idInputs) ids.add(migrationId(c.idInputs));
  return ids;
}
const MIG = recomputedMigrationIds();
// The six canonical-JSON vector hashes are recomputed here from their synthetic inputs, not trusted from the file.
function build(d) {
  if (Array.isArray(d)) return d.map(build);
  if (d && typeof d === 'object') {
    if ('$cps' in d) return String.fromCodePoint(...d.$cps);
    if ('$cps16' in d) return String.fromCharCode(...d.$cps16);
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, build(v)]));
  }
  return d;
}
const VECTOR_HASHES = new Set(JSON.parse(readFileSync(new URL('./fixtures/canonical-vectors.json', import.meta.url), 'utf8')).canonical.map((v) => contentHash(build(v.value)).slice('sha256:'.length)));
for (const v of JSON.parse(readFileSync(new URL('./fixtures/canonical-vectors.json', import.meta.url), 'utf8')).canonical) assert.equal(contentHash(build(v.value)), v.hash);
// The three comparison-key reason codes contain digits, so they are declared rather than pattern-matched.
const REASON_CODES = new Set(['code_point_not_assigned_in_unicode_15_0', 'lone_surrogate', 'runtime_unicode_older_than_15_0']);
// Public structural tokens: fixture case names (labels for hand-written synthetic cases) and one public documentation file name.
// They hold no private values. Any other long token is a finding, however it is spelled.
const STRUCTURAL_LONG_TOKENS = new Set([
  'java-se-licensing-information-user-manual',
  'recorded_example_owned_item_12',
  'state_conflicting_one_candidate', 'product_wrong_schema_version', 'observation_unknown_source_kind', 'correction_migration_id_rejected', 'manifest_schema_version_zero',
  'product_identity_user_all_states', 'owned_item_finished_with_extras', 'observation_migrated_legacy_unspecified', 'correction_with_new_observation'
]);
const tokenFindings = (text, declared = STRUCTURAL_LONG_TOKENS) => {
  const out = [];
  for (const m of text.matchAll(/\b[A-Za-z0-9_-]{28,}\b/g)) {
    const t = m[0];
    if (PUBLIC_DIGESTS.has(t) || MIG.has(t) || VECTOR_HASHES.has(t) || REASON_CODES.has(t) || declared.has(t)) continue;
    out.push(t.slice(0, 6) + '...');
  }
  return out;
};

test('12a the scan covers the library, its fixtures and its tests', () => {
  const rel = files.map((u) => u.pathname.split('/clay-data/').pop());
  assert.ok(files.length >= 20, 'scanned ' + files.length);
  for (const must of ['README.md', 'src/states.js', 'src/canonical.js', 'src/ids.js', 'src/validate.js', 'data/unicode-15.0.0.json', 'fixtures/valid.json', 'fixtures/invalid.json', 'canonical.test.mjs']) assert.ok(rel.some((r) => r.endsWith(must)), must);
});

test('12b no file holds a user path, UUID-shaped text or email address (tokens checked separately)', () => {
  for (const u of files) {
    const f = scanText(readFileSync(u, 'utf8'), { tokens: false });
    assert.deepEqual(f, [], u.pathname);
  }
});

test('12c every long token is a pinned public digest, a recomputed migration id, or a plain identifier', () => {
  for (const u of files) assert.deepEqual(tokenFindings(readFileSync(u, 'utf8')), [], u.pathname);
  assert.ok(MIG.size >= 7);
});

test('12d the digest list matches reality: every pinned digest used in the README is declared above', () => {
  const readme = readFileSync(new URL('../../apps/clay-data/README.md', import.meta.url), 'utf8');
  for (const m of readme.matchAll(/\b[0-9a-f]{64}\b/g)) assert.equal(PUBLIC_DIGESTS.has(m[0]), true, m[0].slice(0, 8));
});

test('12e fixtures declare themselves synthetic and every free-text string is visibly synthetic or structural', () => {
  const enums = new Set();
  const collect = (n) => { if (Array.isArray(n)) n.forEach(collect); else if (n && typeof n === 'object') { for (const [k, v] of Object.entries(n)) { if ((k === 'enum') && Array.isArray(v)) v.forEach((x) => typeof x === 'string' && enums.add(x)); else if (k === 'const' && typeof v === 'string') enums.add(v); else collect(v); } } };
  loadShippedSchemas().forEach(collect);
  const placeholder = /^<[a-z-]+>$/;
  // Declared probe values: deliberately wrong tokens used by the invalid cases, and one structural version label.
  const DECLARED = new Set(['synthetic-1', 'x_1', 'deletes', 'guess', 'maybe', 'scalp', 'quarantined']);
  const codes = new Set();
  const inv = JSON.parse(readFileSync(new URL('./fixtures/invalid.json', import.meta.url), 'utf8'));
  for (const c of inv.cases) for (const e of c.expect) codes.add(e.code);
  const structural = (s, key) => (key === 'reason' && /^[a-z]+(_[a-z0-9]+)*$/.test(s)) || PARTS.includes(s) || V1_DOCS.includes(s) || enums.has(s) || DECLARED.has(s) || codes.has(s) || placeholder.test(s) || /^urn:clay-data:[a-z-]+$/.test(s)
    || /^\d{4}-\d\d-\d\d(T\d\d:\d\d:\d\dZ)?$/.test(s) || MIG.has(s) || /^\/[A-Za-z0-9_/]*$/.test(s) || s === '';
  const synthetic = (s) => s.startsWith(SYNTH_PREFIX) || s.startsWith('Synthetic-');
  const bad = [];
  for (const name of ['valid.json', 'invalid.json']) {
    const doc = JSON.parse(readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
    assert.equal(doc.synthetic, true, name);
    assert.equal(typeof doc.generator, 'string', name);
    const walkv = (n, key) => {
      if (Array.isArray(n)) n.forEach((x) => walkv(x, key));
      else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) { if (k === 'generator' || k === 'name') continue; walkv(v, k); }
      else if (typeof n === 'string' && !synthetic(n) && !structural(n, key)) bad.push(name + ':' + key + ':' + n.slice(0, 12));
    };
    walkv(doc.cases, '');
  }
  assert.deepEqual(bad, []);
});

test('12f the committed Unicode conformance file is public data and is unchanged', () => {
  const bytes = readFileSync(new URL('./fixtures/normalization-test-15.0.0-parts-0-2-3.txt', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'c646d8932aca270c494f99b9d3a1396e1c344de1d36e7ad442e062f211048833');
});

test('12g the shared scanner has not been changed upstream', () => {
  assert.equal(SYNTH_PREFIX, 'Synthetic ');
  assert.deepEqual(scanText('data/users/test-a', { tokens: false }), []);
  assert.equal(scanText('data/users/abc', { tokens: false }).length, 1);
});

test('12h no source or test file reaches outside the library: no live path, URL, browser storage, network or file write', () => {
  const code = files.filter((u) => /\/src\/[a-z]+\.js$/.test(u.pathname) || /\.test\.mjs$/.test(u.pathname));
  assert.equal(code.length, 9);
  const banned = [/data\/users/, /localStorage|sessionStorage|indexedDB/, /\bhttps?:\/\//, /\bfetch\s*\(/, /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdirSync|mkdtemp|unlinkSync|rmSync|renameSync|copyFileSync)\b/, /node:net|node:http|node:https|node:dgram/];
  for (const u of code) {
    const text = readFileSync(u, 'utf8');
    for (const re of banned) assert.equal(re.test(text), false, u.pathname.split('/').slice(-2).join('/') + ' ' + re);
  }
});

test('12i fixtures: no URL-like text; every v1_doc, part, v1_id and ordinal is declared and small; 24 and 56 are never used', () => {
  for (const name of ['valid.json', 'invalid.json', 'canonical-vectors.json']) {
    const text = readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
    assert.equal(/https?:\/\/|www\./i.test(text), false, name);
    assert.equal(/data\/users/.test(text), false, name);
  }
  const seen = { docs: new Set(), parts: new Set(), ints: [] };
  const walkv = (n, key) => {
    if (Array.isArray(n)) n.forEach((x) => walkv(x, key));
    else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) walkv(v, k);
    else if (key === 'v1_doc' || key === 'v1Doc') seen.docs.add(n);
    else if (key === 'part') seen.parts.add(n);
    else if (key === 'v1_id' || key === 'v1Id' || key === 'ordinal' || key === 'index') seen.ints.push(n);
  };
  for (const name of ['valid.json', 'invalid.json']) walkv(JSON.parse(readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8')).cases, '');
  const cv = JSON.parse(readFileSync(new URL('./fixtures/canonical-vectors.json', import.meta.url), 'utf8'));
  for (const v of cv.migrationIds) walkv(v.inputs, '');
  for (const d of seen.docs) assert.equal(V1_DOCS.includes(d), true, String(d));
  for (const p of seen.parts) assert.equal(PARTS.includes(p), true, String(p));
  assert.ok(seen.ints.length > 0);
  for (const n of seen.ints) { assert.equal(Number.isSafeInteger(n) && n >= 0 && n < 100, true, String(n)); assert.equal(n === 24 || n === 56, false, 'rows 24 and 56 must never appear as an id or position'); }
});

test('12j an undeclared long token is flagged, even when it is only letters, underscores or hyphens; a declared one passes', () => {
  const undeclaredAlpha = 'undeclared' + '_alphabetic'.repeat(3);
  const undeclaredKebab = 'undeclared-' + 'word-'.repeat(6) + 'end';
  assert.ok(undeclaredAlpha.length >= 28 && undeclaredKebab.length >= 28);
  assert.equal(tokenFindings('x ' + undeclaredAlpha + ' y').length, 1);
  assert.equal(tokenFindings('x ' + undeclaredKebab + ' y').length, 1);
  assert.equal(tokenFindings('x ' + undeclaredAlpha + ' y', new Set([undeclaredAlpha])).length, 0);
  for (const t of STRUCTURAL_LONG_TOKENS) { assert.ok(t.length >= 28, t); assert.deepEqual(tokenFindings('a ' + t + ' b'), [], t); }
  assert.equal(STRUCTURAL_LONG_TOKENS.size, 11);
});

test('12k the allowlist is exact: every entry is used in a scanned file, so a stale entry fails', () => {
  const all = files.map((u) => readFileSync(u, 'utf8')).join('\n');
  for (const t of STRUCTURAL_LONG_TOKENS) assert.equal(all.includes(t), true, t);
});
