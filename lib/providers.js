function assertAllowedProviderUrl(url, allowedHosts) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error('Invalid provider URL.');
  }
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
    throw new Error('Provider host is not allowed.');
  }
  return parsed;
}

function createProviderFetcher({ fetchImpl = fetch, timeoutMs = 8000, maxConcurrent = 6, maxEntries = 300, now = Date.now, allowedHosts = null } = {}) {
  const hostAllowlist = allowedHosts ? new Set(allowedHosts) : null;
  const cache = new Map();
  const inFlight = new Map();
  const queue = [];
  let active = 0;

  async function acquire() {
    if (active < maxConcurrent) {
      active += 1;
      return;
    }
    if (queue.length >= 100) throw new Error('Provider queue full.');
    await new Promise(resolve => queue.push(resolve));
  }

  function release() {
    const next = queue.shift();
    if (next) next();
    else active -= 1;
  }

  return async function fetchProvider(url, options = {}, ttlMs = 60_000) {
    // Requests carry provider API keys, so they may only go to known provider hosts.
    if (hostAllowlist) url = assertAllowedProviderUrl(url, hostAllowlist);
    const key = String(url);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.result;
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      await acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { ...options, signal: controller.signal });
        const payload = await response.json();
        const result = { status: response.status, payload };
        if (response.ok && ttlMs > 0) {
          for (const [entryKey, entry] of cache) {
            if (entry.expiresAt <= now()) cache.delete(entryKey);
          }
          cache.delete(key);
          cache.set(key, { expiresAt: now() + ttlMs, result });
          while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        }
        return result;
      } finally {
        clearTimeout(timer);
        release();
      }
    })();
    inFlight.set(key, task);
    try {
      return await task;
    } finally {
      inFlight.delete(key);
    }
  };
}

module.exports = { createProviderFetcher, assertAllowedProviderUrl };
