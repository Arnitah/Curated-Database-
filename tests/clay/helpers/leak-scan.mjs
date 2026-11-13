// Checks that nothing real can leak into fixtures, logs or screenshots.
// Real user ids are long opaque strings; test ids always start with "test-". Anything else under data/users/ is a finding.
// Product names must come from the public seed already inside the app, or be clearly synthetic.
export const SYNTH_PREFIX = 'Synthetic ';

export function scanText(text, { tokens = true } = {}) {
  const findings = [];
  for (const m of text.matchAll(/data\/users\/([^/\s"'`]+)/g)) {
    if (!m[1].startsWith('test-')) findings.push('non-test user path segment: ' + m[1]);
  }
  for (const m of text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)) findings.push('uuid-like id: ' + m[0]);
  if (tokens) for (const m of text.matchAll(/\b[A-Za-z0-9_-]{28,}\b/g)) findings.push('long opaque token: ' + m[0].slice(0, 6) + '…');
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text)) findings.push('email address');
  return findings;
}

export function disallowedNames(records, seedNames) {
  const ok = new Set(seedNames);
  return records.map((r) => r.n).filter((n) => !ok.has(n) && !String(n).startsWith(SYNTH_PREFIX));
}
