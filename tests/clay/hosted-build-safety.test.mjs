// Output-folder safety and seed parsing for scripts/build-clay-hosted.mjs.
// Unsafe paths are exercised ONLY through the pure assertSafeOutDir() (it touches nothing), against the real
// repo root; every test that actually builds or deletes uses a fresh temp folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHosted, assertSafeOutDir, parseSeedRows, readOriginalSeedNames, MARKER_NAME, REPO_ROOT } from '../../scripts/build-clay-hosted.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clay-safety-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const refused = (p, root) => assert.throws(() => assertSafeOutDir(p, root), (e) => e.code === 'UNSAFE_OUT', `should refuse: ${p}`);
const R = REPO_ROOT;

test('[safety] repository root, its parents, filesystem root and empty paths are refused', () => {
  for (const p of [R, R + '/', path.join(R, '.'), path.dirname(R), path.dirname(path.dirname(R)), path.parse(R).root, '', '   ']) refused(p, R);
  refused(undefined, R);
});

test('[safety] any source file or folder inside the repo is refused (only hosted/<name> is allowed)', () => {
  for (const d of ['apps', 'apps/clay-hosted', 'apps/clay.html', 'data', 'index', 'tests', 'tests/clay', 'scripts', 'docs', '.git', '.github', 'node_modules', 'hosted', 'hosted/..', 'hosted/../apps', 'hosted/clay/../../data']) refused(path.join(R, d), R);
});

test('[safety] hosted/<name> and temp folders are accepted', () => {
  for (const p of [path.join(R, 'hosted', 'clay'), path.join(R, 'hosted', 'other'), path.join(os.tmpdir(), 'clay-x'), path.join(os.tmpdir(), 'a', 'b', 'c')]) assert.equal(assertSafeOutDir(p, R), path.resolve(p));
});

test('[safety] a symlink to the repo root (or into a source folder) is refused; so are file paths and symlinked outputs', () => {
  const d = tmp();
  try {
    fs.symlinkSync(R, path.join(d, 'to-root'));
    fs.symlinkSync(path.join(R, 'apps'), path.join(d, 'to-apps'));
    refused(path.join(d, 'to-root'), R);
    refused(path.join(d, 'to-apps'), R);
    refused(path.join(d, 'to-root', 'x'), R);   // a new child beneath a symlink into the repo resolves into the repo
    fs.writeFileSync(path.join(d, 'file.txt'), 'x');
    refused(path.join(d, 'file.txt'), R);
    const real = path.join(d, 'real'); fs.mkdirSync(real);
    fs.symlinkSync(real, path.join(d, 'link-to-real'));
    refused(path.join(d, 'link-to-real'), R);
  } finally { rm(d); }
});

test('[safety] a symlinked parent of the repo is still recognised as a parent (repo copied into a temp tree)', () => {
  const d = tmp();
  try {
    const repo = path.join(d, 'repo'); fs.mkdirSync(path.join(repo, 'apps'), { recursive: true });
    const alias = path.join(d, 'alias'); fs.symlinkSync(d, alias);
    refused(d, repo); refused(alias, repo); refused(repo, repo);
    refused(path.join(alias, 'repo', 'apps'), repo);
  } finally { rm(d); }
});

test('[safety] an unsafe path never reaches the build: buildHosted throws before reading or writing anything', () => {
  const d = tmp();
  try {
    const guarded = path.join(d, 'guarded'); fs.mkdirSync(guarded); fs.writeFileSync(path.join(guarded, 'keep.txt'), 'keep');
    // Fake repo root = d, so "d" itself is the root and must be refused without touching its contents.
    assert.throws(() => buildHosted({ outDir: d, repoRoot: d }), (e) => e.code === 'UNSAFE_OUT');
    assert.throws(() => buildHosted({ outDir: path.dirname(d), repoRoot: d }), (e) => e.code === 'UNSAFE_OUT');
    assert.equal(fs.readFileSync(path.join(guarded, 'keep.txt'), 'utf8'), 'keep');
    assert.deepEqual(fs.readdirSync(d), ['guarded']);
  } finally { rm(d); }
});

test('[safety] a non-empty folder with no marker is refused and left exactly as it was', () => {
  const d = tmp();
  try {
    fs.mkdirSync(path.join(d, 'sub')); fs.writeFileSync(path.join(d, 'sub', 'a.txt'), 'A'); fs.writeFileSync(path.join(d, 'b.txt'), 'B');
    assert.throws(() => buildHosted({ outDir: d }), (e) => e.code === 'UNSAFE_OUT' && /not created by this tool/.test(e.message));
    assert.deepEqual(fs.readdirSync(d).sort(), ['b.txt', 'sub']);
    assert.equal(fs.readFileSync(path.join(d, 'sub', 'a.txt'), 'utf8'), 'A');
  } finally { rm(d); }
});

test('[safety] a folder with a forged or foreign marker is refused and left intact', () => {
  const d = tmp();
  try {
    fs.writeFileSync(path.join(d, MARKER_NAME), '{"id":"something-else"}'); fs.writeFileSync(path.join(d, 'index.html'), 'mine');
    assert.throws(() => buildHosted({ outDir: d }), (e) => e.code === 'UNSAFE_OUT' && /marker/.test(e.message));
    fs.writeFileSync(path.join(d, MARKER_NAME), 'not json');
    assert.throws(() => buildHosted({ outDir: d }), (e) => e.code === 'UNSAFE_OUT');
    assert.equal(fs.readFileSync(path.join(d, 'index.html'), 'utf8'), 'mine');
  } finally { rm(d); }
});

test('[safety] a correctly marked folder that also holds a foreign file is refused and nothing is deleted', () => {
  const d = tmp();
  try {
    buildHosted({ outDir: d });
    fs.writeFileSync(path.join(d, 'my-notes.txt'), 'precious');
    const before = fs.readdirSync(d).sort();
    assert.throws(() => buildHosted({ outDir: d }), (e) => e.code === 'UNSAFE_OUT' && /did not generate/.test(e.message));
    assert.deepEqual(fs.readdirSync(d).sort(), before);
    assert.equal(fs.readFileSync(path.join(d, 'my-notes.txt'), 'utf8'), 'precious');
    assert.ok(fs.existsSync(path.join(d, 'index.html')), 'previous build left in place');
  } finally { rm(d); }
});

test('[safety] a marked folder containing a symlink is refused before any deletion', () => {
  const d = tmp(), outside = tmp();
  try {
    buildHosted({ outDir: d });
    fs.writeFileSync(path.join(outside, 'victim.txt'), 'victim');
    fs.rmSync(path.join(d, 'data'), { recursive: true }); fs.symlinkSync(outside, path.join(d, 'data'));
    assert.throws(() => buildHosted({ outDir: d }), (e) => e.code === 'UNSAFE_OUT' && /symbolic link/.test(e.message));
    assert.equal(fs.readFileSync(path.join(outside, 'victim.txt'), 'utf8'), 'victim');
  } finally { rm(d); rm(outside); }
});

test('[safe repeat] new, empty and previously generated folders all build; stale generated files are cleaned; the marker is kept', () => {
  const d = tmp();
  try {
    const out = path.join(d, 'new');
    buildHosted({ outDir: out });                       // new folder
    assert.ok(fs.existsSync(path.join(out, MARKER_NAME)));
    const first = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    fs.writeFileSync(path.join(out, 'data', 'stale.json'), '{}'); fs.writeFileSync(path.join(out, 'robots.txt'), 'old');
    buildHosted({ outDir: out });                       // marked folder, repeat
    assert.ok(!fs.existsSync(path.join(out, 'data', 'stale.json')), 'stale generated file removed');
    assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), first, 'deterministic');
    const empty = path.join(d, 'empty'); fs.mkdirSync(empty);
    buildHosted({ outDir: empty });                     // existing empty folder
    assert.ok(fs.existsSync(path.join(empty, 'index.html')));
  } finally { rm(d); }
});

test('[safe repeat] building never changes the source Clay files', () => {
  const files = ['apps/clay.html', 'apps/clay-web.html'].map((f) => path.join(R, f));
  const before = files.map((f) => fs.readFileSync(f));
  const d = tmp();
  try { buildHosted({ outDir: path.join(d, 'o') }); buildHosted({ outDir: path.join(d, 'o') }); } finally { rm(d); }
  files.forEach((f, i) => assert.ok(before[i].equals(fs.readFileSync(f)), f + ' changed'));
});

test('[safety] the only recursive deletion is inside prepareOutDir, after the marker and unknown-entry checks; buildHosted validates first', () => {
  const src = fs.readFileSync(path.join(R, 'scripts', 'build-clay-hosted.mjs'), 'utf8');
  assert.equal((src.match(/fs\.rmSync\(/g) || []).length, 1, 'exactly one rmSync');
  const rmAt = src.indexOf('fs.rmSync(');
  const prep = src.indexOf('function prepareOutDir');
  for (const needle of ['MARKER_ID', 'unknown.length', 'isSymbolicLink']) assert.ok(src.indexOf(needle, prep) > prep && src.indexOf(needle, prep) < rmAt, `${needle} must be checked before the deletion`);
  assert.ok(!/rmSync\(\s*(out|outDir)\s*,/.test(src), 'the output folder itself is never removed');
  const bh = src.indexOf('export function buildHosted');
  assert.ok(src.indexOf('assertSafeOutDir(outDir, repoRoot)', bh) < src.indexOf('readFileSync', bh), 'path is validated before anything is read');
  assert.ok(src.indexOf('assertSafeOutDir(outDir, repoRoot)', bh) < src.indexOf('prepareOutDir(out)', bh));
});

test('[cli] unsafe --out exits non-zero and names the reason; missing value is rejected (only temp and refused paths used)', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = path.join(R, 'scripts', 'build-clay-hosted.mjs');
  const bad = spawnSync(process.execPath, [script, '--out', R], { encoding: 'utf8' });
  assert.equal(bad.status, 2); assert.match(bad.stderr, /repository root/);
  const parent = spawnSync(process.execPath, [script, '--out', path.dirname(R)], { encoding: 'utf8' });
  assert.equal(parent.status, 2); assert.match(parent.stderr, /parent of the repository/);
  const none = spawnSync(process.execPath, [script, '--out'], { encoding: 'utf8' });
  assert.equal(none.status, 2); assert.match(none.stderr, /needs a folder path/);
  assert.ok(fs.existsSync(path.join(R, 'apps', 'clay.html')) && fs.existsSync(path.join(R, 'data')), 'repo intact');
});

// ---- seed parsing: no evaluation ----------------------------------------------------------------------
test('[parser] reads the real seed names without executing the source', () => {
  const src = fs.readFileSync(path.join(R, 'apps', 'clay.html'), 'utf8');
  const names = readOriginalSeedNames(src);
  assert.ok(names.length >= 10 && names.every((n) => typeof n === 'string' && n));
  assert.ok(!/new Function|\beval\(/.test(fs.readFileSync(path.join(R, 'scripts', 'build-clay-hosted.mjs'), 'utf8').replace(/\/\/.*$/gm, '')), 'no evaluation in the build script');
});

test('[parser] handles quotes, escapes, commas and nested brackets inside strings', () => {
  const t = `const MP_SEED=[['A','Step',"It's \\"quoted\\", ok [x]",'ok'],['B','S2','Plain\\\\','x']];`;
  const { rows, end } = parseSeedRows(t, t.indexOf('[')); 
  assert.deepEqual(rows, [['A', 'Step', `It's "quoted", ok [x]`, 'ok'], ['B', 'S2', 'Plain\\', 'x']]);
  assert.equal(t[end], ';');
});

test('[parser] refuses anything that is not plain string rows: code, calls, templates, comments, numbers, unterminated input', () => {
  const bad = [
    `[[process.exit(1),'a','b','c']]`, `[['a'+'b','s','n','x']]`, "[[`tpl`,'s','n','x']]", `[['a','s','n','x'], // c\n]`, `[['a','s','n',1]]`,
    `[['a','s','n','x']`, `[['a','s','n','x'],()=>1]`, `[['unterminated,'s']]`, `[['a','s','n','x']]]`.slice(0, 5), `{}`,
  ];
  for (const b of bad) assert.throws(() => parseSeedRows(b, 0), undefined, 'should reject: ' + b);
});

test('[parser] has no side effects: hostile source text is inert', () => {
  globalThis.__clay_pwned = false;
  const hostile = `const MP_SEED=[['a','s',(globalThis.__clay_pwned=true,'n'),'x']];`;
  assert.throws(() => readOriginalSeedNames(hostile));
  assert.equal(globalThis.__clay_pwned, false);
  delete globalThis.__clay_pwned;
});
