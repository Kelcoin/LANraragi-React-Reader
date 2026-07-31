import { normalizeThemePalettes } from './theme.js';

const WORKER_URL_KEY = 'lrr_worker_url';
const SYNC_TOKEN_KEY = 'lrr_sync_token';

export function getWorkerUrl() {
  return localStorage.getItem(WORKER_URL_KEY) || '';
}

export function setWorkerUrl(url) {
  if (url) localStorage.setItem(WORKER_URL_KEY, url);
  else localStorage.removeItem(WORKER_URL_KEY);
}

export function getSyncToken() {
  return localStorage.getItem(SYNC_TOKEN_KEY) || '';
}

export function hasValidWorkerConfig(url = getWorkerUrl(), token = getSyncToken()) {
  if (!String(token || '').trim()) return false;
  try {
    const parsed = new URL(String(url || '').trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
  } catch {
    return false;
  }
}

export function setSyncToken(token) {
  if (token) localStorage.setItem(SYNC_TOKEN_KEY, token);
  else localStorage.removeItem(SYNC_TOKEN_KEY);
}

// ── Config Export / Import ─────────────────────────────────────
export const CONFIG_KEYS = [
  'lrr_server_url',
  'lrr_api_key',
  'lrr_worker_url',
  'lrr_sync_token',
  'lrr_eh_cookie',
  'lrr_eh_min_score',
  'lrr_eh_max_comments',
  'lrr_eh_sort_method',
  'lrr_eh_sort_order',
  'lrr_reader_settings',
  'lrr_hide_read',
  'lrr_random_hide_read',
  'lrr_filter',
  'lrr_crop_cover',
  'lrr_archive_browse_mode',
  'lrr_eh_favorite_delete_sync',
  'lrr_image_cache_limit',
  'lrr_theme_mode',
  'lrr_custom_theme',
  'lrr_filter_presets',
];

function encodeUtf8Base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeUtf8Base64(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function exportConfig(overrides = {}) {
  const cfg = {};
  for (const key of CONFIG_KEYS) {
    const val = localStorage.getItem(key);
    if (val) cfg[key] = val;
  }
  for (const key of CONFIG_KEYS) {
    if (!Object.hasOwn(overrides, key)) continue;
    const value = overrides[key];
    if (typeof value === 'string' && value) cfg[key] = value;
    else delete cfg[key];
  }
  return encodeUtf8Base64(JSON.stringify(cfg));
}

export function importConfig(encoded) {
  let cfg;
  try {
    cfg = JSON.parse(decodeUtf8Base64(encoded));
  } catch {
    throw new Error('无效的配置数据：无法解码');
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('无效的配置数据：格式错误');
  let count = 0;
  for (const key of CONFIG_KEYS) {
    if (cfg[key] !== undefined) {
      if (typeof cfg[key] !== 'string') continue;
      if (key === 'lrr_custom_theme') {
        let parsedTheme;
        try { parsedTheme = JSON.parse(cfg[key]); } catch { continue; }
        const normalizedTheme = normalizeThemePalettes(parsedTheme);
        if (!normalizedTheme) continue;
        localStorage.setItem(key, JSON.stringify(normalizedTheme));
        count++;
        continue;
      }
      localStorage.setItem(key, cfg[key]);
      count++;
    }
  }
  if (count === 0) throw new Error('配置数据中未包含任何有效字段');
  return count;
}
