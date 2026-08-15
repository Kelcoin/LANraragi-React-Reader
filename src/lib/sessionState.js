import { getConfigScopeId } from './configScope.js';

const SNAPSHOT_VERSION = 3;
const SNAPSHOT_TTL = 12 * 60 * 60 * 1000;

const SESSION_KEY = 'lrr_runtime_session_v1';
const RESUME_KEY = 'lrr_resume_candidate_v2';
const ROUTE_KEY = 'lrr_route_snapshot_v2';
const HOME_KEY = 'lrr_home_snapshot_v2';
const HOME_NAV_KEY = 'lrr_home_navigation_snapshot_v1';
const READER_KEY = 'lrr_reader_snapshot_v2';
const PWA_UPDATE_RELOAD_KEY = 'lrr_pwa_update_reload_v1';

function safeRead(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {}
}

function safeRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {}
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function readStorageJson(storage, key) {
  try {
    const raw = safeRead(storage, key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStorageJson(storage, key, value) {
  try {
    safeWrite(storage, key, JSON.stringify(value));
  } catch {}
}

function isFresh(ts, ttl = SNAPSHOT_TTL) {
  return typeof ts === 'number' && Date.now() - ts <= ttl;
}

export function getConfigFingerprint() {
  return getConfigScopeId();
}

function matchesConfig(snapshot) {
  return !!snapshot && snapshot.version === SNAPSHOT_VERSION && snapshot.configId === getConfigFingerprint();
}

function normalizeSnapshot(payload) {
  return {
    ...payload,
    version: SNAPSHOT_VERSION,
    configId: getConfigFingerprint(),
    ts: Date.now(),
  };
}

function getNavigationType() {
  try {
    const entry = performance.getEntriesByType?.('navigation')?.[0];
    if (entry && typeof entry.type === 'string') return entry.type;
  } catch {}
  try {
    if (performance?.navigation?.type === 1) return 'reload';
  } catch {}
  return 'navigate';
}

export function shouldRestoreColdRoute({
  navigationType = 'navigate',
  wasDiscarded = false,
  isPwaUpdateReload = false,
  hasResumeCandidate = false,
  hasRouteSnapshot = false,
} = {}) {
  if (isPwaUpdateReload || (!wasDiscarded && navigationType !== 'reload')) return false;
  return hasResumeCandidate || hasRouteSnapshot;
}

function createBootState() {
  if (typeof window === 'undefined') {
    return { isFreshRuntime: false, shouldColdRestore: false, isPwaUpdateReload: false };
  }

  const existingSession = safeRead(sessionStorage, SESSION_KEY);
  const isFreshRuntime = !existingSession;
  if (!existingSession) {
    safeWrite(sessionStorage, SESSION_KEY, String(Date.now()));
  }
  const isPwaUpdateReload = safeRead(sessionStorage, PWA_UPDATE_RELOAD_KEY) === '1';
  if (isPwaUpdateReload) {
    safeRemove(sessionStorage, PWA_UPDATE_RELOAD_KEY);
  }

  const resumeCandidate = readJson(RESUME_KEY);
  const validResumeCandidate =
    matchesConfig(resumeCandidate) &&
    isFresh(resumeCandidate?.ts) &&
    resumeCandidate.reason === 'background'
      ? resumeCandidate
      : null;

  if (resumeCandidate && !validResumeCandidate) {
    safeRemove(localStorage, RESUME_KEY);
  }

  const routeSnapshot = loadRouteSnapshot();
  const navigationType = getNavigationType();
  const wasDiscarded = document.wasDiscarded === true;

  // On mobile PWAs, a backgrounded app can be discarded and later restored
  // through a same-context reload where sessionStorage survives. In that case
  // `isFreshRuntime` is false even though we do need a cold restore path.
  const shouldColdRestore = shouldRestoreColdRoute({
    navigationType,
    wasDiscarded,
    isPwaUpdateReload,
    hasResumeCandidate: !!validResumeCandidate,
    hasRouteSnapshot: !!routeSnapshot,
  });

  // Resume markers are one-shot hints for the next fresh runtime only.
  // Consume them immediately so stale background state cannot leak into
  // later explicit launches.
  if (shouldColdRestore) {
    safeRemove(localStorage, RESUME_KEY);
  } else if (navigationType === 'navigate' && !wasDiscarded) {
    safeRemove(localStorage, RESUME_KEY);
    safeRemove(localStorage, ROUTE_KEY);
  }

  return {
    isFreshRuntime,
    shouldColdRestore,
    resumeCandidate: validResumeCandidate,
    navigationType,
    wasDiscarded,
    isPwaUpdateReload,
  };
}

const bootState = createBootState();
const coldRestoreRoute = bootState.shouldColdRestore
  ? (loadRouteSnapshot() || bootState.resumeCandidate?.route || null)
  : null;
let coldRestoreClaimed = false;

export function getBootState() {
  return bootState;
}

export function resolveInitialRoute(currentRoute) {
  if (currentRoute?.kind !== 'home' || currentRoute?.query || !coldRestoreRoute) return currentRoute;
  if (!['reader', 'metadata'].includes(coldRestoreRoute.kind) || !coldRestoreRoute.archiveId) return currentRoute;
  return { kind: coldRestoreRoute.kind, archiveId: coldRestoreRoute.archiveId };
}

export function isColdRestoreBoot() {
  return bootState.shouldColdRestore;
}

export function claimColdRestoreRoute(kind, archiveId = null) {
  if (!bootState.shouldColdRestore || coldRestoreClaimed || !coldRestoreRoute) {
    return false;
  }
  if (coldRestoreRoute.kind !== kind) {
    return false;
  }
  if (archiveId && coldRestoreRoute.archiveId !== archiveId) {
    return false;
  }
  coldRestoreClaimed = true;
  return true;
}

export function saveRouteSnapshot(route) {
  if (!route) return;
  writeJson(ROUTE_KEY, normalizeSnapshot(route));
}

export function loadRouteSnapshot() {
  const snapshot = readJson(ROUTE_KEY);
  if (!matchesConfig(snapshot) || !isFresh(snapshot?.ts)) return null;
  return snapshot;
}

export function markBackground(route = null) {
  if (route) saveRouteSnapshot(route);
  writeJson(RESUME_KEY, normalizeSnapshot({
    reason: 'background',
    route,
  }));
}

export function clearResumeCandidate() {
  safeRemove(localStorage, RESUME_KEY);
}

export function markPwaUpdateReload() {
  safeWrite(sessionStorage, PWA_UPDATE_RELOAD_KEY, '1');
}

export function saveHomeSnapshot(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  writeJson(HOME_KEY, normalized);
  return normalized;
}

export function loadHomeSnapshot() {
  const snapshot = readJson(HOME_KEY);
  if (!matchesConfig(snapshot) || !isFresh(snapshot?.ts)) return null;
  return snapshot;
}

export function saveHomeNavigationSnapshot(snapshot) {
  const homeSnapshot = saveHomeSnapshot(snapshot);
  writeStorageJson(sessionStorage, HOME_NAV_KEY, normalizeSnapshot({
    reason: 'home-navigation',
    homeSnapshotTs: homeSnapshot.ts,
  }));
}

export function consumeHomeNavigationSnapshot() {
  const marker = readStorageJson(sessionStorage, HOME_NAV_KEY);
  safeRemove(sessionStorage, HOME_NAV_KEY);
  if (!matchesConfig(marker) || !isFresh(marker?.ts, 30 * 60 * 1000)) return null;
  const snapshot = loadHomeSnapshot();
  if (!snapshot || snapshot.ts !== marker.homeSnapshotTs) return null;
  return { ...snapshot, reason: 'home-navigation' };
}

export function clearHomeNavigationSnapshot() {
  safeRemove(sessionStorage, HOME_NAV_KEY);
}

export function saveReaderSnapshot(snapshot) {
  writeJson(READER_KEY, normalizeSnapshot(snapshot));
}

export function loadReaderSnapshot(archiveId = null) {
  const snapshot = readJson(READER_KEY);
  if (!matchesConfig(snapshot) || !isFresh(snapshot?.ts)) return null;
  if (archiveId && snapshot.archiveId !== archiveId) return null;
  return snapshot;
}

export function clearReaderSnapshot(archiveId = null) {
  if (archiveId) {
    const snapshot = readJson(READER_KEY);
    if (snapshot?.archiveId !== archiveId) return;
  }
  safeRemove(localStorage, READER_KEY);
}

function patchArchiveProgressList(items, archiveId, page) {
  return Array.isArray(items) ? items.map((item) => (
    String(item?.id || item?.arcid || '') === archiveId
      ? { ...item, page, progress: page }
      : item
  )) : items;
}

export function updateArchiveProgressInSessionSnapshots(archiveId, page) {
  const id = String(archiveId || '').trim();
  if (!id) return;
  const patch = (snapshot) => {
    if (!snapshot) return snapshot;
    const next = { ...snapshot };
    for (const key of ['archives', 'randoms', 'history', 'watchlist']) {
      next[key] = patchArchiveProgressList(next[key], id, page);
    }
    return next;
  };
  const home = readJson(HOME_KEY);
  if (home) writeJson(HOME_KEY, patch(home));
}

export function clearAllSessionSnapshots() {
  [RESUME_KEY, ROUTE_KEY, HOME_KEY, READER_KEY].forEach((key) => safeRemove(localStorage, key));
  safeRemove(sessionStorage, SESSION_KEY);
}
