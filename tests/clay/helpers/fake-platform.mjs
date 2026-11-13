// Test-only stand-in for the Claude platform's window.claude (db + user). Everything lives in memory inside the page.
// It never talks to a network and never knows a real user id. Paths are checked: only the signed-in user's own private path and the five known document names are allowed.
//
// opts: { uid, noClaude, noUser, remote: {key: {data, at}}, others: {path: value}, setDelayMs, failSet }
export function platformInit(opts) {
  const KEYS = ['clay-products', 'clay-hair', 'clay-log', 'clay-prefs', 'clay-scents'];
  const store = new Map();
  const listeners = new Map();
  const log = { reads: [], writes: [], violations: [], inflight: {}, maxInflight: {} };
  const own = 'data/users/' + opts.uid;
  for (const [k, v] of Object.entries(opts.remote || {})) store.set(own + '/' + k, JSON.parse(JSON.stringify(v)));
  for (const [p, v] of Object.entries(opts.others || {})) store.set(p, JSON.parse(JSON.stringify(v)));
  const check = (collection, k) => {
    if (collection !== own || !KEYS.includes(k)) log.violations.push(collection + '/' + k);
  };
  const snap = (full) => ({ exists: store.has(full), data: () => JSON.parse(JSON.stringify(store.get(full))) });
  const doc = (collection, k) => {
    const full = collection + '/' + k;
    return {
      get: async () => { check(collection, k); log.reads.push(full); return snap(full); },
      set: async (v) => {
        check(collection, k);
        log.inflight[full] = (log.inflight[full] || 0) + 1;
        log.maxInflight[full] = Math.max(log.maxInflight[full] || 0, log.inflight[full]);
        try {
          if (opts.setDelayMs) await new Promise((r) => setTimeout(r, opts.setDelayMs));
          if (opts.failSet) throw new Error('fake write failure');
          store.set(full, JSON.parse(JSON.stringify(v)));
          log.writes.push({ full, key: k, value: JSON.parse(JSON.stringify(v)) });
        } finally { log.inflight[full]--; }
      },
      onSnapshot: (cb) => { check(collection, k); (listeners.get(full) || listeners.set(full, []).get(full)).push(cb); return () => {}; },
    };
  };
  window.__fake = {
    log,
    store: () => Object.fromEntries([...store.entries()]),
    emit: (k, v) => { const full = own + '/' + k; store.set(full, JSON.parse(JSON.stringify(v))); (listeners.get(full) || []).forEach((cb) => cb(snap(full))); },
  };
  if (!opts.noClaude) {
    window.claude = {
      use: async (name) => {
        if (name === 'db') return { collection: (p) => ({ doc: (k) => doc(p, k) }) };
        if (name === 'user') return opts.noUser ? null : { id: async () => opts.uid };
        return null;
      },
    };
  }
}
