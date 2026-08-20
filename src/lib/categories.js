import { lrrApi } from './api.js';
import { getConfigScopeId, migrateLegacyStorageKey } from './configScope.js';

const CACHE_KEY = 'lrr_categories_cache_v1';
const UPDATE_INTERVAL = 30 * 60 * 1000;
// Keep the upstream LANraragi category name byte-for-byte compatible without rendering its emoji in the UI.
export const FAVORITES_CATEGORY_NAME = `${String.fromCodePoint(0x1f516)} Favorites`;
export const FAVORITES_CATEGORY_LABEL = '收藏夹';

let categoriesCache = null;
let categoriesPromise = null;
let categoriesScope = '';

function cacheKey() {
  return migrateLegacyStorageKey(CACHE_KEY);
}

function ensureCurrentScope() {
  const scope = getConfigScopeId();
  if (scope !== categoriesScope) {
    categoriesScope = scope;
    categoriesCache = null;
    categoriesPromise = null;
  }
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t < UPDATE_INTERVAL) return parsed.data;
  } catch {}
  return null;
}

function saveToCache(data) {
  try { localStorage.setItem(cacheKey(), JSON.stringify({ t: Date.now(), data })); } catch {}
}

function setCategoriesCache(data) {
  categoriesCache = Array.isArray(data) ? data : [];
  saveToCache(categoriesCache);
  return categoriesCache;
}

function notifyCategoriesChanged(category) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('lrr:categories-changed', { detail: { category } }));
}

function favoritesCategory(categories) {
  return (categories || []).find((category) => category?.name === FAVORITES_CATEGORY_NAME) || null;
}

export function getCategoryDisplayName(category) {
  if (category?.name === FAVORITES_CATEGORY_NAME) return FAVORITES_CATEGORY_LABEL;
  return category?.name || category?.id || '';
}

export function sortCategoriesForDisplay(categories) {
  return [...(categories || [])].sort((left, right) => (
    Number(right?.name === FAVORITES_CATEGORY_NAME) - Number(left?.name === FAVORITES_CATEGORY_NAME)
  ));
}

export function getCachedCategories() {
  ensureCurrentScope();
  return categoriesCache;
}

export async function getFavoriteState(archiveId) {
  ensureCurrentScope();
  let categories = categoriesCache || loadFromCache();
  if (!categories) {
    const data = await lrrApi.getCategories();
    if (!Array.isArray(data)) throw new Error('LANraragi 返回了无效的分类列表');
    categories = setCategoriesCache(data);
  } else {
    categoriesCache = categories;
  }
  const category = favoritesCategory(categories);
  const id = String(archiveId || '');
  return {
    category,
    favorite: !!category && Array.isArray(category.archives) && category.archives.some((item) => String(item) === id),
  };
}

export async function setArchiveFavorite(archiveId, favorite) {
  const id = String(archiveId || '').trim();
  if (!id) throw new Error('档案 ID 无效');
  const current = await getFavoriteState(id);
  let category = current.category;

  if (favorite && !category) {
    const created = await lrrApi.createCategory(FAVORITES_CATEGORY_NAME);
    if (created?.success === 0 || !created?.category_id) throw new Error('创建 LANraragi 收藏夹失败');
    category = {
      id: created.category_id,
      name: FAVORITES_CATEGORY_NAME,
      pinned: 0,
      search: null,
      archives: [],
    };
    setCategoriesCache([...(categoriesCache || []), category]);
  }

  if (!category) return { category: null, favorite: false };
  if (current.favorite === favorite) return { category, favorite };

  const result = favorite
    ? await lrrApi.addArchiveToCategory(category.id, id)
    : await lrrApi.removeArchiveFromCategory(category.id, id);
  if (result?.success === 0) throw new Error(favorite ? '添加到收藏夹失败' : '从收藏夹移除失败');

  const archives = new Set((category.archives || []).map(String));
  if (favorite) archives.add(id);
  else archives.delete(id);
  const nextCategory = { ...category, archives: Array.from(archives) };
  setCategoriesCache((categoriesCache || []).map((item) => (item.id === category.id ? nextCategory : item)));
  notifyCategoriesChanged(nextCategory);
  return { category: nextCategory, favorite };
}

async function fetchCategories() {
  const data = await lrrApi.getCategories();
  if (!Array.isArray(data)) throw new Error('LANraragi 返回了无效的分类列表');
  return data;
}

export function getStoredCategories() {
  ensureCurrentScope();
  return loadFromCache();
}

export async function loadCategories(options = {}) {
  ensureCurrentScope();
  const { cacheOnly = false, forceRefresh = false } = options;
  const cached = forceRefresh ? null : loadFromCache();
  if (cached) {
    categoriesCache = cached;
    return cached;
  }

  if (cacheOnly) return categoriesCache || [];

  if (categoriesPromise) return categoriesPromise;

  categoriesPromise = (async () => {
    const fallback = categoriesCache || loadFromCache() || [];
    try {
      return setCategoriesCache(await fetchCategories());
    } catch {
      return fallback;
    } finally {
      categoriesPromise = null;
    }
  })();

  return categoriesPromise;
}

export function clearCategoriesCache() {
  ensureCurrentScope();
  categoriesCache = null;
  try { localStorage.removeItem(cacheKey()); } catch {}
}

let updateTimer = null;

export function startCategoriesUpdateTimer() {
  ensureCurrentScope();
  stopCategoriesUpdateTimer();
  const doUpdate = async () => {
    try {
      setCategoriesCache(await fetchCategories());
    } catch {}
    updateTimer = setTimeout(doUpdate, UPDATE_INTERVAL);
  };
  updateTimer = setTimeout(doUpdate, UPDATE_INTERVAL);
}

export function stopCategoriesUpdateTimer() {
  if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
}
