// Tests 1 to 8 of the PR A specification (Revision 4.2): restricted canonical JSON, pinned data digests, the ck1 comparison key,
// guard N1, the start-up self-test, and the official conformance fixture (O2).
// These are selected cases. The start-up check is a canary, not a conformance test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalJSON, contentHash, sha256Hex, comparisonKey, compareKeys, selfTest, runtimeIsUnicode15, CanonicalError, DATA, COMPARISON_KEY_VERSION, REASONS } from '../../apps/clay-data/src/canonical.js';

const fx = (name) => new URL('./fixtures/' + name, import.meta.url);
const vectors = JSON.parse(readFileSync(fx('canonical-vectors.json'), 'utf8'));
const hx = (s) => [...s].map((c) => c.codePointAt(0).toString(16)).join(' ');
const U = (s) => [...s].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');

// Pinned digests (SHA-256, lowercase hex). Definitions: section 5 of the specification.
const PIN = {
  FOLD: '39172e88d33502decbd71f4c1da95ab90b69168189a21c1798855fa730b87e2d',
  RANGES: '78bd1641f1e8e3d5b9f1d764e1ee61223acb5ae5a8f33d0fccebe1a71e2aab75',
  CANARY62: 'af13a49a856b3da6a5e84e640d87091b6936e44bf9c45507dbbe5cbc7009d00b',
  ND15: 'a303eb900b4477807380849b26a11c62d194a496e72573ffa2f718498a86ceb6',
  SEQ: '9167df06615cfeccb39e5a3f73d46f8ef245fb9386d71136c257fe5be01fa430',
  V24: 'b6bc5f0f430c1b7878004d5ebfc89b736d8255f973bb4382270d9dec52354a5b',
  O2: 'c646d8932aca270c494f99b9d3a1396e1c344de1d36e7ad442e062f211048833'
};
const O2_LINES = 2045;

function build(d) {
  if (Array.isArray(d)) return d.map(build);
  if (d && typeof d === 'object') {
    if ('$cps' in d) return String.fromCodePoint(...d.$cps);
    if ('$cps16' in d) return String.fromCharCode(...d.$cps16);
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, build(v)]));
  }
  return d;
}
const code = (fn) => { try { fn(); } catch (e) { return e instanceof CanonicalError ? e.code : 'other:' + e.message; } return 'no_error'; };

// ---- Test 1: restricted canonical JSON -------------------------------------------------------------
test('1a canonical vectors hash to the pinned values', () => {
  assert.equal(vectors.canonical.length, 6);
  for (const v of vectors.canonical) assert.equal(contentHash(build(v.value)), v.hash, v.name);
});
test('1b keys are sorted and no whitespace is written', () => {
  assert.equal(canonicalJSON({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
  assert.equal(canonicalJSON({ b: { d: 1, c: 2 }, a: 0 }), '{"a":0,"b":{"c":2,"d":1}}');
});
test('1c string escaping: control characters escaped, U+2028 and emoji literal', () => {
  assert.equal(canonicalJSON({ t: '\u0001\n\t"\\' }), '{"t":"\\u0001\\n\\t\\"\\\\"}');
  assert.equal(canonicalJSON({ t: ' \u{1F600}' }), '{"t":" \u{1F600}"}');
});
test('1d rejected inputs fail closed with a typed error', () => {
  assert.equal(code(() => canonicalJSON({ a: -0 })), 'negative_zero');
  assert.equal(code(() => canonicalJSON({ a: 1.5 })), 'not_a_safe_integer');
  assert.equal(code(() => canonicalJSON({ a: NaN })), 'not_a_safe_integer');
  assert.equal(code(() => canonicalJSON({ a: Infinity })), 'not_a_safe_integer');
  assert.equal(code(() => canonicalJSON({ a: 2 ** 53 })), 'not_a_safe_integer');
  assert.equal(code(() => canonicalJSON({ a: undefined })), 'undefined_value');
  assert.equal(code(() => canonicalJSON({ a: new Date(0) })), 'not_a_plain_object');
  assert.equal(code(() => canonicalJSON({ a: new Map() })), 'not_a_plain_object');
  assert.equal(code(() => canonicalJSON({ a() {} })), 'unsupported_type');
  assert.equal(code(() => canonicalJSON({ a: Symbol('x') })), 'unsupported_type');
  assert.equal(code(() => canonicalJSON({ a: 1n })), 'unsupported_type');
  assert.equal(code(() => canonicalJSON(undefined)), 'unsupported_type');
  assert.equal(code(() => canonicalJSON({ A: 1 })), 'invalid_key');
  assert.equal(code(() => canonicalJSON({ 'a-b': 1 })), 'invalid_key');
  assert.equal(code(() => canonicalJSON({ '1a': 1 })), 'invalid_key');
  assert.equal(code(() => canonicalJSON({ a: '\ud800' })), 'lone_surrogate');
  assert.equal(code(() => canonicalJSON({ a: ['x', '\udc00'] })), 'lone_surrogate');
});
test('1g key grammar (section 5.6): lowercase ASCII first character; then ASCII letters, digits or underscore', () => {
  const ok = ['entityType', 'schemaVersion', 'ownedItemRef', 'rawText', 'a', 'a_1', 'aB', 'v1Doc', 'x9_Z'];
  for (const k of ok) assert.doesNotThrow(() => canonicalJSON({ [k]: 1 }), k);
  for (const k of ['Ab', 'A', '_a', '1a', 'a-b', 'a b', '', '\u00e9', 'a\u00e9', '\u0430', 'a.b']) assert.equal(code(() => canonicalJSON({ [k]: 1 })), 'invalid_key', JSON.stringify(k));
  // nested objects and arrays are checked too
  assert.equal(code(() => canonicalJSON({ a: [{ Bad: 1 }] })), 'invalid_key');
  assert.equal(code(() => canonicalJSON({ a: { fineKey: { 'no-good': 1 } } })), 'invalid_key');
});
test('1h mixed-case keys sort by UTF-16 code unit order, case is significant and keys differing only by case are distinct', () => {
  assert.equal(canonicalJSON({ ab: 1, a_: 2, aB: 3, a9: 4 }), '{"a9":4,"aB":3,"a_":2,"ab":1}');
  assert.equal(canonicalJSON({ ab: 1, aB: 2 }), '{"aB":2,"ab":1}');
  assert.equal(canonicalJSON({ aB: 2, ab: 1 }), canonicalJSON({ ab: 1, aB: 2 }));
  assert.notEqual(contentHash({ ab: 1 }), contentHash({ aB: 1 }));
  const keys = ['entityType', 'schemaVersion', 'ownedItemRef', 'rawText', 'a_1', 'zz', 'aB'];
  const obj = Object.fromEntries(keys.map((k) => [k, 1]));
  assert.deepEqual(Object.keys(JSON.parse(canonicalJSON(obj))), [...keys].sort());
});
test('1e fixture rejections', () => {
  const expected = { upper_case_key: 'invalid_key', float: 'not_a_safe_integer', beyond_safe_integer: 'not_a_safe_integer', lone_surrogate_in_string: 'lone_surrogate' };
  for (const r of vectors.rejections) assert.equal(code(() => canonicalJSON(JSON.parse(r.json))), expected[r.name], r.name);
});
test('1f NFC and NFD text hash differently on purpose; text is never normalised', () => {
  assert.notEqual(contentHash({ t: 'é' }), contentHash({ t: 'é' }));
});

// ---- Test 3: pinned data ----------------------------------------------------------------------------
test('3 FOLD, RANGES and CANARY-62 digests equal their pins', () => {
  assert.equal(DATA.fold.length, 1530);
  assert.equal(DATA.ranges.length, 707);
  assert.equal(DATA.ranges.reduce((n, [a, b]) => n + (b - a + 1), 0), 286719);
  assert.equal(sha256Hex(JSON.stringify(DATA.fold)), PIN.FOLD);
  assert.equal(sha256Hex(JSON.stringify(DATA.ranges)), PIN.RANGES);
  assert.equal(DATA.canary.length, 62);
  const lines = DATA.canary.map(([cp, nfd, nfkd]) => cp.toString(16) + ':' + nfd + '|' + nfkd + '\n').join('');
  assert.equal(sha256Hex(lines), PIN.CANARY62);
  assert.equal(DATA.unicodeVersion, '15.0.0');
});

// ---- Test 2 and 4: pipeline and guard N1 -------------------------------------------------------------
const needsU15 = { skip: runtimeIsUnicode15() ? false : 'runtime Unicode is older than 15.0 (the older-runtime branch is asserted instead)' };
test('2 pipeline: CR LF to LF, NFD, fold, NFKD, fold, NFKD, collapse and trim', needsU15, () => {
  const k = (s) => comparisonKey(s).key;
  assert.equal(k('A\r\nB'), 'a b');
  assert.equal(k('A\rB'), 'a b');
  assert.equal(k('  A \t 　 B  '), 'a b');
  assert.equal(k('Straße'), 'strasse');
  assert.equal(k('ẞ'), 'ss');
  assert.equal(k('ǅ'), 'dž'.normalize('NFKD'));
  assert.equal(k('ﬁne'), 'fine');
  assert.equal(k('Å'), k('Å'));
  assert.equal(k('Café'), k('CAFÉ'));
  assert.equal(k('ｆｕｌｌ'), 'full');
});
test('4 guard N1 and return shapes', needsU15, () => {
  const ok = comparisonKey('Abc');
  assert.deepEqual(Object.keys(ok).sort(), ['key', 'state', 'version']);
  assert.equal(ok.state, 'ok'); assert.equal(ok.version, 'ck1-unicode-15.0.0'); assert.equal(COMPARISON_KEY_VERSION, 'ck1-unicode-15.0.0');
  const shape = (r) => { assert.equal(r.state, 'unavailable'); assert.equal(r.version, 'ck1-unicode-15.0.0'); assert.equal('key' in r, false); assert.deepEqual(Object.keys(r).sort(), ['reason', 'state', 'version']); return r.reason; };
  assert.equal(shape(comparisonKey('a͸')), 'code_point_not_assigned_in_unicode_15_0');
  assert.equal(shape(comparisonKey('\u{10FFFF}')), 'code_point_not_assigned_in_unicode_15_0');
  assert.equal(shape(comparisonKey('\u{2EBF0}')), 'code_point_not_assigned_in_unicode_15_0');
  assert.equal(shape(comparisonKey('A\ud800')), 'lone_surrogate');
  assert.equal(shape(comparisonKey('\udc00A')), 'lone_surrogate');
  assert.equal(shape(comparisonKey('\udc00\ud800')), 'lone_surrogate');
  assert.equal(comparisonKey('').state, 'ok');
  assert.equal(comparisonKey('\u{1E030}').state, 'ok');
  assert.deepEqual(Object.values(REASONS).sort(), ['code_point_not_assigned_in_unicode_15_0', 'lone_surrogate', 'runtime_unicode_older_than_15_0']);
  assert.throws(() => comparisonKey(5), CanonicalError);
  assert.throws(() => comparisonKey(null), CanonicalError);
});
test('5a compareKeys never compares an unavailable key', needsU15, () => {
  const a = comparisonKey('Café'), b = comparisonKey('CAFÉ'), c = comparisonKey('Tea'), bad = comparisonKey('A\ud800');
  assert.equal(compareKeys(a, b), 'same');
  assert.equal(compareKeys(a, c), 'different');
  assert.equal(compareKeys(a, bad), 'not_comparable');
  assert.equal(compareKeys(bad, bad), 'not_comparable');
  assert.equal(compareKeys(a, { state: 'ok', version: 'ck0', key: a.key }), 'not_comparable');
  assert.equal(compareKeys(null, a), 'not_comparable');
});

// ---- Test 5: whole-domain digests ----------------------------------------------------------------------
const V24 = vectors.comparisonKeyVectors.map((v) => String.fromCharCode(...v.utf16));
test('5b V24 digest on a Unicode 15+ runtime; unavailable on an older one', () => {
  assert.equal(V24.length, 24);
  const lines = V24.map((v) => { const r = comparisonKey(v); return U(v) + ' => ' + (r.state === 'ok' ? U(r.key) : 'UNAVAILABLE(' + r.reason + ')'); });
  if (runtimeIsUnicode15()) assert.equal(sha256Hex(lines.join('\n')), PIN.V24);
  else for (const v of V24) assert.equal(comparisonKey(v).reason, 'runtime_unicode_older_than_15_0');
});
test('5c ND15 over every assigned Unicode 15.0 code point (Unicode 15+ runtime)', needsU15, () => {
  const h = createHash('sha256');
  for (const [a, b] of DATA.ranges) for (let cp = a; cp <= b; cp++) { const ch = String.fromCodePoint(cp); h.update(cp.toString(16) + ':' + hx(ch.normalize('NFD')) + '|' + hx(ch.normalize('NFKD')) + '\n'); }
  assert.equal(h.digest('hex'), PIN.ND15);
});
test('5d SEQ-CANARY digest (Unicode 15+ runtime); the Node 18 value is documented in the README, not asserted', needsU15, () => {
  const lines = DATA.sequenceCanaries.map((r) => hx(String.fromCodePoint(...r.seq.split(' ').map((x) => parseInt(x, 16))).normalize('NFD')));
  assert.equal(sha256Hex(lines.join('\n')), PIN.SEQ);
});

// ---- Test 6: canary set --------------------------------------------------------------------------------
test('6 canary set: 6 detectors, 14 controls, 20 sequences; self-test passes all 62 + 20', () => {
  const s = DATA.sequenceCanaries;
  assert.equal(s.length, 20);
  assert.equal(s.filter((x) => x.role === 'detector').length, 6);
  assert.equal(s.filter((x) => x.role === 'control').length, 14);
  assert.equal(DATA.canary.length, 62);
  const r = selfTest();
  if (runtimeIsUnicode15()) { assert.equal(r.ok, true); assert.deepEqual(r.single, []); assert.deepEqual(r.sequence, []); }
  else assert.equal(r.ok, false);
});

// ---- Test 7: idempotence -------------------------------------------------------------------------------
test('7 idempotence on the vector set', needsU15, () => {
  for (const v of V24) { const r = comparisonKey(v); if (r.state === 'ok') { const r2 = comparisonKey(r.key); assert.equal(r2.state, 'ok'); assert.equal(r2.key, r.key, U(v)); } }
});

// ---- Test 8 (O2): conformance fixture, executed, with in-memory mutation ------------------------------
const cpList = (col) => (col === '' ? '' : String.fromCodePoint(...col.split(' ').map((x) => parseInt(x, 16))));
function runConformance(text) {
  let executed = 0; const failures = [];
  for (const line of text.split('\n')) {
    if (line === '' || line[0] === '#' || line[0] === '@') continue;
    const c = line.split(';').slice(0, 5).map(cpList);
    executed++;
    const [c1, c2, c3, c4, c5] = c;
    const ok = c3 === c1.normalize('NFD') && c3 === c2.normalize('NFD') && c3 === c3.normalize('NFD')
      && c5 === c1.normalize('NFKD') && c5 === c2.normalize('NFKD') && c5 === c3.normalize('NFKD') && c5 === c4.normalize('NFKD') && c5 === c5.normalize('NFKD');
    if (!ok) failures.push(executed);
  }
  return { executed, failures };
}
const gate = (text) => sha256Hex(text) === PIN.O2 && text.split('\n').filter((l) => l !== '' && l[0] !== '#' && l[0] !== '@').length === O2_LINES;
test('8 O2: official NormalizationTest Parts 0, 2, 3 executed; mutated copies fail; the committed file is never changed', needsU15, () => {
  const bytes = readFileSync(fx('normalization-test-15.0.0-parts-0-2-3.txt'));
  const text = bytes.toString('utf8');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), PIN.O2);
  assert.equal(bytes.length, 831164);
  assert.equal(gate(text), true);
  const base = runConformance(text);
  assert.equal(base.executed, O2_LINES); assert.deepEqual(base.failures, []);
  // Mutation 1: one expected value changed (in memory only).
  const lines = text.split('\n');
  const first = lines.findIndex((l) => l !== '' && l[0] !== '#' && l[0] !== '@');
  const cols = lines[first].split(';'); cols[2] = cols[2] + ' 0041';
  const m1 = [...lines]; m1[first] = cols.join(';');
  const r1 = runConformance(m1.join('\n'));
  assert.ok(r1.failures.length >= 1, 'a changed expected value must fail');
  assert.equal(gate(m1.join('\n')), false, 'the hash gate must also fail');
  // Mutation 2: one line deleted.
  const m2 = lines.filter((_, i) => i !== first);
  const r2 = runConformance(m2.join('\n'));
  assert.notEqual(r2.executed, O2_LINES, 'a deleted line must change the executed count');
  assert.equal(gate(m2.join('\n')), false);
  // The original text is unchanged and still equals the committed file.
  assert.equal(text, readFileSync(fx('normalization-test-15.0.0-parts-0-2-3.txt'), 'utf8'));
  assert.equal(createHash('sha256').update(readFileSync(fx('normalization-test-15.0.0-parts-0-2-3.txt'))).digest('hex'), PIN.O2);
});
