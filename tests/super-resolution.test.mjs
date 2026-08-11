import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as imageCache from '../src/lib/imageCache.js';
import * as superResolution from '../src/lib/superResolution.js';
import * as tiling from '../src/lib/superResolutionTiling.js';
import { createSuperResolutionRuntime as createRawSuperResolutionRuntime } from '../src/lib/superResolutionRuntime.js';

function createWorkerHarness() {
  const messages = [];
  const listeners = new Map([
    ['message', new Set()],
    ['error', new Set()],
    ['messageerror', new Set()],
  ]);
  let terminated = false;

  return {
    messages,
    get terminated() {
      return terminated;
    },
    worker: {
      addEventListener(type, listener) {
        listeners.get(type)?.add(listener);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      postMessage(message, transfer) {
        messages.push({ message, transfer });
      },
      terminate() {
        terminated = true;
      },
    },
    emit(data) {
      for (const listener of listeners.get('message')) listener({ data });
    },
    emitWorkerEvent(type, event) {
      for (const listener of listeners.get(type)) listener(event);
    },
  };
}

const productionManifest = {
  id: 'anime4k-x2',
  url: 'https://models.example.test/anime4k-x2.wasm',
  scale: 2,
  inputLayout: 'nchw',
  outputLayout: 'nchw',
  checksum: {
    algorithm: 'SHA-256',
    digest: 'a'.repeat(64),
  },
  license: {
    name: 'MIT',
    url: 'https://opensource.org/license/mit',
  },
  production: true,
};

function validateManifest(manifest) {
  assert.equal(typeof superResolution.validateSuperResolutionManifest, 'function');
  return superResolution.validateSuperResolutionManifest(manifest);
}

function withTimeout(promise, message = 'promise did not settle') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), 100);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

const workerModuleUrl = new URL('../src/lib/superResolution.worker.js', import.meta.url);

test('production Worker loads the registered WebGL build and Vite-managed WASM assets', async () => {
  const workerSource = await readFile(workerModuleUrl, 'utf8');
  const runtimeSource = await readFile(
    new URL('../src/lib/superResolutionRuntime.js', import.meta.url),
    'utf8',
  );
  const viteSource = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  const ortSource = await readFile(
    new URL('../src/lib/superResolutionOrt.js', import.meta.url),
    'utf8',
  );

  assert.match(workerSource, /import \{ loadOrtBackend \} from '\.\/superResolutionOrt\.js';/);
  assert.doesNotMatch(workerSource, /import\('\.\/superResolutionOrt\.js'\)/);
  assert.match(ortSource, /import\('onnxruntime-web\/webgl'\)/);
  assert.match(ortSource, /import\('onnxruntime-web\/wasm'\)/);
  assert.match(ortSource, /new URL\('\.\.\/\.\.\/node_modules\/onnxruntime-web\/dist\/ort-wasm-simd-threaded\.mjs', import\.meta\.url\)/);
  assert.match(ortSource, /new URL\('\.\.\/\.\.\/node_modules\/onnxruntime-web\/dist\/ort-wasm-simd-threaded\.wasm', import\.meta\.url\)/);
  assert.match(ortSource, /ort\.env\.wasm\.wasmPaths\s*=\s*\{[\s\S]*mjs:[\s\S]*wasm:/);
  assert.match(viteSource, /worker:\s*\{\s*format:\s*'es',?\s*\}/);
  assert.match(runtimeSource, /new Worker\(new URL\('\.\/superResolution\.worker\.js', import\.meta\.url\)/);
  assert.doesNotMatch(runtimeSource, /new globalThis\.Worker\(new URL/);
});

test('Real-CUGAN reflects tile edges and disposes every inference tensor', async () => {
  const { createRealCuganProcessor, reflectIndex } = await import('../src/lib/realCugan.js');
  assert.deepEqual([-2, -1, 0, 3, 4, 5].map((index) => reflectIndex(index, 4)), [2, 1, 0, 3, 2, 1]);

  const disposed = [];
  let inputShape;
  const tf = {
    tensor4d(data, shape) {
      inputShape = shape;
      assert.equal(data.length, 64 * 64 * 3);
      return { dispose: () => disposed.push('input') };
    },
  };
  const model = {
    async executeAsync() {
      return {
        shape: [1, 128, 128, 3],
        async data() { return new Float32Array(128 * 128 * 3).fill(0.5); },
        dispose: () => disposed.push('output'),
      };
    },
    dispose: () => disposed.push('model'),
  };
  const processor = createRealCuganProcessor({ tf, model });
  const result = await processor.process(new Uint8ClampedArray(28 * 28 * 4).fill(255), 28, 28);

  assert.deepEqual(inputShape, [1, 64, 64, 3]);
  assert.equal(result.width, 56);
  assert.equal(result.height, 56);
  assert.equal(result.pixels[0], 128);
  assert.deepEqual(disposed, ['output', 'input']);
  processor.dispose();
  assert.deepEqual(disposed, ['output', 'input', 'model']);
});

test('Real-CUGAN backend initialization falls back from WebGL to WASM', async () => {
  const { initializeRealCuganBackend } = await import('../src/lib/realCugan.js');
  const attempts = [];
  const tf = {
    async setBackend(backend) {
      attempts.push(backend);
      return backend === 'wasm';
    },
    async ready() {},
    getBackend: () => attempts.at(-1),
  };
  assert.equal(await initializeRealCuganBackend(tf), 'wasm');
  assert.deepEqual(attempts, ['webgl', 'wasm']);
});

test('Real-CUGAN loads verified local weights through a TensorFlow.js IOHandler', async () => {
  const { createRealCuganModelIOHandler } = await import('../src/lib/realCugan.js');
  const weightData = new Uint8Array([1, 2, 3, 4]).buffer;
  const digestBytes = await globalThis.crypto.subtle.digest('SHA-256', weightData);
  const digest = Array.from(new Uint8Array(digestBytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const requests = [];
  const handler = createRealCuganModelIOHandler({
    manifest: {
      url: '/model.json',
      weightsUrl: '/weights.json',
      weightsChecksum: { digest },
    },
    fetcher: async (url) => {
      requests.push(url);
      if (url === '/model.json') {
        return {
          async json() {
            return {
              modelTopology: { node: [] },
              weightsManifest: [{ paths: ['group1-shard1of1.bin'], weights: [{ name: 'weight', shape: [4], dtype: 'int32' }] }],
              format: 'graph-model',
            };
          },
        };
      }
      return { async arrayBuffer() { return weightData; } };
    },
  });
  const artifacts = await handler.load();
  assert.deepEqual(requests, ['/model.json', '/weights.json']);
  assert.deepEqual(artifacts.weightSpecs, [{ name: 'weight', shape: [4], dtype: 'int32' }]);
  assert.equal(artifacts.weightData.byteLength, 4);
});

const workerManifest = {
  id: 'anime4k-x2',
  url: 'https://models.example.test/anime4k-x2.onnx',
  scale: 2,
  inputLayout: 'nchw',
  outputLayout: 'nchw',
  checksum: {
    algorithm: 'SHA-256',
    digest: 'a'.repeat(64),
  },
};

async function loadWorkerHandlerFactory() {
  try {
    const module = await import(workerModuleUrl.href);
    return module.createSuperResolutionWorkerHandler;
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw error;
  }
}

async function createWorkerHandler(dependencies) {
  const factory = await loadWorkerHandlerFactory();
  assert.equal(typeof factory, 'function');
  return factory(dependencies);
}

function createWorkerDependencies(overrides = {}) {
  const modelBytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const calls = {
    fetch: [],
    digest: [],
    session: [],
  };
  const session = {
    releaseCount: 0,
    async release() {
      this.releaseCount += 1;
    },
  };

  return {
    modelBytes,
    calls,
    session,
    dependencies: {
      fetcher: async (url) => {
        calls.fetch.push(url);
        return {
          ok: true,
          status: 200,
          async arrayBuffer() {
            return modelBytes;
          },
        };
      },
      digest: async (bytes) => {
        calls.digest.push(bytes);
        return workerManifest.checksum.digest;
      },
      sessionFactory: async (bytes, backend) => {
        calls.session.push({ bytes, backend });
        return session;
      },
      ...overrides,
    },
  };
}

function createMemoryCacheStorage(initialEntries = []) {
  const entries = new Map(initialEntries.map(([url, bytes]) => [
    url,
    new Uint8Array(bytes).slice().buffer,
  ]));
  return {
    entries,
    cacheStorage: {
      async open() {
        return {
          async match(url) {
            const bytes = entries.get(url);
            return bytes ? new Response(bytes) : undefined;
          },
          async put(url, response) {
            entries.set(url, await response.arrayBuffer());
          },
          async delete(url) {
            return entries.delete(url);
          },
        };
      },
    },
  };
}

test('exports a testable Worker session handler factory', async () => {
  const factory = await loadWorkerHandlerFactory();
  assert.equal(typeof factory, 'function');
});

test('initializes verified model bytes with WebGL and reports the actual backend', async () => {
  const fixture = createWorkerDependencies();
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'init',
    requestId: 'init-webgl',
    manifest: workerManifest,
  });

  assert.deepEqual(response, {
    type: 'ready',
    requestId: 'init-webgl',
    backend: 'webgl',
  });
  assert.deepEqual(fixture.calls.fetch, [workerManifest.url]);
  assert.equal(fixture.calls.digest.length, 1);
  assert.deepEqual(Array.from(new Uint8Array(fixture.calls.digest[0])), [1, 2, 3, 4]);
  assert.equal(fixture.calls.session.length, 1);
  assert.equal(fixture.calls.session[0].backend, 'webgl');
  assert.deepEqual(Array.from(new Uint8Array(fixture.calls.session[0].bytes)), [1, 2, 3, 4]);
});

test('honors a model manifest that requires the WASM execution provider', async () => {
  const fixture = createWorkerDependencies();
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'init',
    requestId: 'init-wasm-only',
    manifest: { ...workerManifest, executionProviders: ['wasm'] },
  });

  assert.deepEqual(response, {
    type: 'ready',
    requestId: 'init-wasm-only',
    backend: 'wasm',
  });
  assert.deepEqual(fixture.calls.session.map(({ backend }) => backend), ['wasm']);
});

test('dispatches Real-CUGAN manifests to its TensorFlow.js processor', async () => {
  const processor = {
    async process(_pixels, width, height) {
      return { pixels: new Uint8ClampedArray(width * height * 16), width: width * 2, height: height * 2 };
    },
    dispose() {},
  };
  const fixture = createWorkerDependencies({
    realCuganFactory: async () => ({ processor, backend: 'wasm' }),
    decodeImage: async () => ({
      width: 2,
      height: 2,
      pixels: new Uint8ClampedArray(16),
      close() {},
    }),
    encodeImage: async (image) => new Blob([String(image.width)], { type: 'image/png' }),
  });
  const handler = await createWorkerHandler(fixture.dependencies);
  const manifest = {
    ...workerManifest,
    engine: 'realcugan-tfjs',
    url: '/models/realcugan-2x-conservative/model.json',
  };

  const ready = await handler.handleMessage({ type: 'init', requestId: 'cugan-init', manifest });
  assert.equal(ready.type, 'ready');
  assert.equal(ready.backend, 'wasm');
  assert.equal(fixture.calls.fetch.length, 0);
  const result = await handler.handleMessage({
    type: 'process',
    requestId: 'cugan-process',
    manifest,
    blob: new Blob(['source']),
  });
  assert.equal(result.type, 'result', result.error?.message);
  assert.equal(result.width, 4);
  assert.equal(result.height, 4);
});

test('rejects unsupported manifest execution providers before creating a session', async () => {
  const fixture = createWorkerDependencies();
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'init',
    requestId: 'init-invalid-provider',
    manifest: { ...workerManifest, executionProviders: ['webgpu'] },
  });

  assert.equal(response.type, 'error');
  assert.equal(response.requestId, 'init-invalid-provider');
  assert.equal(response.error.name, 'ProtocolError');
  assert.match(response.error.message, /executionProviders/);
  assert.equal(fixture.calls.session.length, 0);
});

test('reuses cached model bytes only after validating them against the manifest checksum', async () => {
  const cachedBytes = new Uint8Array([7, 8, 9]).buffer;
  const cache = createMemoryCacheStorage([[workerManifest.url, cachedBytes]]);
  const fixture = createWorkerDependencies({ cacheStorage: cache.cacheStorage });
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'init',
    requestId: 'init-cache-hit',
    manifest: workerManifest,
  });

  assert.equal(response.type, 'ready', response.error?.message);
  assert.deepEqual(fixture.calls.fetch, []);
  assert.deepEqual(Array.from(new Uint8Array(fixture.calls.session[0].bytes)), [7, 8, 9]);
  assert.equal(fixture.calls.digest.length, 1);
});

test('evicts corrupt cached model bytes, refetches, and stores only the verified response', async () => {
  const cache = createMemoryCacheStorage([[
    workerManifest.url,
    new Uint8Array([9, 9, 9]).buffer,
  ]]);
  const fixture = createWorkerDependencies({
    cacheStorage: cache.cacheStorage,
    digest: async (bytes) => (
      new Uint8Array(bytes)[0] === 9 ? 'b'.repeat(64) : workerManifest.checksum.digest
    ),
  });
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'init',
    requestId: 'init-stale-cache',
    manifest: workerManifest,
  });

  assert.equal(response.type, 'ready', response.error?.message);
  assert.deepEqual(fixture.calls.fetch, [workerManifest.url]);
  assert.deepEqual(
    Array.from(new Uint8Array(cache.entries.get(workerManifest.url))),
    [1, 2, 3, 4],
  );
});

test('falls back to direct fetch when Cache Storage reads or writes fail', async () => {
  let failedReadCount = 0;
  const readFixture = createWorkerDependencies({
    cacheStorage: {
      async open() {
        return {
          async match() {
            failedReadCount += 1;
            throw new Error('cache read failed');
          },
          async put() {},
          async delete() {},
        };
      },
    },
  });
  const readHandler = await createWorkerHandler(readFixture.dependencies);
  const readResponse = await readHandler.handleMessage({
    type: 'init',
    requestId: 'init-cache-read-failure',
    manifest: workerManifest,
  });

  let failedWriteCount = 0;
  const writeFixture = createWorkerDependencies({
    cacheStorage: {
      async open() {
        return {
          async match() {
            return undefined;
          },
          async put() {
            failedWriteCount += 1;
            throw new Error('cache write failed');
          },
          async delete() {},
        };
      },
    },
  });
  const writeHandler = await createWorkerHandler(writeFixture.dependencies);
  const writeResponse = await writeHandler.handleMessage({
    type: 'init',
    requestId: 'init-cache-write-failure',
    manifest: workerManifest,
  });

  assert.equal(readResponse.type, 'ready', readResponse.error?.message);
  assert.equal(writeResponse.type, 'ready', writeResponse.error?.message);
  assert.equal(failedReadCount, 1);
  assert.equal(failedWriteCount, 1);
  assert.deepEqual(readFixture.calls.fetch, [workerManifest.url]);
  assert.deepEqual(writeFixture.calls.fetch, [workerManifest.url]);
});

test('does not cache fetched bytes that fail HTTP or checksum validation', async () => {
  const checksumCache = createMemoryCacheStorage();
  const checksumFixture = createWorkerDependencies({
    cacheStorage: checksumCache.cacheStorage,
    digest: async () => 'b'.repeat(64),
  });
  const checksumHandler = await createWorkerHandler(checksumFixture.dependencies);
  const checksumResponse = await checksumHandler.handleMessage({
    type: 'init',
    requestId: 'init-uncached-checksum-failure',
    manifest: workerManifest,
  });

  const httpCache = createMemoryCacheStorage();
  const httpFixture = createWorkerDependencies({
    cacheStorage: httpCache.cacheStorage,
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  const httpHandler = await createWorkerHandler(httpFixture.dependencies);
  const httpResponse = await httpHandler.handleMessage({
    type: 'init',
    requestId: 'init-uncached-http-failure',
    manifest: workerManifest,
  });

  assert.equal(checksumResponse.error?.name, 'ChecksumError');
  assert.equal(httpResponse.error?.name, 'FetchError');
  assert.equal(checksumCache.entries.has(workerManifest.url), false);
  assert.equal(httpCache.entries.has(workerManifest.url), false);
});

test('falls back to WASM only after a real WebGL session initialization failure', async () => {
  const fixture = createWorkerDependencies({
    sessionFactory: async (bytes, backend) => {
      fixture.calls.session.push({ bytes, backend });
      if (backend === 'webgl') throw new Error('WebGL session unavailable');
      return fixture.session;
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'init',
    requestId: 'init-wasm',
    manifest: workerManifest,
  });

  assert.deepEqual(response, {
    type: 'ready',
    requestId: 'init-wasm',
    backend: 'wasm',
  });
  assert.deepEqual(fixture.calls.session.map(({ backend }) => backend), ['webgl', 'wasm']);
});

test('accepts a trimmed case-insensitive SHA-256 algorithm and uppercase 64-hex digest', async () => {
  const fixture = createWorkerDependencies({
    digest: async () => 'A'.repeat(64),
  });
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'init',
    requestId: 'init-normalized-checksum',
    manifest: {
      ...workerManifest,
      checksum: {
        algorithm: '  sHa-256  ',
        digest: 'A'.repeat(64),
      },
    },
  });

  assert.deepEqual(response, {
    type: 'ready',
    requestId: 'init-normalized-checksum',
    backend: 'webgl',
  });
});

test('rejects a checksum manifest unless its digest is exactly 64 hexadecimal characters', async () => {
  for (const digest of ['a'.repeat(63), `${'a'.repeat(63)}g`]) {
    const fixture = createWorkerDependencies();
    const handler = await createWorkerHandler(fixture.dependencies);

    const response = await handler.handleMessage({
      type: 'init',
      requestId: `init-invalid-digest-${digest.length}`,
      manifest: {
        ...workerManifest,
        checksum: { algorithm: 'SHA-256', digest },
      },
    });

    assert.equal(response.type, 'error');
    assert.equal(response.error.name, 'ProtocolError');
    assert.equal(fixture.calls.session.length, 0);
  }
});

test('falls back to WASM when the WebGL factory returns null and reports the actual backend', async () => {
  const fixture = createWorkerDependencies({
    sessionFactory: async (bytes, backend) => {
      fixture.calls.session.push({ bytes, backend });
      return backend === 'webgl' ? null : fixture.session;
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'init',
    requestId: 'init-null-webgl',
    manifest: workerManifest,
  });

  assert.deepEqual(response, {
    type: 'ready',
    requestId: 'init-null-webgl',
    backend: 'wasm',
  });
  assert.deepEqual(fixture.calls.session.map(({ backend }) => backend), ['webgl', 'wasm']);
});

test('returns SessionInitializationError when both backend factories return null', async () => {
  const fixture = createWorkerDependencies({
    sessionFactory: async (bytes, backend) => {
      fixture.calls.session.push({ bytes, backend });
      return null;
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'init',
    requestId: 'init-null-both',
    manifest: workerManifest,
  });

  assert.equal(response.type, 'error');
  assert.equal(response.error.name, 'SessionInitializationError');
  assert.deepEqual(fixture.calls.session.map(({ backend }) => backend), ['webgl', 'wasm']);
});

test('returns a structured checksum error without creating a session', async () => {
  const fixture = createWorkerDependencies({
    digest: async () => 'b'.repeat(64),
  });
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'init',
    requestId: 'init-bad-digest',
    manifest: workerManifest,
  });

  assert.equal(response.type, 'error');
  assert.equal(response.requestId, 'init-bad-digest');
  assert.equal(response.error.name, 'ChecksumError');
  assert.match(response.error.message, /SHA-256.*mismatch/i);
  assert.equal(fixture.calls.session.length, 0);
});

test('returns structured fetch failures from init', async () => {
  const fixture = createWorkerDependencies({
    fetcher: async () => {
      const error = new Error('model server unavailable');
      error.name = 'NetworkError';
      throw error;
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'init',
    requestId: 'init-fetch-error',
    manifest: workerManifest,
  });

  assert.deepEqual(response, {
    type: 'error',
    requestId: 'init-fetch-error',
    error: { name: 'NetworkError', message: 'model server unavailable' },
  });
  assert.equal(fixture.calls.session.length, 0);
});

test('returns a structured error when both backend session initializations fail', async () => {
  const fixture = createWorkerDependencies({
    sessionFactory: async (_, backend) => {
      const error = new Error(`${backend} session failed`);
      error.name = `${backend}Error`;
      throw error;
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'init',
    requestId: 'init-session-error',
    manifest: workerManifest,
  });

  assert.equal(response.type, 'error');
  assert.equal(response.requestId, 'init-session-error');
  assert.equal(response.error.name, 'SessionInitializationError');
  assert.match(response.error.message, /WebGL session failed/);
  assert.match(response.error.message, /WASM session failed/);
});

test('returns a not-initialized protocol error for process before init', async () => {
  const fixture = createWorkerDependencies();
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'process',
    requestId: 'process-before-init',
    pixels: new Uint8Array([1, 2, 3, 4]),
    width: 1,
    height: 1,
  });

  assert.deepEqual(response, {
    type: 'error',
    requestId: 'process-before-init',
    error: {
      name: 'NotInitializedError',
      message: 'Super-resolution session is not initialized',
    },
  });
});

test('cancellation marks a request stale before later tile processing', async () => {
  const fixture = createWorkerDependencies();
  const handler = await createWorkerHandler(fixture.dependencies);
  await handler.handleMessage({
    type: 'init',
    requestId: 'init-cancel',
    manifest: workerManifest,
  });

  await handler.handleMessage({ type: 'cancel', requestId: 'stale-tile' });
  const response = await handler.handleMessage({
    type: 'process',
    requestId: 'stale-tile',
    pixels: new Uint8Array([1, 2, 3, 4]),
    width: 1,
    height: 1,
  });

  assert.deepEqual(response, {
    type: 'error',
    requestId: 'stale-tile',
    error: {
      name: 'AbortError',
      message: 'Super-resolution request was cancelled',
    },
  });
});

test('consumes a stale cancellation during process so the same request id can retry', async () => {
  const fixture = createWorkerDependencies();
  const handler = await createWorkerHandler(fixture.dependencies);
  await handler.handleMessage({
    type: 'init',
    requestId: 'init-cancel-once',
    manifest: workerManifest,
  });

  await handler.handleMessage({ type: 'cancel', requestId: 'retryable-tile' });
  const cancelledResponse = await handler.handleMessage({
    type: 'process',
    requestId: 'retryable-tile',
    pixels: new Uint8Array([1, 2, 3, 4]),
    width: 1,
    height: 1,
  });
  assert.equal(cancelledResponse.error.name, 'AbortError');

  const retryResponse = await handler.handleMessage({
    type: 'process',
    requestId: 'retryable-tile',
    pixels: new Uint8Array([1, 2, 3, 4]),
    width: 1,
    height: 1,
  });
  assert.equal(retryResponse.error.name, 'NotImplementedError');
});

test('releases a session created by an init made stale by dispose without installing it', async () => {
  const factoryStarted = createDeferred();
  const sessionGate = createDeferred();
  const staleSession = {
    releaseCount: 0,
    async release() {
      this.releaseCount += 1;
    },
  };
  const fixture = createWorkerDependencies({
    sessionFactory: async (bytes, backend) => {
      fixture.calls.session.push({ bytes, backend });
      factoryStarted.resolve();
      await sessionGate.promise;
      return staleSession;
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);

  const initPromise = handler.handleMessage({
    type: 'init',
    requestId: 'init-stale-dispose',
    manifest: workerManifest,
  });
  await factoryStarted.promise;

  const disposeResponse = await handler.handleMessage({
    type: 'dispose',
    requestId: 'dispose-during-init',
  });
  assert.equal(disposeResponse.type, 'disposed');

  sessionGate.resolve();
  const initResponse = await initPromise;
  assert.equal(initResponse.type, 'error');
  assert.equal(initResponse.error.name, 'StaleInitializationError');
  assert.equal(staleSession.releaseCount, 1);

  const processResponse = await handler.handleMessage({
    type: 'process',
    requestId: 'process-after-stale-dispose',
    pixels: new Uint8Array([1, 2, 3, 4]),
    width: 1,
    height: 1,
  });
  assert.equal(processResponse.error.name, 'DisposedError');
});

test('releases a session from an older init when a later init installs a newer session', async () => {
  const firstFactoryStarted = createDeferred();
  const firstSessionGate = createDeferred();
  const firstSession = {
    releaseCount: 0,
    async release() {
      this.releaseCount += 1;
    },
  };
  const secondSession = {
    releaseCount: 0,
    async release() {
      this.releaseCount += 1;
    },
  };
  let factoryCallCount = 0;
  const fixture = createWorkerDependencies({
    sessionFactory: async (bytes, backend) => {
      fixture.calls.session.push({ bytes, backend });
      factoryCallCount += 1;
      if (factoryCallCount === 1) {
        firstFactoryStarted.resolve();
        await firstSessionGate.promise;
        return firstSession;
      }
      return secondSession;
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);

  const firstInitPromise = handler.handleMessage({
    type: 'init',
    requestId: 'init-old-generation',
    manifest: workerManifest,
  });
  await firstFactoryStarted.promise;

  const secondResponse = await handler.handleMessage({
    type: 'init',
    requestId: 'init-new-generation',
    manifest: workerManifest,
  });
  assert.deepEqual(secondResponse, {
    type: 'ready',
    requestId: 'init-new-generation',
    backend: 'webgl',
  });

  firstSessionGate.resolve();
  const firstResponse = await firstInitPromise;
  assert.equal(firstResponse.type, 'error');
  assert.equal(firstResponse.error.name, 'StaleInitializationError');
  assert.equal(firstSession.releaseCount, 1);
  assert.equal(secondSession.releaseCount, 0);

  const processResponse = await handler.handleMessage({
    type: 'process',
    requestId: 'process-new-generation',
    pixels: new Uint8Array([1, 2, 3, 4]),
    width: 1,
    height: 1,
  });
  assert.equal(processResponse.error.name, 'NotImplementedError');
});

test('dispose releases the session and clears the handler state', async () => {
  const fixture = createWorkerDependencies();
  const handler = await createWorkerHandler(fixture.dependencies);
  await handler.handleMessage({
    type: 'init',
    requestId: 'init-dispose',
    manifest: workerManifest,
  });

  const disposeResponse = await handler.handleMessage({
    type: 'dispose',
    requestId: 'dispose-session',
  });
  assert.deepEqual(disposeResponse, {
    type: 'disposed',
    requestId: 'dispose-session',
  });
  assert.equal(fixture.session.releaseCount, 1);

  const processResponse = await handler.handleMessage({
    type: 'process',
    requestId: 'process-after-dispose',
    pixels: new Uint8Array([1, 2, 3, 4]),
    width: 1,
    height: 1,
  });
  assert.equal(processResponse.error.name, 'DisposedError');
});

test('returns structured protocol errors for unknown messages', async () => {
  const fixture = createWorkerDependencies();
  const handler = await createWorkerHandler(fixture.dependencies);

  const response = await handler.handleMessage({
    type: 'unknown',
    requestId: 'unknown-request',
  });

  assert.equal(response.type, 'error');
  assert.equal(response.requestId, 'unknown-request');
  assert.equal(response.error.name, 'ProtocolError');
  assert.match(response.error.message, /unknown message type/i);
});

test('processes an RGBA blob through an NCHW session and preserves nearest alpha', async () => {
  const encoded = [];
  let decodedCloseCount = 0;
  let inputDisposeCount = 0;
  let outputDisposeCount = 0;
  const session = {
    inputNames: ['input'],
    outputNames: ['output'],
    async run(feeds) {
      assert.deepEqual(feeds.input.dims, [1, 3, 1, 1]);
      assert.equal(feeds.input.data[0], 1);
      assert.ok(Math.abs(feeds.input.data[1] - 128 / 255) < 1e-6);
      assert.equal(feeds.input.data[2], 0);
      return {
        output: {
          dims: [1, 3, 2, 2],
          data: new Float32Array([
            1, 1, 1, 1,
            128 / 255, 128 / 255, 128 / 255, 128 / 255,
            0, 0, 0, 0,
          ]),
          dispose() {
            outputDisposeCount += 1;
          },
        },
      };
    },
    async release() {},
  };
  const fixture = createWorkerDependencies({
    sessionFactory: async () => session,
    decodeImage: async () => ({
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([255, 128, 0, 64]),
      close() {
        decodedCloseCount += 1;
      },
    }),
    tensorFactory(data, dims) {
      return {
        data,
        dims,
        dispose() {
          inputDisposeCount += 1;
        },
      };
    },
    encodeImage: async (image) => {
      encoded.push(image);
      return new Blob(['upscaled'], { type: 'image/png' });
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);
  const manifest = { ...workerManifest, tileCore: 1, padding: 0 };
  await handler.handleMessage({ type: 'init', requestId: 'init-nchw-process', manifest });

  const response = await handler.handleMessage({
    type: 'process',
    requestId: 'process-nchw',
    blob: new Blob(['source'], { type: 'image/png' }),
    manifest,
  });

  assert.equal(response.type, 'result', response.error?.message);
  assert.equal(response.requestId, 'process-nchw');
  assert.equal(response.width, 2);
  assert.equal(response.height, 2);
  assert.equal(response.backend, 'webgl');
  assert.equal(response.blob.type, 'image/png');
  assert.deepEqual(Array.from(encoded[0].pixels), [
    255, 128, 0, 64,
    255, 128, 0, 64,
    255, 128, 0, 64,
    255, 128, 0, 64,
  ]);
  assert.equal(decodedCloseCount, 1);
  assert.equal(inputDisposeCount, 1);
  assert.equal(outputDisposeCount, 1);
});

test('processes a fixed-size YCbCr luma model and reconstructs source chroma', async () => {
  let encoded;
  const session = {
    inputNames: ['input'],
    outputNames: ['output'],
    async run(feeds) {
      assert.deepEqual(feeds.input.dims, [1, 1, 2, 2]);
      for (const value of feeds.input.data) assert.ok(Math.abs(value - 0.299) < 0.002);
      return {
        output: {
          dims: [1, 1, 6, 6],
          data: new Float32Array(36).fill(0.299),
        },
      };
    },
    async release() {},
  };
  const fixture = createWorkerDependencies({
    sessionFactory: async () => session,
    decodeImage: async () => ({
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([255, 0, 0, 80]),
      close() {},
    }),
    tensorFactory: (data, dims) => ({ data, dims }),
    encodeImage: async (image) => {
      encoded = image;
      return new Blob(['ycbcr'], { type: 'image/png' });
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);
  const manifest = {
    ...workerManifest,
    scale: 3,
    colorSpace: 'ycbcr-y',
    inputWidth: 2,
    inputHeight: 2,
    tileCore: 1,
    padding: 0,
  };
  await handler.handleMessage({ type: 'init', requestId: 'init-ycbcr', manifest });

  const response = await handler.handleMessage({
    type: 'process',
    requestId: 'process-ycbcr',
    blob: new Blob(['source']),
    manifest,
  });

  assert.equal(response.type, 'result', response.error?.message);
  assert.equal(response.width, 3);
  assert.equal(response.height, 3);
  for (let offset = 0; offset < encoded.pixels.length; offset += 4) {
    assert.ok(encoded.pixels[offset] >= 253);
    assert.ok(encoded.pixels[offset + 1] <= 2);
    assert.ok(encoded.pixels[offset + 2] <= 2);
    assert.equal(encoded.pixels[offset + 3], 80);
  }
});

test('replicate-pads NHWC tiles, stitches cropped cores, and scales alpha', async () => {
  const inputRows = [];
  let runCount = 0;
  let encoded;
  const session = {
    inputNames: ['image'],
    outputNames: ['upscaled'],
    async run(feeds) {
      runCount += 1;
      inputRows.push(Array.from(feeds.image.data.slice(0, 9)));
      const color = runCount === 1 ? [1, 0, 0] : [0, 1, 0];
      const data = new Float32Array(6 * 6 * 3);
      for (let index = 0; index < 6 * 6; index += 1) data.set(color, index * 3);
      return { upscaled: { dims: [1, 6, 6, 3], data } };
    },
    async release() {},
  };
  const fixture = createWorkerDependencies({
    sessionFactory: async () => session,
    decodeImage: async () => ({
      width: 2,
      height: 1,
      pixels: new Uint8ClampedArray([
        255, 0, 0, 10,
        0, 255, 0, 20,
      ]),
      close() {},
    }),
    tensorFactory: (data, dims) => ({ data, dims }),
    encodeImage: async (image) => {
      encoded = image;
      return new Blob(['nhwc'], { type: 'image/png' });
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);
  const manifest = {
    ...workerManifest,
    inputLayout: 'nhwc',
    outputLayout: 'nhwc',
    tileCore: 1,
    padding: 1,
  };
  await handler.handleMessage({ type: 'init', requestId: 'init-nhwc-tiles', manifest });

  const response = await handler.handleMessage({
    type: 'process',
    requestId: 'process-nhwc-tiles',
    blob: new Blob(['source']),
    manifest,
  });

  assert.equal(response.type, 'result');
  assert.equal(runCount, 2);
  assert.deepEqual(inputRows[0], [1, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(inputRows[1], [1, 0, 0, 0, 1, 0, 0, 1, 0]);
  assert.deepEqual(Array.from(encoded.pixels), [
    255, 0, 0, 10,
    255, 0, 0, 10,
    0, 255, 0, 20,
    0, 255, 0, 20,
    255, 0, 0, 10,
    255, 0, 0, 10,
    0, 255, 0, 20,
    0, 255, 0, 20,
  ]);
});

test('rejects invalid model output dimensions and closes decoded resources', async () => {
  let decodedCloseCount = 0;
  const session = {
    inputNames: ['input'],
    outputNames: ['output'],
    async run() {
      return { output: { dims: [1, 3, 1, 1], data: new Float32Array(3) } };
    },
    async release() {},
  };
  const fixture = createWorkerDependencies({
    sessionFactory: async () => session,
    decodeImage: async () => ({
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([1, 2, 3, 4]),
      close() {
        decodedCloseCount += 1;
      },
    }),
    tensorFactory: (data, dims) => ({ data, dims }),
    encodeImage: async () => new Blob(),
  });
  const handler = await createWorkerHandler(fixture.dependencies);
  const manifest = { ...workerManifest, tileCore: 1, padding: 0 };
  await handler.handleMessage({ type: 'init', requestId: 'init-bad-shape', manifest });

  const response = await handler.handleMessage({
    type: 'process',
    requestId: 'process-bad-shape',
    blob: new Blob(['source']),
    manifest,
  });

  assert.equal(response.type, 'error');
  assert.equal(response.error.name, 'TensorShapeError');
  assert.equal(decodedCloseCount, 1);
});

test('rejects oversized output before allocating or running inference', async () => {
  let decodedCloseCount = 0;
  let runCount = 0;
  const session = {
    async run() {
      runCount += 1;
      throw new Error('must not run');
    },
    async release() {},
  };
  const fixture = createWorkerDependencies({
    sessionFactory: async () => session,
    decodeImage: async () => ({
      width: 4097,
      height: 4097,
      pixels: { length: 4097 * 4097 * 4 },
      close() {
        decodedCloseCount += 1;
      },
    }),
  });
  const handler = await createWorkerHandler(fixture.dependencies);
  const manifest = { ...workerManifest, scale: 4 };
  await handler.handleMessage({ type: 'init', requestId: 'init-large-output', manifest });

  const response = await handler.handleMessage({
    type: 'process',
    requestId: 'process-large-output',
    blob: new Blob(['source']),
    manifest,
  });

  assert.equal(response.type, 'error');
  assert.equal(response.error.name, 'NotSupportedError');
  assert.match(response.error.message, /inference.*pixel/i);
  assert.equal(runCount, 0);
  assert.equal(decodedCloseCount, 1);
});

test('cancels between tiles and discards a result returned by an active session run', async () => {
  const runStarted = createDeferred();
  const runGate = createDeferred();
  let runCount = 0;
  let encodeCount = 0;
  let outputDisposeCount = 0;
  const session = {
    inputNames: ['input'],
    outputNames: ['output'],
    async run() {
      runCount += 1;
      runStarted.resolve();
      await runGate.promise;
      return {
        output: {
          dims: [1, 3, 2, 2],
          data: new Float32Array(12),
          dispose() {
            outputDisposeCount += 1;
          },
        },
      };
    },
    async release() {},
  };
  const fixture = createWorkerDependencies({
    sessionFactory: async () => session,
    decodeImage: async () => ({
      width: 2,
      height: 1,
      pixels: new Uint8ClampedArray(8),
      close() {},
    }),
    tensorFactory: (data, dims) => ({ data, dims }),
    encodeImage: async () => {
      encodeCount += 1;
      return new Blob();
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);
  const manifest = { ...workerManifest, tileCore: 1, padding: 0 };
  await handler.handleMessage({ type: 'init', requestId: 'init-active-cancel', manifest });

  const processPromise = handler.handleMessage({
    type: 'process',
    requestId: 'active-cancel',
    blob: new Blob(['source']),
    manifest,
  });
  await runStarted.promise;
  await handler.handleMessage({ type: 'cancel', requestId: 'active-cancel' });
  runGate.resolve();

  const response = await processPromise;
  assert.equal(response.type, 'error');
  assert.equal(response.error.name, 'AbortError');
  assert.equal(runCount, 1);
  assert.equal(encodeCount, 0);
  assert.equal(outputDisposeCount, 1);
});

test('discards a cancelled result that finishes encoding after the request becomes stale', async () => {
  const encodeStarted = createDeferred();
  const encodeGate = createDeferred();
  const session = {
    inputNames: ['input'],
    outputNames: ['output'],
    async run() {
      return {
        output: {
          dims: [1, 3, 2, 2],
          data: new Float32Array(12),
        },
      };
    },
    async release() {},
  };
  const fixture = createWorkerDependencies({
    sessionFactory: async () => session,
    decodeImage: async () => ({
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray(4),
      close() {},
    }),
    tensorFactory: (data, dims) => ({ data, dims }),
    encodeImage: async () => {
      encodeStarted.resolve();
      await encodeGate.promise;
      return new Blob(['late']);
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);
  const manifest = { ...workerManifest, tileCore: 1, padding: 0 };
  await handler.handleMessage({ type: 'init', requestId: 'init-encode-cancel', manifest });
  const processPromise = handler.handleMessage({
    type: 'process',
    requestId: 'encode-cancel',
    blob: new Blob(['source']),
    manifest,
  });
  await encodeStarted.promise;
  await handler.handleMessage({ type: 'cancel', requestId: 'encode-cancel' });
  encodeGate.resolve();

  const response = await processPromise;
  assert.equal(response.type, 'error');
  assert.equal(response.error.name, 'AbortError');
});

test('runtime forwards init, pixel processing, cancellation, and disposal messages', async () => {
  assert.equal(typeof superResolution.createSuperResolutionRuntime, 'function');
  const harness = createWorkerHarness();
  const runtime = superResolution.createSuperResolutionRuntime({
    workerFactory: () => harness.worker,
  });

  const initPromise = runtime.init(productionManifest);
  const initMessage = harness.messages[0].message;
  assert.equal(initMessage.type, 'init');
  assert.equal(typeof initMessage.requestId, 'string');
  assert.deepEqual(initMessage.manifest, productionManifest);
  harness.emit({
    type: 'ready',
    requestId: initMessage.requestId,
    backend: 'wasm',
  });
  assert.deepEqual(await initPromise, { backend: 'wasm' });

  const pixels = new Uint8Array([1, 2, 3, 4]);
  const processPromise = runtime.processPixels({
    requestId: 'pixels-1',
    pixels,
    width: 1,
    height: 1,
  });
  const processMessage = harness.messages[1];
  assert.equal(processMessage.message.type, 'process');
  assert.equal(processMessage.message.requestId, 'pixels-1');
  assert.equal(processMessage.message.pixels, pixels);
  assert.equal(processMessage.transfer.includes(pixels.buffer), true);
  runtime.cancel('pixels-1');
  assert.deepEqual(harness.messages[2].message, {
    type: 'cancel',
    requestId: 'pixels-1',
  });
  await assert.rejects(
    withTimeout(processPromise),
    (error) => error?.name === 'AbortError',
  );

  // A result emitted after cancellation must not settle the cancelled request.
  harness.emit({
    type: 'result',
    requestId: 'pixels-1',
    pixels,
  });

  const retryPixels = new Uint8Array([5, 6, 7, 8]);
  const retryPromise = runtime.processPixels({
    requestId: 'pixels-1',
    pixels: retryPixels,
    width: 1,
    height: 1,
  });
  harness.emit({
    type: 'result',
    requestId: 'pixels-1',
    pixels: retryPixels,
  });
  assert.deepEqual(await retryPromise, { requestId: 'pixels-1', pixels: retryPixels });

  runtime.dispose();
  assert.equal(harness.terminated, true);
});

test('runtime forwards blobs and maps AbortSignal to worker cancellation', async () => {
  const harness = createWorkerHarness();
  const runtime = superResolution.createSuperResolutionRuntime({
    workerFactory: () => harness.worker,
  });
  const blob = new Blob(['source'], { type: 'image/png' });

  const processPromise = runtime.processBlob(blob, {
    manifest: productionManifest,
    requestId: 'blob-result',
  });
  assert.deepEqual(harness.messages[0].message, {
    type: 'process',
    requestId: 'blob-result',
    blob,
    manifest: productionManifest,
  });
  const resultBlob = new Blob(['result'], { type: 'image/png' });
  harness.emit({
    type: 'result',
    requestId: 'blob-result',
    blob: resultBlob,
    width: 2,
    height: 2,
    backend: 'wasm',
  });
  assert.deepEqual(await processPromise, {
    requestId: 'blob-result',
    blob: resultBlob,
    width: 2,
    height: 2,
    backend: 'wasm',
  });

  const controller = new AbortController();
  const cancelledPromise = runtime.processBlob(blob, {
    manifest: productionManifest,
    requestId: 'blob-cancel',
    signal: controller.signal,
  });
  controller.abort();
  assert.deepEqual(harness.messages[2].message, {
    type: 'cancel',
    requestId: 'blob-cancel',
  });
  await assert.rejects(cancelledPromise, (error) => error?.name === 'AbortError');
  runtime.dispose();
});

test('dispose rejects all pending requests and terminates the worker', async () => {
  const harness = createWorkerHarness();
  const runtime = superResolution.createSuperResolutionRuntime({
    workerFactory: () => harness.worker,
  });

  const initPromise = runtime.init(productionManifest);
  const processPromise = runtime.processPixels({
    requestId: 'dispose-process',
    pixels: new Uint8Array([1, 2, 3, 4]),
    width: 1,
    height: 1,
  });
  runtime.dispose();

  await assert.rejects(initPromise, /disposed/);
  await assert.rejects(processPromise, /disposed/);
  assert.deepEqual(harness.messages[2].message, { type: 'dispose' });
  assert.equal(harness.terminated, true);
});

test('rejects all pending requests on worker error', async () => {
  const harness = createWorkerHarness();
  const runtime = superResolution.createSuperResolutionRuntime({
    workerFactory: () => harness.worker,
  });
  const initPromise = runtime.init(productionManifest);
  const processPromise = runtime.processPixels({
    requestId: 'worker-error-process',
    pixels: new Uint8Array([1, 2, 3, 4]),
    width: 1,
    height: 1,
  });

  harness.emitWorkerEvent('error', { error: new Error('worker crashed') });

  await assert.rejects(withTimeout(initPromise), /worker crashed/);
  await assert.rejects(withTimeout(processPromise), /worker crashed/);
  runtime.dispose();
});

test('rejects all pending requests on worker messageerror', async () => {
  const harness = createWorkerHarness();
  const runtime = superResolution.createSuperResolutionRuntime({
    workerFactory: () => harness.worker,
  });
  const initPromise = runtime.init(productionManifest);
  const processPromise = runtime.processPixels({
    requestId: 'message-error-process',
    pixels: new Uint8Array([1, 2, 3, 4]),
    width: 1,
    height: 1,
  });

  harness.emitWorkerEvent('messageerror', { message: 'message could not be cloned' });

  await assert.rejects(withTimeout(initPromise), /message could not be cloned/);
  await assert.rejects(withTimeout(processPromise), /message could not be cloned/);
  runtime.dispose();
});

test('rejects matching request ids with a protocol type mismatch', async () => {
  const harness = createWorkerHarness();
  const runtime = superResolution.createSuperResolutionRuntime({
    workerFactory: () => harness.worker,
  });
  const initPromise = runtime.init(productionManifest);
  const requestId = harness.messages[0].message.requestId;

  harness.emit({ type: 'result', requestId, pixels: new Uint8Array([1]) });

  await assert.rejects(withTimeout(initPromise), /protocol/i);
  runtime.dispose();
});

test('rejects matching request ids with an unknown protocol type', async () => {
  const harness = createWorkerHarness();
  const runtime = superResolution.createSuperResolutionRuntime({
    workerFactory: () => harness.worker,
  });
  const processPromise = runtime.processPixels({
    requestId: 'unknown-response-process',
    pixels: new Uint8Array([1, 2, 3, 4]),
    width: 1,
    height: 1,
  });

  harness.emit({ type: 'unexpected', requestId: 'unknown-response-process' });

  await assert.rejects(withTimeout(processPromise), /protocol/i);
  runtime.dispose();
});

test('rejects non-buffer pixel inputs before posting to the worker', async () => {
  const harness = createWorkerHarness();
  const runtime = superResolution.createSuperResolutionRuntime({
    workerFactory: () => harness.worker,
  });

  await assert.rejects(
    withTimeout(runtime.processPixels({ pixels: [1, 2, 3, 4], width: 1, height: 1 })),
    /pixels.*ArrayBuffer/i,
  );
  assert.equal(harness.messages.length, 0);
  runtime.dispose();
});

test('rejects non-positive or non-integer pixel dimensions before posting', async () => {
  const invalidDimensions = [
    { width: 0, height: 1 },
    { width: 1, height: 0 },
    { width: 1.5, height: 1 },
    { width: 1, height: 1.5 },
  ];

  for (const { width, height } of invalidDimensions) {
    const harness = createWorkerHarness();
    const runtime = superResolution.createSuperResolutionRuntime({
      workerFactory: () => harness.worker,
    });
    await assert.rejects(
      withTimeout(runtime.processPixels({
        pixels: new Uint8Array([1, 2, 3, 4]),
        width,
        height,
      })),
      /positive integers/i,
    );
    assert.equal(harness.messages.length, 0);
    runtime.dispose();
  }
});

test('raw runtime uses the injected manifest validator', async () => {
  const harness = createWorkerHarness();
  const manifest = { id: 'accepted-by-injected-validator' };
  let receivedManifest;
  const runtime = createRawSuperResolutionRuntime({
    workerFactory: () => harness.worker,
    manifestValidator(value) {
      receivedManifest = value;
      return true;
    },
  });

  const initPromise = runtime.init(manifest);
  const initMessage = harness.messages[0].message;
  harness.emit({ type: 'ready', requestId: initMessage.requestId, backend: 'wasm' });

  assert.deepEqual(await initPromise, { backend: 'wasm' });
  assert.equal(receivedManifest, manifest);
  runtime.dispose();
});

test('resolves a super-resolution model by its value', () => {
  assert.equal(typeof superResolution.getSuperResolutionModel, 'function');
  const model = superResolution.getSuperResolutionModel('realcugan');
  assert.equal(model.value, 'realcugan');
  assert.equal(model.label, 'Real-CUGAN');
  assert.equal(model.engine, 'realcugan-tfjs');
  assert.equal(validateManifest(model), true);
});

test('does not ship the test-only ONNX sub-pixel model', () => {
  assert.equal(superResolution.getSuperResolutionModel('onnx-subpixel-x3'), null);
  assert.deepEqual(superResolution.SUPER_RESOLUTION_MODELS.map((model) => model.value), ['waifu2x', 'realcugan']);
});

test('describes every selectable super-resolution model', () => {
  for (const model of superResolution.SUPER_RESOLUTION_MODELS) {
    assert.equal(typeof model.description, 'string', model.value);
    assert.ok(model.description.trim().length > 0, model.value);
  }
});

test('ships a pinned Waifu2x CUNet x2 manifest with cropped-output geometry', () => {
  const model = superResolution.getSuperResolutionModel('waifu2x');
  assert.equal(model.id, 'waifu2x-cunet-art-scale2x-20250502');
  assert.equal(model.scale, 2);
  assert.equal(model.inputName, 'x');
  assert.equal(model.outputName, 'y');
  assert.equal(model.inputLayout, 'nchw');
  assert.equal(model.outputLayout, 'nchw');
  assert.equal(model.inputWidth, 224);
  assert.equal(model.inputHeight, 224);
  assert.equal(model.tileCore, 152);
  assert.equal(model.padding, 36);
  assert.equal(model.outputInset, 18);
  assert.equal(model.checksum.digest, '0966d74dd0739a20de358de88c8fa4eb6cb8c3489bb0e941da9751ad4dcdf495');
  assert.equal(validateManifest(model), true);
});

test('accepts the production Waifu2x 224px input and 376px output geometry', async () => {
  const model = superResolution.getSuperResolutionModel('waifu2x');
  const session = {
    inputNames: ['x'],
    outputNames: ['y'],
    async run(feeds) {
      assert.deepEqual(feeds.x.dims, [1, 3, 224, 224]);
      return { y: { dims: [1, 3, 376, 376], data: new Float32Array(3 * 376 * 376).fill(0.5) } };
    },
    async release() {},
  };
  const fixture = createWorkerDependencies({
    sessionFactory: async () => session,
    decodeImage: async () => ({
      width: 152,
      height: 152,
      pixels: new Uint8ClampedArray(152 * 152 * 4).fill(255),
      close() {},
    }),
    tensorFactory: (data, dims) => ({ data, dims }),
    encodeImage: async () => new Blob(['waifu2x'], { type: 'image/png' }),
  });
  const handler = await createWorkerHandler(fixture.dependencies);
  const manifest = {
    ...workerManifest,
    engine: 'onnx',
    inputName: model.inputName,
    outputName: model.outputName,
    inputWidth: model.inputWidth,
    inputHeight: model.inputHeight,
    tileCore: model.tileCore,
    padding: model.padding,
    outputInset: model.outputInset,
    scale: model.scale,
    executionProviders: ['wasm'],
  };
  await handler.handleMessage({ type: 'init', requestId: 'init-production-waifu2x', manifest });
  const response = await handler.handleMessage({
    type: 'process',
    requestId: 'process-production-waifu2x',
    blob: new Blob(['source']),
    manifest,
  });
  assert.equal(response.type, 'result', response.error?.message);
  assert.equal(response.width, 304);
  assert.equal(response.height, 304);
});

test('accepts cropped model outputs and stitches the remaining core', async () => {
  let encoded;
  const session = {
    inputNames: ['x'],
    outputNames: ['y'],
    async run(feeds) {
      assert.deepEqual(feeds.x.dims, [1, 3, 64, 64]);
      return {
        y: {
          dims: [1, 3, 56, 56],
          data: new Float32Array(3 * 56 * 56).fill(0.5),
        },
      };
    },
    async release() {},
  };
  const fixture = createWorkerDependencies({
    sessionFactory: async () => session,
    decodeImage: async () => ({
      width: 28,
      height: 28,
      pixels: new Uint8ClampedArray(28 * 28 * 4).fill(255),
      close() {},
    }),
    tensorFactory: (data, dims) => ({ data, dims }),
    encodeImage: async (image) => {
      encoded = image;
      return new Blob(['waifu2x'], { type: 'image/png' });
    },
  });
  const handler = await createWorkerHandler(fixture.dependencies);
  const manifest = {
    ...workerManifest,
    inputName: 'x',
    outputName: 'y',
    scale: 2,
    inputWidth: 64,
    inputHeight: 64,
    tileCore: 28,
    padding: 18,
    outputInset: 18,
  };
  await handler.handleMessage({ type: 'init', requestId: 'init-cropped-output', manifest });

  const response = await handler.handleMessage({
    type: 'process',
    requestId: 'process-cropped-output',
    blob: new Blob(['source']),
    manifest,
  });

  assert.equal(response.type, 'result', response.error?.message);
  assert.equal(response.width, 56);
  assert.equal(response.height, 56);
  assert.equal(encoded.width, 56);
  assert.equal(encoded.height, 56);
});

test('rejects fixed model inputs that cannot contain the configured core and padding', () => {
  assert.equal(validateManifest({
    ...productionManifest,
    inputWidth: 10,
    inputHeight: 10,
    tileCore: 8,
    padding: 2,
  }), false);
});

test('builds a stable derived image cache key from the model identity and source URL', () => {
  assert.equal(typeof superResolution.getSuperResolutionCacheKey, 'function');
  assert.equal(
    superResolution.getSuperResolutionCacheKey('https://reader.example.test/page/1?size=full', productionManifest),
    `sr:v1:anime4k-x2:2:${'a'.repeat(64)}:https://reader.example.test/page/1?size=full`,
  );
});

test('image cache owns explicitly stored derived image blobs', async () => {
  assert.equal(typeof imageCache.putImage, 'function');
  const key = `sr:test:${Date.now()}`;
  const objectUrl = imageCache.putImage(key, new Blob(['upscaled'], { type: 'image/png' }));

  assert.equal(typeof objectUrl, 'string');
  assert.equal(await imageCache.getCachedImage(key), objectUrl);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await imageCache.deleteImageKeys(key);
  await imageCache.clearImageCache();
});

test('reuses a cached super-resolution result without fetching or running inference', async () => {
  let fetchCount = 0;
  let processCount = 0;
  let createCount = 0;
  const result = await superResolution.processSuperResolutionImageSource('blob:original', {
    runtime: {
      async processBlob() {
        processCount += 1;
        return { blob: new Blob(['unexpected']) };
      },
    },
    manifest: productionManifest,
    cacheKey: 'sr:derived',
    getCachedSource: async (key) => {
      assert.equal(key, 'sr:derived');
      return 'blob:cached-upscaled';
    },
    fetcher: async () => {
      fetchCount += 1;
      return { ok: true, async blob() { return new Blob(['original']); } };
    },
    createObjectURL() {
      createCount += 1;
      return 'blob:unexpected';
    },
    revokeObjectURL() {},
  });

  assert.equal(result.src, 'blob:cached-upscaled');
  assert.equal(result.backend, 'cache');
  assert.equal(fetchCount, 0);
  assert.equal(processCount, 0);
  assert.equal(createCount, 0);
  result.dispose();
});

test('stores a new super-resolution result in the shared image cache', async () => {
  const resultBlob = new Blob(['result'], { type: 'image/png' });
  const writes = [];
  const result = await superResolution.processSuperResolutionImageSource('blob:original', {
    runtime: {
      async processBlob() {
        return { blob: resultBlob, width: 20, height: 30, backend: 'webgl' };
      },
    },
    manifest: productionManifest,
    cacheKey: 'sr:derived',
    getCachedSource: async () => null,
    cacheResult(key, blob) {
      writes.push([key, blob]);
      return 'blob:cached-upscaled';
    },
    fetcher: async () => ({ ok: true, async blob() { return new Blob(['original']); } }),
    createObjectURL() {
      throw new Error('cache-owned results must not create a temporary object URL');
    },
    revokeObjectURL() {},
  });

  assert.deepEqual(writes, [['sr:derived', resultBlob]]);
  assert.deepEqual(result, {
    src: 'blob:cached-upscaled',
    width: 20,
    height: 30,
    backend: 'webgl',
    dispose: result.dispose,
  });
  result.dispose();
});

test('shares a keep-alive visible-page inference across renderer switches', async () => {
  let processCount = 0;
  let finishInference;
  let markInferenceStarted;
  const inferenceGate = new Promise((resolve) => { finishInference = resolve; });
  const inferenceStarted = new Promise((resolve) => { markInferenceStarted = resolve; });
  const runtime = {
    async processBlob() {
      processCount += 1;
      markInferenceStarted();
      await inferenceGate;
      return { blob: new Blob(['enhanced']), width: 20, height: 20, backend: 'wasm' };
    },
  };
  const cache = new Map();
  const firstAbort = new AbortController();
  const options = {
    runtime,
    manifest: productionManifest,
    cacheKey: 'shared-visible-page',
    keepAlive: true,
    getCachedSource: async (key) => cache.get(key) ?? null,
    cacheResult: (key) => {
      const source = `blob:cached-${key}`;
      cache.set(key, source);
      return source;
    },
    fetcher: async () => ({ ok: true, blob: async () => new Blob(['source']) }),
  };

  const first = superResolution.processSuperResolutionImageSource('blob:original', {
    ...options,
    signal: firstAbort.signal,
  });
  await inferenceStarted;
  const second = superResolution.processSuperResolutionImageSource('blob:original', options);
  await Promise.resolve();
  assert.equal(processCount, 1);
  firstAbort.abort();
  finishInference();

  await assert.rejects(first, { name: 'AbortError' });
  assert.equal((await second).src, 'blob:cached-shared-visible-page');
  assert.equal(processCount, 1);
});

test('processes an image source into a disposable super-resolution object URL', async () => {
  assert.equal(typeof superResolution.processSuperResolutionImageSource, 'function');
  const originalBlob = new Blob(['original'], { type: 'image/jpeg' });
  const resultBlob = new Blob(['result'], { type: 'image/png' });
  const controller = new AbortController();
  const revoked = [];
  let processOptions;
  const result = await superResolution.processSuperResolutionImageSource('blob:original', {
    runtime: {
      async processBlob(blob, options) {
        assert.equal(blob, originalBlob);
        processOptions = options;
        return { blob: resultBlob, width: 20, height: 30, backend: 'wasm' };
      },
    },
    manifest: productionManifest,
    signal: controller.signal,
    fetcher: async (url, options) => {
      assert.equal(url, 'blob:original');
      assert.equal(options.signal, controller.signal);
      return { ok: true, async blob() { return originalBlob; } };
    },
    createObjectURL(blob) {
      assert.equal(blob, resultBlob);
      return 'blob:upscaled';
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  });

  assert.equal(processOptions.manifest, productionManifest);
  assert.equal(processOptions.signal, controller.signal);
  assert.deepEqual(result, {
    src: 'blob:upscaled',
    width: 20,
    height: 30,
    backend: 'wasm',
    dispose: result.dispose,
  });
  result.dispose();
  result.dispose();
  assert.deepEqual(revoked, ['blob:upscaled']);
});

test('rejects an already-aborted image source before fetching or creating a URL', async () => {
  assert.equal(typeof superResolution.processSuperResolutionImageSource, 'function');
  const controller = new AbortController();
  controller.abort();
  let fetchCount = 0;

  await assert.rejects(
    superResolution.processSuperResolutionImageSource('blob:original', {
      runtime: { async processBlob() { throw new Error('must not run'); } },
      manifest: productionManifest,
      signal: controller.signal,
      fetcher: async () => {
        fetchCount += 1;
        return { ok: true, async blob() { return new Blob(); } };
      },
      createObjectURL() {
        throw new Error('must not create URL');
      },
    }),
    (error) => error?.name === 'AbortError',
  );
  assert.equal(fetchCount, 0);
});

test('skips animated image sources before super-resolution inference', async () => {
  const gifFrame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0, 0];
  const animatedGif = new Blob([new Uint8Array([
    ...Buffer.from('GIF89a'), 1, 0, 1, 0, 0, 0, 0,
    ...gifFrame, ...gifFrame, 0x3b,
  ])], { type: 'image/gif' });
  let processCount = 0;

  await assert.rejects(
    superResolution.processSuperResolutionImageSource('blob:animated', {
      runtime: {
        async processBlob() {
          processCount += 1;
          throw new Error('must not run');
        },
      },
      manifest: productionManifest,
      fetcher: async () => ({ ok: true, async blob() { return animatedGif; } }),
      createObjectURL: () => 'blob:must-not-exist',
      revokeObjectURL() {},
    }),
    (error) => error?.name === 'NotSupportedError',
  );
  assert.equal(processCount, 0);
});

test('accepts a complete production model manifest', () => {
  assert.equal(typeof superResolution.validateSuperResolutionManifest, 'function');
  assert.equal(validateManifest(productionManifest), true);
});

test('rejects production manifests missing required metadata', () => {
  const missingFields = [
    'id',
    'url',
    'scale',
    'inputLayout',
    'outputLayout',
    'checksum',
    'license',
  ];

  for (const field of missingFields) {
    const manifest = { ...productionManifest };
    manifest[field] = undefined;
    assert.equal(
      validateManifest(manifest),
      false,
      `manifest without ${field} must be rejected`,
    );
  }
});

test('rejects Real-CUGAN manifests without a local weight payload checksum', () => {
  const model = superResolution.getSuperResolutionModel('realcugan');
  assert.equal(validateManifest({ ...model, weightsUrl: undefined }), false);
  assert.equal(validateManifest({ ...model, weightsChecksum: undefined }), false);
});

test('rejects incomplete production license metadata', () => {
  for (const license of [null, {}, { name: 'MIT' }, { name: '', url: 'https://example.test' }]) {
    assert.equal(
      validateManifest({ ...productionManifest, license }),
      false,
      `license ${JSON.stringify(license)} must be rejected`,
    );
  }
});

test('accepts only SHA-256 checksums with a 64-character hexadecimal digest', () => {
  const invalidChecksums = [
    { algorithm: 'sha1', digest: 'a'.repeat(64) },
    { algorithm: 'sha-256', digest: 'a'.repeat(63) },
    { algorithm: 'sha-256', digest: 'a'.repeat(65) },
    { algorithm: 'sha-256', digest: `${'a'.repeat(63)}g` },
    { algorithm: 'sha-256', value: 'a'.repeat(64) },
  ];

  for (const checksum of invalidChecksums) {
    assert.equal(
      validateManifest({ ...productionManifest, checksum }),
      false,
      `checksum ${JSON.stringify(checksum)} must be rejected`,
    );
  }
});

test('accepts only runtime-supported nchw and nhwc tensor layouts', () => {
  assert.equal(validateManifest({
    ...productionManifest,
    inputLayout: 'nhwc',
    outputLayout: 'nhwc',
  }), true);

  for (const layout of ['rgba8', 'NCHW', 'channels-first']) {
    assert.equal(validateManifest({ ...productionManifest, inputLayout: layout }), false);
    assert.equal(validateManifest({ ...productionManifest, outputLayout: layout }), false);
  }
});

test('accepts only non-empty WebGL/WASM execution provider lists', () => {
  assert.equal(validateManifest({ ...productionManifest, executionProviders: ['wasm'] }), true);
  assert.equal(validateManifest({ ...productionManifest, executionProviders: ['webgl', 'wasm'] }), true);

  for (const executionProviders of [[], ['webgpu'], ['wasm', 'wasm'], 'wasm']) {
    assert.equal(validateManifest({ ...productionManifest, executionProviders }), false);
  }
});

test('rejects non-positive or non-integer production scales', () => {
  for (const scale of [0, -2, 2.5, '2']) {
    assert.equal(
      validateManifest({ ...productionManifest, scale }),
      false,
      `scale ${String(scale)} must be rejected`,
    );
  }
});

function getTilingApi() {
  assert.equal(typeof tiling.createTilePlan, 'function');
  assert.equal(typeof tiling.getOutputTileRect, 'function');
  return tiling;
}

test('creates one unclipped tile for an image smaller than the default core', () => {
  const { createTilePlan } = getTilingApi();
  const plan = createTilePlan(80, 60);

  assert.deepEqual(plan, {
    width: 80,
    height: 60,
    tileCore: 128,
    padding: 18,
    columns: 1,
    rows: 1,
    tiles: [{
      index: 0,
      row: 0,
      column: 0,
      core: { x: 0, y: 0, width: 80, height: 60 },
      input: { x: 0, y: 0, width: 80, height: 60 },
    }],
  });
});

test('covers internal and right/bottom edge tiles with clipped padding', () => {
  const { createTilePlan } = getTilingApi();
  const plan = createTilePlan(300, 270, { tileCore: 128, padding: 18 });

  assert.equal(plan.tiles.length, 9);
  assert.deepEqual(plan.tiles[4], {
    index: 4,
    row: 1,
    column: 1,
    core: { x: 128, y: 128, width: 128, height: 128 },
    input: { x: 110, y: 110, width: 164, height: 160 },
  });
  assert.deepEqual(plan.tiles[8], {
    index: 8,
    row: 2,
    column: 2,
    core: { x: 256, y: 256, width: 44, height: 14 },
    input: { x: 238, y: 238, width: 62, height: 32 },
  });
});

test('uses the configured core and padding while covering the whole image', () => {
  const { createTilePlan } = getTilingApi();
  const plan = createTilePlan(260, 140, { tileCore: 100, padding: 7 });

  assert.deepEqual(plan.tiles.map(({ core }) => core), [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 100, y: 0, width: 100, height: 100 },
    { x: 200, y: 0, width: 60, height: 100 },
    { x: 0, y: 100, width: 100, height: 40 },
    { x: 100, y: 100, width: 100, height: 40 },
    { x: 200, y: 100, width: 60, height: 40 },
  ]);
  assert.deepEqual(plan.tiles[4].input, { x: 93, y: 93, width: 114, height: 47 });
  assert.deepEqual(plan.tiles[5].input, { x: 193, y: 93, width: 67, height: 47 });
});

test('maps a tile core to 2x and 4x output rectangles', () => {
  const { createTilePlan, getOutputTileRect } = getTilingApi();
  const tile = createTilePlan(300, 270).tiles[8];

  assert.deepEqual(getOutputTileRect(tile, 2), { x: 512, y: 512, width: 88, height: 28 });
  assert.deepEqual(getOutputTileRect(tile, 4), { x: 1024, y: 1024, width: 176, height: 56 });
});
