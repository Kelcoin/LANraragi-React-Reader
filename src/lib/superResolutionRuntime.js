let requestSequence = 0;

function createRequestId() {
  requestSequence += 1;
  return `super-resolution-${requestSequence}`;
}

function getTransferBuffer(pixels) {
  if (pixels instanceof ArrayBuffer) return pixels;
  if (ArrayBuffer.isView(pixels)) return pixels.buffer;
  return null;
}

function isPixelBuffer(pixels) {
  return pixels instanceof ArrayBuffer || ArrayBuffer.isView(pixels);
}

function createAbortError(message = 'Super-resolution request cancelled') {
  if (typeof globalThis.DOMException === 'function') {
    return new DOMException(message, 'AbortError');
  }
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function createProtocolError(message) {
  const error = new Error(`Super-resolution protocol error: ${message}`);
  error.name = 'ProtocolError';
  return error;
}

function toError(value) {
  if (value instanceof Error) return value;
  if (value && typeof value.message === 'string') {
    const error = new Error(value.message);
    if (typeof value.name === 'string') error.name = value.name;
    return error;
  }
  return new Error(typeof value === 'string' ? value : 'Super-resolution worker request failed');
}

function getResponsePayload(data) {
  if (data.type === 'ready') return { backend: data.backend };
  const payload = { ...data };
  delete payload.type;
  return payload;
}

function rejectAllPending(pending, error) {
  const requests = [...pending.values()];
  pending.clear();
  for (const request of requests) request.reject(error);
}

function createProductionWorker() {
  if (typeof globalThis.Worker !== 'function') {
    throw new TypeError('Worker is unavailable in this browser');
  }
  return new Worker(new URL('./superResolution.worker.js', import.meta.url), {
    type: 'module',
  });
}

function isBlobLike(value) {
  return (typeof globalThis.Blob === 'function' && value instanceof globalThis.Blob)
    || Boolean(value && typeof value.arrayBuffer === 'function');
}

export function createSuperResolutionRuntime({
  workerFactory = createProductionWorker,
  manifestValidator,
  recycleAfterPages = 6,
} = {}) {
  if (typeof workerFactory !== 'function') {
    throw new TypeError('workerFactory must be a function');
  }
  if (typeof manifestValidator !== 'function') {
    throw new TypeError('manifestValidator must be a function');
  }
  if (!Number.isInteger(recycleAfterPages) || recycleAfterPages < 1) {
    throw new TypeError('recycleAfterPages must be a positive integer');
  }

  const pending = new Map();
  let disposed = false;
  let worker = workerFactory();
  if (!worker || typeof worker.postMessage !== 'function') {
    throw new TypeError('workerFactory must return a Worker-like object');
  }

  let initializedManifest = null;
  let completedPages = 0;
  let recycling = null;

  function handleMessage(event) {
    const data = event?.data;
    if (!data || data.requestId === undefined) return;

    const request = pending.get(data.requestId);
    if (!request) return;
    if (data.type === 'error') {
      pending.delete(data.requestId);
      request.reject(toError(data.error));
      return;
    }

    const expectedType = request.type === 'init' ? 'ready' : 'result';
    if (data.type !== expectedType) {
      pending.delete(data.requestId);
      request.reject(createProtocolError(
        `request ${data.requestId} expected ${expectedType}, received ${String(data.type)}`,
      ));
      return;
    }

    pending.delete(data.requestId);
    if (expectedType === 'ready') {
      initializedManifest = request.manifest;
      completedPages = 0;
    } else {
      completedPages += 1;
    }
    request.resolve(getResponsePayload(data));
  }

  function handleWorkerError(event) {
    rejectAllPending(
      pending,
      toError(event?.error ?? event?.message ?? 'Super-resolution worker failed'),
    );
  }

  function bindWorker(nextWorker) {
    if (typeof nextWorker.addEventListener !== 'function') {
      throw new TypeError('workerFactory must return a Worker with addEventListener');
    }
    nextWorker.addEventListener('message', handleMessage);
    nextWorker.addEventListener('error', handleWorkerError);
    nextWorker.addEventListener('messageerror', handleWorkerError);
  }

  bindWorker(worker);

  function postRequest(type, payload = {}, transfer = []) {
    if (disposed) return Promise.reject(new Error('Super-resolution runtime is disposed'));

    const requestId = payload.requestId ?? createRequestId();
    if (pending.has(requestId)) {
      return Promise.reject(new Error(`Request already pending: ${requestId}`));
    }
    const message = { ...payload, type, requestId };

    return new Promise((resolve, reject) => {
      pending.set(requestId, { type, manifest: payload.manifest, resolve, reject });
      try {
        if (transfer.length > 0) worker.postMessage(message, transfer);
        else worker.postMessage(message);
      } catch (error) {
        pending.delete(requestId);
        reject(error);
      }
    });
  }

  function init(manifest) {
    if (!manifestValidator(manifest)) {
      return Promise.reject(new TypeError('Invalid super-resolution manifest'));
    }
    return postRequest('init', { manifest });
  }

  // Rebuilding the worker periodically releases the ORT WebGPU session, the
  // worker's WebGPU device, and its wasm heap. Without this, devices with tight
  // per-process GPU memory budgets (iOS WKWebView) accumulate memory until the
  // web content process is killed and the page reloads mid-read.
  function recycleWorker() {
    if (disposed || !initializedManifest || completedPages < recycleAfterPages || pending.size > 0) {
      return null;
    }
    if (recycling) return recycling;
    completedPages = 0;
    recycling = (async () => {
      try { worker.postMessage({ type: 'dispose' }); } catch {}
      worker.terminate?.();
      if (disposed) throw new Error('Super-resolution runtime is disposed');
      worker = workerFactory();
      bindWorker(worker);
      return await init(initializedManifest);
    })().finally(() => {
      recycling = null;
    });
    return recycling;
  }

  async function processPixels(request = {}) {
    const { requestId, pixels, width, height } = request ?? {};
    if (!isPixelBuffer(pixels)) {
      return Promise.reject(new TypeError('pixels must be an ArrayBuffer or ArrayBuffer view'));
    }
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      return Promise.reject(new TypeError('width and height must be positive integers'));
    }
    const recyclePromise = recycleWorker();
    if (recyclePromise) await recyclePromise.catch(() => {});
    const transferBuffer = getTransferBuffer(pixels);
    return postRequest(
      'process',
      { requestId, pixels, width, height },
      transferBuffer ? [transferBuffer] : [],
    );
  }

  async function processBlob(blob, options = {}) {
    const { manifest, requestId, signal } = options ?? {};
    if (!isBlobLike(blob)) {
      return Promise.reject(new TypeError('blob must be a Blob'));
    }
    if (!manifestValidator(manifest)) {
      return Promise.reject(new TypeError('Invalid super-resolution manifest'));
    }
    const id = requestId ?? createRequestId();
    if (signal?.aborted) return Promise.reject(createAbortError());

    const recyclePromise = recycleWorker();
    if (recyclePromise) await recyclePromise.catch(() => {});
    const promise = postRequest('process', { requestId: id, blob, manifest });
    if (!signal || typeof signal.addEventListener !== 'function') return promise;

    const handleAbort = () => cancel(id);
    signal.addEventListener('abort', handleAbort, { once: true });
    return promise.finally(() => signal.removeEventListener?.('abort', handleAbort));
  }

  function cancel(requestId) {
    if (disposed) return;
    const request = pending.get(requestId);
    if (request) {
      pending.delete(requestId);
      request.reject(createAbortError());
    }
    worker.postMessage({ type: 'cancel', requestId });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;

    worker.removeEventListener?.('message', handleMessage);
    worker.removeEventListener?.('error', handleWorkerError);
    worker.removeEventListener?.('messageerror', handleWorkerError);
    rejectAllPending(pending, new Error('Super-resolution runtime is disposed'));

    try {
      worker.postMessage({ type: 'dispose' });
    } finally {
      worker.terminate?.();
    }
  }

  return {
    init,
    processPixels,
    processBlob,
    cancel,
    dispose,
  };
}
