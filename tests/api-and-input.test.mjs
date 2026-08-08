import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as api from '../src/lib/api.js';
import * as categories from '../src/lib/categories.js';
import * as upload from '../src/lib/upload.js';
import * as workerConfig from '../src/lib/worker-config.js';

const read = (path) => readFileSync(path, 'utf8');

let readerSettings = {};
try {
  readerSettings = await import('../src/lib/readerSettings.js');
} catch {}

test('API keys are Base64 encoded from UTF-8 bytes', () => {
  assert.equal(typeof api.encodeApiKey, 'function', 'encodeApiKey must exist');
  assert.equal(api.encodeApiKey('密钥'), Buffer.from('密钥', 'utf8').toString('base64'));
});

test('archive search responses are reused briefly and can be cleared', async () => {
  assert.equal(typeof api.clearArchiveSearchResponseCache, 'function');
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  const previousNow = Date.now;
  let now = 1000;
  let calls = 0;
  globalThis.localStorage = {
    getItem: (key) => (key === 'lrr_server_url' ? 'https://example.test' : ''),
  };
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      text: async () => JSON.stringify({ data: [{ arcid: String(calls) }] }),
    };
  };
  Date.now = () => now;
  try {
    api.clearArchiveSearchResponseCache();
    const first = await api.lrrApi.search('artist:test$', 0, 'date_added', 'desc');
    const second = await api.lrrApi.search(' artist:test$ ', 0, 'date_added', 'desc');
    assert.equal(calls, 1);
    assert.deepEqual(second, first);

    now += 60_001;
    await api.lrrApi.search('artist:test$', 0, 'date_added', 'desc');
    assert.equal(calls, 2);

    api.clearArchiveSearchResponseCache();
    await api.lrrApi.search('artist:test$', 0, 'date_added', 'desc');
    assert.equal(calls, 3);
  } finally {
    api.clearArchiveSearchResponseCache?.();
    Date.now = previousNow;
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }
});

test('archive search cache evicts the least recently used response', async () => {
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.localStorage = {
    getItem: (key) => (key === 'lrr_server_url' ? 'https://example.test' : ''),
  };
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ data: [{ call: ++calls }] }),
  });
  try {
    api.clearArchiveSearchResponseCache();
    await api.lrrApi.search('q0');
    await api.lrrApi.search('q1');
    await api.lrrApi.search('q0');
    for (let index = 2; index <= 30; index += 1) {
      await api.lrrApi.search(`q${index}`);
    }
    assert.equal(calls, 31);
    await api.lrrApi.search('q0');
    assert.equal(calls, 31);
    await api.lrrApi.search('q1');
    assert.equal(calls, 32);
  } finally {
    api.clearArchiveSearchResponseCache();
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }
});

test('archive search scopes filters by category or untagged state', async () => {
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  const urls = [];
  globalThis.localStorage = {
    getItem: (key) => (key === 'lrr_server_url' ? 'https://example.test' : ''),
  };
  globalThis.fetch = async (url) => {
    urls.push(new URL(String(url)));
    return { ok: true, text: async () => JSON.stringify({ data: [] }) };
  };
  try {
    api.clearArchiveSearchResponseCache();
    await api.lrrApi.search('artist:test$', 0, 'date_added', 'desc', { category: 'SET_1234567890' });
    await api.lrrApi.search('artist:test$', 0, 'date_added', 'desc', { category: 'SET_1234567890' });
    await api.lrrApi.search('artist:test$', 0, 'date_added', 'desc', { category: 'SET_0987654321' });
    await api.lrrApi.search('artist:test$', 0, 'date_added', 'desc', { untaggedOnly: true });

    assert.equal(urls.length, 3, 'category scope must participate in the cache key');
    assert.equal(urls[0].searchParams.get('category'), 'SET_1234567890');
    assert.equal(urls[0].searchParams.get('filter'), 'artist:test$');
    assert.equal(urls[1].searchParams.get('category'), 'SET_0987654321');
    assert.equal(urls[2].searchParams.get('untaggedonly'), 'true');
    assert.equal(urls[2].searchParams.get('category'), null);
  } finally {
    api.clearArchiveSearchResponseCache();
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }
});

test('reader settings reject unsafe automatic turn intervals', () => {
  assert.equal(typeof readerSettings.normalizeReaderSettings, 'function', 'normalizeReaderSettings must load in Node');
  assert.equal(readerSettings.normalizeReaderSettings({ autoTurnInterval: 0 }).autoTurnInterval, 5);
  assert.equal(readerSettings.normalizeReaderSettings({ autoTurnInterval: -8 }).autoTurnInterval, 5);
  assert.equal(readerSettings.normalizeReaderSettings({ autoTurnInterval: 9999 }).autoTurnInterval, 3600);
  assert.equal(readerSettings.normalizeReaderSettings({ autoTurnInterval: 12 }).autoTurnInterval, 12);
  assert.equal(readerSettings.normalizeReaderSettings({}).allowProgressRegression, true);
  assert.equal(readerSettings.normalizeReaderSettings({ allowProgressRegression: false }).allowProgressRegression, false);
  assert.equal(readerSettings.normalizeReaderSettings({}).maxConcurrentDecodes, 3);
  assert.equal(readerSettings.normalizeReaderSettings({ maxConcurrentDecodes: 0 }).maxConcurrentDecodes, 1);
  assert.equal(readerSettings.normalizeReaderSettings({ maxConcurrentDecodes: 7 }).maxConcurrentDecodes, 6);
  assert.equal(readerSettings.normalizeReaderSettings({ maxConcurrentDecodes: 4.9 }).maxConcurrentDecodes, 4);
});

test('reader settings keep E-Hentai sorting valid across Home and Reader', () => {
  const defaults = readerSettings.normalizeReaderSettings({});
  assert.equal(defaults.ehMinScore, 0);
  assert.equal(defaults.ehMaxComments, 45);
  assert.equal(defaults.ehSortMethod, 'score');
  assert.equal(readerSettings.normalizeReaderSettings({ ehSortMethod: 'posted' }).ehSortMethod, 'time');
  assert.equal(readerSettings.normalizeReaderSettings({ ehSortMethod: 'invalid' }).ehSortMethod, 'score');

  const home = read('src/pages/Home.jsx');
  assert.match(home, /normalizeReaderSettings\(\{[\s\S]*ehCookie:/);
  assert.doesNotMatch(home, /const DEFAULT_READER_EH_SETTINGS\s*=/);
});

test('drag and drop keeps only supported archive files', () => {
  assert.equal(typeof upload.partitionUploadFiles, 'function', 'partitionUploadFiles must exist');
  const files = [
    { name: 'book.cbz', size: 1, lastModified: 1 },
    { name: 'scan.PDF', size: 2, lastModified: 2 },
    { name: 'notes.txt', size: 3, lastModified: 3 },
  ];
  const result = upload.partitionUploadFiles(files);
  assert.deepEqual(result.accepted.map((file) => file.name), ['book.cbz', 'scan.PDF']);
  assert.deepEqual(result.rejected.map((file) => file.name), ['notes.txt']);
});

test('config import ignores non-string field values', () => {
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  try {
    const payload = {
      lrr_server_url: { unsafe: true },
      lrr_api_key: 'ok',
      lrr_random_hide_read: '1',
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    assert.equal(workerConfig.importConfig(btoa(binary)), 2);
    assert.equal(values.has('lrr_server_url'), false);
    assert.equal(values.get('lrr_api_key'), 'ok');
    assert.equal(values.get('lrr_random_hide_read'), '1');
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('config transfer includes the random hide-read setting', () => {
  assert.ok(workerConfig.CONFIG_KEYS.includes('lrr_random_hide_read'));
});

test('Worker features require a valid HTTP URL and a non-empty token', () => {
  assert.equal(typeof workerConfig.hasValidWorkerConfig, 'function');
  assert.equal(workerConfig.hasValidWorkerConfig('https://sync.example.workers.dev', 'token'), true);
  assert.equal(workerConfig.hasValidWorkerConfig('http://localhost:8787', 'token'), true);
  assert.equal(workerConfig.hasValidWorkerConfig('not-a-url', 'token'), false);
  assert.equal(workerConfig.hasValidWorkerConfig('ftp://sync.example.test', 'token'), false);
  assert.equal(workerConfig.hasValidWorkerConfig('https://sync.example.test', '   '), false);
});

test('Favorites category keeps its server name and uses the fixed UI label', () => {
  assert.equal(categories.FAVORITES_CATEGORY_NAME, '🔖 Favorites');
  assert.equal(categories.getCategoryDisplayName({ name: '🔖 Favorites' }), '收藏夹');
  assert.equal(categories.getCategoryDisplayName({ name: 'Reading' }), 'Reading');

  const source = [
    { id: 'reading', name: 'Reading' },
    { id: 'favorites', name: '🔖 Favorites' },
    { id: 'later', name: 'Later' },
  ];
  assert.deepEqual(
    categories.sortCategoriesForDisplay(source).map((category) => category.id),
    ['favorites', 'reading', 'later'],
  );
  assert.deepEqual(source.map((category) => category.id), ['reading', 'favorites', 'later']);
});

test('Favorites creates a missing category and toggles archive membership', async () => {
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  const values = new Map([
    ['lrr_server_url', 'https://lrr.example.test'],
    ['lrr_api_key', 'secret'],
  ]);
  const calls = [];
  const categoryId = 'SET_1234567890';
  const archiveId = 'a'.repeat(40);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url: String(url), method, headers: options.headers || {}, body: options.body });
    let payload = { success: 1 };
    if (method === 'GET' && String(url).endsWith('/api/categories')) payload = [];
    if (method === 'PUT' && String(url).endsWith('/api/categories')) {
      payload = { success: 1, category_id: categoryId };
    }
    return { ok: true, text: async () => JSON.stringify(payload) };
  };
  try {
    categories.clearCategoriesCache();
    assert.equal((await categories.getFavoriteState(archiveId)).favorite, false);
    assert.equal((await categories.setArchiveFavorite(archiveId, true)).favorite, true);
    assert.equal((await categories.getFavoriteState(archiveId)).favorite, true);
    assert.equal((await categories.setArchiveFavorite(archiveId, false)).favorite, false);

    const create = calls.find((call) => call.method === 'PUT' && call.url.endsWith('/api/categories'));
    assert.equal(create.headers['Content-Type'], 'application/x-www-form-urlencoded;charset=UTF-8');
    assert.equal(create.body, new URLSearchParams({ name: '🔖 Favorites' }).toString());
    assert.ok(calls.some((call) => call.method === 'PUT' && call.url.endsWith(`/api/categories/${categoryId}/${archiveId}`)));
    assert.ok(calls.some((call) => call.method === 'DELETE' && call.url.endsWith(`/api/categories/${categoryId}/${archiveId}`)));
  } finally {
    categories.clearCategoriesCache?.();
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }
});
