const WEBGL_BACKEND = 'webgl';
const WASM_BACKEND = 'wasm';

function createNamedError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function toErrorDetails(error) {
  return {
    name: typeof error?.name === 'string' && error.name ? error.name : 'Error',
    message: typeof error?.message === 'string' && error.message
      ? error.message
      : String(error),
  };
}

function createErrorResponse(requestId, error) {
  return {
    type: 'error',
    requestId,
    error: toErrorDetails(error),
  };
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchModel(fetcher, url) {
  const response = await fetcher(url);
  if (response?.ok === false) {
    throw createNamedError(
      'FetchError',
      `Failed to fetch super-resolution model (HTTP ${response.status ?? 'unknown'})`,
    );
  }
  if (typeof response?.arrayBuffer !== 'function') {
    throw createNamedError('FetchError', 'Model response does not provide arrayBuffer()');
  }
  return response.arrayBuffer();
}

async function digestWithWebCrypto(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw createNamedError('DigestError', 'Web Crypto SHA-256 is unavailable');
  }
  return bytesToHex(await subtle.digest('SHA-256', bytes));
}

async function createProductionSession(modelBytes, backend) {
  const ort = await import('onnxruntime-web');
  return ort.InferenceSession.create(modelBytes, {
    executionProviders: [backend],
  });
}

function normalizeDigest(value) {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return bytesToHex(value);
  return String(value).trim().toLowerCase();
}

function validateInitManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw createNamedError('ProtocolError', 'init requires a model manifest');
  }
  if (typeof manifest.url !== 'string' || !manifest.url) {
    throw createNamedError('ProtocolError', 'init requires a model URL');
  }
  const checksum = manifest.checksum;
  if (typeof checksum?.algorithm !== 'string'
    || checksum.algorithm.trim().toLowerCase() !== 'sha-256'
    || typeof checksum.digest !== 'string'
    || !/^[a-f0-9]{64}$/i.test(checksum.digest)) {
    throw createNamedError('ProtocolError', 'init requires a SHA-256 model checksum');
  }
}

function validateDigest(manifest, actualDigest) {
  const expectedDigest = manifest.checksum.digest.toLowerCase();
  if (normalizeDigest(actualDigest) !== expectedDigest) {
    throw createNamedError(
      'ChecksumError',
      `SHA-256 checksum mismatch: expected ${expectedDigest}, received ${normalizeDigest(actualDigest)}`,
    );
  }
}

function getDefaultFetcher() {
  if (typeof globalThis.fetch !== 'function') {
    throw createNamedError('FetchError', 'fetch is unavailable in this worker');
  }
  return globalThis.fetch.bind(globalThis);
}

function describeSessionAttempt(backend, error) {
  const label = backend === WEBGL_BACKEND ? 'WebGL' : 'WASM';
  if (error) return `${label} session failed: ${toErrorDetails(error).message}`;
  return `${label} session factory returned no session`;
}

export function createSuperResolutionWorkerHandler(dependencies = {}) {
  const fetcher = dependencies.fetcher ?? getDefaultFetcher();
  const digest = dependencies.digest ?? digestWithWebCrypto;
  const sessionFactory = dependencies.sessionFactory ?? createProductionSession;
  let session = null;
  let backend = null;
  let disposed = false;
  let generation = 0;
  const staleRequestIds = new Set();

  function isCurrentGeneration(initGeneration) {
    return !disposed && initGeneration === generation;
  }

  async function ensureCurrentGeneration(initGeneration, candidateSession) {
    if (isCurrentGeneration(initGeneration)) return;
    if (candidateSession && typeof candidateSession.release === 'function') {
      await candidateSession.release();
    }
    throw createNamedError(
      'StaleInitializationError',
      'Super-resolution initialization result became stale',
    );
  }

  async function initialize(requestId, manifest) {
    if (disposed) throw createNamedError('DisposedError', 'Super-resolution worker is disposed');
    const initGeneration = ++generation;
    validateInitManifest(manifest);

    const modelBytes = await fetchModel(fetcher, manifest.url);
    const actualDigest = await digest(modelBytes);
    validateDigest(manifest, actualDigest);

    let nextSession;
    let selectedBackend = WEBGL_BACKEND;
    let webglError;
    try {
      nextSession = await sessionFactory(modelBytes, WEBGL_BACKEND);
    } catch (error) {
      webglError = error;
    }

    await ensureCurrentGeneration(initGeneration, nextSession);

    let wasmError;
    if (!nextSession) {
      selectedBackend = WASM_BACKEND;
      try {
        nextSession = await sessionFactory(modelBytes, WASM_BACKEND);
      } catch (error) {
        wasmError = error;
      }
    }

    await ensureCurrentGeneration(initGeneration, nextSession);
    if (!nextSession) {
      throw createNamedError(
        'SessionInitializationError',
        `${describeSessionAttempt(WEBGL_BACKEND, webglError)}; `
          + describeSessionAttempt(WASM_BACKEND, wasmError),
      );
    }

    if (session && typeof session.release === 'function') await session.release();
    await ensureCurrentGeneration(initGeneration, nextSession);
    session = nextSession;
    backend = selectedBackend;
    staleRequestIds.clear();
    return { type: 'ready', requestId, backend };
  }

  async function dispose(requestId) {
    disposed = true;
    generation += 1;
    const currentSession = session;
    session = null;
    backend = null;
    staleRequestIds.clear();

    try {
      if (currentSession && typeof currentSession.release === 'function') {
        await currentSession.release();
      }
    } catch (error) {
      throw createNamedError('DisposeError', `Failed to release super-resolution session: ${toErrorDetails(error).message}`);
    }

    return { type: 'disposed', requestId };
  }

  async function handleMessage(message) {
    const requestId = message?.requestId;

    try {
      switch (message?.type) {
        case 'init':
          return await initialize(requestId, message.manifest);
        case 'process':
          if (disposed) throw createNamedError('DisposedError', 'Super-resolution worker is disposed');
          if (staleRequestIds.delete(requestId)) {
            throw createNamedError('AbortError', 'Super-resolution request was cancelled');
          }
          if (!session) {
            throw createNamedError('NotInitializedError', 'Super-resolution session is not initialized');
          }
          throw createNamedError(
            'NotImplementedError',
            'Super-resolution processing is not implemented until Task 2B',
          );
        case 'cancel':
          if (disposed) throw createNamedError('DisposedError', 'Super-resolution worker is disposed');
          staleRequestIds.add(requestId);
          return { type: 'cancelled', requestId };
        case 'dispose':
          return await dispose(requestId);
        default:
          throw createNamedError('ProtocolError', `Unknown message type: ${String(message?.type)}`);
      }
    } catch (error) {
      return createErrorResponse(requestId, error);
    }
  }

  return { handleMessage };
}

function isWorkerGlobal(scope) {
  if (!scope?.self) return false;
  if (typeof scope.WorkerGlobalScope === 'function') {
    return scope.self instanceof scope.WorkerGlobalScope;
  }
  return typeof scope.window === 'undefined'
    && typeof scope.self.addEventListener === 'function'
    && typeof scope.self.postMessage === 'function';
}

function installWorkerGlobal() {
  if (!isWorkerGlobal(globalThis)) return;

  const workerScope = globalThis.self;
  const handler = createSuperResolutionWorkerHandler();
  workerScope.addEventListener('message', async (event) => {
    workerScope.postMessage(await handler.handleMessage(event.data));
  });
}

installWorkerGlobal();
