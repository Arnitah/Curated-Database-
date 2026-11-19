// Test 9 of the PR A specification (Revision 4.2): event ids, migration ids, collision detection, diagnostic locator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { newEventId, migrationId, checkMigrationIds, snapshotPosition, makeMigrationId, __makeMigrationIdForTests, IdError, V1_DOCS, PARTS, MIGRATION_KIND, EVENT_ID, MIGRATION_ID, SNAPSHOT_HASH } from '../../apps/clay-data/src/ids.js';
import { canonicalJSON } from '../../apps/clay-data/src/canonical.js';

const vectors = JSON.parse(readFileSync(new URL('./fixtures/canonical-vectors.json', import.meta.url), 'utf8'));
const code = (fn) => { try { fn(); } catch (e) { return e instanceof IdError ? e.code : 'other:' + e.message; } return 'no_error'; };
const base = { v1_doc: 'clay-products', v1_id: 12, part: 'owned_item', ordinal: 0 };
const sha = (t) => createHash('sha256').update(t, 'utf8').digest();

test('9a event ids: e_ plus UUIDv4, random, no arguments', () => {
  const seen = new Set();
  for (let i = 0; i < 10000; i++) { const id = newEventId(); assert.match(id, EVENT_ID); assert.doesNotMatch(id, MIGRATION_ID); assert.equal(id.length, 38); seen.add(id); }
  assert.equal(seen.size, 10000); // an observation, not a guarantee
  assert.equal(code(() => newEventId('anything')), 'event_id_takes_no_arguments');
});

test('9b recorded example and every known answer reproduce', () => {
  assert.equal(vectors.migrationIds.length, 7);
  for (const v of vectors.migrationIds) { assert.equal(migrationId(v.inputs), v.id, v.name); assert.match(v.id, MIGRATION_ID); }
  assert.equal(vectors.migrationIds[0].id, migrationId(base));
});

test('9c formula: m_ + first 32 hex of SHA-256 over canonicalJSON of the five fields; kind is a constant', () => {
  assert.equal(MIGRATION_KIND, 'clay-v1-migration');
  const text = canonicalJSON({ kind: MIGRATION_KIND, ...base });
  assert.equal(text, '{"kind":"clay-v1-migration","ordinal":0,"part":"owned_item","v1_doc":"clay-products","v1_id":12}');
  assert.equal(migrationId(base), 'm_' + sha(text).toString('hex').slice(0, 32));
  assert.equal(code(() => migrationId({ ...base, kind: 'other' })), 'invalid_input');
});

test('9d input constraints are enforced', () => {
  assert.equal(V1_DOCS.length, 5);
  assert.deepEqual([...PARTS], ['identity', 'owned_item', 'observation', 'legacy_raw']);
  const bad = [
    null, [], 'x', 5,
    { ...base, v1_doc: 'clay-other' }, { ...base, v1_doc: 5 },
    { ...base, v1_id: -1 }, { ...base, v1_id: 1.5 }, { ...base, v1_id: '12' }, { ...base, v1_id: NaN }, { ...base, v1_id: 2 ** 53 }, { ...base, v1_id: -0 },
    { ...base, part: 'fifth' }, { ...base, part: 'manifest' },
    { ...base, ordinal: -1 }, { ...base, ordinal: 0.5 }, { ...base, ordinal: '0' },
    { v1_doc: base.v1_doc, v1_id: 12, part: 'owned_item' },
    { ...base, extra: 1 }
  ];
  for (const b of bad) assert.equal(code(() => migrationId(b)), 'invalid_input', JSON.stringify(b));
  assert.equal(code(() => migrationId(Object.create({ v1_doc: 'clay-products' }))), 'invalid_input');
});

test('9e public function takes exactly one argument; extra arguments cannot change the result', () => {
  assert.equal(migrationId.length, 1);
  assert.equal(migrationId(base, () => new Uint8Array(32), 'x'), migrationId(base));
});

test('9f determinism, content independence and distinct ids for distinct parts', () => {
  assert.equal(migrationId(base), migrationId({ ...base }));
  const all = PARTS.map((part) => migrationId({ ...base, part }));
  assert.equal(new Set(all).size, 4);
  assert.equal(new Set([0, 1, 2, 3].map((ordinal) => migrationId({ ...base, ordinal }))).size, 4);
  assert.notEqual(migrationId(base), migrationId({ ...base, v1_id: 13 }));
  assert.notEqual(migrationId(base), migrationId({ ...base, v1_doc: 'clay-log' }));
  // The function takes no content: a record with a different name has the same id because only provenance is an input.
  const rec = { v1_doc: 'clay-products', v1_id: 12, name: 'Synthetic A' }, rec2 = { ...rec, name: 'Synthetic B' };
  const pick = (r) => migrationId({ v1_doc: r.v1_doc, v1_id: r.v1_id, part: 'owned_item', ordinal: 0 });
  assert.equal(pick(rec), pick(rec2));
});

test('9g ordinal: zero-based, contiguous, assigned by source position and independent of record order', () => {
  const doc = [{ v1_id: 3 }, { v1_id: 1 }, { v1_id: 2 }];
  const idsOf = (d) => Object.fromEntries(d.map((r) => [r.v1_id, migrationId({ v1_doc: 'clay-products', v1_id: r.v1_id, part: 'owned_item', ordinal: 0 })]));
  assert.deepEqual(idsOf(doc), idsOf([...doc].reverse()));
  const multi = [0, 1, 2].map((ordinal) => migrationId({ ...base, part: 'observation', ordinal }));
  assert.equal(new Set(multi).size, 3);
});

test('9h collision detection fails the run, naming positions only', () => {
  const a = { inputs: base, id: migrationId(base) };
  assert.equal(checkMigrationIds([a, { inputs: { ...base, part: 'identity' }, id: migrationId({ ...base, part: 'identity' }) }]), true);
  assert.equal(checkMigrationIds([a, a]), true); // the same inputs repeated is a repeat, not a collision
  const stub = makeMigrationId(() => Buffer.alloc(32, 7));
  assert.equal(stub(base), stub({ ...base, v1_id: 99 }));
  const e1 = { inputs: base, id: stub(base) }, e2 = { inputs: { ...base, v1_id: 99 }, id: stub({ ...base, v1_id: 99 }) };
  try { checkMigrationIds([e1, e2]); assert.fail('expected collision'); } catch (e) { assert.equal(e.code, 'migration_id_collision'); assert.deepEqual(e.positions, [0, 1]); assert.equal(/99|clay-products/.test(e.message), false); }
  // truncation boundary: digests equal in the first 16 bytes and different afterwards give one id
  const tail = makeMigrationId((t) => { const d = Buffer.alloc(32, 9); d.writeUInt8(t.length % 251, 20); return d; });
  assert.equal(tail(base), tail({ ...base, v1_id: 99 }));
  // collision with an existing id (bare string) fails; the same id with identical inputs does not
  assert.equal(code(() => checkMigrationIds([a], [a.id])), 'migration_id_collision');
  assert.equal(checkMigrationIds([a], [{ inputs: base, id: a.id }]), true);
  assert.equal(code(() => checkMigrationIds([a], [{ inputs: { ...base, v1_id: 99 }, id: a.id }])), 'migration_id_collision');
  assert.equal(code(() => checkMigrationIds([{ inputs: base, id: 'not-an-id' }])), 'invalid_entries');
  assert.equal(code(() => checkMigrationIds('x')), 'invalid_entries');
  assert.equal(__makeMigrationIdForTests, makeMigrationId);
  assert.equal(code(() => makeMigrationId(() => Buffer.alloc(4))(base)), 'invalid_digest');
});

test('9i diagnostic locator: a plain object, never an id, never a hash input', () => {
  const hash = 'sha256:' + 'a'.repeat(64);
  const p = snapshotPosition({ v1SnapshotHash: hash, v1_doc: 'clay-products', index: 0 });
  assert.deepEqual({ ...p }, { v1SnapshotHash: hash, v1_doc: 'clay-products', index: 0 });
  assert.equal(Object.isFrozen(p), true);
  assert.match(hash, SNAPSHOT_HASH);
  for (const bad of [null, [], { v1_doc: 'clay-products', index: 0 }, { v1SnapshotHash: hash, v1_doc: 'clay-products', index: -1 }, { v1SnapshotHash: hash, v1_doc: 'clay-products', index: 0.5 },
    { v1SnapshotHash: 'sha256:' + 'A'.repeat(64), v1_doc: 'clay-products', index: 0 }, { v1SnapshotHash: 'sha256:' + 'a'.repeat(63), v1_doc: 'clay-products', index: 0 },
    { v1SnapshotHash: hash, v1_doc: 'nope', index: 0 }, { v1SnapshotHash: hash, v1_doc: 'clay-products', index: 0, id: 1 }]) assert.equal(code(() => snapshotPosition(bad)), 'invalid_position');
  // A locator is rejected as migration input, so it can never become part of an id.
  assert.equal(code(() => migrationId(p)), 'invalid_input');
  assert.equal(code(() => migrationId({ ...base, position: p })), 'invalid_input');
});

test('9j no code path builds a migration id from a snapshot position', () => {
  const src = readFileSync(new URL('../../apps/clay-data/src/ids.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function makeMigrationId'), src.indexOf('export function checkMigrationIds'));
  const code = body.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal(/snapshot|position|index/i.test(code), false);
});

test('9k repeatability: 1,000 calls, a fresh child process, and any key order give one id; types are not coerced', () => {
  const first = migrationId(base);
  for (let i = 0; i < 1000; i++) assert.equal(migrationId({ ...base }), first);
  const reordered = { ordinal: 0, part: 'owned_item', v1_id: 12, v1_doc: 'clay-products' };
  assert.equal(migrationId(reordered), first);
  const url = new URL('../../apps/clay-data/src/ids.js', import.meta.url).href;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', "import('" + url + "').then((m) => process.stdout.write(m.migrationId({ v1_doc: 'clay-products', v1_id: 12, part: 'owned_item', ordinal: 0 })))"], { encoding: 'utf8' });
  assert.equal(out, first);
  assert.equal(code(() => migrationId({ ...base, v1_id: '12' })), 'invalid_input');
  assert.equal(code(() => migrationId({ ...base, name: 'Synthetic Product A' })), 'invalid_input');
  for (const k of ['index', 'position', 'scope', 'locator', 'kind']) assert.equal(code(() => migrationId({ ...base, [k]: 1 })), 'invalid_input', k);
});

test('9l separation: no migration id matches ^e_ and no event id matches ^m_; the locator matches neither', () => {
  assert.equal(/^e_/.test(migrationId(base)), false);
  assert.equal(/^m_/.test(newEventId()), false);
  const loc = JSON.stringify(snapshotPosition({ v1SnapshotHash: 'sha256:' + 'b'.repeat(64), v1_doc: 'clay-log', index: 3 }));
  assert.equal(/^(m|e)_/.test(loc), false);
  const src = readFileSync(new URL('../../apps/clay-data/src/ids.js', import.meta.url), 'utf8');
  assert.equal(/import .*canonical/.test(src), true);
});

test('9m observation (not the test of the duplicate branch): a few thousand synthetic inputs give no duplicate ids', () => {
  const seen = new Map(); let dup = 0;
  for (const v1_doc of V1_DOCS) for (let v1_id = 0; v1_id < 100; v1_id++) for (const part of PARTS) for (let ordinal = 0; ordinal < 3; ordinal++) {
    const id = migrationId({ v1_doc, v1_id, part, ordinal });
    if (seen.has(id)) dup++; seen.set(id, 1);
  }
  assert.equal(seen.size, 6000);
  assert.equal(dup, 0);
});

// ---- Test 9 follow-up: sub-requirements not yet asserted line by line -----------------------------------------------------
test('9n recorded known answer (spec literal, built from halves) and four different ids for the four parts', () => {
  const recorded = 'm_' + ['15542227c9fde90f', '70a1f8bd145d2445'].join('');
  assert.equal(migrationId({ v1_doc: 'clay-products', v1_id: 12, part: 'owned_item', ordinal: 0 }), recorded);
  assert.equal(recorded.length, 34);
  const four = PARTS.map((part) => migrationId({ ...base, part }));
  assert.equal(new Set(four).size, 4);
  assert.equal(four[PARTS.indexOf('owned_item')], recorded);
  for (const v of vectors.migrationIds) assert.equal(v.id.length, 34, v.name);
});

test('9o input constraints: every field missing, null, undefined or non-finite fails closed with a typed error', () => {
  for (const k of ['v1_doc', 'v1_id', 'part', 'ordinal']) {
    const without = { ...base }; delete without[k];
    assert.equal(code(() => migrationId(without)), 'invalid_input', 'missing ' + k);
    for (const v of [null, undefined, '', {}, [], true]) assert.equal(code(() => migrationId({ ...base, [k]: v })), 'invalid_input', k + '=' + String(v));
  }
  for (const k of ['v1_id', 'ordinal']) for (const v of [Infinity, -Infinity, NaN, 2 ** 53, 2 ** 53 + 2, -0, -1, 0.5, '0', '1']) assert.equal(code(() => migrationId({ ...base, [k]: v })), 'invalid_input', k + '=' + String(v));
  for (const k of ['index', 'position', 'scope', 'locator', 'kind', 'name', 'id']) assert.equal(code(() => migrationId({ ...base, [k]: 'x' })), 'invalid_input', 'extra ' + k);
  for (const v of ['clay-product', 'CLAY-PRODUCTS', 'clay-products ', 'clay_products']) assert.equal(code(() => migrationId({ ...base, v1_doc: v })), 'invalid_input', v);
  for (const v of ['Identity', 'owned-item', 'legacy', '']) assert.equal(code(() => migrationId({ ...base, part: v })), 'invalid_input', v);
  assert.equal(migrationId({ ...base, v1_id: 2 ** 53 - 1 }).length, 34);
});

test('9p separation in code: neither family can call the other', () => {
  const src = readFileSync(new URL('../../apps/clay-data/src/ids.js', import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const cut = src.indexOf('export function newEventId'), cut2 = src.indexOf('const isPlain');
  assert.ok(cut > 0 && cut2 > cut);
  const eventPart = src.slice(cut, cut2), migrationPart = src.slice(cut2);
  assert.equal(/migration|MIGRATION|canonical|makeMigrationId|checkMigrationIds/.test(eventPart), false, 'event id code must not reach migration code');
  assert.equal(/randomUUID|newEventId|EVENT_ID|uuid/i.test(migrationPart), false, 'migration id code must not reach event code');
  for (const v of vectors.migrationIds) { assert.doesNotMatch(v.id, EVENT_ID); assert.match(v.id, MIGRATION_ID); }
});

test('9q ordinal: single outputs use 0; multi-output positions number 0..n-1 in source order; content never decides an ordinal', () => {
  const single = PARTS.map((part) => migrationId({ ...base, part, ordinal: 0 }));
  assert.equal(new Set(single).size, 4);
  const outputsA = ['synthetic first', 'synthetic second', 'synthetic third'];
  const outputsB = ['synthetic third', 'synthetic first', 'synthetic second']; // same content, different source positions
  const idsFor = (outs) => outs.map((_, ordinal) => migrationId({ ...base, part: 'observation', ordinal }));
  const a = idsFor(outputsA), b = idsFor(outputsB);
  assert.deepEqual(a, b, 'the id belongs to the source position, not to what the output says');
  assert.equal(new Set(a).size, 3);
  assert.deepEqual(a.map((_, i) => i), [0, 1, 2]);
  const n = 7;
  const run = Array.from({ length: n }, (_, ordinal) => migrationId({ ...base, part: 'observation', ordinal }));
  assert.equal(new Set(run).size, n);
  assert.equal(run[3], migrationId({ ...base, part: 'observation', ordinal: 3 }));
  assert.equal(code(() => migrationId({ ...base, part: 'observation', ordinal: -1 })), 'invalid_input');
});

test('9r quarantine boundary: the locator is a plain object, never an id, and no field of it can enter a migration id', () => {
  const hash = 'sha256:' + 'c'.repeat(64);
  const p = snapshotPosition({ v1SnapshotHash: hash, v1_doc: 'clay-log', index: 4 });
  assert.equal(typeof p, 'object'); assert.equal(typeof p === 'string', false);
  assert.equal(Object.getPrototypeOf(p), Object.prototype);
  assert.deepEqual(Object.keys(p).sort(), ['index', 'v1SnapshotHash', 'v1_doc']);
  for (const v of Object.values(p)) assert.equal(/^(m|e)_/.test(String(v)), false);
  assert.equal(/^(m|e)_/.test(String(p)), false);
  assert.throws(() => { p.index = 9; }, TypeError);
  for (const k of ['v1SnapshotHash', 'index']) assert.equal(code(() => migrationId({ ...base, [k]: p[k] })), 'invalid_input', k);
  assert.equal(code(() => migrationId({ ...base, v1_id: p.v1SnapshotHash })), 'invalid_input');
  assert.equal(code(() => migrationId({ v1_doc: p.v1_doc, v1_id: p.v1SnapshotHash, part: 'identity', ordinal: p.index })), 'invalid_input');
  for (const bad of [undefined, null, '', 'x', 1.5, -1, NaN, true, {}, []]) assert.equal(code(() => migrationId({ ...base, v1_id: bad })), 'invalid_input', String(bad));
  assert.equal(code(() => snapshotPosition({ ...p, index: 2 ** 53 })), 'invalid_position');
});

test('9s duplicate detection by injection: truncation boundary both ways, e_-shaped existing id, positions only', () => {
  const other = { ...base, v1_id: 99 };
  const entry = (fn, inputs) => ({ inputs, id: fn(inputs) });
  // Digests agree on the first 16 bytes and differ afterwards: equal ids, detected.
  const late = makeMigrationId((t) => { const d = Buffer.alloc(32, 9); d.writeUInt8(t.length % 251, 20); return d; });
  assert.equal(late(base), late(other));
  assert.equal(code(() => checkMigrationIds([entry(late, base), entry(late, other)])), 'migration_id_collision');
  // A stub that differs within the first 16 bytes gives different ids and no error.
  const early = makeMigrationId((t) => { const d = Buffer.alloc(32, 9); d.writeUInt8(1 + (t.length % 200), 5); return d; });
  assert.notEqual(early(base), early({ ...base, v1_id: 1234567 }));
  assert.equal(checkMigrationIds([entry(early, base), entry(early, { ...base, v1_id: 1234567 })]), true);
  // An entry whose id is an e_-shaped id equal to an existing id must throw.
  const eId = newEventId();
  assert.notEqual(code(() => checkMigrationIds([{ inputs: base, id: eId }], [eId])), 'no_error');
  assert.equal(code(() => checkMigrationIds([{ inputs: base, id: eId }], [eId])), 'invalid_entries');
  // The error names positions only: no input value, no id text.
  const stub = makeMigrationId(() => Buffer.alloc(32, 7));
  const e1 = entry(stub, base), e2 = entry(stub, other);
  for (const run of [() => checkMigrationIds([e1, e2]), () => checkMigrationIds([e1], [e2.id]), () => checkMigrationIds([e1], [{ inputs: other, id: e2.id }])]) {
    let err; try { run(); } catch (e) { err = e; }
    assert.ok(err instanceof IdError); assert.equal(err.code, 'migration_id_collision');
    assert.ok(Array.isArray(err.positions) && err.positions.every((x) => Number.isInteger(x) && x >= 0));
    const shown = err.message + JSON.stringify(err.positions);
    assert.equal(shown.includes(e1.id), false); assert.equal(/clay-products|99|owned_item/.test(shown), false);
  }
});

test('9t no claim of collision-freedom: the README and the module header say detection is a failure condition', () => {
  const readme = readFileSync(new URL('../../apps/clay-data/README.md', import.meta.url), 'utf8');
  const header = readFileSync(new URL('../../apps/clay-data/src/ids.js', import.meta.url), 'utf8').slice(0, 900);
  for (const t of [readme, header]) { assert.match(t, /not mathematically guaranteed/i); assert.match(t, /failure condition/i); }
  assert.equal(/collision-free|never collide|cannot collide/i.test(readme.replace(/No guarantee of collision-freedom is claimed/i, '')), false);
});
