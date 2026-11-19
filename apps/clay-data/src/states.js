// The six value states of the Clay v2 data contract.
// Every optional fact is stored as a field { state, value?, source?, candidates?, reason?, setBy }.
// The state describes OUR RECORD of the fact, not the real world.
// Pure functions, no I/O, no dependencies.

export const STATES = Object.freeze(['stated', 'not_stated', 'unknown', 'missing', 'not_applicable', 'conflicting']);

// Per state: which of the four optional properties are required and which are allowed.
// Anything not listed as required or allowed is forbidden.
// setBy is required for every state (the field shape always carries it).
const PROPS = ['value', 'source', 'candidates', 'reason'];
export const STATE_RULES = Object.freeze({
  stated: { required: ['value', 'source'], optional: [] },
  not_stated: { required: ['source'], optional: [] },
  unknown: { required: ['reason'], optional: ['source'] },
  missing: { required: ['reason'], optional: [] },
  not_applicable: { required: ['reason'], optional: [] },
  conflicting: { required: ['candidates'], optional: [] }
});

export const SET_BY = Object.freeze(['user', 'rule', 'migration']);

// States that screening and pairing must treat as "insufficient information".
export const INSUFFICIENT_INFORMATION = Object.freeze(['missing', 'unknown', 'not_stated', 'conflicting']);

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

export function isState(name) {
  return typeof name === 'string' && STATES.includes(name);
}

// Presence check used by the truth table: which of the four properties are present.
export function presenceRule(state, present) {
  const r = STATE_RULES[state];
  if (!r) return false;
  for (const p of PROPS) {
    const here = !!present[p];
    if (r.required.includes(p)) { if (!here) return false; }
    else if (!r.optional.includes(p)) { if (here) return false; }
  }
  return true;
}

// Returns { ok, errors: [{code, path}] }. Never throws on bad data, never mutates.
export function validateStateField(field) {
  const errors = [];
  if (!isPlain(field)) return { ok: false, errors: [{ code: 'not_an_object', path: '' }] };
  if (!isState(field.state)) return { ok: false, errors: [{ code: 'unknown_state', path: '/state' }] };
  const allowed = new Set(['state', 'setBy', ...PROPS]);
  for (const k of Object.keys(field)) if (!allowed.has(k)) errors.push({ code: 'unknown_property', path: '/' + k });
  const present = {};
  for (const p of PROPS) present[p] = has(field, p);
  const r = STATE_RULES[field.state];
  for (const p of PROPS) {
    if (r.required.includes(p) && !present[p]) errors.push({ code: 'missing_' + p, path: '/' + p });
    else if (!r.required.includes(p) && !r.optional.includes(p) && present[p]) errors.push({ code: 'forbidden_' + p, path: '/' + p });
  }
  if (!has(field, 'setBy') || !SET_BY.includes(field.setBy)) errors.push({ code: 'invalid_setBy', path: '/setBy' });
  if (present.candidates) {
    const c = field.candidates;
    if (!Array.isArray(c) || c.length < 2) errors.push({ code: 'candidates_need_two', path: '/candidates' });
    else c.forEach((x, i) => { if (!isPlain(x) || !has(x, 'value') || !has(x, 'source')) errors.push({ code: 'candidate_needs_source', path: '/candidates/' + i }); });
  }
  return { ok: errors.length === 0, errors };
}

// Screening and pairing must never read these states as "absent" or "safe".
export function isInsufficientInformation(state) {
  return INSUFFICIENT_INFORMATION.includes(state);
}
