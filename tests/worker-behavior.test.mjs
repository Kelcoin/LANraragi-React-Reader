import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const workerSource = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function createWorker(entries = [], globals = {}) {
  const values = new Map([['tokens', JSON.stringify(['test-token'])], ...entries]);
  let listener = null;
  const context = {
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    Date,
    JSON,
    Math,
    Map,
    Set,
    Promise,
    console,
    setTimeout,
    clearTimeout,
    APP_VERSION: 'test',
    HISTORY_KV: {
      async get(key) { return values.get(key) ?? null; },
      async put(key, value) { values.set(key, String(value)); },
      async delete(key) { values.delete(key); },
      async list({ prefix = '' } = {}) {
        return { keys: Array.from(values.keys()).filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
      },
    },
    addEventListener(type, callback) { if (type === 'fetch') listener = callback; },
    ...globals,
  };
  vm.runInNewContext(workerSource, context);
  return async function dispatch(path, { method = 'GET', scope, body, token = 'test-token' } = {}) {
    const headers = { 'x-sync-token': token };
    if (scope) headers['x-lrr-server-scope'] = scope;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const request = new Request(`https://worker.example${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let responsePromise;
    listener({ request, respondWith(value) { responsePromise = value; } });
    return responsePromise;
  };
}

const SCOPE_A = 'a'.repeat(32);
const SCOPE_B = 'b'.repeat(32);

test('Worker retried delete preserves a re-written history entry', async () => {
  const dispatch = createWorker();
  const t0 = Date.now();
  await dispatch('/history', { method: 'PUT', scope: SCOPE_A, body: { history: { id: 'one', page: 1, time: t0 } } });
  await dispatch('/history', { method: 'DELETE', scope: SCOPE_A, body: { ids: ['one'] } });
  // User re-opens the archive: newer progress revives the entry (tombstone kept).
  await dispatch('/history', { method: 'PUT', scope: SCOPE_A, body: { history: { id: 'one', page: 5, time: t0 + 1000 } } });
  // Stale retried DELETE (original response was lost) must not wipe the revive.
  await dispatch('/history', { method: 'DELETE', scope: SCOPE_A, body: { ids: ['one'] } });
  const state = await (await dispatch('/history', { scope: SCOPE_A })).json();
  assert.deepEqual(state.histories.map((item) => item.id), ['one']);
  assert.equal(state.histories[0].page, 5);
});

test('Worker status reload requires authentication', async () => {
  const dispatch = createWorker();
  const unauthorized = await dispatch('/?reload=1', { token: '' });
  assert.equal(unauthorized.status, 401);
  const authorized = await dispatch('/?reload=1', { scope: SCOPE_A });
  assert.equal(authorized.status, 302);
});

test('Worker classifies the original copyright-removal page', async () => {
  const page = '<title>Gallery Not Available - ExHentai.org</title><p>This gallery is unavailable due to a copyright claim by Irodori Comics.</p>';
  const dispatch = createWorker([], { fetch: async () => new Response(page, { status: 200 }) });
  const response = await dispatch('/', {
    method: 'POST',
    body: { url: 'https://exhentai.org/g/3951227/838402b64f', cookie: '' },
  });

  assert.equal(response.status, 410);
  assert.equal((await response.json()).error, 'GALLERY_COPYRIGHT_REMOVED');
});

test('Worker classifies content-warning pages', async () => {
  const page = '<title>Content Warning</title><h1>Content Warning</h1><p>You are seeing this page because this gallery contains content that may be objectionable.</p>';
  const dispatch = createWorker([], { fetch: async () => new Response(page, { status: 200 }) });
  const response = await dispatch('/', {
    method: 'POST',
    body: { url: 'https://exhentai.org/g/3951227/838402b64f', cookie: '' },
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'CONTENT_WARNING');
});

test('Worker returns structured data for unknown upstream errors', async () => {
  const dispatch = createWorker([], { fetch: async () => new Response('temporary upstream error', { status: 503 }) });
  const response = await dispatch('/', {
    method: 'POST',
    body: { url: 'https://exhentai.org/g/3951227/838402b64f', cookie: '' },
  });

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'EH_UPSTREAM_ERROR',
    status: 503,
    detail: 'EH 返回了 HTTP 503 响应',
  });
});

test('Worker checks both EH sites and refreshes igneous after an invalid ExHentai page', async () => {
  const calls = [];
  const validPage = '<html><body>' + 'gallery '.repeat(120) + '</body></html>';
  const dispatch = createWorker([], {
    fetch: async (url, options) => {
      calls.push({ url: String(url), cookie: options.headers.Cookie });
      if (String(url).includes('e-hentai.org')) return new Response(validPage, { status: 200 });
      if (calls.length === 2) return new Response('Sad Panda', { status: 200 });
      return new Response(validPage, { status: 200, headers: { 'set-cookie': 'igneous=refreshed; Path=/' } });
    },
  });
  const response = await dispatch('/eh/check', {
    method: 'POST',
    body: { cookie: 'ipb_member_id=123; ipb_pass_hash=hash' },
  });

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.eHentai.ok, true);
  assert.equal(result.exHentai.ok, true);
  assert.equal(result.refreshed, true);
  assert.match(result.cookie, /igneous=refreshed/);
  assert.equal(calls.length, 3);
  assert.match(calls[2].cookie, /nw=1/);
});

test('Worker status page input fields have explicit hover and focus states', async () => {
  const html = await (await createWorker()('/')).text();
  assert.match(html, /input:hover, textarea:hover \{ border-color:rgba\(255,255,255,\.24\); background:#141b26; \}/);
  assert.match(html, /input:focus, textarea:focus \{ border-color:#3b82f6/);
  assert.match(html, /transition:border-color \.15s ease, background-color \.15s ease, box-shadow \.15s ease/);
  assert.match(html, /outline:none;/);
});

test('Worker history is isolated by server scope and serializes concurrent writes', async () => {
  const dispatch = createWorker();
  const now = Date.now();
  const writes = [
    dispatch('/history', { method: 'PUT', scope: SCOPE_A, body: { history: { id: 'one', page: 1, time: now } } }),
    dispatch('/history', { method: 'PUT', scope: SCOPE_A, body: { history: { id: 'two', page: 2, time: now + 1 } } }),
  ];
  assert.deepEqual((await Promise.all(writes)).map((response) => response.status), [200, 200]);
  const sameScope = await (await dispatch('/history', { scope: SCOPE_A })).json();
  const otherScope = await (await dispatch('/history', { scope: SCOPE_B })).json();
  assert.deepEqual(sameScope.histories.map((item) => item.id).sort(), ['one', 'two']);
  assert.deepEqual(otherScope.histories, []);
});

test('Worker watchlist tombstone blocks an older client from reviving a deletion', async () => {
  const dispatch = createWorker();
  await dispatch('/watchlist', { method: 'PUT', scope: SCOPE_A, body: { item: { id: 'one', addedAt: 1000 } } });
  await dispatch('/watchlist', { method: 'DELETE', scope: SCOPE_A, body: { ids: ['one'] } });
  await dispatch('/watchlist', { method: 'PUT', scope: SCOPE_A, body: { item: { id: 'one', addedAt: 1000 } } });
  const state = await (await dispatch('/watchlist', { scope: SCOPE_A })).json();
  assert.deepEqual(state.items, []);
  assert.equal(state.deleted[0].id, 'one');
});

test('Worker claims legacy aggregate data into the first server scope once', async () => {
  const now = Date.now();
  const dispatch = createWorker([
    ['history:test-token', JSON.stringify({ histories: [{ id: 'legacy', page: 3, time: now }], deleted: [] })],
  ]);
  const migrated = await (await dispatch('/history', { scope: SCOPE_A })).json();
  const isolated = await (await dispatch('/history', { scope: SCOPE_B })).json();
  assert.equal(migrated.histories[0].id, 'legacy');
  assert.deepEqual(isolated.histories, []);
});

test('Worker status performs no remote update request', async () => {
  let fetchCalls = 0;
  const dispatch = createWorker([], { fetch: async () => { fetchCalls += 1; throw new Error('unexpected fetch'); } });
  const html = await (await dispatch('/')).text();
  assert.equal(fetchCalls, 0);
  assert.doesNotMatch(html, /Worker 更新|最新版本|更新检查/);
});

test('Worker status uses Readoshi branding and animated centered KV panels', async () => {
  const html = await (await createWorker()('/')).text();
  assert.match(html, /<title>Readoshi Sync Worker<\/title>/);
  assert.match(html, /class="brand-logo"[^>]+public\/logo-white\.png/);
  assert.match(html, /<h1>Readoshi Sync Worker<\/h1>/);
  assert.match(html, /请输入合法 Token，仅能导入 \/ 导出该 Token 对应的阅读历史与非重复记录。/);
  assert.match(html, /\.collapsible\s*\{[^}]*grid-template-rows:\s*0fr[^}]*transition:/s);
  assert.match(html, /\.collapsible\.is-open\s*\{[^}]*grid-template-rows:\s*1fr/s);
  assert.match(html, /\.tool-actions\s*\{[^}]*justify-content:\s*center/s);
  assert.match(html, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(html, /class="collapsible is-open"/);
  assert.match(html, /classList\.toggle\('is-open'/);
});
