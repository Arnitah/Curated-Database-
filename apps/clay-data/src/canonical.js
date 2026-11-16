// Restricted canonical JSON, SHA-256 helpers and the comparison key ck1-unicode-15.0.0.
// Node built-ins only. No network. Reads one committed data file (../data/unicode-15.0.0.json) at load time.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export class CanonicalError extends Error {
  constructor(code, detail) { super(detail ? code + ': ' + detail : code); this.name = 'CanonicalError'; this.code = code; }
}

// ---- Restricted canonical JSON (in the spirit of RFC 8785, with stricter input rules) -------------
// Allowed: null, true/false, strings, safe integers, arrays, plain objects.
// Rejected: floats, -0, NaN, Infinity, integers beyond +-(2^53-1), undefined, Date, functions, symbols, bigint,
// non-plain objects, strings with lone surrogates, keys outside ^[a-z][a-z0-9_]*$.
// Keys sorted by UTF-16 code unit order. No whitespace. Standard JSON string escaping.
const KEY = /^[a-z][a-z0-9_]*$/;

function loneSurrogate(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = s.charCodeAt(i + 1); if (n >= 0xdc00 && n <= 0xdfff) { i++; continue; } return true; }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

function enc(v, path) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean': return v ? 'true' : 'false';
    case 'string':
      if (loneSurrogate(v)) throw new CanonicalError('lone_surrogate', path || '/');
      return JSON.stringify(v);
    case 'number':
      if (Object.is(v, -0)) throw new CanonicalError('negative_zero', path || '/');
      if (!Number.isSafeInteger(v)) throw new CanonicalError('not_a_safe_integer', path || '/');
      return String(v);
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map((x, i) => enc(x, path + '/' + i)).join(',') + ']';
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new CanonicalError('not_a_plain_object', path || '/');
      const keys = Object.keys(v).sort();
      return '{' + keys.map((k) => {
        if (!KEY.test(k)) throw new CanonicalError('invalid_key', path || '/');
        if (v[k] === undefined) throw new CanonicalError('undefined_value', path + '/' + k);
        return JSON.stringify(k) + ':' + enc(v[k], path + '/' + k);
      }).join(',') + '}';
    }
    default: throw new CanonicalError('unsupported_type', path || '/');
  }
}

export function canonicalJSON(value) { return enc(value, ''); }

export function sha256Hex(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }
export function sha256Bytes(text) { return createHash('sha256').update(text, 'utf8').digest(); }
// contentHash form used by the contract: "sha256:" + 64 lowercase hex of the canonical string.
export function contentHash(value) { return 'sha256:' + sha256Hex(canonicalJSON(value)); }

// ---- comparisonKey ck1-unicode-15.0.0 --------------------------------------------------------------
export const COMPARISON_KEY_VERSION = 'ck1-unicode-15.0.0';
export const REASONS = Object.freeze({
  UNASSIGNED: 'code_point_not_assigned_in_unicode_15_0',
  LONE_SURROGATE: 'lone_surrogate',
  OLD_RUNTIME: 'runtime_unicode_older_than_15_0'
});

export const DATA = JSON.parse(readFileSync(new URL('../data/unicode-15.0.0.json', import.meta.url), 'utf8'));

const FOLD = new Map(DATA.fold.map(([k, v]) => [parseInt(k, 16), String.fromCodePoint(...v.split(' ').map((x) => parseInt(x, 16)))]));
const RANGES = DATA.ranges;

function assigned15(cp) {
  let lo = 0, hi = RANGES.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, r = RANGES[m]; if (cp < r[0]) hi = m - 1; else if (cp > r[1]) lo = m + 1; else return true; }
  return false;
}
const hx = (s) => [...s].map((c) => c.codePointAt(0).toString(16)).join(' ');
const fold = (s) => { let o = ''; for (const ch of s) { const m = FOLD.get(ch.codePointAt(0)); o += m === undefined ? ch : m; } return o; };

// White_Space code points (Unicode 15.0): U+0009-000D, 0020, 0085, 00A0, 1680, 2000-200A, 2028, 2029, 202F, 205F, 3000.
const WS = /[\u{9}-\u{d}\u{20}\u{85}\u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}]+/gu;

// Start-up self-test: 62 single canaries and 20 sequence canaries, expected values from the pinned data file.
export function selfTest() {
  const single = [];
  for (const [cp, nfd, nfkd] of DATA.canary) {
    const ch = String.fromCodePoint(cp);
    if (hx(ch.normalize('NFD')) !== nfd || hx(ch.normalize('NFKD')) !== nfkd) single.push(cp);
  }
  const sequence = [];
  DATA.sequenceCanaries.forEach((row, i) => {
    const s = String.fromCodePoint(...row.seq.split(' ').map((x) => parseInt(x, 16)));
    const d = hx(s.normalize('NFD')).split(' ').map((x) => x.toUpperCase().padStart(4, '0')).join(' ');
    const k = hx(s.normalize('NFKD')).split(' ').map((x) => x.toUpperCase().padStart(4, '0')).join(' ');
    if (d !== row.nfd || k !== row.nfkd) sequence.push(i);
  });
  return { ok: single.length === 0 && sequence.length === 0, single, sequence };
}

const RUNTIME_OK = selfTest().ok;
export function runtimeIsUnicode15() { return RUNTIME_OK; }

const unavailable = (reason) => ({ state: 'unavailable', version: COMPARISON_KEY_VERSION, reason });

export function comparisonKey(text) {
  if (typeof text !== 'string') throw new CanonicalError('not_a_string');
  if (!RUNTIME_OK) return unavailable(REASONS.OLD_RUNTIME);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let cp = c;
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = text.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) { cp = 0x10000 + ((c - 0xd800) << 10) + (n - 0xdc00); i++; } else return unavailable(REASONS.LONE_SURROGATE);
    } else if (c >= 0xdc00 && c <= 0xdfff) return unavailable(REASONS.LONE_SURROGATE);
    if (!assigned15(cp)) return unavailable(REASONS.UNASSIGNED);
  }
  let s = text.replace(/\r\n?/g, '\n');
  s = fold(s.normalize('NFD'));
  s = s.normalize('NFKD');
  s = fold(s);
  s = s.normalize('NFKD');
  return { state: 'ok', version: COMPARISON_KEY_VERSION, key: s.replace(WS, ' ').replace(/^ | $/g, '') };
}

// Never compares an unavailable key, and never compares keys of different versions.
export function compareKeys(a, b) {
  const okShape = (r) => r && typeof r === 'object' && r.state === 'ok' && typeof r.key === 'string' && r.version === COMPARISON_KEY_VERSION;
  if (!okShape(a) || !okShape(b)) return 'not_comparable';
  return a.key === b.key ? 'same' : 'different';
}
