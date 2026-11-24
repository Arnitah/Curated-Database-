// The page is published through the Artifact tool, which wraps it in its own skeleton and REPLACES a skeleton it recognises.
// CSS that sits inside the skeleton's <style> is therefore lost (this is what left the week strip, scent stack cards and colour
// swatches unstyled on the live page until 22 Nov). These tests make sure the rules live in the page-owned <style>.
//
// HONEST SCOPE: the real wrapper runs inside the publishing service and is not in this repo. tests/clay/helpers/artifact-wrapper.mjs is a
// model of it. It is calibrated here against a real publish event: the file published on 15 Nov (repo commit cb95cf4) came back from the
// service with sha256 6156cb10…; the model must reproduce that exactly. That calibration needs git history (it skips on a shallow clone).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { startServer, REPO_ROOT } from './helpers/server.mjs';
import { launchBrowser, openClay } from './helpers/launch.mjs';
import { wrapAsArtifact, parts, SKELETON, RESET, HEAD } from './helpers/artifact-wrapper.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'apps/clay.html'), 'utf8');
// the five rule sets, as (selector, declarations that must be present in the page-owned stylesheet)
const RULES = [
  ['.wq-sw i', ['display:inline-block', 'width:12px', 'height:12px', 'border-radius:50%', 'background:var(--sw)']],
  ['.wk', ['display:flex', 'gap:6px', 'justify-content:space-between']],
  ['.wk-d', ['display:flex', 'flex-direction:column', 'align-items:center', 'flex:1']],
  ['.wk-d i', ['width:26px', 'height:26px', 'border-radius:50%', 'display:block']],
  ['.stack-grid', ['display:grid', 'grid-template-columns:repeat(auto-fill,minmax(210px,1fr))', 'gap:10px']],
  ['.stack-card', ['display:flex', 'flex-direction:column', 'border-radius:14px', 'padding:12px 14px']],
];
const ruleBody = (css, sel) => { const m = css.match(new RegExp('(?:^|[}\\s])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); return m ? m[1] : null; };
// the same rules as one block, for building the "defective" variant
const blockText = () => RULES.map(([s, d]) => `${s}{${d.join(';')}}`).join('');

test('[invariant] the candidate file already has the canonical skeleton, so the wrapper leaves it exactly as it is', () => {
  assert.ok(SRC.startsWith(SKELETON), 'apps/clay.html starts with the exact skeleton (doctype, two metas, the one reset style)');
  assert.equal(wrapAsArtifact(SRC), SRC, 'wrapping is the identity: nothing is dropped or re-nested');
});

test('[invariant] after the wrapper the skeleton stylesheet is the bare reset and the five rule sets sit in the page-owned stylesheet', () => {
  const w = wrapAsArtifact(SRC);
  assert.equal((w.match(/<!doctype/gi) || []).length, 1, 'one doctype');
  assert.equal((w.match(/<head>/g) || []).length, 1, 'one head');
  assert.equal(w.indexOf('<style>'), HEAD.length, 'the skeleton <style> is the first and only one in the head');
  const headEnd = w.indexOf('</head>');
  assert.equal(w.slice(0, headEnd).match(/<style/g).length, 1, 'exactly one <style> inside <head>');
  const skeletonCss = w.slice(HEAD.length + '<style>'.length, w.indexOf('</style>'));
  assert.equal(skeletonCss, RESET, 'skeleton stylesheet is exactly the reset, nothing appended');
  for (const [sel] of RULES) assert.equal(skeletonCss.includes(sel), false, `${sel} must not live in the skeleton`);
  const { pageCss, page } = parts(w);
  assert.ok(page.startsWith('\n<title>'), 'page content (title first) follows the skeleton');
  for (const [sel, decls] of RULES) {
    const body = ruleBody(pageCss, sel);
    assert.notEqual(body, null, `${sel} is defined in the page-owned stylesheet`);
    for (const d of decls) assert.ok(body.includes(d), `${sel} keeps "${d}"`);
    assert.equal(pageCss.split(new RegExp('(?:^|[}\\s])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{')).length - 1, 1, `${sel} is defined exactly once`);
  }
  assert.ok(/<\/body>\s*<\/html>\s*$/.test(w), 'document ends with </body></html>');
});

test('[invariant] the guard catches the original defect: rules placed in the skeleton stylesheet are dropped by the wrapper', () => {
  // rebuild the defective layout from the candidate: put the rules back after the reset, inside the skeleton <style>
  const stripped = SRC.replace(/\.wq-sw i\{[^\n]*\n\.stack-grid\{[^\n]*\n/, '');
  const hadBlock = /\.wq-sw i\{/.test(SRC.slice(SKELETON.length));
  assert.ok(hadBlock, 'precondition: the candidate defines the rules in the page stylesheet');
  const defective = SRC.replace(RESET + '</style>', RESET + blockText() + '</style>');
  assert.notEqual(defective, SRC);
  const w = wrapAsArtifact(defective);
  const skeletonCss = w.slice(HEAD.length + '<style>'.length, w.indexOf('</style>'));
  assert.equal(skeletonCss, RESET, 'wrapper replaces the skeleton');
  assert.ok(w.length < defective.length, 'the extra rules were discarded, not nested');
  // and if the page-owned copies were also missing (the real defect), the output would have no definition at all
  const withoutPageCopies = defective.replace(/\.wq-sw i\{[^\n]*\n\.stack-grid\{[^\n]*\n/, '\n');
  const w2 = parts(wrapAsArtifact(withoutPageCopies)).pageCss;
  for (const [sel] of RULES) assert.equal(ruleBody(w2, sel), null, `${sel} would be undefined after wrapping the defective layout`);
  void stripped;
});

test('[invariant] wrapper model calibration: it reproduces the real service output for the file published on 15 Nov', { skip: (() => { try { execFileSync('git', ['cat-file', '-e', 'cb95cf4a55f8926b8f8497d09a34891747757d4f'], { cwd: REPO_ROOT, stdio: 'ignore' }); return false; } catch { return 'git history (cb95cf4) not available in this checkout'; } })() }, () => {
  const old = execFileSync('git', ['show', 'cb95cf4a55f8926b8f8497d09a34891747757d4f:apps/clay.html'], { cwd: REPO_ROOT, maxBuffer: 64e6, encoding: 'utf8' });
  assert.equal(sha(old), '812ba3b8a7881169c615d54e776d5f1b21991f65a14c38ffab164679a57d06e2', 'input is the file that was published');
  const out = wrapAsArtifact(old);
  assert.equal(sha(out), '6156cb10089c8b0eb50fa4cdfe70718df94828da0a39b3d6be7536dbed3f6555', 'model output equals the stored live page (397,550 bytes) the service returned');
  assert.equal(Buffer.byteLength(out), 397550);
  for (const [sel] of RULES) assert.equal(ruleBody(parts(out).pageCss, sel), null, `${sel} was undefined in what the service stored`);
});

// ---- rendered appearance, in the page produced by the wrapper model --------------------------------------------------------------------
let srv, browser;
before(async () => { srv = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser.close(); await srv.close(); });

// uses the app's own renderers (welcomeCard, weekCard, stackCards) and reads computed styles
const probe = (page) => page.evaluate(() => {
  const k = yKey(new Date()); YLOG[k] = YLOG[k] && YLOG[k].length ? YLOG[k] : ['face-wash'];
  const box = document.createElement('div'); box.id = 'rcProbe'; document.body.appendChild(box);
  box.innerHTML = welcomeCard() + weekCard(true) + stackCards();
  const cs = (el) => getComputedStyle(el);
  const q = (s) => box.querySelector(s);
  const sw = q('.wq-sw i'), wk = q('.wk'), wkd = q('.wk-d'), wki = q('.wk-d i'), sg = q('.stack-grid'), sc = q('.stack-card');
  return {
    found: { sw: !!sw, wk: !!wk, wkd: !!wkd, wki: !!wki, sg: !!sg, sc: !!sc },
    sw: sw && { display: cs(sw).display, w: cs(sw).width, h: cs(sw).height, r: cs(sw).borderTopLeftRadius },
    wk: wk && { display: cs(wk).display, gap: cs(wk).columnGap },
    wkd: wkd && { display: cs(wkd).display, dir: cs(wkd).flexDirection },
    wki: wki && { display: cs(wki).display, w: cs(wki).width, h: cs(wki).height },
    sg: sg && { display: cs(sg).display, cols: cs(sg).gridTemplateColumns.split(' ').length },
    sc: sc && { display: cs(sc).display, dir: cs(sc).flexDirection, r: cs(sc).borderTopLeftRadius },
  };
});

test('[invariant] rendered in a browser from the wrapped output, swatches, week strip and scent stack cards are styled', async () => {
  const h = await openClay(browser, srv.base, { noClaude: true, html: wrapAsArtifact(SRC) });
  try {
    const r = await probe(h.page);
    assert.deepEqual(r.found, { sw: true, wk: true, wkd: true, wki: true, sg: true, sc: true }, 'the app renders all five kinds of element');
    assert.deepEqual({ w: r.sw.w, h: r.sw.h, r: r.sw.r }, { w: '12px', h: '12px', r: '50%' }, 'round 12px dot (display is blockified by its flex parent, so size and radius are what prove the rule applied)');
    assert.deepEqual(r.wk, { display: 'flex', gap: '6px' });
    assert.deepEqual(r.wkd, { display: 'flex', dir: 'column' });
    assert.deepEqual(r.wki, { display: 'block', w: '26px', h: '26px' });
    assert.equal(r.sg.display, 'grid'); assert.ok(r.sg.cols >= 1);
    assert.deepEqual(r.sc, { display: 'flex', dir: 'column', r: '14px' });
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('[invariant] rendered output of the original defect (rules left in the skeleton) is visibly unstyled, so the check above is meaningful', async () => {
  const defective = SRC.replace(RESET + '</style>', RESET + blockText() + '</style>').replace(/\.wq-sw i\{[^\n]*\n\.stack-grid\{[^\n]*\n/, '\n');
  const h = await openClay(browser, srv.base, { noClaude: true, html: wrapAsArtifact(defective) });
  try {
    const r = await probe(h.page);
    assert.equal(r.wk.display, 'block', 'week strip not flex');
    assert.notEqual(r.sg.display, 'grid', 'scent stack not a grid');
    assert.notEqual(r.wki.w, '26px', 'week dots not sized');
    assert.notEqual(r.sw.w, '12px', 'swatch dots not sized');
  } finally { await h.close(); }
});
