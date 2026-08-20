import { lrrApi } from './api';
import { getConfigFingerprint } from './sessionState';
import { migrateLegacyStorageKey } from './configScope';

const KEY = 'lrr_server_info_cache_v1';
const TTL = 30 * 60 * 1000;
const SERVER_INFO_TIMEOUT_MS = 5000;

const BOOLEAN_FIELDS = [
  'has_password',
  'debug_mode',
  'nofun_mode',
  'server_resizes_images',
  'server_tracks_progress',
  'authenticated_progress',
];

export function normalizeServerInfo(info) {
  if (!info || typeof info !== 'object') return info;
  const normalized = { ...info };
  BOOLEAN_FIELDS.forEach((field) => {
    if (normalized[field] === 0 || normalized[field] === 1) normalized[field] = normalized[field] === 1;
  });
  normalized.server_tracks_progress = normalized.server_tracks_progress === true;
  return normalized;
}

function readCache() {
  try {
    const raw = localStorage.getItem(migrateLegacyStorageKey(KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.configId !== getConfigFingerprint()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function cacheServerInfo(data) {
  const normalized = normalizeServerInfo(data);
  try {
    localStorage.setItem(migrateLegacyStorageKey(KEY), JSON.stringify({
      configId: getConfigFingerprint(),
      ts: Date.now(),
      data: normalized,
    }));
  } catch {}
  return normalized;
}

export function getStoredServerInfo({ allowStale = true } = {}) {
  const cached = readCache();
  if (!cached) return null;
  if (!allowStale && Date.now() - cached.ts > TTL) return null;
  return normalizeServerInfo(cached.data) || null;
}

export async function loadServerInfo({ cacheOnly = false, forceRefresh = false } = {}) {
  const cached = forceRefresh ? null : getStoredServerInfo({ allowStale: !cacheOnly });
  if (cached) return cached;
  if (cacheOnly) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('服务器状态检测超时')), SERVER_INFO_TIMEOUT_MS);
  try {
    const info = await lrrApi.getServerInfo({ signal: controller.signal });
    return cacheServerInfo(info);
  } finally {
    clearTimeout(timer);
  }
}
