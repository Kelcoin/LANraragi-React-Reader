import assert from 'node:assert/strict';
import test from 'node:test';

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
  assert.deepEqual(superResolution.getSuperResolutionModel('realcugan'), {
    value: 'realcugan',
    label: 'Real-CUGAN',
  });
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
