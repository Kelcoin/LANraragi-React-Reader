import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as api from '../src/lib/api.js';
import * as categories from '../src/lib/categories.js';
import * as metadataEditor from '../src/lib/metadataEditor.js';
import * as upload from '../src/lib/upload.js';
import * as workerConfig from '../src/lib/worker-config.js';
import * as superResolution from '../src/lib/superResolution.js';

const read = (path) => readFileSync(path, 'utf8');

let readerSettings = {};
try {
  readerSettings = await import('../src/lib/readerSettings.js');
} catch {}

test('API keys are Base64 encoded from UTF-8 bytes', () => {
  assert.equal(typeof api.encodeApiKey, 'function', 'encodeApiKey must exist');
  assert.equal(api.encodeApiKey('密钥'), Buffer.from('密钥', 'utf8').toString('base64'));
});

test('metadata plugins keep descriptions without treating parameter defaults as plugin defaults', () => {
  const plugins = metadataEditor.normalizeMetadataPlugins([
    { namespace: 'first', name: 'First', description: 'Line<br>Two &amp; more', parameters: [{ default_value: '1', type: 'bool' }] },
    { namespace: 'ehplugin', name: 'E-Hentai', login_from: 'ehlogin', description: 'Searches g.e-hentai for tags.', parameters: [] },
  ]);
  assert.equal('isDefault' in plugins[0], false);
  assert.equal(plugins[0].description, 'Line\nTwo & more');
  assert.equal(plugins[1].value, 'ehplugin');
  assert.equal(plugins[1].description, 'Searches g.e-hentai for tags.');
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

test('reader settings normalize super-resolution fields', () => {
  const defaults = readerSettings.normalizeReaderSettings({});
  assert.equal(defaults.srEnabled, false);
  assert.equal(defaults.srModel, 'waifu2x');
  assert.equal(defaults.preloadCount, 3);
  assert.equal('srPreloadCount' in defaults, false);
  assert.equal(defaults.srAuto, false);
  assert.equal(defaults.srAutoThreshold, 500);

  assert.equal(readerSettings.normalizeReaderSettings({ srEnabled: 1 }).srEnabled, true);
  assert.equal(readerSettings.normalizeReaderSettings({ srAuto: 'yes' }).srAuto, true);
  assert.equal(readerSettings.normalizeReaderSettings({ srModel: 'onnx-subpixel-x3' }).srModel, 'waifu2x');
  assert.equal(readerSettings.normalizeReaderSettings({ srModel: 'realcugan' }).srModel, 'realcugan');
  assert.equal(readerSettings.normalizeReaderSettings({ srModel: 'unknown' }).srModel, 'waifu2x');
  assert.equal(readerSettings.normalizeReaderSettings({ preloadCount: 99 }).preloadCount, 10);
  assert.equal('srPreloadCount' in readerSettings.normalizeReaderSettings({ srPreloadCount: 5 }), false);
  assert.equal(readerSettings.normalizeReaderSettings({ srAutoThreshold: -1 }).srAutoThreshold, 500);
  assert.equal(readerSettings.normalizeReaderSettings({ srAutoThreshold: 640 }).srAutoThreshold, 640);

  // 纯函数库可加载；Node 环境（无 document/WebGL）安全降级为不支持
  assert.equal(typeof superResolution.detectSuperResolutionSupport, 'function');
  assert.deepEqual(superResolution.SUPER_RESOLUTION_MODELS.map((m) => m.value), ['waifu2x', 'realcugan']);
  const fallback = superResolution.detectSuperResolutionSupport();
  assert.equal(fallback.supported, false);
  assert.ok(fallback.reason);
});

test('super resolution avg page size computes from pagecount + size aliases', () => {
  // 10 页、5120 KB → 每页 512 KB
  assert.equal(superResolution.getArchiveAvgPageSizeKb({ pagecount: 10, size: 5120 * 1024 }), 512);
  // filesize / file_size 别名
  assert.equal(superResolution.getArchiveAvgPageSizeKb({ pagecount: 5, filesize: 2560 * 1024 }), 512);
  assert.equal(superResolution.getArchiveAvgPageSizeKb({ total: 4, file_size: 4096 * 1024 }), 1024);
  // 数据不足 → null
  assert.equal(superResolution.getArchiveAvgPageSizeKb({}), null);
  assert.equal(superResolution.getArchiveAvgPageSizeKb({ pagecount: 0, size: 100 }), null);
  assert.equal(superResolution.getArchiveAvgPageSizeKb({ pagecount: 10, size: 0 }), null);
  assert.equal(superResolution.getArchiveAvgPageSizeKb(null), null);
});

test('super resolution auto-enable uses avg page size vs threshold', () => {
  const archive = { pagecount: 10, size: 5120 * 1024 }; // 512 KB/页
  // 低于阈值 → 启用
  assert.equal(superResolution.shouldAutoEnableSuperResolution(archive, true, 600), true);
  // 高于或等于阈值 → 不启用
  assert.equal(superResolution.shouldAutoEnableSuperResolution(archive, true, 512), false);
  assert.equal(superResolution.shouldAutoEnableSuperResolution(archive, true, 400), false);
  // srAuto 关闭 → 不启用
  assert.equal(superResolution.shouldAutoEnableSuperResolution(archive, false, 600), false);
  // 阈值 0 → 不限制每页体积；负值 / 非数字 → 不启用
  assert.equal(superResolution.shouldAutoEnableSuperResolution(archive, true, 0), true);
  assert.equal(superResolution.shouldAutoEnableSuperResolution(archive, true, -5), false);
  assert.equal(superResolution.shouldAutoEnableSuperResolution(archive, true, NaN), false);
  // 数据不足 → 不启用
  assert.equal(superResolution.shouldAutoEnableSuperResolution({}, true, 600), false);
});

test('unsigned reader setting inputs remove non-digit and negative content', () => {
  assert.equal(readerSettings.sanitizeUnsignedIntegerInput('500'), '500');
  assert.equal(readerSettings.sanitizeUnsignedIntegerInput('5a0-0'), '500');
  assert.equal(readerSettings.sanitizeUnsignedIntegerInput('-12'), '12');
  assert.equal(readerSettings.sanitizeUnsignedIntegerInput(''), '');
});

test('super resolution support requires WebGPU instead of falling back to WebGL or WASM', () => {
  const previous = {
    Worker: globalThis.Worker,
    createImageBitmap: globalThis.createImageBitmap,
    OffscreenCanvas: globalThis.OffscreenCanvas,
  };
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  globalThis.Worker = function Worker() {};
  globalThis.createImageBitmap = function createImageBitmap() {};
  globalThis.OffscreenCanvas = function OffscreenCanvas() {};
  try {
    assert.deepEqual(superResolution.detectSuperResolutionSupport(), {
      supported: false,
      reason: '当前浏览器或设备不支持 WebGPU，无法启用超分。',
    });
  } finally {
    Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test('super resolution rejects a WebGPU environment that cannot acquire an adapter', async () => {
  assert.deepEqual(await superResolution.verifySuperResolutionSupport({
    requestAdapter: async () => null,
  }), {
    supported: false,
    reason: '未找到可用的 WebGPU 显卡适配器，无法启用超分。',
  });
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

test('upload URL tasks deduplicate new valid URLs against the queue', () => {
  assert.equal(typeof upload.createUploadUrlTasks, 'function', 'createUploadUrlTasks must exist');
  const tasks = upload.createUploadUrlTasks([
    'https://example.test/one',
    'https://example.test/one',
    'https://example.test/two',
  ], new Set(['https://example.test/two']));

  assert.deepEqual(tasks, [{
    type: 'url',
    label: 'https://example.test/one',
    url: 'https://example.test/one',
    status: 'queued',
    progress: 0,
    message: '',
  }]);
});

test('upload tasks report per-item progress from the worker callback', async () => {
  const updates = [];
  const tasks = [{ id: 'one' }, { id: 'two' }];
  const results = await upload.runUploadTasks(tasks, async (task, index, updateProgress) => {
    updateProgress(index === 0 ? 37 : 82);
    return { id: task.id };
  }, (update) => {
    updates.push({ index: update.index, status: update.status, progress: update.progress });
  });

  assert.deepEqual(results.map((item) => item.status), ['success', 'success']);
  assert.ok(updates.some((item) => item.index === 0 && item.status === 'running' && item.progress === 37));
  assert.ok(updates.some((item) => item.index === 1 && item.status === 'running' && item.progress === 82));
  assert.deepEqual(updates.filter((item) => item.status === 'success').map((item) => item.progress), [100, 100]);
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

test('config export includes super-resolution reader settings', () => {
  const previousStorage = globalThis.localStorage;
  const readerSettingsValue = JSON.stringify({
    srEnabled: true,
    srModel: 'realcugan',
    srAuto: true,
    srAutoThreshold: 768,
  });
  globalThis.localStorage = {
    getItem: (key) => key === 'lrr_reader_settings' ? readerSettingsValue : null,
  };
  try {
    const binary = atob(workerConfig.exportConfig());
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const exported = JSON.parse(new TextDecoder().decode(bytes));
    assert.deepEqual(JSON.parse(exported.lrr_reader_settings), JSON.parse(readerSettingsValue));
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('config import normalizes super-resolution reader settings', () => {
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  try {
    const payload = {
      lrr_reader_settings: JSON.stringify({
        srEnabled: true,
        srModel: 'anime4k',
        srAuto: true,
        srAutoThreshold: 640,
        srPreloadCount: 8,
      }),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    assert.equal(workerConfig.importConfig(btoa(binary)), 1);
    const imported = JSON.parse(values.get('lrr_reader_settings'));
    assert.equal(imported.srEnabled, false);
    assert.equal(imported.srModel, 'waifu2x');
    assert.equal(imported.srAuto, true);
    assert.equal(imported.srAutoThreshold, 640);
    assert.equal('srPreloadCount' in imported, false);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('isBase64ConfigEncoded only accepts a Readoshi base64 config', () => {
  const enc = (value) => btoa(new TextEncoder().encode(value).reduce((s, b) => s + String.fromCharCode(b), ''));
  assert.equal(workerConfig.isBase64ConfigEncoded(enc(JSON.stringify({ lrr_api_key: 'k' }))), true);
  assert.equal(workerConfig.isBase64ConfigEncoded('随便的文本不是配置'), false);
  assert.equal(workerConfig.isBase64ConfigEncoded(''), false);
  assert.equal(workerConfig.isBase64ConfigEncoded(enc('not json')), false);
  assert.equal(workerConfig.isBase64ConfigEncoded(enc('[]')), false);
  assert.equal(workerConfig.isBase64ConfigEncoded(enc('{}')), false);
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
