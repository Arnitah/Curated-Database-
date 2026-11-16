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
