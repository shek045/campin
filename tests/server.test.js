const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { server } = require('../server');
const { publicFile, createRateLimiter, validateApiParams } = require('../lib/http');
const { createProviderFetcher } = require('../lib/providers');

let base;
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test('only public app assets can be served', async () => {
  for (const file of ['/.env', '/.env.example', '/.git/config', '/server.js', '/lib/http.js', '/package.json', '/assets/../server.js']) {
    const response = await fetch(`${base}${file}`);
    assert.equal(response.status, 403, file);
  }
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(`${base}/assets/js/domain/trip.js`)).status, 200);
  assert.equal(publicFile('/app', '/assets/js/%2e%2e/%2e%2e/server.js'), null);
});

test('malformed URLs do not crash the server', async () => {
  const status = await new Promise((resolve, reject) => {
    http.get(`${base}/%ZZ`, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(status, 400);
  assert.equal((await fetch(`${base}/api/config`)).status, 200);
});

test('JSON requests are bounded and validated before provider work', async () => {
  for (const [body, expected] of [['null', 400], ['[]', 400], ['{', 400], [JSON.stringify({ query: 42 }), 400], [JSON.stringify({ query: 'a'.repeat(40_000) }), 413]]) {
    const response = await fetch(`${base}/api/intent/parse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body
    });
    assert.equal(response.status, expected);
  }
  assert.equal((await fetch(`${base}/api/intent/parse`, { method: 'POST', body: '{}' })).status, 415);
  const response = await fetch(`${base}/api/judge/results`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'test', cards: Array(9).fill({ id: 'x' }) })
  });
  assert.equal(response.status, 400);
});

test('query limits, coordinate ranges and month starts are validated', () => {
  for (const query of ['limit=-1', 'limit=201', 'limit=0', 'limit=1&limit=2', 'lat=91', 'lon=', 'radius=501',
    'start_date=2026-02-30T00:00:00.000Z', 'start_date=2026-13-01T00:00:00.000Z']) {
    assert.ok(validateApiParams(new URL(`http://local/api/test?${query}`)), query);
  }
  assert.equal(validateApiParams(new URL('http://local/api/test?limit=12&lat=0&lon=0&start_date=2026-12-01T00:00:00.000Z')), '');
});

test('rate limiter expires entries and rejects excess traffic', () => {
  let time = 0;
  const allow = createRateLimiter({ limit: 2, windowMs: 10, now: () => time });
  assert.ok(allow('a'));
  assert.ok(allow('a'));
  assert.equal(allow('a'), false);
  time = 11;
  assert.ok(allow('a'));
});

test('provider requests are coalesced, cached and concurrency limited', async () => {
  let calls = 0, active = 0, peak = 0;
  const provider = createProviderFetcher({
    maxConcurrent: 2,
    fetchImpl: async () => {
      calls += 1; active += 1; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active -= 1;
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    }
  });
  await Promise.all([provider('a'), provider('a'), provider('b'), provider('c')]);
  await provider('a');
  assert.equal(calls, 3);
  assert.equal(peak, 2);
});

test('provider failures are not cached and timeouts abort body reads', async () => {
  let calls = 0;
  const provider = createProviderFetcher({ fetchImpl: async () => {
    calls += 1;
    return { ok: false, status: 503, json: async () => ({ error: 'unavailable' }) };
  } });
  await provider('a'); await provider('a');
  assert.equal(calls, 2);
  const slow = createProviderFetcher({ timeoutMs: 5, fetchImpl: async (url, { signal }) => ({
    ok: true, status: 200, json: () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })
  }) });
  await assert.rejects(slow('slow'), /aborted/);
});
