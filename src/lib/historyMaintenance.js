import { getHistory, loadHistoryState } from './history';
import { getWatchlist, loadWatchlistState } from './watchlist';
import { getSyncToken, getWorkerUrl } from './worker-config';

const HISTORY_EXISTENCE_CHECK_KEY = 'lrr_history_existence_checked_at';
const HISTORY_EXISTENCE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let checkTimer = null;
let startupTimer = null;
let checkInFlight = null;

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function currentHistoryScopeKey() {
  const serverUrl = (localStorage.getItem('lrr_server_url') || '').replace(/\/$/, '');
  const workerUrl = (getWorkerUrl() || '').replace(/\/$/, '');
  const syncToken = getSyncToken() || '';
  const historyMode = workerUrl && syncToken
    ? `remote:${workerUrl}:${hashString(syncToken)}`
    : 'local';
  return `${HISTORY_EXISTENCE_CHECK_KEY}:${hashString(`${serverUrl}|${historyMode}`)}`;
}

function readLastCheckedAt() {
  return Number(localStorage.getItem(currentHistoryScopeKey()) || 0) || 0;
}

function writeLastCheckedAt(time = Date.now()) {
  localStorage.setItem(currentHistoryScopeKey(), String(time));
}

export function isArchiveMissingError(err) {
  return err?.status === 400 || err?.status === 404;
}

export async function runHistoryExistenceCheck({ force = false } = {}) {
  if (checkInFlight) return checkInFlight;
  const now = Date.now();
  if (!force && now - readLastCheckedAt() < HISTORY_EXISTENCE_CHECK_INTERVAL_MS) return 0;

  checkInFlight = (async () => {
    const before = getHistory().length + getWatchlist().length;
    const [historyState, watchlistState] = await Promise.all([
      loadHistoryState({ force: true }),
      loadWatchlistState({ force: true }),
    ]);
    const after = historyState.histories.length + watchlistState.items.length;
    writeLastCheckedAt();
    return Math.max(0, before - after);
  })();

  try {
    return await checkInFlight;
  } finally {
    checkInFlight = null;
  }
}

export function startHistoryExistenceCheckTimer() {
  if (checkTimer) return;
  startupTimer = window.setTimeout(() => {
    startupTimer = null;
    if (document.visibilityState === 'visible') runHistoryExistenceCheck().catch(() => {});
  }, 5000);
  checkTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') runHistoryExistenceCheck().catch(() => {});
  }, HISTORY_EXISTENCE_CHECK_INTERVAL_MS);
}

export function stopHistoryExistenceCheckTimer() {
  if (startupTimer) {
    window.clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (checkTimer) {
    window.clearInterval(checkTimer);
    checkTimer = null;
  }
}
