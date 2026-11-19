// Test 10 of the PR A specification (Revision 4.2): the six value states and the full presence truth table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES, STATE_RULES, SET_BY, INSUFFICIENT_INFORMATION, isState, presenceRule, validateStateField, isInsufficientInformation } from '../../apps/clay-data/src/states.js';

const PROPS = ['value', 'source', 'candidates', 'reason'];
const EXPECT = {
  stated: ['value', 'source'],
  not_stated: ['source'],
  unknown: ['reason', ['source']],
  missing: ['reason'],
  not_applicable: ['reason'],
  conflicting: ['candidates']
};
const req = (s) => (Array.isArray(EXPECT[s][EXPECT[s].length - 1]) ? EXPECT[s].slice(0, -1) : EXPECT[s]);
const opt = (s) => (Array.isArray(EXPECT[s][EXPECT[s].length - 1]) ? EXPECT[s][EXPECT[s].length - 1] : []);
const sample = { value: 'Synthetic value', source: { kind: 'user' }, candidates: [{ value: 'Synthetic A', source: { kind: 'user' } }, { value: 'Synthetic B', source: { kind: 'user' } }], reason: 'not_asked' };

test('10a six states, in the recorded order', () => {
  assert.deepEqual([...STATES], ['stated', 'not_stated', 'unknown', 'missing', 'not_applicable', 'conflicting']);
  assert.equal(Object.isFrozen(STATES), true);
  assert.deepEqual([...SET_BY], ['user', 'rule', 'migration']);
  for (const s of STATES) assert.equal(isState(s), true);
  for (const x of ['Stated', 'none', '', null, undefined, 5, {}]) assert.equal(isState(x), false);
});

test('10b truth table: 6 states x 16 presence combinations, exactly the allowed ones pass', () => {
  let rows = 0, accepted = 0;
  for (const s of STATES) {
    for (let mask = 0; mask < 16; mask++) {
      const present = {}; PROPS.forEach((p, i) => { present[p] = !!(mask & (1 << i)); });
      const should = req(s).every((p) => present[p]) && PROPS.every((p) => present[p] ? (req(s).includes(p) || opt(s).includes(p)) : true);
      assert.equal(presenceRule(s, present), should, s + ' ' + mask);
      const field = { state: s, setBy: 'user' };
      for (const p of PROPS) if (present[p]) field[p] = sample[p];
      const r = validateStateField(field);
      assert.equal(r.ok, should, s + ' ' + mask + ' ' + JSON.stringify(r.errors));
      rows++; if (should) accepted++;
    }
  }
  assert.equal(rows, 96);
  assert.equal(accepted, 7); // stated 1, not_stated 1, unknown 2, missing 1, not_applicable 1, conflicting 1
});

test('10c setBy is required and restricted; unknown properties and states are rejected', () => {
  const ok = { state: 'missing', reason: 'not_asked', setBy: 'rule' };
  assert.equal(validateStateField(ok).ok, true);
  assert.deepEqual(validateStateField({ state: 'missing', reason: 'not_asked' }).errors.map((e) => e.code), ['invalid_setBy']);
  assert.equal(validateStateField({ ...ok, setBy: 'admin' }).ok, false);
  assert.equal(validateStateField({ ...ok, extra: 1 }).errors[0].code, 'unknown_property');
  assert.equal(validateStateField({ ...ok, state: 'maybe' }).errors[0].code, 'unknown_state');
  for (const bad of [null, undefined, [], 'x', 5]) assert.equal(validateStateField(bad).errors[0].code, 'not_an_object');
  assert.equal(validateStateField({ state: 'stated', value: 'Synthetic', source: { kind: 'user' }, setBy: 'user', reason: undefined }).ok, true);
});

test('10d conflicting needs at least two candidates, each with value and source', () => {
  const f = (candidates) => ({ state: 'conflicting', candidates, setBy: 'user' });
  assert.equal(validateStateField(f(sample.candidates)).ok, true);
  assert.equal(validateStateField(f([sample.candidates[0]])).errors[0].code, 'candidates_need_two');
  assert.equal(validateStateField(f('x')).errors[0].code, 'candidates_need_two');
  assert.equal(validateStateField(f([{ value: 'a' }, sample.candidates[1]])).errors[0].code, 'candidate_needs_source');
});

test('10e insufficient information: missing, unknown, not_stated and conflicting; never stated or not_applicable', () => {
  assert.deepEqual([...INSUFFICIENT_INFORMATION].sort(), ['conflicting', 'missing', 'not_stated', 'unknown']);
  for (const s of STATES) assert.equal(isInsufficientInformation(s), ['missing', 'unknown', 'not_stated', 'conflicting'].includes(s));
  assert.equal(isInsufficientInformation('absent'), false);
  assert.equal(Object.keys(STATE_RULES).length, 6);
});

test('10f validation never mutates its input', () => {
  const f = { state: 'stated', value: 'Synthetic', source: { kind: 'user' }, setBy: 'user' };
  const before = JSON.stringify(f);
  validateStateField(f);
  assert.equal(JSON.stringify(f), before);
});
