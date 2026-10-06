const KEY = 'campin.saved.v1';

export function createSavedListings(storage) {
  let ids = new Set();
  try {
    const stored = JSON.parse(storage?.getItem(KEY) || '[]');
    if (Array.isArray(stored)) ids = new Set(stored.filter(id => typeof id === 'string').slice(0, 500));
  } catch {
    // Saving still works in memory when storage is unavailable.
  }
  return {
    has(id) { return ids.has(String(id)); },
    toggle(id) {
      const key = String(id);
      if (ids.has(key)) ids.delete(key);
      else if (ids.size < 500) ids.add(key);
      try { storage?.setItem(KEY, JSON.stringify([...ids])); } catch { /* Storage may be disabled. */ }
      return ids.has(key);
    }
  };
}
