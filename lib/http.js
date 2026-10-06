const path = require('node:path');

const PUBLIC_FILES = new Set(['/index.html', '/assets/demo-screenshot.svg']);

function publicFile(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded === '/') decoded = '/index.html';
  if (!PUBLIC_FILES.has(decoded) && !/^\/assets\/(?:css|js)\/[a-zA-Z0-9/_-]+\.(?:css|js)$/.test(decoded)) {
    return null;
  }
  const resolved = path.resolve(root, `.${decoded}`);
  return path.relative(root, resolved).startsWith('..') ? null : resolved;
}

function readJsonBody(req, maxBytes = 32_768) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    let failed = false;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (failed) return;
      if (bytes > maxBytes) {
        failed = true;
        chunks.length = 0;
        reject(Object.assign(new Error('Request body too large.'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch {
        reject(Object.assign(new Error('Expected a JSON object.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function createRateLimiter({ limit = 120, windowMs = 60_000, maxEntries = 2000, now = Date.now } = {}) {
  const clients = new Map();
  return key => {
    const time = now();
    for (const [client, entry] of clients) {
      if (entry.resetAt <= time) clients.delete(client);
    }
    let entry = clients.get(key);
    if (!entry) {
      if (clients.size >= maxEntries) return false;
      entry = { count: 0, resetAt: time + windowMs };
      clients.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

function validateApiParams(url) {
  const params = url.searchParams;
  for (const [key, value] of params) {
    if (value.length > 300 || params.getAll(key).length > 1) return 'Invalid query parameters.';
  }
  for (const [key, max] of [['limit', 200], ['offset', 10_000]]) {
    if (params.has(key) && (!/^\d+$/.test(params.get(key)) || Number(params.get(key)) > max || (key === 'limit' && Number(params.get(key)) < 1))) {
      return `Invalid ${key}.`;
    }
  }
  for (const [key, max] of [['lat', 90], ['lon', 180], ['latitude', 90], ['longitude', 180]]) {
    if (params.has(key) && (!params.get(key).trim() || !Number.isFinite(Number(params.get(key))) || Math.abs(Number(params.get(key))) > max)) return `Invalid ${key}.`;
  }
  if (params.has('radius') && (!(Number(params.get('radius')) > 0) || Number(params.get('radius')) > 500)) return 'Invalid radius.';
  if (params.has('start_date')) {
    const value = params.get('start_date');
    if (!/^\d{4}-\d{2}-01T00:00:00\.000Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return 'Invalid month start.';
  }
  return '';
}

module.exports = { publicFile, readJsonBody, createRateLimiter, validateApiParams };
