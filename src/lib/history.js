import { getSyncToken, getWorkerUrl } from './worker-config';
import { decorateArchiveRecord, hydrateArchiveRecords, rememberArchiveMetadata } from './archiveMetadataCache';
import { loadServerInfo } from './serverInfoCache';
import { clampProgressPage, mergeLatestHistoryItems, mergeMonotonicHistoryItems } from './historyProgressCache';
import { getConfigScopeId, getServerScopeId, migrateLegacyStorageKey } from './configScope';
import { dispatchReadingProgressChanged } from './readingProgress';
import { getAllowProgressRegression } from './readerSettings';
import { updateArchiveProgressInSessionSnapshots } from './sessionState';
import { commitRemoteRemoval } from './remoteRemoval';

const LOCAL_HISTORY_KEY = 'lrr_history';
const LOCAL_HIDE_READ_KEY = 'lrr_hide_read';
const REMOTE_HISTORY_CACHE_KEY = 'lrr_history_remote_cache';
const REMOTE_HIDE_READ_CACHE_KEY = 'lrr_hide_read_remote_cache';
const HISTORY_PENDING_DELETES_KEY = 'lrr_history_pending_deletes';
const CROP_COVER_KEY = 'lrr_crop_cover';
const ARCHIVE_BROWSE_MODE_KEY = 'lrr_archive_browse_mode';
const ARCHIVE_DISPLAY_MODE_KEY = 'lrr_archive_display_mode';
const REMOTE_LOAD_TTL_MS = 30 * 1000;
const HISTORY_SYNC_INTERVAL_MS = 8 * 1000;
const HISTORY_SYNC_RETRY_MS = 2 * 60 * 1000;

let remoteLoadPromise = null;
let remoteLoadPromiseScope = '';
let remoteLoadedAt = 0;
let remoteLoadedScope = '';
let historyFlushTimer = null;
let historyFlushPromise = null;
let historyDeleteRetryTimer = null;
let pendingHistoryScope = '';
let pendingHistoryUrgent = false;
const pendingHistorySync = new Map();
const pendingHistoryPageCaps = new Map();

function remoteConfig() {
  const workerUrl = getWorkerUrl();
  const token = getSyncToken();
  if (!workerUrl || !token) return null;
  return { base: workerUrl.replace(/\/$/, ''), token };
}

export function hasRemoteHistory() {
  return !!remoteConfig();
}

function normalizeHistoryItem(item) {
  const id = String(item?.id || item?.arcid || '').trim();
  if (!id) return null;
  return {
    id,
    page: Number(item.page) || 0,
    time: Number(item.time) || 0,
  };
}

function sortHistoryByTime(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeHistoryItem)
    .filter(Boolean)
    .sort((a, b) => (b.time || 0) - (a.time || 0));
}

function safeReadJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function emitHistoryChanged() {
  window.dispatchEvent(new CustomEvent('lrr:history-changed'));
}

function activeHistoryKey() {
  return migrateLegacyStorageKey(hasRemoteHistory() ? REMOTE_HISTORY_CACHE_KEY : LOCAL_HISTORY_KEY);
}

function activeHideReadKey() {
  return migrateLegacyStorageKey(hasRemoteHistory() ? REMOTE_HIDE_READ_CACHE_KEY : LOCAL_HIDE_READ_KEY);
}

function pendingHistoryDeleteKey() {
  return migrateLegacyStorageKey(HISTORY_PENDING_DELETES_KEY);
}

function getPendingHistoryDeletes() {
  return safeReadJson(pendingHistoryDeleteKey(), []).map(String).filter(Boolean);
}

function setPendingHistoryDeletes(ids) {
  localStorage.setItem(pendingHistoryDeleteKey(), JSON.stringify(Array.from(new Set(ids))));
}

function scheduleHistoryDeleteRetry() {
  if (historyDeleteRetryTimer || !hasRemoteHistory()) return;
  historyDeleteRetryTimer = setTimeout(() => {
    historyDeleteRetryTimer = null;
    flushHistoryDeleteQueue().catch(() => {});
  }, HISTORY_SYNC_RETRY_MS);
}

export async function flushHistoryDeleteQueue() {
  const ids = getPendingHistoryDeletes();
  if (ids.length === 0) return true;
  if (!hasRemoteHistory()) return false;
  // If an archive was read again after the failed delete, it is active in the
  // local history again — drop the stale delete intent instead of wiping the
  // new progress on the worker.
  const activeIds = new Set(getStoredHistory().map((item) => item.id));
  const remaining = ids.filter((id) => !activeIds.has(id));
  if (remaining.length === 0) {
    setPendingHistoryDeletes([]);
    return true;
  }
  try {
    await workerJson('/history', { method: 'DELETE', body: { ids: remaining } });
    const sent = new Set(remaining);
    setPendingHistoryDeletes(getPendingHistoryDeletes().filter((id) => !sent.has(id)));
    return true;
  } catch {
    scheduleHistoryDeleteRetry();
    return false;
  }
}

function writeHistoryCache(list, { notify = true } = {}) {
  const histories = sortHistoryByTime(list);
  localStorage.setItem(activeHistoryKey(), JSON.stringify(histories));
  if (notify) emitHistoryChanged();
}

function discardPendingHistorySync(archiveIds) {
  const ids = (Array.isArray(archiveIds) ? archiveIds : [archiveIds]).map(String).filter(Boolean);
  for (const id of ids) {
    pendingHistorySync.delete(id);
    pendingHistoryPageCaps.delete(id);
  }
}

function writeHideReadCache(v) {
  localStorage.setItem(activeHideReadKey(), v ? '1' : '0');
  emitHistoryChanged();
}

async function workerJson(endpoint, { method = 'GET', body = null, keepalive = false } = {}) {
  const cfg = remoteConfig();
  if (!cfg) throw new Error('未配置 Worker');
  const init = {
    method,
    headers: { 'x-sync-token': cfg.token, 'x-lrr-server-scope': getServerScopeId() },
    keepalive,
  };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const perform = () => fetch(cfg.base + endpoint, init);
  // Serialize cross-tab writes with Web Locks so two tabs cannot interleave
  // read-modify-write on the worker KV (mutationLocks is per-isolate there).
  // keepalive teardown and reads skip the lock. Cross-device concurrency
  // still needs Durable Objects to be fully atomic.
  const request = method !== 'GET' && !keepalive && typeof navigator?.locks?.request === 'function'
    ? navigator.locks.request('lrr-worker-write-v1', { mode: 'exclusive' }, perform)
    : perform();
  const res = await request;
  if (!res.ok) throw new Error(`Worker Error: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function scheduleHistoryFlush(delay = HISTORY_SYNC_INTERVAL_MS) {
  if (historyFlushTimer) return;
  historyFlushTimer = setTimeout(() => {
    historyFlushTimer = null;
    flushHistorySync().catch(() => {});
  }, delay);
}

// Rapid page flips collapse into one remote write after the reader pauses for
// this window instead of one PUT per page (server not tracking progress).
const URGENT_FLUSH_DELAY_MS = 1500;

function queueHistorySync(item, pageCap = 0, immediateRemote = false) {
  const cfg = remoteConfig();
  if (!cfg) return;
  const scope = `${getConfigScopeId()}|${cfg.base}|${cfg.token}`;
  if (pendingHistoryScope && pendingHistoryScope !== scope) {
    pendingHistorySync.clear();
    pendingHistoryPageCaps.clear();
    pendingHistoryUrgent = false;
  }
  pendingHistoryScope = scope;
  if (pageCap > 0) pendingHistoryPageCaps.set(item.id, pageCap);
  const queued = pendingHistorySync.get(item.id);
  const boundedQueued = queued
    ? { ...queued, page: clampProgressPage(queued.page, pageCap) }
    : null;
  pendingHistorySync.set(item.id, mergeLatestHistoryItems(boundedQueued ? [boundedQueued] : [], [item])[0]);
  pendingHistoryUrgent = pendingHistoryUrgent || immediateRemote;
  if (immediateRemote && historyFlushTimer) {
    clearTimeout(historyFlushTimer);
    historyFlushTimer = null;
  }
  if (!historyFlushPromise) scheduleHistoryFlush(immediateRemote ? URGENT_FLUSH_DELAY_MS : HISTORY_SYNC_INTERVAL_MS);
}

export async function flushHistorySync({ keepalive = false } = {}) {
  const cfg = remoteConfig();
  const scope = cfg ? `${getConfigScopeId()}|${cfg.base}|${cfg.token}` : '';
  if (!cfg || (pendingHistoryScope && pendingHistoryScope !== scope)) {
    pendingHistorySync.clear();
    pendingHistoryPageCaps.clear();
    pendingHistoryUrgent = false;
    pendingHistoryScope = '';
    if (historyFlushTimer) clearTimeout(historyFlushTimer);
    historyFlushTimer = null;
    return true;
  }
  if (pendingHistorySync.size === 0) return true;
  if (historyFlushPromise) return historyFlushPromise;
  if (historyFlushTimer) {
    clearTimeout(historyFlushTimer);
    historyFlushTimer = null;
  }

  const batch = Array.from(pendingHistorySync.values());
  const batchWasUrgent = pendingHistoryUrgent;
  pendingHistoryUrgent = false;
  batch.forEach((item) => pendingHistorySync.delete(item.id));
  historyFlushPromise = workerJson('/history', { method: 'PUT', body: { histories: batch }, keepalive })
    .then(() => true)
    .catch(() => {
      batch.forEach((item) => {
        const queued = pendingHistorySync.get(item.id);
        const pageCap = pendingHistoryPageCaps.get(item.id) || 0;
        const boundedQueued = queued ? { ...queued, page: clampProgressPage(queued.page, pageCap) } : null;
        const boundedItem = { ...item, page: clampProgressPage(item.page, pageCap) };
        pendingHistorySync.set(item.id, mergeLatestHistoryItems(boundedQueued ? [boundedQueued] : [], [boundedItem])[0]);
      });
      pendingHistoryUrgent = pendingHistoryUrgent || batchWasUrgent;
      scheduleHistoryFlush(HISTORY_SYNC_RETRY_MS);
      return false;
    })
    .finally(() => {
      historyFlushPromise = null;
      if (pendingHistorySync.size === 0) {
        pendingHistoryScope = '';
        pendingHistoryPageCaps.clear();
        pendingHistoryUrgent = false;
      }
      if (pendingHistorySync.size > 0 && !historyFlushTimer) {
        scheduleHistoryFlush(pendingHistoryUrgent ? 0 : HISTORY_SYNC_INTERVAL_MS);
      }
    });
  return historyFlushPromise;
}

function archiveToHistoryItem(archive, page) {
  rememberArchiveMetadata(archive);
  return {
    id: archive.arcid,
    page: clampProgressPage(page, archive.pagecount),
    time: Date.now(),
  };
}

function getStoredHistory() {
  return sortHistoryByTime(safeReadJson(activeHistoryKey(), []));
}

export const getHistory = () => getStoredHistory().map(decorateArchiveRecord).filter(Boolean);

async function loadHistoryStateNow({ force = false } = {}) {
  const remote = hasRemoteHistory();
  const cfg = remote ? remoteConfig() : null;
  const scope = cfg ? `${getConfigScopeId()}|${cfg.base}|${cfg.token}` : '';
  const historyStorageKey = activeHistoryKey();
  const hideReadStorageKey = activeHideReadKey();
  let histories;
  let hideRead;
  let retentionDays = 0;

  if (remote && (force || remoteLoadedScope !== scope || !remoteLoadedAt || Date.now() - remoteLoadedAt >= REMOTE_LOAD_TTL_MS)) {
    await flushHistorySync();
    await flushHistoryDeleteQueue();
    const data = await workerJson('/history');
    const currentCfg = remoteConfig();
    const currentScope = currentCfg ? `${getConfigScopeId()}|${currentCfg.base}|${currentCfg.token}` : '';
    if (currentScope !== scope) return loadHistoryStateNow({ force: true });
    const pendingDeletes = new Set(getPendingHistoryDeletes());
    const remoteHistories = sortHistoryByTime(data?.histories || []).filter((item) => !pendingDeletes.has(item.id));
    const allowRegression = getAllowProgressRegression();
    histories = allowRegression
      ? mergeLatestHistoryItems(remoteHistories, getStoredHistory())
      : mergeMonotonicHistoryItems(remoteHistories, getStoredHistory());
    hideRead = !!data?.hideRead;
    retentionDays = data?.retentionDays || 0;
    localStorage.setItem(historyStorageKey, JSON.stringify(histories));
    localStorage.setItem(hideReadStorageKey, hideRead ? '1' : '0');
    // Backfill anything newer locally than on the worker (e.g. a pagehide
    // keepalive flush that failed, or a flush dropped by a config switch).
    // Previously this only happened when the server tracks progress itself.
    const remoteById = new Map(remoteHistories.map((item) => [item.id, item]));
    const backfill = getStoredHistory().filter((item) => {
      if (pendingDeletes.has(item.id)) return false;
      const remoteItem = remoteById.get(item.id);
      return !remoteItem || (item.time || 0) > (remoteItem.time || 0);
    });
    if (backfill.length > 0) {
      await workerJson('/history', { method: 'PUT', body: { histories: backfill } }).catch(() => {});
    }
    remoteLoadedAt = Date.now();
    remoteLoadedScope = scope;
  } else {
    histories = getStoredHistory();
    hideRead = getHideRead();
    writeHistoryCache(histories, { notify: false });
  }

  const hydrated = await hydrateArchiveRecords(histories, { force });
  if (hydrated.missingIds.length > 0) await pruneHistoryItems(hydrated.missingIds);
  let resultItems = hydrated.items;
  try {
    const serverInfo = await loadServerInfo({ forceRefresh: force });
    if (serverInfo?.server_tracks_progress === true) {
      const storedById = new Map(histories.map((item) => [item.id, item]));
      const changed = [];
      resultItems = hydrated.items.map((item) => {
        if (item.progress === undefined || item.progress === null || item.progress === '') return item;
        const pageCap = Math.max(0, Number.parseInt(item.pagecount, 10) || 0);
        const lrrProgress = clampProgressPage(item.progress, pageCap);
        const stored = storedById.get(item.id);
        const storedPage = clampProgressPage(stored?.page, pageCap);
        const nextPage = getAllowProgressRegression()
          ? (stored ? storedPage : lrrProgress)
          : Math.max(storedPage, lrrProgress);
        if (!stored || stored.page === nextPage) return { ...item, page: nextPage };
        const next = { id: item.id, page: nextPage, time: stored.time };
        changed.push(next);
        return { ...item, page: nextPage };
      });
      if (changed.length > 0) {
        const changedById = new Map(changed.map((item) => [item.id, item]));
        const reconciled = histories.map((item) => changedById.get(item.id) || item);
        writeHistoryCache(reconciled, { notify: false });
        if (remote) await workerJson('/history', { method: 'PUT', body: { histories: changed } }).catch(() => {});
      }
    }
  } catch {}
  emitHistoryChanged();
  return { histories: resultItems, hideRead, remote, retentionDays };
}

export function loadHistoryState(options = {}) {
  const remote = hasRemoteHistory();
  const cfg = remote ? remoteConfig() : null;
  const scope = cfg ? `${getConfigScopeId()}|${cfg.base}|${cfg.token}` : '';
  if (remote && !options.force && remoteLoadPromise && remoteLoadPromiseScope === scope) return remoteLoadPromise;
  const task = loadHistoryStateNow(options);
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

export const saveHistory = async (archive, page, { immediateRemote = false, allowRegression = getAllowProgressRegression() } = {}) => {
  if (!archive?.arcid) return false;
  const item = archiveToHistoryItem(archive, page);
  const storedHistory = getStoredHistory().map((entry) => (
    entry.id === item.id
      ? { ...entry, page: clampProgressPage(entry.page, archive.pagecount) }
      : entry
  ));
  const history = allowRegression
    ? mergeLatestHistoryItems(storedHistory, [item])
    : mergeMonotonicHistoryItems(storedHistory, [item]);
  writeHistoryCache(history);
  updateArchiveProgressInSessionSnapshots(item.id, item.page);
  rememberArchiveMetadata({ ...archive, id: item.id, arcid: item.id, page: item.page, progress: item.page });
  dispatchReadingProgressChanged({
    archiveId: item.id,
    page: item.page,
    total: archive.pagecount,
    timestamp: item.time,
  });

  if (!hasRemoteHistory()) return true;
  queueHistorySync(history.find((entry) => entry.id === item.id), archive.pagecount, immediateRemote);
  return true;
};

export const getHideRead = () => localStorage.getItem(activeHideReadKey()) === '1';

export const setHideRead = async (v) => {
  writeHideReadCache(v);
  if (!hasRemoteHistory()) return true;
  try {
    await workerJson('/history', { method: 'PUT', body: { hideRead: !!v } });
    return true;
  } catch {
    return false;
  }
};

export const replaceAllHistory = async (list) => {
  const histories = sortHistoryByTime(list);
  writeHistoryCache(histories);
  if (!hasRemoteHistory()) return true;
  try {
    await workerJson('/history', { method: 'PUT', body: { histories } });
    return true;
  } catch {
    return false;
  }
};

export const removeHistoryItems = async (archiveIds) => {
  const removeSet = new Set((Array.isArray(archiveIds) ? archiveIds : []).filter(Boolean));
  if (removeSet.size === 0) return 0;
  const before = getStoredHistory();
  const next = before.filter((item) => !removeSet.has(item.id));
  const removed = before.length - next.length;
  if (removed === 0) return 0;
  const ids = Array.from(removeSet);
  await commitRemoteRemoval({
    hasRemote: hasRemoteHistory(),
    removeRemote: () => workerJson('/history', { method: 'DELETE', body: { ids }, keepalive: true }),
    commitLocal: () => {
      discardPendingHistorySync(ids);
      writeHistoryCache(next);
    },
  });
  return removed;
};

export const removeHistoryItem = async (archiveId) => removeHistoryItems([archiveId]);

export const pruneHistoryItems = async (archiveIds) => {
  const removeSet = new Set((Array.isArray(archiveIds) ? archiveIds : []).filter(Boolean));
  if (removeSet.size === 0) return 0;
  const before = getStoredHistory();
  const next = before.filter((item) => !removeSet.has(item.id));
  const removed = before.length - next.length;
  if (removed === 0) return 0;

  writeHistoryCache(next);
  if (hasRemoteHistory()) {
    try {
      await workerJson('/history', { method: 'DELETE', body: { ids: Array.from(removeSet) } });
    } catch {
      setPendingHistoryDeletes([...getPendingHistoryDeletes(), ...removeSet]);
      scheduleHistoryDeleteRetry();
    }
  }
  return removed;
};

export const getCropCover = () => localStorage.getItem(CROP_COVER_KEY) !== '0';

export const setCropCover = (v) => {
  localStorage.setItem(CROP_COVER_KEY, v ? '1' : '0');
};

export const getArchiveBrowseMode = () => localStorage.getItem(ARCHIVE_BROWSE_MODE_KEY) === 'paged' ? 'paged' : 'scroll';

export const setArchiveBrowseMode = (mode) => {
  localStorage.setItem(ARCHIVE_BROWSE_MODE_KEY, mode === 'paged' ? 'paged' : 'scroll');
};

export const ARCHIVE_DISPLAY_MODES = { card: 'card', compact: 'compact' };

export const getArchiveDisplayMode = () => (
  localStorage.getItem(ARCHIVE_DISPLAY_MODE_KEY) === ARCHIVE_DISPLAY_MODES.compact
    ? ARCHIVE_DISPLAY_MODES.compact
    : ARCHIVE_DISPLAY_MODES.card
);

export const setArchiveDisplayMode = (mode) => {
  localStorage.setItem(
    ARCHIVE_DISPLAY_MODE_KEY,
    mode === ARCHIVE_DISPLAY_MODES.compact ? ARCHIVE_DISPLAY_MODES.compact : ARCHIVE_DISPLAY_MODES.card,
  );
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { flushHistorySync({ keepalive: true }).catch(() => {}); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushHistorySync({ keepalive: true }).catch(() => {});
  });
}
