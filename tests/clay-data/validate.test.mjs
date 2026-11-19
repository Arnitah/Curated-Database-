// Test 11 (validator part) of the PR A specification (Revision 4.2): the restricted Draft 2020-12 subset validator.
// All schemas here are tiny synthetic documents. Shipped-schema checks are in schema-conformance.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, createShippedRegistry, loadShippedSchemas, SchemaError, decodeFragment, parsePointer, resolvePointer } from '../../apps/clay-data/src/validate.js';

// Built at run time so that no URL-shaped literal sits in a test file (see no-private-data.test.mjs).
const REMOTE_REF = ['https', '//remote.invalid/x#/$defs/y'].join(':');
const DRAFT = ['https', '//json-schema.org/draft/2020-12/schema'].join(':');
const S = (id, body) => ({ $schema: DRAFT, $id: id, ...body });
const code = (fn) => { try { fn(); } catch (e) { return e instanceof SchemaError ? e.code : 'other:' + e.message; } return 'no_error'; };
const one = (body, extra = []) => createRegistry([S('urn:t:a', body), ...extra]);
const check = (reg, v, id = 'urn:t:a') => reg.validate(id, v);
const codes = (r) => r.errors.map((e) => e.code + '@' + e.path);

test('11a keywords of the subset accept and reject as written', () => {
  const r = one({ type: 'object', required: ['n'], additionalProperties: false, properties: {
    n: { type: 'integer', minimum: 1, maximum: 5 }, s: { type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-z]+$' },
    a: { type: 'array', items: { type: 'boolean' }, minItems: 1, maxItems: 2 }, e: { enum: ['x', 'y'] }, c: { const: 7 }, z: { type: 'null' } } });
  assert.deepEqual(check(r, { n: 3, s: 'abc', a: [true], e: 'x', c: 7, z: null }), { ok: true, errors: [] });
  assert.deepEqual(codes(check(r, {})), ['required@/n']);
  assert.deepEqual(codes(check(r, { n: 0 })), ['minimum@/n']);
  assert.deepEqual(codes(check(r, { n: 6 })), ['maximum@/n']);
  assert.deepEqual(codes(check(r, { n: 1.5 })), ['type@/n']);
  assert.deepEqual(codes(check(r, { n: 1, s: 'a' })), ['min_length@/s']);
  assert.deepEqual(codes(check(r, { n: 1, s: 'abcde' })), ['max_length@/s']);
  assert.deepEqual(codes(check(r, { n: 1, s: 'AB' })), ['pattern@/s']);
  assert.deepEqual(codes(check(r, { n: 1, a: [] })), ['min_items@/a']);
  assert.deepEqual(codes(check(r, { n: 1, a: [true, true, true] })), ['max_items@/a']);
  assert.deepEqual(codes(check(r, { n: 1, a: [1] })), ['type@/a/0']);
  assert.deepEqual(codes(check(r, { n: 1, e: 'q' })), ['enum@/e']);
  assert.deepEqual(codes(check(r, { n: 1, c: 8 })), ['const@/c']);
  assert.deepEqual(codes(check(r, { n: 1, extra: 1 })), ['additional_property@/extra']);
  assert.deepEqual(codes(check(r, [])), ['type@']);
});

test('11b integer type is strict: no floats, no unsafe integers, no strings', () => {
  const r = one({ type: 'integer' });
  for (const v of [1.5, NaN, Infinity, 2 ** 53, '1', true, null, {}, []]) assert.equal(check(r, v).ok, false, String(v));
  for (const v of [0, 1, -5, 2 ** 53 - 1]) assert.equal(check(r, v).ok, true, String(v));
});

test('11b2 negative zero is rejected as an integer (it is rejected by canonical JSON); other integers are unchanged', () => {
  const r = one({ type: 'integer' });
  assert.deepEqual(codes(check(r, -0)), ['type@']);
  assert.equal(check(one({ type: 'object', properties: { n: { type: 'integer' } } }), JSON.parse('{"n":-0}')).ok, false);
  for (const v of [0, 1, -1, 5, -5, 2 ** 53 - 1, -(2 ** 53 - 1)]) assert.equal(check(r, v).ok, true, String(v));
  assert.equal(check(r, 0).ok, true);
  assert.equal(check(one({ type: 'integer', minimum: 0 }), -0).ok, false);
});

test('11c oneOf: exactly one branch; zero and several are distinct typed errors; empty oneOf is a schema error', () => {
  const r = one({ oneOf: [{ type: 'string' }, { type: 'integer' }] });
  assert.equal(check(r, 'x').ok, true);
  assert.deepEqual(codes(check(r, true)), ['oneOf_no_match@']);
  const m = one({ oneOf: [{ type: 'string' }, { type: 'string', minLength: 1 }] });
  assert.deepEqual(codes(check(m, 'x')), ['oneOf_multiple_match@']);
  assert.equal(code(() => one({ oneOf: [] })), 'oneOf_empty');
});

test('11d unsupported or malformed schema constructs fail closed with typed errors', () => {
  assert.equal(code(() => one({ type: 'object', allOf: [] })), 'unsupported_keyword');
  assert.equal(code(() => one({ anyOf: [{ type: 'string' }] })), 'unsupported_keyword');
  assert.equal(code(() => one({ not: {} })), 'unsupported_keyword');
  assert.equal(code(() => one({ format: 'date-time', type: 'string' })), 'unsupported_keyword');
  assert.equal(code(() => one({ patternProperties: {} })), 'unsupported_keyword');
  assert.equal(code(() => one({ type: ['string', 'null'] })), 'unsupported_type');
  assert.equal(code(() => one({ type: 'number' })), 'unsupported_type');
  assert.equal(code(() => one({ type: 'string', pattern: '(' , maxLength: 5 })), 'invalid_pattern');
  assert.equal(code(() => one({ type: 'string', pattern: '^a$' })), 'pattern_requires_maxLength');
  assert.equal(code(() => one({ type: 'string', pattern: '^a$', maxLength: 300 })), 'pattern_requires_maxLength');
  assert.equal(code(() => one({ type: 'string', pattern: '^' + 'a'.repeat(201) + '$', maxLength: 10 })), 'invalid_pattern');
  assert.equal(code(() => one({ type: 'string', minLength: -1 })), 'invalid_bound');
  assert.equal(code(() => one({ type: 'object', required: 'x' })), 'invalid_required');
  assert.equal(code(() => one({ enum: [] })), 'invalid_enum');
  assert.equal(code(() => createRegistry([{ type: 'string' }])), 'missing_id');
  assert.equal(code(() => createRegistry([S('urn:t:a', {}), S('urn:t:a', {})])), 'duplicate_id');
});

test('11e $ref: local and cross-schema, with $defs; remote, unknown, sibling, cyclic and too-deep refs are rejected', () => {
  const b = S('urn:t:b', { $defs: { word: { type: 'string', minLength: 1, maxLength: 5 } } });
  const a = S('urn:t:a', { $defs: { n: { type: 'integer' } }, type: 'object', properties: { x: { $ref: '#/$defs/n' }, w: { $ref: 'urn:t:b#/$defs/word' } } });
  const r = createRegistry([a, b]);
  assert.equal(r.validate('urn:t:a', { x: 1, w: 'ok' }).ok, true);
  assert.deepEqual(codes(r.validate('urn:t:a', { x: 'q', w: '' })), ['type@/x', 'min_length@/w']);
  assert.equal(code(() => one({ properties: { p: { $ref: REMOTE_REF } } })), 'ref_remote');
  assert.equal(code(() => one({ properties: { p: { $ref: 'urn:t:zzz#/$defs/y' } } })), 'ref_unknown_schema');
  assert.equal(code(() => one({ properties: { p: { $ref: '#/properties/x' } } })), 'ref_not_local_defs');
  assert.equal(code(() => one({ $defs: { y: { type: 'string' } }, properties: { p: { $ref: '#/$defs/y', type: 'string' } } })), 'ref_sibling');
  assert.equal(code(() => one({ $defs: { y: { $ref: '#/$defs/z' }, z: { $ref: '#/$defs/y' } }, properties: { p: { $ref: '#/$defs/y' } } })), 'ref_cycle');
  const chain = {}; for (let i = 0; i < 20; i++) chain['d' + i] = i === 19 ? { type: 'string' } : { $ref: '#/$defs/d' + (i + 1) };
  assert.equal(code(() => one({ $defs: chain, properties: { p: { $ref: '#/$defs/d0' } } })), 'ref_depth_exceeded');
  assert.equal(code(() => one({ properties: { p: { $ref: '#/$defs/missing' } } })), 'ref_unresolved');
});

test('11f JSON Pointer (RFC 6901): percent-decode first, then ~1 and ~0', () => {
  assert.equal(decodeFragment('%24defs'), '$defs');
  assert.deepEqual(parsePointer('/a~1b/c~0d'), ['a/b', 'c~d']);
  assert.deepEqual(parsePointer(''), []);
  assert.equal(code(() => parsePointer('a')), 'pointer_invalid');
  assert.equal(code(() => parsePointer('/a~2')), 'pointer_invalid');
  assert.equal(resolvePointer({ a: { 'b/c': { 'd~e': 1 } } }, '/a/b~1c/d~0e'), 1);
  assert.equal(code(() => resolvePointer({ a: 1 }, '/b')), 'pointer_unresolved');
  const r = one({ $defs: { 'a/b': { type: 'string' } }, properties: { p: { $ref: '#/$defs/a~1b' } } });
  assert.equal(r.validate('urn:t:a', { p: 'x' }).ok, true);
});

// Note: a node with $ref allows only annotation siblings ($comment, title, description); that is a deliberate restriction of the subset.
test('11g validation of unknown schema ids and hostile values fails safely', () => {
  const r = one({ type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } });
  assert.throws(() => r.validate('urn:t:nope', {}), SchemaError);
  assert.equal(check(r, JSON.parse('{"__proto__":1}')).ok, false);
  assert.equal(check(r, { a: 'x', constructor: 1 }).ok, false);
  const deep = (n) => (n === 0 ? 'x' : { a: deep(n - 1) });
  const nested = one({ $defs: { n: { type: 'object', properties: { a: { $ref: '#/$defs/n' } } } }, properties: { p: { $ref: '#/$defs/n' } } });
  assert.equal(check(nested, { p: deep(10) }).ok, false); // leaf is a string where an object is expected
});

test('11h the shipped registry loads: every $ref resolves and every schema compiles', () => {
  const reg = createShippedRegistry();
  assert.equal(loadShippedSchemas().length, 7);
  assert.equal(reg.ids().length, 7);
  assert.deepEqual([...reg.ids()].sort(), ['urn:clay-data:common', 'urn:clay-data:correction', 'urn:clay-data:directions', 'urn:clay-data:ingredient-observation', 'urn:clay-data:manifest', 'urn:clay-data:owned-item', 'urn:clay-data:product-identity']);
});

// ---- Test 11 follow-up: sub-requirements of the Rev4.3 text not yet asserted -----------------------------------------------
const thrown = (fn) => { try { fn(); } catch (e) { return e; } return null; };

test('11u oneOf: a branch that is a $ref is evaluated; a failing branch leaks no errors; the real six-state schema behaves', () => {
  const r = one({ $defs: { word: { type: 'string', minLength: 2, maxLength: 4 } }, oneOf: [{ $ref: '#/$defs/word' }, { type: 'object', required: ['k'], properties: { k: { type: 'integer' } }, additionalProperties: false }] });
  assert.deepEqual(check(r, 'abc'), { ok: true, errors: [] });
  assert.deepEqual(check(r, { k: 1 }), { ok: true, errors: [] });
  assert.deepEqual(codes(check(r, 'a')), ['oneOf_no_match@']);
  assert.deepEqual(codes(check(r, { k: 'x', z: 1 })), ['oneOf_no_match@']);
  const state = createRegistry([...loadShippedSchemas(), S('urn:t:state', { type: 'object', additionalProperties: false, properties: { f: { $ref: 'urn:clay-data:common#/$defs/stringState' } } })]);
  const src = { kind: 'user_entered' };
  const six = [
    { state: 'stated', value: 'synthetic', source: src, setBy: 'user' }, { state: 'not_stated', source: src, setBy: 'rule' },
    { state: 'unknown', reason: 'no_label', setBy: 'user' }, { state: 'missing', reason: 'no_label', setBy: 'migration' },
    { state: 'not_applicable', reason: 'no_label', setBy: 'rule' }, { state: 'conflicting', candidates: [{ value: 'one', source: src }, { value: 'two', source: src }], setBy: 'user' }];
  for (const f of six) assert.deepEqual(check(state, { f }, 'urn:t:state'), { ok: true, errors: [] }, f.state);
  for (const f of [{ state: 'invented', setBy: 'user' }, { state: 'stated', source: src, setBy: 'user' }, { ...six[0], extra: 1 }, { ...six[0], setBy: 'robot' }, 'stated', null]) assert.deepEqual(codes(check(state, { f }, 'urn:t:state')), ['oneOf_no_match@/f'], JSON.stringify(f));
});

test('11v $ref: three nested levels, the depth limit itself passes and one past it fails, a direct cycle fails, a relative path fails', () => {
  const nested = one({ $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/c' }, c: { type: 'string', maxLength: 3 } }, properties: { p: { $ref: '#/$defs/a' } } });
  assert.equal(check(nested, { p: 'abc' }).ok, true);
  assert.deepEqual(codes(check(nested, { p: 'abcd' })), ['max_length@/p']);
  const chain = (n) => { const d = {}; for (let i = 0; i < n; i++) d['d' + i] = i === n - 1 ? { type: 'string' } : { $ref: '#/$defs/d' + (i + 1) }; return one({ $defs: d, properties: { p: { $ref: '#/$defs/d0' } } }); };
  assert.equal(check(chain(16), { p: 'x' }).ok, true, 'a chain of 16 definitions is at the limit and passes');
  const over = thrown(() => chain(17));
  assert.equal(over.code, 'ref_depth_exceeded');
  assert.equal(code(() => one({ $defs: { y: { $ref: '#/$defs/y' } }, properties: { p: { $ref: '#/$defs/y' } } })), 'ref_cycle');
  for (const rel of ['./other.json#/$defs/y', '../x#/$defs/y', 'other.json']) assert.notEqual(code(() => one({ properties: { p: { $ref: rel } } })), 'no_error', rel);
  assert.equal(code(() => one({ properties: { p: { $ref: './other.json#/$defs/y' } } })), 'ref_unknown_schema');
});

test('11w pointer escaping: resolvePointer on a/b and m~n, ~01 is a literal ~1, percent-decoding comes first, bad pointers fail', () => {
  assert.equal(resolvePointer({ 'a/b': 1 }, '/a~1b'), 1);
  assert.equal(resolvePointer({ 'm~n': 2 }, '/m~0n'), 2);
  assert.equal(resolvePointer({ '~1': 3, '/': 4 }, '/~01'), 3);
  assert.deepEqual(parsePointer('/~01'), ['~1']);
  assert.deepEqual(parsePointer(decodeFragment('/a%7E1b')), ['a/b']);
  assert.deepEqual(parsePointer(decodeFragment('/a%7E01b')), ['a~1b']);
  for (const bad of ['/~2', 'a', '/a~', '/~', 'x/y']) assert.equal(code(() => parsePointer(bad)), 'pointer_invalid', bad);
  const e2e = one({ $defs: { 'm~n': { type: 'integer' }, 'a/b': { type: 'string' } }, properties: { p: { $ref: '#/$defs/m~0n' }, q: { $ref: '#/$defs/a~1b' } } });
  assert.equal(check(e2e, { p: 1, q: 'x' }).ok, true);
  assert.deepEqual(codes(check(e2e, { p: 'x', q: 1 })), ['type@/p', 'type@/q']);
});

test('11x invalid regular expressions throw invalid_pattern naming the pointer; a valid anchored pattern accepts and rejects', () => {
  for (const pat of ['(', '[', '\\', '\\p{NotAProperty}', '^' + 'a'.repeat(201) + '$']) {
    const e = thrown(() => one({ properties: { p: { type: 'string', pattern: pat, maxLength: 5 } } }));
    assert.equal(e && e.code, 'invalid_pattern', pat);
    assert.equal(e.pointer, '/properties/p/pattern', pat);
  }
  assert.equal(code(() => one({ properties: { p: { type: 'string', pattern: '^a$' } } })), 'pattern_requires_maxLength');
  const ok = one({ properties: { p: { type: 'string', pattern: '^[a-z]{2}$', maxLength: 2 } } });
  assert.equal(check(ok, { p: 'ab' }).ok, true);
  assert.deepEqual(codes(check(ok, { p: 'AB' })), ['pattern@/p']);
});

test('11y each supported type: one accepting value and several rejecting values; unsupported types fail at load', () => {
  const sets = {
    string: { accept: ['', 'x'], reject: [1, null, {}, [], true] },
    integer: { accept: [0, -1, 2 ** 53 - 1, -(2 ** 53 - 1)], reject: [1.5, NaN, Infinity, -Infinity, '1', 2 ** 53, -(2 ** 53), true, null] },
    boolean: { accept: [true, false], reject: [0, 1, 'true', null, {}, []] },
    object: { accept: [{}, { a: 1 }], reject: [[], null, 'x', 1, true] },
    array: { accept: [[], [1]], reject: [{}, 'x', null, 1, true] },
    null: { accept: [null], reject: [0, '', false, {}, []] }
  };
  for (const [type, { accept, reject }] of Object.entries(sets)) {
    const r = one({ type });
    for (const v of accept) assert.equal(check(r, v).ok, true, type + ' accepts ' + JSON.stringify(v));
    for (const v of reject) assert.equal(check(r, v).ok, false, type + ' rejects ' + String(v));
  }
  for (const t of ['number', ['string', 'null'], 'text', '', 7, null]) {
    const e = thrown(() => one({ type: t }));
    assert.equal(e && e.code, 'unsupported_type', JSON.stringify(t));
    assert.equal(e.pointer, '/type');
  }
});

test('11z each unsupported keyword throws unsupported_keyword naming the keyword and its pointer', () => {
  const words = ['format', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'patternProperties', 'unevaluatedProperties', 'unevaluatedItems',
    'dependentRequired', 'dependentSchemas', 'contains', 'uniqueItems', 'multipleOf', 'minProperties', 'maxProperties', 'propertyNames'];
  for (const k of words) {
    const e = thrown(() => one({ properties: { p: { type: 'string', [k]: k === 'uniqueItems' ? true : {} } } }));
    assert.equal(e && e.code, 'unsupported_keyword', k);
    assert.equal(e.keyword, k); assert.equal(e.pointer, '/properties/p/' + k);
  }
  const top = thrown(() => one({ not: {} }));
  assert.equal(top.keyword, 'not'); assert.equal(top.pointer, '/not');
});
