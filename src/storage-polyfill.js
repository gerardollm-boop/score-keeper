const PERSONAL_PREFIX = "sk_personal_";
const SHARED_PREFIX = "sk_shared_";

function prefixFor(shared) {
  return shared ? SHARED_PREFIX : PERSONAL_PREFIX;
}

window.storage = {
  async get(key, shared = false) {
    try {
      const raw = localStorage.getItem(prefixFor(shared) + key);
      if (raw === null) return null;
      return { key, value: raw, shared };
    } catch (e) {
      console.error("storage.get error", e);
      return null;
    }
  },
  async set(key, value, shared = false) {
    try {
      localStorage.setItem(prefixFor(shared) + key, value);
      return { key, value, shared };
    } catch (e) {
      console.error("storage.set error", e);
      return null;
    }
  },
  async delete(key, shared = false) {
    try {
      const fullKey = prefixFor(shared) + key;
      const existed = localStorage.getItem(fullKey) !== null;
      localStorage.removeItem(fullKey);
      return { key, deleted: existed, shared };
    } catch (e) {
      console.error("storage.delete error", e);
      return null;
    }
  },
  async list(prefix = "", shared = false) {
    try {
      const base = prefixFor(shared);
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(base + prefix)) keys.push(k.slice(base.length));
      }
      return { keys, prefix, shared };
    } catch (e) {
      console.error("storage.list error", e);
      return null;
    }
  },
};
