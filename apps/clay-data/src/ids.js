// Identifiers for the Clay v2 data contract.
//   Event ids     "e_" + UUIDv4, random, for records the USER creates.
//   Migration ids "m_" + first 32 hex of SHA-256 over canonicalJSON({kind:"clay-v1-migration", v1_doc, v1_id, part, ordinal}).
// The migration formula is the one recorded in Handoff - Clay. It is frozen: a change needs its own approval.
// Distinct inputs are EXPECTED, but not mathematically guaranteed, to give distinct truncated ids, so detecting a
// duplicate is a failure condition (checkMigrationIds), not an assumption.
import { randomUUID } from 'node:crypto';
import { canonicalJSON, sha256Bytes } from './canonical.js';

export class IdError extends Error {
  constructor(code, detail, positions) { super(detail ? code + ': ' + detail : code); this.name = 'IdError'; this.code = code; if (positions) this.positions = positions; }
}

export const V1_DOCS = Object.freeze(['clay-products', 'clay-hair', 'clay-log', 'clay-prefs', 'clay-scents']);
export const PARTS = Object.freeze(['identity', 'owned_item', 'observation', 'legacy_raw']);
export const MIGRATION_KIND = 'clay-v1-migration';

export const EVENT_ID = /^e_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const MIGRATION_ID = /^m_[0-9a-f]{32}$/;
export const SNAPSHOT_HASH = /^sha256:[0-9a-f]{64}$/;

export function newEventId() {
  if (arguments.length !== 0) throw new IdError('event_id_takes_no_arguments');
  return 'e_' + randomUUID();
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isNonNegInt = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0);

function checkInput(input) {
  if (!isPlain(input)) throw new IdError('invalid_input', 'not a plain object');
  const allowed = ['v1_doc', 'v1_id', 'part', 'ordinal'];
  for (const k of Object.keys(input)) if (!allowed.includes(k)) throw new IdError('invalid_input', 'unexpected property');
  for (const k of allowed) if (!(k in input)) throw new IdError('invalid_input', 'missing ' + k);
  if (!V1_DOCS.includes(input.v1_doc)) throw new IdError('invalid_input', 'v1_doc');
  if (!isNonNegInt(input.v1_id)) throw new IdError('invalid_input', 'v1_id');
  if (!PARTS.includes(input.part)) throw new IdError('invalid_input', 'part');
  if (!isNonNegInt(input.ordinal)) throw new IdError('invalid_input', 'ordinal');
}

// Internal factory so tests can inject a stub digest and exercise the duplicate-detection branch.
// digestFn(string) must return at least 16 bytes (Buffer or Uint8Array).
export function makeMigrationId(digestFn) {
  return function build(input) {
    checkInput(input);
    const text = canonicalJSON({ kind: MIGRATION_KIND, v1_doc: input.v1_doc, v1_id: input.v1_id, part: input.part, ordinal: input.ordinal });
    const d = digestFn(text);
    if (!d || d.length < 16) throw new IdError('invalid_digest');
    return 'm_' + Buffer.from(d.subarray(0, 16)).toString('hex');
  };
}
export { makeMigrationId as __makeMigrationIdForTests };

const real = makeMigrationId(sha256Bytes);
// Public function: exactly one argument; any further argument is ignored and cannot change the result.
export function migrationId(input) { return real(input); }

// Duplicate detection as a failure condition. entries: [{ inputs, id }]. existing: ids already in use, either bare id
// strings (any equality is a collision, because their inputs are unknown) or { inputs, id } objects (equality with the
// same canonical inputs is a repeat, not a collision). The error names positions only, never input values.
export function checkMigrationIds(entries, existing = []) {
  if (!Array.isArray(entries) || !Array.isArray(existing)) throw new IdError('invalid_entries');
  const seen = new Map();
  entries.forEach((e, i) => {
    if (!isPlain(e) || typeof e.id !== 'string' || !MIGRATION_ID.test(e.id)) throw new IdError('invalid_entries', 'entry shape', [i]);
    const canon = canonicalJSON(e.inputs);
    if (seen.has(e.id)) {
      const first = seen.get(e.id);
      if (first.canon !== canon) throw new IdError('migration_id_collision', 'two different inputs share one id', [first.index, i]);
    } else seen.set(e.id, { canon, index: i });
  });
  existing.forEach((x, j) => {
    if (typeof x === 'string') {
      if (seen.has(x)) throw new IdError('migration_id_collision', 'id equals an existing id', [seen.get(x).index, entries.length + j]);
    } else if (isPlain(x) && typeof x.id === 'string') {
      const hit = seen.get(x.id);
      if (hit && hit.canon !== canonicalJSON(x.inputs)) throw new IdError('migration_id_collision', 'id equals an existing id with different inputs', [hit.index, entries.length + j]);
    } else throw new IdError('invalid_entries', 'existing shape', [entries.length + j]);
  });
  return true;
}

// Diagnostic locator for records that receive NO migration id (invalid or duplicate v1 id). It is a plain object, never
// a string, never an identifier, never an input to migrationId, and meaningful only inside the identified snapshot.
export function snapshotPosition(pos) {
  if (!isPlain(pos)) throw new IdError('invalid_position');
  const keys = Object.keys(pos).sort().join(',');
  if (keys !== 'index,v1SnapshotHash,v1_doc') throw new IdError('invalid_position', 'properties');
  if (typeof pos.v1SnapshotHash !== 'string' || !SNAPSHOT_HASH.test(pos.v1SnapshotHash)) throw new IdError('invalid_position', 'v1SnapshotHash');
  if (!V1_DOCS.includes(pos.v1_doc)) throw new IdError('invalid_position', 'v1_doc');
  if (!isNonNegInt(pos.index)) throw new IdError('invalid_position', 'index');
  return Object.freeze({ v1SnapshotHash: pos.v1SnapshotHash, v1_doc: pos.v1_doc, index: pos.index });
}
