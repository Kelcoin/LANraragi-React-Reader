import { getSyncToken, getWorkerUrl } from './worker-config';
import { decorateArchiveRecord, hydrateArchiveRecords, rememberArchiveMetadata } from './archiveMetadataCache';
import { getConfigScopeId, getServerScopeId, migrateLegacyStorageKey } from './configScope';
import { mergeWatchlistReadingProgress } from './readingProgress';

const LOCAL_WATCHLIST_KEY = 'lrr_watchlist';
const REMOTE_WATCHLIST_CACHE_KEY = 'lrr_watchlist_remote_cache';
const WATCHLIST_PENDING_DELETES_KEY = 'lrr_watchlist_pending_deletes';
const REMOTE_LOAD_TTL_MS = 30 * 1000;
const WATCHLIST_RETRY_MS = 2 * 60 * 1000;

let remoteLoadPromise = null;
let remoteLoadPromiseScope = '';
let remoteLoadedAt = 0;
let remoteLoadedScope = '';
let deleteRetryTimer = null;

function remoteConfig() {
  const workerUrl = getWorkerUrl();
  const token = getSyncToken();
  if (!workerUrl || !token) return null;
  return { base: workerUrl.replace(/\/$/, ''), token };
}

export function hasRemoteWatchlist() {
  return !!remoteConfig();
}

function safeReadJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function emitWatchlistChanged() {
  window.dispatchEvent(new CustomEvent('lrr:watchlist-changed'));
}

function activeWatchlistKey() {
  return migrateLegacyStorageKey(hasRemoteWatchlist() ? REMOTE_WATCHLIST_CACHE_KEY : LOCAL_WATCHLIST_KEY);
}

function pendingDeleteKey() {
  return migrateLegacyStorageKey(WATCHLIST_PENDING_DELETES_KEY);
}

function getPendingDeletes() {
  return safeReadJson(pendingDeleteKey(), []).map(String).filter(Boolean);
}

function setPendingDeletes(ids) {
  localStorage.setItem(pendingDeleteKey(), JSON.stringify(Array.from(new Set(ids))));
}

function scheduleDeleteRetry() {
  if (deleteRetryTimer || !hasRemoteWatchlist()) return;
  deleteRetryTimer = setTimeout(() => {
    deleteRetryTimer = null;
    flushWatchlistDeleteQueue().catch(() => {});
  }, WATCHLIST_RETRY_MS);
}

export async function flushWatchlistDeleteQueue() {
  const ids = getPendingDeletes();
  if (ids.length === 0) return true;
  if (!hasRemoteWatchlist()) return false;
  try {
    await workerJson('/watchlist', { method: 'DELETE', body: { ids } });
    const sent = new Set(ids);
    setPendingDeletes(getPendingDeletes().filter((id) => !sent.has(id)));
    return true;
  } catch {
    scheduleDeleteRetry();
    return false;
  }
}

function normalizeWatchlistItem(item) {
  const id = String(item?.id || item?.arcid || '').trim();
  if (!id) return null;
  return {
    id,
    addedAt: Number(item.addedAt) || Date.now(),
  };
}

function sortWatchlist(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeWatchlistItem)
    .filter(Boolean)
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

export function mergeWatchlistProgress(items, histories) {
  return mergeWatchlistReadingProgress(items, histories);
}

export function getWatchlistAutoRemoveIds(items, threshold = 0.8) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => Number(item?.total) > 0 && Number(item?.page) / Number(item.total) > threshold)
    .map((item) => String(item?.id || item?.arcid || ''))
    .filter(Boolean);
}

function writeWatchlistCache(list, { notify = true } = {}) {
  localStorage.setItem(activeWatchlistKey(), JSON.stringify(sortWatchlist(list)));
  if (notify) emitWatchlistChanged();
}

async function workerJson(endpoint, { method = 'GET', body = null } = {}) {
  const cfg = remoteConfig();
  if (!cfg) throw new Error('未配置 Worker');
  const init = {
    method,
    headers: { 'x-sync-token': cfg.token, 'x-lrr-server-scope': getServerScopeId() },
  };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(cfg.base + endpoint, init);
  if (!res.ok) throw new Error(`Worker Error: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function getStoredWatchlist() {
  return sortWatchlist(safeReadJson(activeWatchlistKey(), []));
}

export const getWatchlist = () => getStoredWatchlist().map(decorateArchiveRecord).filter(Boolean);

async function loadWatchlistStateNow({ force = false } = {}) {
  const remote = hasRemoteWatchlist();
  const cfg = remote ? remoteConfig() : null;
  const scope = cfg ? `${getConfigScopeId()}|${cfg.base}|${cfg.token}` : '';
  const watchlistStorageKey = activeWatchlistKey();
  let items;
  let lastSync = 0;
  if (remote && (force || remoteLoadedScope !== scope || !remoteLoadedAt || Date.now() - remoteLoadedAt >= REMOTE_LOAD_TTL_MS)) {
    await flushWatchlistDeleteQueue();
    const data = await workerJson('/watchlist');
    const currentCfg = remoteConfig();
    const currentScope = currentCfg ? `${getConfigScopeId()}|${currentCfg.base}|${currentCfg.token}` : '';
    if (currentScope !== scope) return loadWatchlistStateNow({ force: true });
    const pendingDeletes = new Set(getPendingDeletes());
    items = sortWatchlist(data?.items || []).filter((item) => !pendingDeletes.has(item.id));
    lastSync = data?.lastSync || 0;
    localStorage.setItem(watchlistStorageKey, JSON.stringify(items));
    remoteLoadedAt = Date.now();
    remoteLoadedScope = scope;
  } else {
    items = getStoredWatchlist();
    writeWatchlistCache(items, { notify: false });
  }
  const hydrated = await hydrateArchiveRecords(items, { force });
  if (hydrated.missingIds.length > 0) await removeWatchlistItems(hydrated.missingIds);
  emitWatchlistChanged();
  return { items: hydrated.items, remote, lastSync };
}

export function loadWatchlistState(options = {}) {
  const remote = hasRemoteWatchlist();
  const cfg = remote ? remoteConfig() : null;
  const scope = cfg ? `${getConfigScopeId()}|${cfg.base}|${cfg.token}` : '';
  if (remote && !options.force && remoteLoadPromise && remoteLoadPromiseScope === scope) return remoteLoadPromise;
  const task = loadWatchlistStateNow(options);
  if (!remote) return task;
  remoteLoadPromiseScope = scope;
  const trackedPromise = task.finally(() => {
    if (remoteLoadPromise !== trackedPromise) return;
    remoteLoadPromise = null;
    remoteLoadPromiseScope = '';
  });
  remoteLoadPromise = trackedPromise;
  return trackedPromise;
}

export const addWatchlistItem = async (archive) => {
  rememberArchiveMetadata(archive);
  const item = normalizeWatchlistItem(archive);
  if (!item) return false;
  item.addedAt = Date.now();
  const next = getStoredWatchlist().filter((entry) => entry.id !== item.id);
  writeWatchlistCache([item, ...next]);
  if (!hasRemoteWatchlist()) return true;
  try {
    await workerJson('/watchlist', { method: 'PUT', body: { item } });
    return true;
  } catch {
    return false;
  }
};

export const removeWatchlistItems = async (archiveIds) => {
  const removeSet = new Set((Array.isArray(archiveIds) ? archiveIds : []).map(String).filter(Boolean));
  if (removeSet.size === 0) return 0;
  const before = getStoredWatchlist();
  const next = before.filter((item) => !removeSet.has(item.id));
  const removed = before.length - next.length;
  if (removed === 0) return 0;
  writeWatchlistCache(next);
  if (hasRemoteWatchlist()) {
    try {
      await workerJson('/watchlist', { method: 'DELETE', body: { ids: Array.from(removeSet) } });
    } catch {
      setPendingDeletes([...getPendingDeletes(), ...removeSet]);
      scheduleDeleteRetry();
    }
  }
  return removed;
};

export const removeWatchlistItem = async (archiveId) => removeWatchlistItems([archiveId]);
