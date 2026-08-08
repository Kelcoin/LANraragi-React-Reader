import { md5 } from './configScope.js';

const DB_NAME = 'readoshi-eh-comments-v1';
const STORE = 'comments';
export const EH_COMMENTS_CACHE_TTL = 24 * 60 * 60 * 1000;
export const EH_COMMENTS_CACHE_MAX_ENTRIES = 100;

const memoryCache = new Map();

function normalizeSourceUrl(sourceUrl) {
  const raw = String(sourceUrl || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.href.replace(/\/$/, '');
  } catch {
    return raw.replace(/\/+$/, '').toLowerCase();
  }
}

export function createEhCommentsCacheKey(sourceUrl, cookie) {
  return `eh-comments:${md5(normalizeSourceUrl(sourceUrl))}:${md5(String(cookie || ''))}`;
}

export function selectEhCommentRecordsToDelete(records, {
  now = Date.now(),
  ttl = EH_COMMENTS_CACHE_TTL,
  maxEntries = EH_COMMENTS_CACHE_MAX_ENTRIES,
} = {}) {
  const expired = records.filter((record) => now - Number(record?.ts || 0) > ttl);
  const expiredKeys = new Set(expired.map((record) => record.key));
  const valid = records
    .filter((record) => !expiredKeys.has(record.key))
    .sort((a, b) => Number(a.lastAccess || a.ts || 0) - Number(b.lastAccess || b.ts || 0));
  const overflow = valid.slice(0, Math.max(0, valid.length - maxEntries));
  return [...new Set([...expired, ...overflow].map((record) => record.key))];
}

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, operation) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const request = operation(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

function isFresh(record, now) {
  return !!record && now - Number(record.ts || 0) <= EH_COMMENTS_CACHE_TTL;
}

export async function readEhCommentsCacheState(key, { now = Date.now() } = {}) {
  let record = memoryCache.get(key) || null;
  if (!record) {
    try { record = await withStore('readonly', (store) => store.get(key)); } catch { record = null; }
  }
  if (!isFresh(record, now)) {
    if (record) await deleteEhCommentsCache(key);
    return null;
  }
  const accessed = { ...record, lastAccess: now };
  memoryCache.set(key, accessed);
  try { await withStore('readwrite', (store) => store.put(accessed)); } catch {}
  return {
    comments: Array.isArray(accessed.comments) ? accessed.comments : [],
    unavailable: typeof accessed.unavailable === 'string' ? accessed.unavailable : null,
    ts: Number(accessed.ts || 0),
  };
}

export async function readEhCommentsCache(key, options = {}) {
  const state = await readEhCommentsCacheState(key, options);
  return state ? state.comments : null;
}

export async function writeEhCommentsCache(key, comments, { now = Date.now(), unavailable = null } = {}) {
  const record = { key, comments: Array.isArray(comments) ? comments : [], unavailable: unavailable || null, ts: now, lastAccess: now };
  memoryCache.set(key, record);
  try { await withStore('readwrite', (store) => store.put(record)); } catch {}
  await pruneEhCommentsCache({ now });
}

export async function deleteEhCommentsCache(key) {
  memoryCache.delete(key);
  try { await withStore('readwrite', (store) => store.delete(key)); } catch {}
}

export async function pruneEhCommentsCache({ now = Date.now() } = {}) {
  const memoryDeletes = selectEhCommentRecordsToDelete([...memoryCache.values()], { now });
  memoryDeletes.forEach((key) => memoryCache.delete(key));
  let records = null;
  try { records = await withStore('readonly', (store) => store.getAll()); } catch {}
  if (!Array.isArray(records)) return;
  const deletes = selectEhCommentRecordsToDelete(records, { now });
  await Promise.all(deletes.map(async (key) => {
    memoryCache.delete(key);
    try { await withStore('readwrite', (store) => store.delete(key)); } catch {}
  }));
}
