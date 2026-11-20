// Output-folder safety and seed parsing for scripts/build-clay-hosted.mjs.
// Unsafe paths are exercised ONLY through the pure assertSafeOutDir() (it touches nothing), against the real
// repo root; every test that actually builds or deletes uses a fresh temp folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHosted, assertSafeOutDir, planCleanup, permittedPaths, parseSeedRows, readOriginalSeedNames, MARKER_NAME, REPO_ROOT } from '../../scripts/build-clay-hosted.mjs';

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
    assert.throws(() => buildHosted({ outDir: d }), (e) => e.code === 'UNSAFE_OUT' && /did not generate|unexpected file/.test(e.message));
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

test('[safe repeat] new, empty and previously generated folders all build; the marker is kept', () => {
  const d = tmp();
  try {
    const out = path.join(d, 'new');
    buildHosted({ outDir: out });                       // new folder
    assert.ok(fs.existsSync(path.join(out, MARKER_NAME)));
    const first = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    buildHosted({ outDir: out });                       // marked folder, repeat
    assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), first, 'deterministic');
    fs.writeFileSync(path.join(out, 'data', 'stale.json'), '{}');   // not in the manifest: rejected, not silently deleted
    assert.throws(() => buildHosted({ outDir: out }), (e) => e.code === 'UNSAFE_OUT');
    assert.ok(fs.existsSync(path.join(out, 'data', 'stale.json')));
    fs.rmSync(path.join(out, 'data', 'stale.json'));
    buildHosted({ outDir: out });
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

test('[safety] the script has no recursive removal; deletion is per verified file after a full pre-check; buildHosted validates the path first', () => {
  const src = fs.readFileSync(path.join(R, 'scripts', 'build-clay-hosted.mjs'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/rmSync|recursive:\s*true\s*,?\s*force|rimraf/.test(src.replace(/mkdirSync\([^)]*recursive: true[^)]*\)/g, '')), 'no recursive deletion API');
  const prep = src.indexOf('function prepareOutDir');
  const plan = src.indexOf('planCleanup(out, repoRoot)', prep);
  assert.ok(plan > prep && plan < src.indexOf('unlinkSync', prep), 'planCleanup runs before the first unlink');
  assert.ok(plan < src.indexOf('rmdirSync', prep), 'planCleanup runs before the first rmdir');
  assert.equal((src.match(/unlinkSync\(/g) || []).length, 1);
  const bh = src.indexOf('export function buildHosted');
  assert.ok(src.indexOf('assertSafeOutDir(outDir, repoRoot)', bh) < src.indexOf('readFileSync', bh), 'path is validated before anything is read');
  assert.ok(src.indexOf('assertSafeOutDir(outDir, repoRoot)', bh) < src.indexOf('prepareOutDir(out, repoRoot)', bh));
});

// ---- nested entries: every descendant is checked before anything is deleted --------------------------------
const snapshot = (dir) => {
  const o = {};
  const rec = (d) => { for (const n of fs.readdirSync(d)) { const a = path.join(d, n), st = fs.lstatSync(a); const r = path.relative(dir, a); if (st.isSymbolicLink()) o[r] = 'LINK->' + fs.readlinkSync(a); else if (st.isDirectory()) { o[r] = 'DIR'; rec(a); } else o[r] = fs.readFileSync(a, 'utf8').length + ':' + fs.readFileSync(a, 'utf8').slice(0, 40); } };
  rec(dir); return o;
};
const rejectedRebuildKeepsEverything = (out, re) => {
  const before = snapshot(out);
  assert.throws(() => buildHosted({ outDir: out }), (e) => e.code === 'UNSAFE_OUT' && re.test(e.message));
  assert.deepEqual(snapshot(out), before, 'nothing deleted, nothing changed after the rejected rebuild');
};

test('[nested] a sentinel file inside data/ blocks the rebuild and survives; the previous build stays whole', () => {
  const d = tmp();
  try {
    const out = path.join(d, 'o'); buildHosted({ outDir: out });
    const s = path.join(out, 'data', 'clay', 'SENTINEL-data.txt'); fs.writeFileSync(s, 'do not delete');
    rejectedRebuildKeepsEverything(out, /data\/clay\/SENTINEL-data\.txt \(unexpected file\)/);
    assert.equal(fs.readFileSync(s, 'utf8'), 'do not delete');
    assert.ok(fs.existsSync(path.join(out, 'index.html')) && fs.existsSync(path.join(out, 'data', 'clay', 'hair_tips.json')));
  } finally { rm(d); }
});

test('[nested] a sentinel file inside index/ (deep, in a shard folder) blocks the rebuild and survives', () => {
  const d = tmp();
  try {
    const out = path.join(d, 'o'); buildHosted({ outDir: out });
    const s = path.join(out, 'index', 'clay', 'products', 'SENTINEL-index.json'); fs.writeFileSync(s, '{"keep":true}');
    rejectedRebuildKeepsEverything(out, /SENTINEL-index\.json \(unexpected file\)/);
    assert.equal(fs.readFileSync(s, 'utf8'), '{"keep":true}');
    const deep = path.join(out, 'index', 'clay', 'products', 'x', 'y'); fs.mkdirSync(deep, { recursive: true }); fs.writeFileSync(path.join(deep, 'SENTINEL-deep.txt'), 'deep');
    fs.rmSync(s);
    rejectedRebuildKeepsEverything(out, /index\/clay\/products\/x\/ \(unexpected folder\)/);
    assert.equal(fs.readFileSync(path.join(deep, 'SENTINEL-deep.txt'), 'utf8'), 'deep');
  } finally { rm(d); }
});

test('[nested] an unexpected empty folder, even one with no files in it, is rejected', () => {
  const d = tmp();
  try {
    const out = path.join(d, 'o'); buildHosted({ outDir: out });
    fs.mkdirSync(path.join(out, 'data', 'my-empty-folder'));
    rejectedRebuildKeepsEverything(out, /my-empty-folder\/ \(unexpected folder\)/);
  } finally { rm(d); }
});

test('[nested] a symlink at depth (file link, folder link, dangling link) is rejected and its target is untouched', () => {
  const d = tmp(), outside = tmp();
  try {
    const out = path.join(d, 'o'); buildHosted({ outDir: out });
    fs.writeFileSync(path.join(outside, 'victim.txt'), 'victim'); fs.mkdirSync(path.join(outside, 'dir')); fs.writeFileSync(path.join(outside, 'dir', 'v2.txt'), 'v2');
    for (const [rel, target] of [['data/clay/link-file', path.join(outside, 'victim.txt')], ['index/clay/products/link-dir', path.join(outside, 'dir')], ['data/scents/dangling', path.join(outside, 'nope')]]) {
      const l = path.join(out, rel); fs.symlinkSync(target, l);
      rejectedRebuildKeepsEverything(out, /symbolic link/);
      fs.unlinkSync(l);
    }
    assert.equal(fs.readFileSync(path.join(outside, 'victim.txt'), 'utf8'), 'victim');
    assert.equal(fs.readFileSync(path.join(outside, 'dir', 'v2.txt'), 'utf8'), 'v2');
    buildHosted({ outDir: out });   // with the links removed the rebuild is allowed again
  } finally { rm(d); rm(outside); }
});

test('[nested] a generated file replaced by a symlink to the same name is rejected, not followed', () => {
  const d = tmp(), outside = tmp();
  try {
    const out = path.join(d, 'o'); buildHosted({ outDir: out });
    fs.writeFileSync(path.join(outside, 'victim.txt'), 'victim');
    const f = path.join(out, 'data', 'clay', 'hair_tips.json'); fs.rmSync(f); fs.symlinkSync(path.join(outside, 'victim.txt'), f);
    rejectedRebuildKeepsEverything(out, /symbolic link/);
    assert.equal(fs.readFileSync(path.join(outside, 'victim.txt'), 'utf8'), 'victim');
  } finally { rm(d); rm(outside); }
});

test('[nested] a forged marker cannot widen the allowlist: bad paths are refused, and listed-but-absent files are harmless', () => {
  const d = tmp(), outside = tmp();
  try {
    const out = path.join(d, 'o'); buildHosted({ outDir: out });
    const mk = path.join(out, MARKER_NAME); const m = JSON.parse(fs.readFileSync(mk, 'utf8'));
    for (const bad of ['../escape.txt', '/etc/passwd', 'a//b', './x', 'data\\x', MARKER_NAME]) {
      fs.writeFileSync(mk, JSON.stringify({ ...m, files: [...m.files, bad] }));
      assert.throws(() => planCleanup(out), (e) => e.code === 'UNSAFE_OUT' && /invalid path/.test(e.message), bad);
    }
    fs.writeFileSync(mk, JSON.stringify({ ...m, files: [...m.files, 'data/listed-but-missing.json'] }));
    assert.throws(() => planCleanup(out), (e) => e.code === 'UNSAFE_OUT' && /cannot generate/.test(e.message));
    fs.writeFileSync(mk, JSON.stringify({ ...m, files: m.files.filter((x) => x !== 'data/clay/hair_tips.json') }));   // narrowing is allowed to plan, but then the real file is unlisted
    assert.throws(() => planCleanup(out), (e) => e.code === 'UNSAFE_OUT' && /hair_tips\.json \(unexpected file\)/.test(e.message));
    fs.writeFileSync(mk, JSON.stringify({ id: 'clay-hosted-preview/v1' }));   // old marker has no manifest
    assert.throws(() => planCleanup(out), (e) => e.code === 'UNSAFE_OUT');
    assert.ok(fs.existsSync(path.join(out, 'index.html')));
  } finally { rm(d); rm(outside); }
});

test('[nested] planCleanup is pure: it deletes nothing even when it approves, and the manifest equals the generated files', () => {
  const d = tmp();
  try {
    const out = path.join(d, 'o'); const r = buildHosted({ outDir: out });
    const before = snapshot(out);
    const plan = planCleanup(out);
    assert.deepEqual(snapshot(out), before);
    const m = JSON.parse(fs.readFileSync(path.join(out, MARKER_NAME), 'utf8'));
    assert.equal(m.id, 'clay-hosted-preview/v2');
    assert.deepEqual(m.files, plan.files.map((f) => path.relative(out, f).split(path.sep).join('/')).filter((x) => x !== MARKER_NAME).sort());
    assert.ok(m.files.includes('data/clay/hair_tips.json') && m.files.includes('index.html') && m.files.length > 50);
    assert.ok(r.info.copied_files > 50);
  } finally { rm(d); }
});

test('[nested] an older generated file that is no longer permitted is refused, not deleted, even when the marker lists it', () => {
  const d = tmp();
  try {
    const out = path.join(d, 'o'); buildHosted({ outDir: out });
    const m = path.join(out, MARKER_NAME); const meta = JSON.parse(fs.readFileSync(m, 'utf8'));
    fs.mkdirSync(path.join(out, 'data', 'old-gen'), { recursive: true }); fs.writeFileSync(path.join(out, 'data', 'old-gen', 'stale.json'), '{}');
    fs.writeFileSync(m, JSON.stringify({ ...meta, files: [...meta.files, 'data/old-gen/stale.json'] }));
    rejectedRebuildKeepsEverything(out, /cannot generate/);
    assert.ok(fs.existsSync(path.join(out, 'data', 'old-gen', 'stale.json')), 'manual cleanup required');
  } finally { rm(d); }
});

// ---- the marker is a record, never the authority -------------------------------------------------------
for (const rel of ['notes.txt', 'data/clay/unexpected.txt', 'index/clay/products/unexpected.json', 'data/safe-batch/my_products_seed.json', 'index.html.bak']) {
  test(`[manifest] editing the marker to list a foreign file (${rel}) does not make it deletable; the whole folder stays unchanged`, () => {
    const d = tmp();
    try {
      const out = path.join(d, 'o'); buildHosted({ outDir: out });
      const f = path.join(out, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'foreign sentinel');
      const mk = path.join(out, MARKER_NAME); const m = JSON.parse(fs.readFileSync(mk, 'utf8'));
      fs.writeFileSync(mk, JSON.stringify({ ...m, files: [...m.files, rel] }, null, 2));
      rejectedRebuildKeepsEverything(out, /cannot generate/);
      assert.equal(fs.readFileSync(f, 'utf8'), 'foreign sentinel');
      assert.ok(fs.existsSync(path.join(out, 'index.html')) && fs.existsSync(path.join(out, 'data', 'clay', 'hair_tips.json')), 'previous build intact');
      assert.throws(() => planCleanup(out), (e) => e.code === 'UNSAFE_OUT');
    } finally { rm(d); }
  });
}

test('[manifest] the permitted set is derived from the builder, not from any folder or marker, and covers exactly what a build writes', () => {
  const perm = permittedPaths();
  const d = tmp();
  try {
    const out = path.join(d, 'o'); buildHosted({ outDir: out });
    const m = JSON.parse(fs.readFileSync(path.join(out, MARKER_NAME), 'utf8'));
    assert.deepEqual([...m.files].sort(), [...perm].sort(), 'every generated file is permitted, and every permitted path is generated');
    for (const bad of ['data/clay/my_products_seed.json', 'index/added_products.json', 'notes.txt', MARKER_NAME]) assert.ok(!perm.has(bad), bad);
    const out2 = path.join(d, 'o2'); fs.mkdirSync(out2); fs.writeFileSync(path.join(out2, 'x'), 'x');
    assert.deepEqual([...permittedPaths()].sort(), [...perm].sort(), 'independent of folder contents');
  } finally { rm(d); }
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
