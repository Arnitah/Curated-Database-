/**
 * Storage namespace for a single signed-in Clay principal.
 *
 * The current artifact app uses unscoped localStorage keys for its offline
 * cache. The standalone hosted build must route every app storage operation
 * through this adapter after validating the current Managed Auth user id.
 * clear() removes only this user's namespace, never another account's data.
 */
export function createClayScopedStorage(storage, {
  userId,
  prefix = 'clay:user:'
} = {}) {
  if (!storage
      || typeof storage.getItem !== 'function'
      || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function'
      || typeof storage.key !== 'function') {
    throw new TypeError('A Web Storage-compatible object is required');
  }
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new TypeError('A verified Clay user id is required');
  }
  if (typeof prefix !== 'string' || !prefix) {
    throw new TypeError('A non-empty storage namespace prefix is required');
  }

  const namespace = prefix + encodeURIComponent(userId) + ':';

  function scopedKeys() {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === 'string' && key.startsWith(namespace)) {
        keys.push(key.slice(namespace.length));
      }
    }
    return keys;
  }

  return Object.freeze({
    get length() {
      return scopedKeys().length;
    },
    key(index) {
      if (!Number.isSafeInteger(index) || index < 0) return null;
      return scopedKeys()[index] ?? null;
    },
    getItem(key) {
      return storage.getItem(namespace + String(key));
    },
    setItem(key, value) {
      storage.setItem(namespace + String(key), String(value));
    },
    removeItem(key) {
      storage.removeItem(namespace + String(key));
    },
    clear() {
      for (const key of scopedKeys()) storage.removeItem(namespace + key);
    }
  });
}
