// Builds the standalone, static-host Clay preview (Cloudflare Pages compatible) from apps/clay.html.
//
//   node scripts/build-clay-hosted.mjs              writes hosted/clay/
//   node scripts/build-clay-hosted.mjs --out <dir>  writes somewhere else
//
// READ-ONLY on the source: apps/clay.html and apps/clay-web.html are never written. The output is
// generated, git-ignored, and made only of: one page, a few public reference files, and two small
// config files. It uses synthetic demo data and has no Claude artifact runtime and no Supabase.
//
// Output safety: --out is checked by assertSafeOutDir() before anything is read or written. It must be
// outside the repository, or a sub-folder of hosted/. An existing folder is only ever refreshed when it
// carries this tool's marker file and holds nothing but files this tool generates. The output folder
// itself is never deleted, and no arbitrary folder is ever deleted recursively.
//
// The page is derived, not forked: each change below is an exact, asserted patch of apps/clay.html.
// If clay.html changes so a patch no longer matches exactly once, the build fails loudly instead of
// silently shipping something unreviewed. Node built-ins only (no npm install needed to build).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');
export const DEFAULT_OUT = path.join(REPO_ROOT, 'hosted', 'clay');

// Public reference files the page actually requests (checked by the tests: no 404s while browsing).
// Deliberately NOT included: data/clay/my_products_seed.json (a personal shelf seed), anything under
// data/users, index/added_products.json, or any other file the page does not ask for.
export const COPY_FILES = [
  'version.json',
  'data/clay/hair_tips.json',
  'data/clay/hair_wash_steps.json',
  'data/clay/product_steps.json',
  'data/clay/feel_words.json',
  'data/safe-batch/scent_families.json',
  'data/safe-batch/product_actives.json',
  'data/safe-batch/product_hype_flags.json',
  'data/safe-batch/proof_grades.json',
  'data/scents/twins.json',
  'data/scents/houses.json',
  'data/scents/traditions.json',
  'data/scents/rates.json',
];
export const COPY_DIRS = ['index/clay/products'];

// Things that must never appear in the hosted output (the tests re-check this on the built page).
export const FORBIDDEN = [
  /window\.claude/, /claude\.use\s*\(/, /\.use\(\s*['"](?:db|user|comments)['"]\s*\)/,
  /onSnapshot/, /\.collection\(/, /data\/users\//,
  /raw\.githubusercontent\.com/, /supabase/i, /claudeusercontent/,
  /my_products_seed/,
];

const HEADERS = `/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex, nofollow
`;

const ROBOTS = 'User-agent: *\nDisallow: /\n';

const BANNER = '<div id="demo-banner" role="note" style="background:#ece6dc;color:#5a5249;border-bottom:1px solid #d9d1c5;font:600 12px/1.4 \'Nunito Sans\',system-ui,sans-serif;padding:6px 12px;text-align:center">Demo preview · starts with synthetic sample data · your changes stay in this browser</div>\n';

function once(src, needle, label) {
  const first = src.indexOf(needle);
  if (first < 0) throw new Error(`patch "${label}": text not found in apps/clay.html`);
  if (src.indexOf(needle, first + 1) >= 0) throw new Error(`patch "${label}": text found more than once`);
  return first;
}
const replaceOnce = (src, needle, repl, label) => { const i = once(src, needle, label); return src.slice(0, i) + repl + src.slice(i + needle.length); };
function replaceBetween(src, start, end, repl, label) {
  const i = once(src, start, label);
  const j = src.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`patch "${label}": end marker not found after start`);
  return src.slice(0, i) + repl + src.slice(j + end.length);
}
function replaceLine(src, startsWith, repl, label) {
  const re = new RegExp('^' + startsWith.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$', 'gm');
  const hits = [...src.matchAll(re)];
  if (hits.length !== 1) throw new Error(`patch "${label}": expected exactly one line, found ${hits.length}`);
  return src.slice(0, hits[0].index) + repl + src.slice(hits[0].index + hits[0][0].length);
}

export const quotedLiteralPresent = (text, name) => ["'", '"', '`'].some((q) => text.includes(q + name + q));

// Non-evaluating parser for the one known seed shape: [ ['area','step','name','status'], ... ]
// Only quoted strings, commas, brackets and whitespace are accepted. Anything else (code, comments,
// template strings, numbers, unknown escapes) throws. The HTML source is never executed.
export function parseSeedRows(text, start = 0) {
  let i = start;
  const fail = (m) => { throw new Error(`seed parser: ${m} at offset ${i}`); };
  const ws = () => { while (i < text.length && ' \t\r\n'.includes(text[i])) i++; };
  const expect = (c) => { ws(); if (text[i] !== c) fail(`expected "${c}"`); i++; };
  const str = () => {
    ws();
    const q = text[i];
    if (q !== "'" && q !== '"') fail('expected a quoted string');
    i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail('unterminated string');
      const c = text[i++];
      if (c === q) return out;
      if (c === '\n') fail('newline inside string');
      if (c === '\\') {
        const n = text[i++];
        const map = { n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"' };
        if (!Object.hasOwn(map, n)) fail(`unsupported escape \\${n}`);
        out += map[n];
      } else out += c;
    }
  };
  expect('[');
  const rows = [];
  for (;;) {
    ws();
    if (text[i] === ']') { i++; break; }
    expect('[');
    const row = [];
    for (;;) {
      row.push(str());
      ws();
      if (text[i] === ',') { i++; ws(); if (text[i] === ']') break; continue; }
      break;
    }
    expect(']');
    if (row.length !== 4) fail('each seed row must have exactly 4 strings');
    rows.push(row);
    ws();
    if (text[i] === ',') i++;
    else if (text[i] !== ']') fail('expected "," or "]"');
  }
  return { rows, end: i };
}

const SEED_DECL = 'const MP_SEED=';
export function readOriginalSeedNames(src) {
  const at = src.indexOf(SEED_DECL);
  if (at < 0) throw new Error('MP_SEED not found');
  return parseSeedRows(src, at + SEED_DECL.length).rows.map((r) => r[2]);
}

// ---- output directory safety -------------------------------------------------------------------
export const MARKER_NAME = '.clay-hosted-preview';
const MARKER_ID = 'clay-hosted-preview/v2';

const unsafe = (why) => Object.assign(new Error(`Refusing to use this output folder: ${why}`), { code: 'UNSAFE_OUT' });

// Resolves symlinks on the longest part of the path that already exists.
function realish(p) {
  let cur = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(cur) && path.dirname(cur) !== cur) { tail.unshift(path.basename(cur)); cur = path.dirname(cur); }
  return path.join(fs.realpathSync(cur), ...tail);
}

// Pure check: touches nothing. Returns the resolved output path or throws UNSAFE_OUT.
export function assertSafeOutDir(outDir, repoRoot = REPO_ROOT) {
  if (typeof outDir !== 'string' || !outDir.trim()) throw unsafe('the path is empty');
  const root = realish(repoRoot);
  const abs = path.resolve(outDir);
  const out = realish(abs);
  if (out === path.parse(out).root) throw unsafe('that is a filesystem root');
  if (out === root) throw unsafe('that is the repository root');
  if (root.startsWith(out + path.sep)) throw unsafe('that is a parent of the repository');
  if (out.startsWith(root + path.sep)) {
    const rel = path.relative(root, out).split(path.sep);
    if (rel[0] !== 'hosted' || rel.length < 2) throw unsafe('inside the repository only hosted/<name> may be used; anything else overlaps source files or folders');
  }
  if (fs.existsSync(abs)) {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) throw unsafe('that is a symbolic link');
    if (!st.isDirectory()) throw unsafe('that is a file, not a folder');
  }
  return out;
}

// ---- manifest-checked cleanup ------------------------------------------------------------------------
// The marker holds the exact list of files the previous build wrote. Before anything is deleted, every
// descendant of the output folder is enumerated (without following symlinks) and checked against that list.
const toPosix = (rel) => rel.split(path.sep).join('/');

function walkNoFollow(root) {
  const out = [];
  const rec = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const st = fs.lstatSync(abs);
      const rel = toPosix(path.relative(root, abs));
      out.push({ rel, abs, type: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other' });
      if (st.isDirectory()) rec(abs);
    }
  };
  rec(root);
  return out;
}

function writeMarker(out, files = []) {
  fs.writeFileSync(path.join(out, MARKER_NAME), JSON.stringify({ id: MARKER_ID, generator: 'scripts/build-clay-hosted.mjs', note: 'Generated Clay hosted preview. Safe to rebuild.', files: [...files].sort() }, null, 2) + '\n');
}

// Everything this build wrote (the output folder was verified empty or ours at the start). Marker excluded.
const listGenerated = (out) => walkNoFollow(out).filter((e) => e.type === 'file' && e.rel !== MARKER_NAME).map((e) => e.rel);

// The only paths this builder can generate, derived from its own code and the repo's current product index,
// never from the output folder or its marker.
export function permittedPaths(repoRoot = REPO_ROOT) {
  const set = new Set(['index.html', '_headers', 'robots.txt', 'build-info.json', ...COPY_FILES]);
  for (const d of COPY_DIRS) for (const f of fs.readdirSync(path.join(repoRoot, d)).filter((n) => n.endsWith('.json'))) set.add(`${d}/${f}`);
  return set;
}

// Pure: returns { files, dirs } to remove, or throws UNSAFE_OUT without having touched anything.
// The marker's list is only a record: it can narrow what may be deleted, never widen it beyond permittedPaths().
export function planCleanup(out, repoRoot = REPO_ROOT) {
  const permitted = permittedPaths(repoRoot);
  let marker;
  try { marker = JSON.parse(fs.readFileSync(path.join(out, MARKER_NAME), 'utf8')); } catch { marker = null; }
  if (!marker || marker.id !== MARKER_ID || !Array.isArray(marker.files)) throw unsafe('its marker file is not a Clay hosted preview marker for this version. Nothing was deleted');
  const listed = new Set();
  for (const f of marker.files) {
    if (typeof f !== 'string' || !f || f.startsWith('/') || f.includes('\\') || f.split('/').some((x) => x === '' || x === '.' || x === '..') || f === MARKER_NAME) throw unsafe('its marker lists an invalid path. Nothing was deleted');
    if (!permitted.has(f)) throw unsafe(`its marker lists ${f}, which this builder cannot generate. Nothing was deleted; clean the folder manually`);
    listed.add(f);
  }
  const listedDirs = new Set();
  for (const f of listed) { const parts = f.split('/'); for (let i = 1; i < parts.length; i++) listedDirs.add(parts.slice(0, i).join('/')); }
  const found = walkNoFollow(out).filter((e) => e.rel !== MARKER_NAME);
  const bad = [];
  for (const e of found) {
    if (e.type === 'symlink' || e.type === 'other') bad.push(`${e.rel} (${e.type === 'symlink' ? 'symbolic link' : 'not a regular file'})`);
    else if (e.type === 'file' && !(listed.has(e.rel) && permitted.has(e.rel))) bad.push(`${e.rel} (unexpected file)`);
    else if (e.type === 'dir' && !listedDirs.has(e.rel)) bad.push(`${e.rel}/ (unexpected folder)`);
  }
  if (bad.length) throw unsafe(`it contains entries this tool did not generate: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? `, and ${bad.length - 5} more` : ''}. Nothing was deleted`);
  return { files: found.filter((e) => e.type === 'file').map((e) => e.abs), dirs: found.filter((e) => e.type === 'dir').map((e) => e.abs).sort((x, y) => y.length - x.length) };
}

// The only place anything is deleted: individually verified files, then folders that are then empty.
// There is no recursive removal anywhere in this script.
function prepareOutDir(out, repoRoot) {
  if (!fs.existsSync(out)) { fs.mkdirSync(out, { recursive: true }); writeMarker(out); return; }
  const entries = fs.readdirSync(out);
  if (entries.length === 0) { writeMarker(out); return; }
  if (!entries.includes(MARKER_NAME)) throw unsafe('it already exists, is not empty, and was not created by this tool (no marker file). Choose a new or empty folder');
  const plan = planCleanup(out, repoRoot);   // every descendant checked before the first deletion
  for (const f of plan.files) fs.unlinkSync(f);
  for (const d of plan.dirs) fs.rmdirSync(d);
  writeMarker(out);
}

export function buildHosted({ outDir = DEFAULT_OUT, repoRoot = REPO_ROOT } = {}) {
  const out = assertSafeOutDir(outDir, repoRoot);   // first: nothing is read or written before the path is accepted
  const srcPath = path.join(repoRoot, 'apps', 'clay.html');
  const raw = fs.readFileSync(srcPath, 'utf8');
  const seedDoc = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps', 'clay-hosted', 'demo-seed.json'), 'utf8'));
  if (seedDoc.synthetic !== true) throw new Error('demo-seed.json must be marked synthetic');
  for (const [a, st, n, s] of seedDoc.shelf) {
    if (!n.startsWith('Synthetic ')) throw new Error(`demo seed name must start with "Synthetic ": ${n}`);
    if (!['cur', 'have', 'past', 'next'].includes(s)) throw new Error(`demo seed status invalid: ${n}`);
    if (typeof a !== 'string' || typeof st !== 'string') throw new Error(`demo seed row malformed: ${n}`);
  }
  const originalNames = readOriginalSeedNames(raw);
  const patches = [];
  let s = raw;
  const apply = (label, fn) => { s = fn(s); patches.push(label); };

  apply('head: noindex, hosted marker, proper <title>', (x) => replaceOnce(x, '</head><body>\n<title>Clay Web</title>',
    '<meta name="robots" content="noindex,nofollow"><meta name="clay-runtime" content="hosted-preview"><title>Clay Web (demo preview)</title></head><body>', 'head'));
  apply('banner: synthetic-data notice above the app', (x) => replaceOnce(x, '<div class="app" id="app">', BANNER + '<div class="app" id="app">', 'banner'));
  apply('sidebar: generic demo profile chip', (x) => replaceOnce(x,
    '<div class="profile-chip"><span class="avatar">N</span><span><b>Your profile</b><br><span class="small muted">Combination · barrier recovering</span></span></div>',
    '<div class="profile-chip"><span class="avatar">D</span><span><b>Demo profile</b><br><span class="small muted">Synthetic sample data</span></span></div>', 'profile chip'));
  apply('seed: replace the personal starter shelf with synthetic demo rows', (x) => {
    const at = once(x, SEED_DECL, 'MP_SEED');
    const { end } = parseSeedRows(x, at + SEED_DECL.length);   // parsed, never executed
    if (x[end] !== ';') throw new Error('patch "MP_SEED": expected ";" after the seed array');
    return x.slice(0, at) + SEED_DECL + JSON.stringify(seedDoc.shelf) + x.slice(end);
  });
  apply('migrations: drop personal rename map and name-based re-adds', (x) => {
    x = replaceLine(x, 'const MP_REN=', '/* hosted preview: no personal rename map */', 'MP_REN');
    x = replaceLine(x, 'MP.forEach(p=>{ if(MP_REN[p.n])', '/* hosted preview: no personal renames */', 'MP_REN apply');
    x = replaceLine(x, '[["Summer', '/* hosted preview: no name-based re-adds */', 'name re-adds');
    x = replaceLine(x, "try{ if(!localStorage.getItem('clay-mig-hato'))", '/* hosted preview: no personal one-off migration */', 'hato migration');
    return x;
  });
  apply('sync: remove the artifact-database sync layer (local saving only)', (x) => {
    x = replaceBetween(x, '/* ---------- Save to your Claude account (private to you, follows you across devices) ----------', 'empty snapshots cannot replace non-empty saved data. */',
      '/* ---------- Local saving in this browser (hosted preview; there is no account sync in this build) ---------- */', 'sync header');
    return replaceBetween(x, 'const csRef=k=>CSYNC.db.collection(', "\n    finally{ CSYNC.writing[k]=false; }\n  },1200);\n}\n",
      "function claySyncPush(k){ csStamp(k,Date.now()); }   /* hosted preview: nothing leaves this browser */\n", 'sync layer');
  });
  apply('boot: remove the artifact db/user hook block', (x) => replaceBetween(x, "(async()=>{\n  try{\n    const db=window.claude&&window.claude.use", "  }catch(e){ CSYNC.status='local'; }\n})();\n",
    "CSYNC.status='local';   /* hosted preview: no account, no remote documents */\n", 'boot hooks'));
  apply('comments: remove the Claude toolbar comment hook', (x) => {
    x = replaceOnce(x, "window.claude?.use?.('comments').then(api=>{ commentsApi = api; }).catch(()=>{});\n", '', 'comments hook');
    x = replaceOnce(x, 'let commentsApi = null;\n', '', 'commentsApi var');
    return replaceBetween(x, '    if (!commentsApi){', "catch(err){ if (err && err.code==='unavailable'){ commentsApi=null; } toast('Use the comment button in the Claude toolbar, then click this card'); }",
      "    toast('Comments are not part of the hosted preview.');", 'comment click');
  });
  apply('copy: replace Claude-account wording in the save note', (x) => replaceBetween(x, "${CSYNC.status==='synced'?'Saved to your Claude account", "to save to your account.'}",
    'Demo preview: this shelf starts with invented sample data. Anything you add or change is saved only in this browser. Nothing is sent anywhere.', 'save note'));
  apply('examples: neutralise unreferenced sample blocks (ROUTINE, SHELF, SHELFVIZ)', (x) => {
    if ((x.match(/\bshelfViz\(/g) || []).length !== 1) throw new Error('patch "dead samples": shelfViz() is now called somewhere; review before neutralising SHELFVIZ');
    for (const n of ['ROUTINE', 'SHELF']) if ((x.match(new RegExp('(?<![\\w$.\'"])' + n + '(?![\\w$\'"])', 'g')) || []).length !== 1) throw new Error(`patch "dead samples": ${n} is now referenced; review before neutralising`);
    x = replaceBetween(x, 'const ROUTINE = {', '\n};', 'const ROUTINE = {};   /* hosted preview: unreferenced sample block removed */', 'ROUTINE');
    x = replaceBetween(x, 'const SHELF = [', '\n];', 'const SHELF = [];   /* hosted preview: unreferenced sample block removed */', 'SHELF');
    return replaceBetween(x, 'const SHELFVIZ=[', '}];', 'const SHELFVIZ=[];   /* hosted preview: unreferenced sample block removed */', 'SHELFVIZ');
  });
  apply('examples: label invented content and drop fabricated user claims', (x) => {
    x = replaceOnce(x, "tag('From your Oct 13 scan','ok','scan')", "tag('Sample profile (demo)','ok','scan')", 'discover scan claim');
    x = replaceOnce(x, "const ownTag = own==='both'?tag('you own both','ok','check'):own==='one'?tag('you own one'):'';", "const ownTag = tag('sample pairing');", 'pair ownership claim');
    x = replaceOnce(x, "{h:'h3', style:`--season:${SEASON[s]}`})}\n    <section class=\"card stop\"", "{h:'h3', right:SAMPLE, style:`--season:${SEASON[s]}`})}\n    <section class=\"card stop\"", 'pairs label');
    x = replaceOnce(x, "<h3>Scent of the season</h3>${cmt('scent of the season')}", "<h3>Scent of the season</h3>${SAMPLE}${cmt('scent of the season')}", 'scent card label');
    return replaceOnce(x, "'Body only, on the side',`<div class=\"row\">${pack('pump','#C9A27E'", "'Sample idea · body only, on the side',`<div class=\"row\">${pack('pump','#C9A27E'", 'today scent label');
  });
  apply('data: same-origin only (no GitHub fallback)', (x) => {
    x = replaceOnce(x, 'const CLAY_GH="https://raw.githubusercontent.com/Arnitah/curated-database-/main/";\n', '', 'CLAY_GH');
    x = replaceOnce(x, '/* Data files are published next to the page (artifacts can\'t reach GitHub); GitHub is the fallback elsewhere */',
      '/* Data files are served from the same origin as the page; there is no other fallback */', 'data comment');
    return replaceOnce(x, 'const bases=window.CLAY_DATA_BASE?[window.CLAY_DATA_BASE]:["",CLAY_GH];', 'const bases=window.CLAY_DATA_BASE?[window.CLAY_DATA_BASE]:[""];', 'bases');
  });

  for (const re of FORBIDDEN) if (re.test(s)) throw new Error(`hosted page still matches forbidden pattern ${re}`);
  // A seed name may still appear inside general advice prose; what must be gone is any quoted record literal.
  for (const n of originalNames) for (const q of ["'", '"', '`']) if (s.includes(q + n + q)) throw new Error(`hosted page still contains an original seed record: ${n}`);

  prepareOutDir(out, repoRoot);   // the only deletion: manifest-checked files, never recursive
  try {
  fs.writeFileSync(path.join(out, 'index.html'), s);
  fs.writeFileSync(path.join(out, '_headers'), HEADERS);
  fs.writeFileSync(path.join(out, 'robots.txt'), ROBOTS);

  const copied = [];
  const copy = (rel) => {
    const from = path.join(repoRoot, rel), to = path.join(out, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied.push(rel);
  };
  for (const f of COPY_FILES) copy(f);
  for (const d of COPY_DIRS) for (const f of fs.readdirSync(path.join(repoRoot, d)).filter((n) => n.endsWith('.json')).sort()) copy(`${d}/${f}`);

  const info = {
    runtime: 'hosted-preview',
    starts_with_synthetic_demo_data: true,
    source: 'apps/clay.html',
    source_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    patches,
    copied_files: copied.length,
    note: 'Generated by scripts/build-clay-hosted.mjs. Contains no account data, no credentials and no Claude artifact runtime.',
  };
  fs.writeFileSync(path.join(out, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
  return { outDir: out, info, bytes: s.length };
  } finally {
    writeMarker(out, listGenerated(out));   // exact manifest of what this build wrote, even if it failed part-way
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--out');
  if (i > 0 && !process.argv[i + 1]) { console.error('--out needs a folder path'); process.exit(2); }
  const out = i > 0 ? process.argv[i + 1] : DEFAULT_OUT;
  let r;
  try { r = buildHosted({ outDir: out }); }
  catch (e) { console.error(e.message); process.exit(e.code === 'UNSAFE_OUT' ? 2 : 1); }
  console.log(`Built hosted Clay preview: ${path.relative(REPO_ROOT, r.outDir) || r.outDir}`);
  console.log(`  page ${r.bytes} chars, ${r.info.patches.length} patches, ${r.info.copied_files} data files, source sha256 ${r.info.source_sha256.slice(0, 12)}`);
}
