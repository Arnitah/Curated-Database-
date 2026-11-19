// Checks that the Clay CI workflow's path filters cover what the Clay harness and the data-contract library depend on.
// Offline, no dependency, no network. It reads the workflow as TEXT and never edits it.
//
// LIMITS (also stated in apps/clay-data/README.md). These are different conditions with different effects:
//  A. GitHub documents three conditions for path-filtered workflows: a push of more than 1,000 commits and a diff that times out
//     both ALWAYS run the workflow (an extra run, harmless to an advisory workflow); a diff of more than 3,000 files whose matching
//     files are not among the first 3,000 returned means the workflow does NOT run (a possible missed run).
//  B. Limits of this design: (1) a path-filtered workflow does not run when every changed path is outside the filters, so it cannot
//     run this test then; (2) the test sees only the files declared below and cannot detect a NEW loaded dependency or application
//     path that nobody adds to the lists (no static scan of the page, decision D13 Option A); (3) commits made with [skip ci] never
//     run CI; (4) how GitHub treats renamed and deleted files for path matching is unconfirmed, so rename pairs are tested as the
//     conservative case (both paths count as changed); (5) a skipped, path-filtered workflow leaves a required check pending, which
//     would matter only if the workflow were required, and it is not; (6) the matcher models GitHub's documented behaviour and does
//     not prove it.
//  BRANCH RESTRICTION: push runs only for pushes to main (push.branches is [main]); pull_request has no equivalent restriction and
//  runs for pull requests targeting any base branch. A push to another branch does not run this workflow whatever paths it touches,
//  so work on a branch is covered only through its pull request. The same twelve filters sit under both events.
//  BOT COMMITS: the version file and data filters principally affect human edits, because the workflows that write those paths
//  automatically commit with [skip ci].
//
// The lists below were derived by read-only inspection of the repository on commit 37af6e8 (branch phase1-clay-tests, identical on
// main 9cbc79b): grep of package.json scripts, tests/clay/, apps/ingredient-intelligence/ and apps/clay.html for loaded and
// referenced paths. They are hand-maintained. Any change to tests/clay/helpers/, to what apps/clay.html fetches, or to the engine
// bundle inputs means re-deriving them in the same PR. Evidence categories stay separate: A and B are verified by reading code;
// REFERENCED_BY_APP is code-referenced and its use at run time in tests is NOT verified.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKFLOW = '.github/workflows/clay-tests.yml';

const REQUIRED = [
  'apps/clay.html', 'apps/ingredient-intelligence/**', 'tests/clay/**', 'package.json', 'package-lock.json', '.github/workflows/clay-tests.yml',
  'apps/clay-data/**', 'tests/clay-data/**', 'data/clay/**', 'data/safe-batch/**', 'data/scents/**', 'version.json'
];

// Category A, verified: executed by the test:ci script.
const EXECUTED_TESTS = [
  'tests/clay/boot.test.mjs', 'tests/clay/bundle-parity.test.mjs', 'tests/clay/engine-integration.test.mjs', 'tests/clay/isolation.test.mjs',
  'tests/clay/migrations.test.mjs', 'tests/clay/pages.test.mjs', 'tests/clay/shelf-actions.test.mjs', 'tests/clay/sync.test.mjs',
  'apps/ingredient-intelligence/tests/smoke.test.mjs', 'apps/ingredient-intelligence/tests/clay-shaped.test.mjs'
];
// Category B, verified: loaded or run by those tests.
const LOADED_DEPENDENCIES = [
  'apps/clay.html', 'apps/ingredient-intelligence/src/engine.js', 'apps/ingredient-intelligence/src/clay-adapter.js',
  'apps/ingredient-intelligence/tools/bundle.mjs', 'apps/ingredient-intelligence/data/ingredients.json',
  'apps/ingredient-intelligence/data/pairing-rules.json', 'apps/ingredient-intelligence/data/sources.json',
  'tests/clay/helpers/server.mjs', 'tests/clay/helpers/launch.mjs', 'tests/clay/helpers/fake-platform.mjs', 'tests/clay/helpers/leak-scan.mjs',
  'tests/clay/fixtures/synthetic-shelf.json'
];
// Verified: how the tests are run.
const RUN_CONFIGURATION = ['package.json', 'package-lock.json', '.github/workflows/clay-tests.yml'];
// Category D, referenced by application code; run-time use in tests is not verified.
const REFERENCED_BY_APP = [
  'version.json', 'data/clay/hair_tips.json', 'data/clay/hair_wash_steps.json', 'data/clay/product_steps.json', 'data/clay/feel_words.json',
  'data/safe-batch/scent_families.json', 'data/scents/twins.json', 'data/scents/houses.json', 'data/scents/traditions.json', 'data/scents/rates.json'
];
// Category D, deliberately outside the twelve filters (decision D14, Option A): a hand edit will not trigger this workflow.
const KNOWN_UNCOVERED = ['index/clay/products/names.json'];

// ---- minimal workflow parser: fails closed on anything it does not expect ---------------------------------------------
function parseWorkflow(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === 'on:');
  if (start < 0) throw new Error('workflow: top-level "on:" not found');
  if (lines.filter((l) => l === 'on:').length !== 1) throw new Error('workflow: duplicate "on:"');
  const ev = {}; let cur = null, sub = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '' || l.trim().startsWith('#')) continue;
    if (!l.startsWith(' ')) break; // next top-level key
    let m;
    if ((m = /^ {2}([a-z_]+):$/.exec(l))) {
      if (!['pull_request', 'push', 'workflow_dispatch'].includes(m[1])) throw new Error('workflow: unknown event ' + m[1]);
      if (ev[m[1]]) throw new Error('workflow: duplicate event ' + m[1]);
      ev[m[1]] = { paths: null, branches: null }; cur = ev[m[1]]; sub = null; continue;
    }
    if (!cur) throw new Error('workflow: content before any event: ' + l.trim());
    if ((m = /^ {4}(paths|branches|paths-ignore|[a-z_-]+):(.*)$/.exec(l))) {
      const key = m[1], rest = m[2].trim();
      if (key === 'paths') {
        if (rest !== '' || cur.paths) throw new Error('workflow: malformed or duplicate paths');
        cur.paths = []; sub = 'paths';
      } else if (key === 'branches') {
        if (cur.branches) throw new Error('workflow: duplicate branches');
        const b = /^\[([^\]]*)\]$/.exec(rest);
        if (!b) throw new Error('workflow: branches must be an inline list');
        cur.branches = b[1].split(',').map((x) => x.trim()); sub = null;
      } else throw new Error('workflow: unexpected key ' + key);
      continue;
    }
    if ((m = /^ {6}- '([^']+)'$/.exec(l))) {
      if (sub !== 'paths') throw new Error('workflow: list item outside paths: ' + l.trim());
      cur.paths.push(m[1]); continue;
    }
    throw new Error('workflow: unexpected line: ' + l.trim());
  }
  for (const k of ['pull_request', 'push', 'workflow_dispatch']) if (!ev[k]) throw new Error('workflow: missing event ' + k);
  for (const k of ['pull_request', 'push']) if (!ev[k].paths || ev[k].paths.length === 0) throw new Error('workflow: missing or empty paths list under ' + k);
  return ev;
}

// ---- matcher: literal paths, * (no slash) and ** (any), as documented by GitHub; anything else is refused -----------
function toRegExp(pattern) {
  if (!/^[A-Za-z0-9_.\/*-]+$/.test(pattern) || /\*\*\*/.test(pattern)) throw new Error('unsupported pattern character in: ' + pattern);
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') { if (pattern[i + 1] === '*') { re += '.*'; i++; } else re += '[^/]*'; }
    else re += c.replace(/[.\\^$+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
const matches = (patterns, path) => patterns.some((p) => toRegExp(p).test(path));
const changed = (pair) => (Array.isArray(pair) ? pair : [pair]); // a rename counts BOTH paths as changed (conservative)
const relevant = (patterns, pair) => changed(pair).some((p) => matches(patterns, p));

function checkLists(pr, push) {
  if (JSON.stringify(pr) !== JSON.stringify(push)) throw new Error('pull_request.paths and push.paths differ');
  if (JSON.stringify(pr) !== JSON.stringify(REQUIRED)) throw new Error('paths differ from the twelve required filters');
  return true;
}

const text = readFileSync(ROOT + WORKFLOW, 'utf8');
const ev = parseWorkflow(text);

test('1 identical lists: both events list the same twelve filters, in order', () => {
  assert.deepEqual(ev.pull_request.paths, ev.push.paths);
  assert.deepEqual(ev.pull_request.paths, REQUIRED);
  assert.equal(REQUIRED.length, 12);
  assert.equal(new Set(REQUIRED).size, 12);
});

test('2 parsing fails closed on any structure it does not expect', () => {
  const bad = {
    'unknown event': text.replace('  workflow_dispatch:', '  schedule:'),
    'paths-ignore': text.replace("    paths:\n      - 'apps/clay.html'", "    paths-ignore:\n      - 'apps/clay.html'"),
    'missing paths list': text.replace(/ {4}paths:\n( {6}- '[^']+'\n)+ {2}push:/, '  push:'),
    'altered branches': text.replace('branches: [main]', 'branches: [main, other]') + '',
    'duplicate event': text.replace('  workflow_dispatch:', "  workflow_dispatch:\n  pull_request:\n    paths:\n      - 'x'"),
    'unquoted item': text.replace("- 'apps/clay.html'", '- apps/clay.html'),
    'no on key': text.replace('\non:\n', '\nrun:\n')
  };
  for (const [name, t] of Object.entries(bad)) {
    let threw = false, parsed = null;
    try { parsed = parseWorkflow(t); } catch { threw = true; }
    if (name === 'altered branches') assert.deepEqual(parsed.push.branches, ['main', 'other'], name); // parses, but item 11 then fails
    else assert.equal(threw, true, name);
  }
});

test('3 relevant trees are covered, including nested paths', () => {
  for (const p of ['apps/ingredient-intelligence/src/deep/nested/file.js', 'tests/clay/new.test.mjs', 'tests/clay/helpers/x.mjs', 'tests/clay-data/new.test.mjs', 'tests/clay-data/fixtures/x.json', 'apps/clay-data/src/x.js', 'apps/clay-data/schema/x.schema.json', 'data/clay/x.json', 'data/scents/x.json', 'data/safe-batch/x.json']) assert.equal(matches(ev.pull_request.paths, p), true, p);
  assert.equal(matches(ev.push.paths, 'tests/clay-data/fixtures/x.json'), true);
});

test('4 package.json and package-lock.json are covered, by exact name', () => {
  assert.equal(matches(ev.pull_request.paths, 'package.json'), true);
  assert.equal(matches(ev.pull_request.paths, 'package-lock.json'), true);
  assert.equal(REQUIRED.some((p) => p.includes('package*')), false);
});

test('5 the workflow file matches its own filter', () => {
  assert.equal(matches(ev.pull_request.paths, WORKFLOW), true);
  assert.equal(matches(ev.push.paths, WORKFLOW), true);
});

test('6 harness files (categories A, B, run configuration, referenced by the app) each match a filter', () => {
  for (const [group, list] of Object.entries({ EXECUTED_TESTS, LOADED_DEPENDENCIES, RUN_CONFIGURATION, REFERENCED_BY_APP })) {
    for (const p of list) { assert.equal(matches(ev.pull_request.paths, p), true, group + ': ' + p); assert.equal(matches(ev.push.paths, p), true, group + ': ' + p); }
  }
});

test('7 rename pairs: both the old and the new path count as changed; whichever side is relevant matches', () => {
  const f = ev.pull_request.paths;
  assert.equal(relevant(f, ['tests/clay/a.test.mjs', 'tests/clay-data/a.test.mjs']), true); // in to in
  assert.equal(relevant(f, ['tests/clay/a.test.mjs', 'docs/a.md']), true); // in to outside
  assert.equal(relevant(f, ['docs/a.md', 'apps/clay-data/src/a.js']), true); // outside to in
  assert.equal(relevant(f, ['docs/a.md', 'docs/b.md']), false); // outside to outside
  assert.equal(relevant(f, 'index/clay/products/names.json'), false);
});

test('8 mutation check: removing any one required line makes the check fail; the committed workflow is untouched', () => {
  assert.equal(checkLists(ev.pull_request.paths, ev.push.paths), true);
  for (let i = 0; i < REQUIRED.length; i++) {
    const cut = REQUIRED.filter((_, j) => j !== i);
    assert.throws(() => checkLists(cut, cut), /required filters/, REQUIRED[i]);
    assert.throws(() => checkLists(cut, REQUIRED), /differ/, REQUIRED[i]);
  }
  assert.equal(readFileSync(ROOT + WORKFLOW, 'utf8'), text);
});

test('9 matcher scope: only literal paths, * and ** are supported; the workflow uses nothing else', () => {
  for (const p of [...ev.pull_request.paths, ...ev.push.paths]) assert.doesNotThrow(() => toRegExp(p), p);
  for (const bad of ['a?b', 'a[b]', '!a', 'a{b,c}', 'a+b', '**/*.js ', 'a***b', 'a b']) assert.throws(() => toRegExp(bad), /unsupported/, bad);
  assert.equal(toRegExp('tests/clay/**').test('tests/clay/a/b/c.mjs'), true);
  assert.equal(toRegExp('tests/*.js').test('tests/a/b.js'), false);
  assert.equal(toRegExp('tests/*.js').test('tests/b.js'), true);
  assert.equal(toRegExp('package.json').test('packageXjson'), false);
});

test('10 the header states the limits', () => {
  const header = readFileSync(new URL(import.meta.url), 'utf8').split('\nimport ')[0];
  for (const phrase of ['1,000 commits', '3,000 files', 'cannot detect a NEW loaded dependency', 'BRANCH RESTRICTION', '[skip ci]', 'unconfirmed']) assert.ok(header.includes(phrase), phrase);
});

test('11 branch configuration is recorded, not changed: push is main only; pull_request has no branches; workflow_dispatch has no paths', () => {
  assert.deepEqual(ev.push.branches, ['main']);
  assert.equal(ev.pull_request.branches, null);
  assert.equal(ev.workflow_dispatch.paths, null);
  assert.equal(ev.workflow_dispatch.branches, null);
});

test('12 every listed path exists, and the tests/clay directory matches the executed list plus this file', () => {
  for (const [group, list] of Object.entries({ EXECUTED_TESTS, LOADED_DEPENDENCIES, RUN_CONFIGURATION, REFERENCED_BY_APP, KNOWN_UNCOVERED })) {
    for (const p of list) assert.equal(existsSync(ROOT + p), true, group + ': ' + p + ' is listed but does not exist');
  }
  const onDisk = readdirSync(ROOT + 'tests/clay').filter((f) => f.endsWith('.test.mjs')).sort();
  const listed = [...EXECUTED_TESTS.filter((p) => p.startsWith('tests/clay/')).map((p) => p.slice('tests/clay/'.length)), 'ci-paths.test.mjs'].sort();
  assert.deepEqual(onDisk, listed);
});

test('13 the known gap stays outside the filters, so a later filter change is noticed', () => {
  for (const p of KNOWN_UNCOVERED) { assert.equal(matches(ev.pull_request.paths, p), false, p); assert.equal(matches(ev.push.paths, p), false, p); }
});
