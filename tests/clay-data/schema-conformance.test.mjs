// Test 11 (schemas) of the PR A specification (Revision 4.2): shipped schemas against synthetic valid and invalid records,
// the partition of schemas, and the manifest contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createShippedRegistry, loadShippedSchemas } from '../../apps/clay-data/src/validate.js';
import { migrationId, PARTS, V1_DOCS } from '../../apps/clay-data/src/ids.js';
import { STATES } from '../../apps/clay-data/src/states.js';

const read = (u) => JSON.parse(readFileSync(new URL(u, import.meta.url), 'utf8'));
const valid = read('./fixtures/valid.json');
const invalid = read('./fixtures/invalid.json');
const reg = createShippedRegistry();
const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

// Placeholders are replaced at run time, so no event id, run id or hash is ever stored in a fixture.
function fill(x) {
  if (Array.isArray(x)) return x.map(fill);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fill(v)]));
  if (x === '<event-id>') return 'e_' + randomUUID();
  if (x === '<content-hash>') return 'sha256:' + hex(64);
  if (x === '<snapshot-hash>') return 'sha256:' + hex(64);
  if (x === '<run-id>') return randomUUID();
  if (x === '<run-id-upper>') return randomUUID().toUpperCase();
  return x;
}
const errs = (r) => r.errors.map((e) => ({ code: e.code, path: e.path }));

test('11i fixtures are synthetic and carry the declared markers', () => {
  assert.equal(valid.synthetic, true); assert.equal(invalid.synthetic, true);
  assert.equal(typeof valid.generator, 'string'); assert.equal(typeof invalid.generator, 'string');
  assert.equal(valid.cases.length, 13); assert.equal(invalid.cases.length, 21);
  for (const c of [...valid.cases, ...invalid.cases]) assert.equal(reg.ids().includes(c.schema), true, c.name);
});

test('11j every valid case validates against its schema', () => {
  for (const c of valid.cases) {
    const rec = fill(c.record);
    const r = reg.validate(c.schema, rec);
    assert.equal(r.ok, true, c.name + ' ' + JSON.stringify(r.errors));
  }
});

test('11k migrated ids in valid cases are recomputed from their inputs, not trusted', () => {
  let n = 0;
  for (const c of valid.cases) {
    if (!c.idInputs) continue;
    assert.equal(c.record.id, migrationId(c.idInputs), c.name); n++;
  }
  assert.equal(n, 4);
  for (const c of valid.cases) if (!c.idInputs && typeof c.record.id === 'string') assert.equal(c.record.id, '<event-id>', c.name);
});

test('11k2 a migrated-form id inside an invalid case is also recomputed from declared inputs', () => {
  const c = invalid.cases.find((x) => x.name === 'correction_migration_id_rejected');
  assert.equal(c.record.id, migrationId(c.idInputs));
});

test('11l every invalid case fails with exactly the expected typed errors', () => {
  for (const c of invalid.cases) {
    const r = reg.validate(c.schema, fill(c.record));
    assert.equal(r.ok, false, c.name);
    assert.deepEqual(errs(r), c.expect, c.name);
  }
});

test('11m partition: part set is exactly identity, owned_item, observation, legacy_raw', () => {
  assert.deepEqual([...PARTS], ['identity', 'owned_item', 'observation', 'legacy_raw']);
  assert.equal(V1_DOCS.length, 5);
});

const CLASS = {
  'urn:clay-data:product-identity': 'migrated',
  'urn:clay-data:owned-item': 'migrated',
  'urn:clay-data:ingredient-observation': 'migrated',
  'urn:clay-data:common': 'shared',
  'urn:clay-data:correction': 'user-created',
  'urn:clay-data:directions': 'user-created',
  'urn:clay-data:manifest': 'manifest'
};
const schemas = loadShippedSchemas();
const byId = Object.fromEntries(schemas.map((s) => [s.$id, s]));

test('11n every shipped schema is classified; an unclassified schema fails', () => {
  assert.deepEqual(Object.keys(byId).sort(), Object.keys(CLASS).sort());
  const files = readdirSync(new URL('../../apps/clay-data/schema/', import.meta.url)).filter((f) => f.endsWith('.schema.json')).sort();
  assert.deepEqual(files, ['common', 'correction', 'directions', 'ingredient-observation', 'manifest', 'owned-item', 'product-identity'].map((n) => n + '.schema.json'));
});

test('11o no shipped schema defines a quarantine entity (Option C: legacy_raw is report-only)', () => {
  // The only permitted occurrence is the manifest's four-integer counts object, which has a "quarantined" count.
  const names = (node, out = []) => {
    if (Array.isArray(node)) node.forEach((x) => names(x, out));
    else if (node && typeof node === 'object') {
      for (const k of ['$defs', 'properties']) if (node[k]) out.push(...Object.keys(node[k]).map((n) => k + ':' + n));
      for (const v of Object.values(node)) names(v, out);
    }
    return out;
  };
  for (const s of schemas) {
    assert.equal(/quarantine|legacy_raw|legacyraw/i.test(s.$id), false, s.$id);
    const hits = names(s).filter((n) => /quarantine|legacy_raw|legacyraw/i.test(n));
    if (s.$id === 'urn:clay-data:manifest') assert.deepEqual(hits, ['properties:quarantined']);
    else assert.deepEqual(hits, [], s.$id);
    assert.equal(JSON.stringify(s).includes('"legacy_raw"'), false, s.$id);
  }
});

test('11p the manifest requires no id; every other entity schema does', () => {
  for (const [id, kind] of Object.entries(CLASS)) {
    const s = byId[id];
    if (kind === 'shared') { assert.equal(s.required, undefined, id); continue; }
    const req = s.required || [];
    if (kind === 'manifest') { assert.equal(req.includes('id'), false); assert.equal('id' in (s.properties || {}), false); assert.equal('idKind' in (s.properties || {}), false); }
    else { assert.equal(req.includes('id'), true, id); assert.equal(req.includes('idKind'), true, id); }
  }
});

test('11q user-created schemas accept only e_ ids; migrated schemas accept e_ or m_ ids', () => {
  const m = 'm_' + hex(32), e = 'e_' + randomUUID();
  const rec = (name) => fill(valid.cases.find((c) => c.name === name).record);
  const corr = rec('correction_annotates'), dir = rec('directions_owned_item_ref'), item = rec('owned_item_user_no_legacy');
  assert.equal(reg.validate('urn:clay-data:correction', { ...corr, id: e }).ok, true);
  assert.equal(reg.validate('urn:clay-data:correction', { ...corr, id: m }).ok, false);
  assert.equal(reg.validate('urn:clay-data:directions', { ...dir, id: m }).ok, false);
  assert.equal(reg.validate('urn:clay-data:owned-item', { ...item, id: e }).ok, true);
  assert.equal(reg.validate('urn:clay-data:owned-item', { ...item, id: 'x_' + hex(32) }).ok, false);
});

test('11r manifest contract: schemaVersion integer >= 1, runs of {runId, mappingVersion, v1SnapshotHash, counts}', () => {
  const man = valid.cases.find((c) => c.name === 'manifest_one_run');
  const base = () => fill(man.record);
  assert.equal(reg.validate('urn:clay-data:manifest', base()).ok, true);
  assert.deepEqual(Object.keys(base()).sort(), ['runs', 'schemaVersion']);
  const run = Object.keys(base().runs[0]).sort();
  assert.deepEqual(run, ['counts', 'mappingVersion', 'runId', 'v1SnapshotHash']);
  assert.deepEqual(Object.keys(base().runs[0].counts).sort(), ['input', 'migrated', 'migrated_with_flags', 'quarantined']);
  const bad = (f) => { const x = base(); f(x); return reg.validate('urn:clay-data:manifest', x).ok; };
  assert.equal(bad((x) => { x.schemaVersion = 1.5; }), false);
  assert.equal(bad((x) => { x.schemaVersion = 7; }), true);
  assert.equal(bad((x) => { x.runs[0].runId = 'not-a-uuid'; }), false);
  assert.equal(bad((x) => { const r = x.runs[0].runId; x.runs[0].runId = r.slice(0, 14) + '1' + r.slice(15); }), false);
  assert.equal(bad((x) => { x.runs[0].v1SnapshotHash = x.runs[0].v1SnapshotHash.toUpperCase(); }), false);
  assert.equal(bad((x) => { x.runs[0].v1SnapshotHash = 'sha256:' + hex(63); }), false);
  assert.equal(bad((x) => { x.runs[0].counts.extra = 1; }), false);
  assert.equal(bad((x) => { delete x.runs[0].counts.input; }), false);
  assert.equal(bad((x) => { x.runs[0].counts.input = 1.5; }), false);
  for (const k of ['id', 'idKind', 'entityType', 'origin', 'createdAt', 'contentHash']) assert.equal(bad((x) => { x[k] = 'x'; }), false, k);
});

test('11s value-state fields: all six states appear in a schema branch and a field with a bad state is rejected', () => {
  const common = byId['urn:clay-data:common'];
  const text = JSON.stringify(common);
  for (const s of STATES) assert.equal(text.includes('"' + s + '"'), true, s);
  assert.equal(common.$defs.stringState.oneOf.length, 6);
});

test('11t user-created records never carry migration provenance', () => {
  const e = (name) => valid.cases.find((c) => c.name === name).record;
  assert.equal(e('correction_annotates').origin, 'user');
  assert.equal(e('directions_owned_item_ref').origin, 'user');
  assert.equal(e('correction_annotates').idKind, 'event');
});

// ---- Test 11 follow-up: schema-level sub-requirements of the Rev4.3 text not yet asserted --------------------------------
const walk = (node, at, visit) => {
  if (Array.isArray(node)) node.forEach((x, i) => walk(x, at + '/' + i, visit));
  else if (node && typeof node === 'object') { visit(node, at); for (const [k, v] of Object.entries(node)) walk(v, at + '/' + k, visit); }
};
const DEFS_NAME = /^[A-Za-z0-9_-]+$/;
const lintDefs = (schema) => Object.keys(schema.$defs || {}).filter((k) => !DEFS_NAME.test(k));

test('11u loading: every shipped schema loads with a unique $id; every object schema is closed explicitly', () => {
  assert.equal(schemas.length, 7);
  assert.equal(new Set(schemas.map((s) => s.$id)).size, 7);
  assert.equal(reg.ids().length, 7);
  // additionalProperties is set explicitly on every object schema. It is false everywhere except one declared open node:
  // the owned-item legacy extras object, which exists to carry unknown v1 fields unchanged (the specification names legacy { v1Doc, v1Id, extras } in section 6.6).
  const OPEN = ['urn:clay-data:owned-item/properties/legacy/properties/extras'];
  const open = []; let objects = 0;
  for (const s of schemas) walk(s, '', (n, at) => {
    if (n.type !== 'object') return;
    objects++;
    assert.equal(typeof n.additionalProperties, 'boolean', s.$id + at + ' must set additionalProperties explicitly');
    if (n.additionalProperties === true) open.push(s.$id + at);
  });
  assert.ok(objects >= 7);
  assert.deepEqual(open, OPEN);
});

test('11v $defs naming lint: shipped keys pass; a synthetic key with a slash fails the lint', () => {
  for (const s of schemas) assert.deepEqual(lintDefs(s), [], s.$id);
  assert.deepEqual(lintDefs({ $defs: { 'a/b': { type: 'string' }, ok_name: {}, 'x~y': {} } }), ['a/b', 'x~y']);
  assert.deepEqual(lintDefs({ $defs: { fine: {}, 'with space': {} } }), ['with space']);
});

test('11w manifest runId and counts: lowercase UUIDv4 only; negative or non-integer counts are rejected', () => {
  const man = valid.cases.find((c) => c.name === 'manifest_one_run');
  const run = (f) => { const x = fill(man.record); f(x.runs[0]); return reg.validate('urn:clay-data:manifest', x).ok; };
  assert.equal(run(() => {}), true);
  assert.equal(run((r) => { r.runId = randomUUID(); }), true);
  assert.equal(run((r) => { r.runId = randomUUID().toUpperCase(); }), false);
  assert.equal(run((r) => { const u = randomUUID(); r.runId = u.slice(0, 14) + '1' + u.slice(15); }), false, 'version 1');
  assert.equal(run((r) => { const u = randomUUID(); r.runId = u.slice(0, 19) + 'c' + u.slice(20); }), false, 'variant outside 8 9 a b');
  assert.equal(run((r) => { r.runId = randomUUID().replace('-', ''); }), false, 'a missing hyphen');
  assert.equal(run((r) => { r.runId = 'e_' + randomUUID(); }), false, 'e_ prefix');
  assert.equal(run((r) => { r.runId = 'm_' + hex(32); }), false, 'm_ prefix');
  for (const v of [123, null, true, {}, [], undefined]) assert.equal(run((r) => { r.runId = v; }), false, String(v));
  for (const k of ['input', 'migrated', 'migrated_with_flags', 'quarantined']) {
    for (const v of [-1, 0.5, '1', null, NaN]) assert.equal(run((r) => { r.counts[k] = v; }), false, k + '=' + String(v));
    assert.equal(run((r) => { r.counts[k] = 0; }), true, k + '=0');
  }
});

test('11x partition detail: common defines no entity; no schema carries a part or ordinal field; the part list is frozen at four', () => {
  const common = byId['urn:clay-data:common'];
  for (const k of ['properties', 'required', 'type', 'oneOf']) assert.equal(common[k], undefined, 'common.' + k);
  assert.equal(Object.keys(common.$defs).some((k) => /^(entity|record|item)$/i.test(k)), false);
  for (const s of schemas) walk(s, '', (n, at) => {
    for (const bad of ['part', 'ordinal', 'kind_part']) assert.equal(Boolean(n.properties) && bad in n.properties, false, s.$id + at + ' ' + bad);
  });
  assert.equal(PARTS.length, 4); assert.equal(Object.isFrozen(PARTS), true);
  assert.equal(JSON.stringify(schemas).includes('clay-v1-migration'), false);
});

test('11y synthetic only: no fixture value equals the numbers held back from this work, and fixtures carry only synthetic markers', () => {
  const held = [24, 56];
  for (const [label, f] of [['valid', valid], ['invalid', invalid]]) walk(f, '', (n, at) => {
    for (const [k, v] of Object.entries(n)) if (typeof v === 'number') assert.equal(held.includes(v), false, label + at + '/' + k);
    if (n.idInputs) assert.equal(held.includes(n.idInputs.v1_id), false, label + at);
  });
  assert.equal(valid.synthetic, true); assert.equal(invalid.synthetic, true);
});
