import { getConfigScopeId } from './configScope.js';

const getBaseUrl = () => {
  return (localStorage.getItem('lrr_server_url') || '').replace(/\/$/, '');
};

const ARCHIVE_SEARCH_CACHE_TTL_MS = 60 * 1000;
const ARCHIVE_SEARCH_CACHE_LIMIT = 30;
const archiveSearchResponseCache = new Map();

export function clearArchiveSearchResponseCache() {
  archiveSearchResponseCache.clear();
}

function cachedArchiveSearch(filter, start, sortby, order, options) {
  const normalizedFilter = String(filter || '').trim();
  const category = String(options?.category || '').trim();
  const untaggedOnly = !!options?.untaggedOnly;
  const key = `${getConfigScopeId()}|${category}|${untaggedOnly}|${normalizedFilter}|${start}|${sortby}|${order}`;
  const now = Date.now();
  const cached = archiveSearchResponseCache.get(key);
  if (cached && cached.expiresAt > now) {
    archiveSearchResponseCache.delete(key);
    archiveSearchResponseCache.set(key, cached);
    return waitForCaller(cached.promise, options?.signal);
  }
  archiveSearchResponseCache.delete(key);

  const params = new URLSearchParams({ filter: normalizedFilter, start, sortby, order });
  if (category) params.set('category', category);
  if (untaggedOnly) params.set('untaggedonly', 'true');
  const promise = request(`/search?${params}`)
    .catch((error) => {
      if (archiveSearchResponseCache.get(key)?.promise === promise) archiveSearchResponseCache.delete(key);
      throw error;
    });
  archiveSearchResponseCache.set(key, { expiresAt: now + ARCHIVE_SEARCH_CACHE_TTL_MS, promise });
  while (archiveSearchResponseCache.size > ARCHIVE_SEARCH_CACHE_LIMIT) {
    archiveSearchResponseCache.delete(archiveSearchResponseCache.keys().next().value);
  }
  return waitForCaller(promise, options?.signal);
}

function waitForCaller(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function encodeApiKey(key = '') {
  const bytes = new TextEncoder().encode(String(key));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const encodeKey = () => {
  const key = localStorage.getItem('lrr_api_key') || '';
  return encodeApiKey(key);
};

const getAuthHeaders = () => ({ Authorization: `Bearer ${encodeKey()}` });

const getApiUrl = (endpoint) => {
  const base = getBaseUrl();
  if (!base) throw new Error('未配置服务器地址');
  return `${base}/api${endpoint}`;
};

function createApiError(status, message) {
  const err = new Error(message || `API Error: ${status}`);
  err.status = status;
  return err;
}

async function readResponse(res) {
  if (!res.ok) {
    if (res.status === 401) throw createApiError(res.status, 'API Error: 401 (API Key 错误或未授权)');
    let message = '';
    try { message = await res.text(); } catch {}
    throw createApiError(res.status, message || `API Error: ${res.status}`);
  }

  const text = await res.text();
  return parseResponseText(text);
}

function parseResponseText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readXhrResponse(xhr) {
  const status = xhr.status;
  if (status < 200 || status >= 300) {
    if (status === 401) throw createApiError(status, 'API Error: 401 (API Key 错误或未授权)');
    throw createApiError(status, xhr.responseText || `API Error: ${status}`);
  }
  return parseResponseText(xhr.responseText || '');
}

function uploadFormData(endpoint, body, { signal, onProgress } = {}) {
  if (typeof XMLHttpRequest === 'undefined') {
    return fetch(getApiUrl(endpoint), {
      method: 'PUT',
      headers: getAuthHeaders(),
      body,
      signal,
    }).then(readResponse);
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.open('PUT', getApiUrl(endpoint));
    Object.entries(getAuthHeaders()).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      signal?.removeEventListener('abort', abort);
      try { resolve(readXhrResponse(xhr)); }
      catch (error) { reject(error); }
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', abort);
      reject(createApiError(xhr.status || 0, '上传失败'));
    };
    xhr.onabort = () => {
      signal?.removeEventListener('abort', abort);
      reject(signal ? abortReason(signal) : createApiError(0, '上传已取消'));
    };
    if (signal?.aborted) {
      xhr.abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}

const request = async (endpoint, method = 'GET', body = null, options = {}) => {
  const base = getBaseUrl();
  if (!base) throw new Error('未配置服务器地址');

  const headers = getAuthHeaders();
  let requestBody = null;
  if (body instanceof URLSearchParams) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    requestBody = body.toString();
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const res = await fetch(`${base}/api${endpoint}`, {
    method,
    headers,
    body: requestBody,
    signal: options.signal,
    keepalive: !!options.keepalive,
  });

  return readResponse(res);
};

function abortReason(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('操作已取消');
  error.name = 'AbortError';
  return error;
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal) {
      setTimeout(() => signal.removeEventListener('abort', abort), ms);
    }
  });
}

export async function waitForMinionJob(job, {
  signal,
  timeoutMs = 5 * 60 * 1000,
  pollMs = 1000,
  onProgress,
  getStatus = (jobId) => lrrApi.getMinionStatus(jobId, { signal }),
} = {}) {
  const jobId = Number(job?.job ?? job);
  if (!Number.isFinite(jobId) || jobId <= 0) return null;
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 1);
  while (Date.now() <= deadline) {
    if (signal?.aborted) throw abortReason(signal);
    const status = await getStatus(jobId);
    onProgress?.(status);
    const state = String(status?.state || '').toLowerCase();
    if (state === 'finished') return status;
    if (state === 'failed' || state === 'error') {
      throw new Error(status?.error || 'LANraragi 后台任务失败');
    }
    if (Date.now() >= deadline) break;
    await wait(Math.max(0, Number(pollMs) || 0), signal);
  }
  throw new Error('LANraragi 后台任务等待超时');
}

export function normalizeUntaggedArchiveIds(response) {
  const items = Array.isArray(response)
    ? response
    : (Array.isArray(response?.data)
      ? response.data
      : (Array.isArray(response?.archives) ? response.archives : response?.ids));
  return (Array.isArray(items) ? items : [])
    .map((item) => (typeof item === 'string' ? item : (item?.arcid || item?.id)))
    .filter(Boolean);
}

export async function loadArchiveMetadataBatch(ids, loadArchive, { concurrency = 6, signal, ignoreMissing = false } = {}) {
  const archiveIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (archiveIds.length === 0) return [];
  const results = new Array(archiveIds.length);
  let cursor = 0;
  const workerCount = Math.min(archiveIds.length, Math.max(1, Math.floor(Number(concurrency) || 1)));
  const abortError = () => {
    if (signal?.reason) return signal.reason;
    const error = new Error('Archive metadata request aborted');
    error.name = 'AbortError';
    return error;
  };
  const worker = async () => {
    while (cursor < archiveIds.length) {
      if (signal?.aborted) throw abortError();
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await loadArchive(archiveIds[index]);
      } catch (error) {
        if (ignoreMissing && (error?.status === 400 || error?.status === 404)) continue;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results.filter((item) => item !== undefined);
}

export const lrrApi = {
  search: (filter = '', start = 0, sortby = 'date_added', order = 'desc', options = {}) =>
    cachedArchiveSearch(filter, start, sortby, order, options),
  clearSearchCache: () => {
    clearArchiveSearchResponseCache();
    return request('/search/cache', 'DELETE');
  },

  getRandom: (count = 10, options = {}) => request(`/search/random?count=${count}`, 'GET', null, options),
  getAllArchives: (options = {}) => request('/archives', 'GET', null, options),
  getUntaggedArchives: async (options = {}) => normalizeUntaggedArchiveIds(await request('/archives/untagged', 'GET', null, options)),
  getArchive: (id, options = {}) => request(`/archives/${id}/metadata`, 'GET', null, options),
  updateArchiveMetadata: (id, { title = '', tags = '', summary = '' }, options = {}) => {
    const params = new URLSearchParams({ title, tags, summary });
    return request(`/archives/${encodeURIComponent(id)}/metadata?${params}`, 'PUT', null, options);
  },
  getMetadataPlugins: (options = {}) => request('/plugins/metadata', 'GET', null, options),
  getDownloadPlugins: () => request('/plugins/download'),
  useMetadataPlugin: (id, plugin, arg = '', options = {}) => {
    const params = new URLSearchParams({ id, plugin, arg });
    return request(`/plugins/use?${params}`, 'POST', null, options);
  },
  useDownloadPlugin: (plugin, arg) => {
    const params = new URLSearchParams({ plugin, arg });
    return request(`/plugins/use?${params}`, 'POST');
  },
  uploadArchive: async (file, options = {}) => {
    const body = new FormData();
    body.append('file', file, file.name);
    return uploadFormData('/archives/upload', body, options);
  },
  getArchiveFiles: (id, options = {}) => request(`/archives/${id}/files`, 'GET', null, options),
  deleteArchive: (id) => request(`/archives/${encodeURIComponent(id)}`, 'DELETE', null, { keepalive: true }),
  setArchiveThumbnail: (id, page) =>
    request(`/archives/${encodeURIComponent(id)}/thumbnail?page=${encodeURIComponent(page)}`, 'PUT'),
  downloadArchive: async (id) => {
    const res = await fetch(getApiUrl(`/archives/${encodeURIComponent(id)}/download`), {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      if (res.status === 401) throw createApiError(res.status, 'API Error: 401 (API Key 错误或未授权)');
      throw createApiError(res.status, `API Error: ${res.status}`);
    }
    const disposition = res.headers.get('Content-Disposition') || '';
    const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i);
    const filename = filenameMatch
      ? decodeURIComponent((filenameMatch[1] || filenameMatch[2] || '').trim())
      : `${id}.zip`;
    return { blob: await res.blob(), filename };
  },
  getArchiveThumbnail: async (id, { page = null, noFallback = false, signal } = {}) => {
    const base = getBaseUrl();
    if (!base) throw new Error('未配置服务器地址');

    const params = new URLSearchParams();
    if (page !== undefined && page !== null) params.set('page', String(page));
    if (noFallback) params.set('no_fallback', 'true');

    const query = params.toString();
    const res = await fetch(`${base}/api/archives/${encodeURIComponent(id)}/thumbnail${query ? `?${query}` : ''}`, {
      headers: getAuthHeaders(),
      signal,
    });

    if (res.status === 202) {
      let job = null;
      try { job = await res.json(); } catch {}
      return { status: 202, blob: null, job };
    }
    if (!res.ok) {
      if (res.status === 401) throw createApiError(res.status, 'API Error: 401 (API Key 错误或未授权)');
      throw createApiError(res.status, `API Error: ${res.status}`);
    }
    return { status: res.status, blob: await res.blob() };
  },
  regenerateThumbnails: (force = false) => request(`/regen_thumbs?force=${force ? 1 : 0}`, 'POST'),
  getMinionStatus: (job, options = {}) => request(`/minion/${encodeURIComponent(job)}`, 'GET', null, options),
  queueArchivePageThumbnails: (id, force = false) =>
    request(`/archives/${id}/files/thumbnails${force ? '?force=true' : ''}`, 'POST'),
  extractArchive: (id, options = {}) => request(`/archives/${id}/extract`, 'POST', null, options),
  clearCache: (id) => request(`/archives/${id}/extract`, 'DELETE'),
  updateProgress: (id, page, options = {}) => request(
    `/archives/${id}/progress/${page}${options.force ? '?force=1' : ''}`,
    'PUT',
    null,
    options,
  ),
  getCategories: () => request('/categories'),
  createCategory: (name) => request('/categories', 'PUT', new URLSearchParams({ name })),
  addArchiveToCategory: (categoryId, archiveId) => request(
    `/categories/${encodeURIComponent(categoryId)}/${encodeURIComponent(archiveId)}`,
    'PUT',
  ),
  removeArchiveFromCategory: (categoryId, archiveId) => request(
    `/categories/${encodeURIComponent(categoryId)}/${encodeURIComponent(archiveId)}`,
    'DELETE',
  ),
  getServerInfo: () => request('/info'),
};

export const checkServerStatus = async (url, key) => {
  const base = (url || '').replace(/\/$/, '');
  if (!base) throw new Error('未配置服务器地址');

  const headers = {};
  if (key) headers['Authorization'] = `Bearer ${encodeApiKey(key)}`;

  const res = await fetch(`${base}/api/info`, { headers });
  if (!res.ok) {
    if (res.status === 401) throw new Error('API Key 错误或未授权');
    throw new Error(`服务器返回错误 (${res.status})`);
  }
  return res.json();
};


