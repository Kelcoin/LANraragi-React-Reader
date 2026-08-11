// Two-tier image cache: memory (fast) + Cache API (persistent across reloads).
// On page reload after iOS process kill, images load from disk cache instantly
// instead of re-fetching from network.
const MEM_CACHE = new Map();
const MAX_MEM_ENTRIES = 64;
const DISK_CACHE = 'lrr-img-v3';
import { imageCacheIndex } from './imageCacheIndex.js';
import {
  resolveCacheLimit,
  resolveMemoryImageCacheBudget,
  selectCacheEvictions,
  selectMemoryImageCacheEvictions,
} from './cachePolicy.js';
import { createImageLoadQueue, IMAGE_LOAD_PRIORITY } from './imageLoadQueue.js';
import { getConfigScopeId, scopedCacheKey } from './configScope.js';

export { IMAGE_LOAD_PRIORITY } from './imageLoadQueue.js';

const CACHE_MODE_KEY = 'lrr_image_cache_limit';

const lastIndexTouch = new Map();
const INDEX_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
let cleanupTimer = null;
let diskCachePromise = null;
const retiredObjectUrlTimers = new Map();
const imageLoadQueue = createImageLoadQueue({ maxConcurrent: 5 });
const RETIRED_URL_GRACE_MS = 30 * 1000;
const MAX_RETIRED_URLS = 200;
const MAX_MEM_BYTES = resolveMemoryImageCacheBudget(globalThis.navigator?.deviceMemory);
let memoryBytes = 0;

function retireObjectUrl(objectUrl) {
  if (!objectUrl || retiredObjectUrlTimers.has(objectUrl)) return;
  const timer = setTimeout(() => {
    retiredObjectUrlTimers.delete(objectUrl);
    URL.revokeObjectURL(objectUrl);
  }, RETIRED_URL_GRACE_MS);
  retiredObjectUrlTimers.set(objectUrl, timer);
  while (retiredObjectUrlTimers.size > MAX_RETIRED_URLS) {
    const [oldestUrl, oldestTimer] = retiredObjectUrlTimers.entries().next().value;
    clearTimeout(oldestTimer);
    retiredObjectUrlTimers.delete(oldestUrl);
    URL.revokeObjectURL(oldestUrl);
  }
}

async function fetchForScope(fetcher, scope, signal) {
  if (getConfigScopeId() !== scope) return null;
  const blob = await fetcher(signal);
  return getConfigScopeId() === scope ? blob : null;
}

function getDiskCache() {
  if (typeof caches === 'undefined') return Promise.resolve(null);
  if (!diskCachePromise) {
    diskCachePromise = caches.open(DISK_CACHE).catch((error) => {
      diskCachePromise = null;
      throw error;
    });
  }
  return diskCachePromise;
}

// ── Disk cache helpers ──
function cacheKeyToUrl(key) {
  return `${location.origin}/__lrr_cache__/${encodeURIComponent(key)}`;
}

async function diskGet(key) {
  let blob = null;
  try {
    const cache = await getDiskCache();
    const response = await cache?.match(new Request(cacheKeyToUrl(key)));
    if (response) blob = await response.blob();
  } catch {}
  if (!blob) {
    try { blob = await imageCacheIndex.getBlob(key); } catch {}
  }
  if (!blob) return null;
  const now = Date.now();
  if (now - (lastIndexTouch.get(key) || 0) >= INDEX_TOUCH_INTERVAL_MS) {
    lastIndexTouch.set(key, now);
    imageCacheIndex.put({ key, size: blob.size, lastAccessedAt: now }).catch(() => {});
  }
  return blob;
}

async function diskPut(key, blob) {
  let stored = false;
  try {
    const cache = await getDiskCache();
    if (cache) {
      await cache.put(new Request(cacheKeyToUrl(key)), new Response(blob));
      stored = true;
      imageCacheIndex.deleteBlob(key).catch(() => {});
    }
  } catch {}
  if (!stored) {
    try {
      await imageCacheIndex.putBlob(key, blob);
      stored = true;
    } catch {}
  }
  if (!stored) return;
  try {
    await imageCacheIndex.put({ key, size: blob.size, createdAt: Date.now(), lastAccessedAt: Date.now() });
    if (cleanupTimer) clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(() => {
      cleanupTimer = null;
      enforceImageCacheLimit().catch(() => {});
    }, 2000);
  } catch {}
}

async function deleteDiskEntry(key) {
  try {
    const cache = await getDiskCache();
    if (cache) await cache.delete(new Request(cacheKeyToUrl(key)));
  } catch {}
  await imageCacheIndex.delete(key);
}

function removeMemoryEntry(key, { retire = true } = {}) {
  const entry = MEM_CACHE.get(key);
  if (!entry) return;
  if (entry.objectUrl) {
    if (retire) retireObjectUrl(entry.objectUrl);
    else URL.revokeObjectURL(entry.objectUrl);
  }
  memoryBytes = Math.max(0, memoryBytes - (entry.blob?.size || 0));
  MEM_CACHE.delete(key);
}

function getMemoryEntry(key) {
  const entry = MEM_CACHE.get(key);
  if (!entry) return null;
  entry.lastAccessedAt = Date.now();
  MEM_CACHE.delete(key);
  MEM_CACHE.set(key, entry);
  return entry;
}

function rememberBlob(key, blob) {
  removeMemoryEntry(key);
  const victims = selectMemoryImageCacheEvictions(
    Array.from(MEM_CACHE, ([entryKey, entry]) => ({
      key: entryKey,
      size: entry.blob?.size || 0,
      lastAccessedAt: entry.lastAccessedAt || 0,
    })),
    blob.size,
    MAX_MEM_BYTES,
    MAX_MEM_ENTRIES,
  );
  victims.forEach((victim) => removeMemoryEntry(victim));

  const objectUrl = URL.createObjectURL(blob);
  MEM_CACHE.set(key, { objectUrl, blob, lastAccessedAt: Date.now() });
  memoryBytes += blob.size || 0;
  return objectUrl;
}

function scheduleImageLoad(key, fetcher, priority = IMAGE_LOAD_PRIORITY.NORMAL) {
  return imageLoadQueue.schedule(key, async (signal) => {
    const memoryEntry = getMemoryEntry(key);
    if (memoryEntry) return memoryEntry.blob;
    let blob = await diskGet(key);
    if (!blob) {
      blob = await fetcher(signal);
      if (!blob) return null;
      diskPut(key, blob).catch(() => {});
    }
    return blob;
  }, priority);
}

export async function primeImage(key, fetcher, { priority = IMAGE_LOAD_PRIORITY.PRELOAD } = {}) {
  if (!key || typeof fetcher !== 'function') return false;
  const scope = getConfigScopeId();
  key = scopedCacheKey(key);
  if (getMemoryEntry(key)) return true;
  try {
    return !!(await scheduleImageLoad(key, (signal) => fetchForScope(fetcher, scope, signal), priority));
  } catch {
    return false;
  }
}

export async function getCachedImage(key) {
  key = scopedCacheKey(key);
  const memoryEntry = getMemoryEntry(key);
  if (memoryEntry) return memoryEntry.objectUrl;
  const blob = await diskGet(key);
  if (!blob) return null;
  return rememberBlob(key, blob);
}

export function putImage(key, blob) {
  if (!key || !blob || typeof blob.size !== 'number') return null;
  key = scopedCacheKey(key);
  diskPut(key, blob).catch(() => {});
  return rememberBlob(key, blob);
}

// ── Public API ──
export async function getImage(key, fetcher, { priority = IMAGE_LOAD_PRIORITY.NORMAL } = {}) {
  const scope = getConfigScopeId();
  key = scopedCacheKey(key);
  // 1. Memory cache (instant)
  const memoryEntry = getMemoryEntry(key);
  if (memoryEntry) return memoryEntry.objectUrl;

  let blob;
  try { blob = await scheduleImageLoad(key, (signal) => fetchForScope(fetcher, scope, signal), priority); } catch { return null; }
  if (!blob) return null;
  const loadedEntry = getMemoryEntry(key);
  if (loadedEntry) return loadedEntry.objectUrl;
  return rememberBlob(key, blob);
}

export async function clearImageCache({ disk = false } = {}) {
  for (const [, entry] of MEM_CACHE) {
    if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  for (const [objectUrl, timer] of retiredObjectUrlTimers) {
    clearTimeout(timer);
    URL.revokeObjectURL(objectUrl);
  }
  retiredObjectUrlTimers.clear();
  MEM_CACHE.clear();
  memoryBytes = 0;
  lastIndexTouch.clear();
  if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = null; }
  if (disk) {
    const cacheDelete = typeof caches === 'undefined'
      ? Promise.resolve(false)
      : caches.delete(DISK_CACHE).catch(() => false);
    await Promise.all([cacheDelete, imageCacheIndex.clear()]);
    diskCachePromise = null;
  }
}

export async function deleteImageKeys(keys) {
  const scopedKeys = Array.from(new Set((Array.isArray(keys) ? keys : [keys])
    .filter(Boolean)
    .map((key) => scopedCacheKey(key))));
  if (scopedKeys.length === 0) return 0;
  await Promise.all(scopedKeys.map(async (key) => {
    removeMemoryEntry(key, { retire: false });
    lastIndexTouch.delete(key);
    await deleteDiskEntry(key);
  }));
  return scopedKeys.length;
}

export async function getImageCacheStats() {
  const entries = await imageCacheIndex.all();
  const estimate = typeof navigator !== 'undefined' && navigator.storage?.estimate ? await navigator.storage.estimate() : {};
  const mode = typeof localStorage !== 'undefined' ? (localStorage.getItem(CACHE_MODE_KEY) || 'auto') : 'auto';
  return { mode, bytes: entries.reduce((sum, entry) => sum + (entry.size || 0), 0), limit: resolveCacheLimit(mode, estimate.quota), entries: entries.length };
}

export function setImageCacheLimit(mode) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(CACHE_MODE_KEY, mode);
  return enforceImageCacheLimit();
}

export async function enforceImageCacheLimit(protectedKeys = new Set()) {
  const entries = await imageCacheIndex.all();
  const estimate = typeof navigator !== 'undefined' && navigator.storage?.estimate ? await navigator.storage.estimate() : {};
  const mode = typeof localStorage !== 'undefined' ? (localStorage.getItem(CACHE_MODE_KEY) || 'auto') : 'auto';
  const stats = { mode, bytes: entries.reduce((sum, entry) => sum + (entry.size || 0), 0), limit: resolveCacheLimit(mode, estimate.quota), entries: entries.length };
  const scopedProtectedKeys = new Set(Array.from(protectedKeys, (key) => scopedCacheKey(key)));
  const victims = selectCacheEvictions(entries, stats.limit, scopedProtectedKeys);
  if (!victims.length) return { ...stats, removed: 0 };
  for (const entry of victims) {
    await deleteDiskEntry(entry.key);
  }
  return { ...stats, removed: victims.length };
}
