import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, useReducer } from 'react';
import { createPortal } from 'react-dom';
import { loadArchiveMetadataBatch, lrrApi } from '../lib/api';
import { getHistory, getHideRead, setHideRead, getCropCover, setCropCover, getArchiveBrowseMode, setArchiveBrowseMode, getArchiveDisplayMode, setArchiveDisplayMode, ARCHIVE_DISPLAY_MODES, removeHistoryItem, loadHistoryState } from '../lib/history';
import { addWatchlistItem, getWatchlist, getWatchlistAutoRemoveIds, loadWatchlistState, mergeWatchlistProgress, pruneWatchlistItem, pruneWatchlistItems, removeWatchlistItem } from '../lib/watchlist';
import { loadTagDB, startTagDBUpdateTimer, stopTagDBUpdateTimer } from '../lib/tags';
import { getWorkerUrl, setWorkerUrl, getSyncToken, setSyncToken, importConfig, hasValidWorkerConfig } from '../lib/worker-config';
import { runHistoryExistenceCheck } from '../lib/historyMaintenance';
import { getEhCookie, getEhFavoriteDeleteSync, hasValidEhCookie, setEhFavoriteDeleteSync } from '../lib/ehFavoriteSync';
import { acquireBodyScrollLock } from '../lib/bodyScrollLock';
import { deleteArchiveWithFavoriteSync } from '../lib/archiveDeletion';
import ArchiveCard from '../components/ArchiveCard';
import ArchiveGrid from '../components/ArchiveGrid';
import ArchiveContextMenu from '../components/ArchiveContextMenu';
import ConfirmDialog from '../components/ConfirmDialog';
import ExecutionProgressPanel from '../components/ExecutionProgressPanel';
import ArchiveDeletionFailureDialog from '../components/ArchiveDeletionFailureDialog';
import TextInputDialog from '../components/TextInputDialog';
import CustomSelect from '../components/CustomSelect';
import TagSuggest from '../components/TagSuggest';
import CacheSettings from '../components/CacheSettings';
import EhFavoriteDeleteSwitch from '../components/EhFavoriteDeleteSwitch';
import ToggleSwitch from '../components/ToggleSwitch';
import AppVersion from '../components/AppVersion';
import ConfigTransferDialog from '../components/ConfigTransferDialog';
import ConfigExportDialog from '../components/ConfigExportDialog';
import SettingHint from '../components/SettingHint';
import SecretInput from '../components/SecretInput';
import ThemeColorPicker from '../components/ThemeColorPicker';
import { useToast } from '../components/Toast';
import { HomeSectionGlyph, ThemeModeGlyph, ToolbarGlyph, getSectionGlyphColor } from '../components/AppGlyphs';
import { deleteFilterPreset, readFilterPresets, renameFilterPreset, saveFilterPreset } from '../lib/filterPresets';
import { FAVORITES_CATEGORY_NAME, getCategoryDisplayName, getStoredCategories, loadCategories, setArchiveFavorite, sortCategoriesForDisplay, startCategoriesUpdateTimer, stopCategoriesUpdateTimer } from '../lib/categories';
import { claimColdRestoreRoute, consumeHomeNavigationSnapshot, getBootState, loadHomeSnapshot, markBackground, saveHomeNavigationSnapshot, saveHomeSnapshot } from '../lib/sessionState';
import { getStoredServerInfo, loadServerInfo } from '../lib/serverInfoCache';
import { useHorizontalScroller } from '../lib/horizontalScroller';
import { navigateDeduplicate, navigateHistory, navigateHome, navigateToMetadata, navigateUpload, navigateWatchlist } from '../lib/navigation';
import { ARCHIVE_BROWSE_MODES, ARCHIVE_PAGE_SIZE, clampArchivePage, getArchivePageAfterResize, getArchivePageCount, getArchivePageStart, getSmartArchivePageSize } from '../lib/archivePagination';
import { reduceArchiveRefreshPhase } from '../lib/archiveRefreshMotion';
import { ARCHIVE_PROGRESS_VISIBILITY, shouldShowArchiveProgress } from '../lib/archiveProgress';
import { clearConfiguredArchiveReadingProgress } from '../lib/archiveProgressActions';
import { consumeArchiveCatalogDirty } from '../lib/archiveMetadataCache';
import { ARCHIVE_CARD_COVER_HEIGHT, ARCHIVE_CARD_META_GAP, ARCHIVE_CARD_META_ROW_HEIGHT, ARCHIVE_CARD_TITLE_GAP, ARCHIVE_CARD_TITLE_SLOT_HEIGHT, ARCHIVE_CARD_WIDTH } from '../lib/archiveGridLayout';


const HOME_COLLAPSE_STORAGE_KEYS = {
  history: 'lrr_home_collapsed_history',
  watchlist: 'lrr_home_collapsed_watchlist',
  random: 'lrr_home_collapsed_random',
};

function readStoredCollapsed(key, fallback = false) {
  try {
    const value = localStorage.getItem(key);
    if (value === '1') return true;
    if (value === '0') return false;
  } catch {}
  return !!fallback;
}

import { subscribeReadingProgressChanged } from '../lib/readingProgress';
import { migrateLegacyStorageKey } from '../lib/configScope';
import { DEFAULT_READER_SETTINGS, READER_SETTINGS_KEY, normalizeReaderSettings, sanitizeUnsignedIntegerInput } from '../lib/readerSettings';
import { getArchiveSearchTotal, hasArchiveSearchQuery } from '../lib/archiveSearch';
import { filterRandomArchives, getRandomHideRead, setRandomHideRead } from '../lib/randomArchiveFilter';
import { DEFAULT_THEME_PALETTES, readStoredThemePalettes } from '../lib/theme';
import { getNewlyAddedArchiveId, getNewlyAddedArchiveIds, getRemovedArchiveIds, getSettingsPaneNaturalHeight, getVisibleContinueReadingItems } from '../lib/readerUiState';

const FILTER_KEY = 'lrr_filter';
const RANDOMS_RECENT_KEY = 'lrr_random_recent_v1';
const RANDOMS_BATCH_SIZE = 8;
const RANDOMS_DEFAULT_BATCHES = 2;
const RANDOMS_FILL_MAX_ITEMS = 24;
const RANDOMS_FETCH_ATTEMPTS = 3;
const RANDOMS_RECENT_LIMIT = 48;
const RANDOMS_REQUEST_TIMEOUT_MS = 6500;
const ARCHIVES_SCROLL_KEY = 'lrr_scroll_archives_on_arrival';
const RANDOMS_REVALIDATE_STALE_MS = 10 * 60 * 1000;
const RANDOMS_RESTORE_GRACE_MS = 90 * 1000;
const RESUME_REFRESH_SUPPRESS_MS = 10 * 1000;
const FILTER_INPUT_MIN_WIDTH = 400;
const FILTER_ACTIONS_MIN_WIDTH = 320;
const FILTER_LAYOUT_GAP = 12;
const FILTER_STACK_BREAKPOINT = FILTER_INPUT_MIN_WIDTH + FILTER_ACTIONS_MIN_WIDTH + FILTER_LAYOUT_GAP;
const HOME_NARROW_MAX_WIDTH = 720;
const HOME_MAX_WIDTH = 1680;
const HOME_CAROUSEL_EXPANDED_HEIGHT = '420px';
const UNTAGGED_CATEGORY_ID = '__untagged__';
const UNTAGGED_CATEGORY = Object.freeze({ id: UNTAGGED_CATEGORY_ID, name: '无标签' });

function getHomeCarouselPadding(isNarrow) {
  return `12px ${isNarrow ? 14 : 20}px 20px`;
}

function getRandomSkeletonCount(viewportWidth, isNarrow) {
  const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const shellWidth = Math.min(safeViewportWidth, HOME_MAX_WIDTH);
  const shellPadding = isNarrow ? 20 : 40;
  const carouselPadding = isNarrow ? 28 : 40;
  const gap = isNarrow ? 10 : 16;
  const availableWidth = Math.max(ARCHIVE_CARD_WIDTH, shellWidth - shellPadding - carouselPadding);
  return Math.max(5, Math.ceil((availableWidth + gap) / (ARCHIVE_CARD_WIDTH + gap)));
}

function readFilter() {
  try {
    return JSON.parse(localStorage.getItem(FILTER_KEY));
  } catch { return null; }
}

function readRouteFilterQuery(routeQuery) {
  const query = routeQuery || '';
  if (!query) return '';
  const stored = readFilter();
  const storedQuery = typeof stored?.query === 'string' ? stored.query : '';
  const normalize = (value) => (value || '').trim().replace(/,\s*$/, '').trim();
  return normalize(storedQuery) === normalize(query) ? storedQuery : query;
}

function writeFilter(f) {
  localStorage.setItem(FILTER_KEY, JSON.stringify(f));
}

function tokenizeFilterQuery(query = '') {
  return query
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatFilterTokens(tokens, { trailingComma = false } = {}) {
  const text = tokens.map((token) => token.trim()).filter(Boolean).join(', ');
  if (!text) return '';
  return trailingComma ? `${text}, ` : text;
}

function appendFilterToken(query, token) {
  const trimmedToken = (token || '').trim();
  if (!trimmedToken) return query || '';
  const tokens = tokenizeFilterQuery(query);
  if (!tokens.includes(trimmedToken)) tokens.push(trimmedToken);
  return formatFilterTokens(tokens, { trailingComma: true });
}

function removeFilterToken(query, token) {
  const trimmedToken = (token || '').trim();
  const tokens = tokenizeFilterQuery(query).filter((part) => part !== trimmedToken);
  return formatFilterTokens(tokens);
}

function replaceCurrentFilterToken(query, token) {
  const trimmedToken = (token || '').trim();
  if (!trimmedToken) return query || '';
  const raw = query || '';
  const commaIndex = raw.lastIndexOf(',');
  const prefix = commaIndex >= 0 ? raw.slice(0, commaIndex) : '';
  const tokens = tokenizeFilterQuery(prefix);
  tokens.push(trimmedToken);
  return formatFilterTokens(tokens, { trailingComma: true });
}

function readRecentRandomIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(migrateLegacyStorageKey(RANDOMS_RECENT_KEY)));
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeRecentRandomIds(ids) {
  try {
    localStorage.setItem(migrateLegacyStorageKey(RANDOMS_RECENT_KEY), JSON.stringify(ids.slice(0, RANDOMS_RECENT_LIMIT)));
  } catch {}
}

function getRandomBatchIds(items) {
  return (items || []).map((item) => item?.arcid || item?.id).filter(Boolean);
}

function scoreRandomBatch(items, currentIds, recentIds) {
  const ids = getRandomBatchIds(items);
  if (ids.length === 0) return Number.NEGATIVE_INFINITY;

  let score = 0;
  ids.forEach((id) => {
    if (!currentIds.has(id)) score += 4;
    if (!recentIds.has(id)) score += 2;
  });

  const uniqueCount = new Set(ids).size;
  score += uniqueCount * 0.1;
  if (ids.every((id) => currentIds.has(id))) score -= 100;
  return score;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForPaint() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function withAbortTimeout(task, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function consumeArchivesScrollFlag() {
  try {
    if (sessionStorage.getItem(ARCHIVES_SCROLL_KEY) !== '1') return false;
    sessionStorage.removeItem(ARCHIVES_SCROLL_KEY);
    return true;
  } catch {
    return false;
  }
}

function shouldRevalidateHydratedRandoms(snapshot, boot) {
  if (!snapshot || !Array.isArray(snapshot.randoms) || snapshot.randoms.length === 0) return false;
  if (snapshot.reason === 'home-navigation') return false;

  const randomsUpdatedAt = typeof snapshot.randomsUpdatedAt === 'number'
    ? snapshot.randomsUpdatedAt
    : snapshot.ts;
  const age = typeof randomsUpdatedAt === 'number' ? Date.now() - randomsUpdatedAt : Number.POSITIVE_INFINITY;

  if (boot.navigationType === 'reload') return true;
  if (age >= RANDOMS_REVALIDATE_STALE_MS) return true;

  const resumeTs = boot.resumeCandidate?.ts;
  if (typeof resumeTs === 'number' && Date.now() - resumeTs > RANDOMS_RESTORE_GRACE_MS) {
    return true;
  }

  return false;
}

const DEFAULT_FILTER = { query: '', sortBy: 'date_added', order: 'desc', active: false };
const bootState = getBootState();

function SkeletonCard({ showProgress = false }) {
  return (
    <div className="home-skeleton-card" style={{
      flex: `0 0 ${ARCHIVE_CARD_WIDTH}px`,
      minWidth: `${ARCHIVE_CARD_WIDTH}px`,
      width: `${ARCHIVE_CARD_WIDTH}px`,
    }}>
      <div className="home-skeleton-cover" style={{ height: `${ARCHIVE_CARD_COVER_HEIGHT}px` }}>
        <div className="shimmer-strip home-skeleton-shimmer" />
      </div>
      {showProgress && (
        <div className="home-skeleton-progress" />
      )}
      <div className="home-skeleton-title" style={{
        marginTop: `${ARCHIVE_CARD_TITLE_GAP}px`,
        height: `${ARCHIVE_CARD_TITLE_SLOT_HEIGHT}px`,
      }}>
        <div className="home-skeleton-line home-skeleton-line-wide" />
        <div className="home-skeleton-line home-skeleton-line-short" />
      </div>
      <div className="home-skeleton-meta" style={{
        height: `${ARCHIVE_CARD_META_ROW_HEIGHT}px`,
        marginTop: `${ARCHIVE_CARD_META_GAP}px`,
      }}>
        <div className="home-skeleton-meta-line home-skeleton-meta-line-left" />
        <div className="home-skeleton-meta-line home-skeleton-meta-line-right" />
      </div>
    </div>
  );
}

function SectionHeading({ glyph, children, onClick, title, style }) {
  const content = (
    <>
      <HomeSectionGlyph name={glyph} size={21} color={getSectionGlyphColor(glyph)} />
      <span>{children}</span>
    </>
  );

  return (
    <h2 className="section-heading" style={style}>
      {onClick ? (
        <button
          type="button"
          className="btn btn-quiet section-heading-link"
          onClick={onClick}
          title={title}
        >
          {content}
        </button>
      ) : content}
    </h2>
  );
}

function CollapseButton({ collapsed, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="btn btn-quiet btn-icon collapse-button"
    >
      <svg className="collapse-button-icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
        <path d="M6 15l6-6 6 6z" />
      </svg>
    </button>
  );
}

const THEME_MODE_LABELS = {
  auto: '自适应',
  dark: '深色',
  light: '浅色',
};
function readReaderSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(READER_SETTINGS_KEY) || '{}');
    const standaloneCookie = (localStorage.getItem('lrr_eh_cookie') || '').trim();
    const settings = saved && typeof saved === 'object' ? saved : {};
    return normalizeReaderSettings({
      ...settings,
      ehCookie: typeof settings.ehCookie === 'string' && settings.ehCookie.trim()
        ? settings.ehCookie
        : standaloneCookie,
    });
  } catch {
    return { ...DEFAULT_READER_SETTINGS };
  }
}

function writeReaderSettings(settings) {
  localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(settings));
  const cookie = String(settings?.ehCookie || '').trim();
  if (cookie) localStorage.setItem('lrr_eh_cookie', cookie);
  else localStorage.removeItem('lrr_eh_cookie');
}

export default function Home({ onSelectArchive, onLogout, themeMode = 'auto', onThemeModeChange, themePalettes = null, onThemePalettesChange }) {
  const { showToast } = useToast();
  const supportsAutomaticArchiveLoading = typeof IntersectionObserver !== 'undefined';
  const workerReady = hasValidWorkerConfig();
  const [archiveCatalogDirty] = useState(() => consumeArchiveCatalogDirty());
  const [navSnapshot] = useState(() => (archiveCatalogDirty ? null : consumeHomeNavigationSnapshot()));
  const [coldRestoreBoot] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('q')) return false;
    if (archiveCatalogDirty) return false;
    if (navSnapshot) return false;
    if (claimColdRestoreRoute('home')) return true;
    const boot = getBootState();
    return !!(!boot.isPwaUpdateReload && (boot.wasDiscarded || boot.navigationType === 'reload') && loadHomeSnapshot());
  });
  const [filter, setFilter] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
      const f = { ...DEFAULT_FILTER, query: readRouteFilterQuery(q), active: true };
      writeFilter(f);
      return f;
    }
    if (navSnapshot?.filter && typeof navSnapshot.filter === 'object') {
      const f = { ...DEFAULT_FILTER, ...navSnapshot.filter };
      writeFilter(f);
      return f;
    }
    const stored = readFilter();
    if (stored && typeof stored === 'object') return { ...DEFAULT_FILTER, ...stored };
    return { ...DEFAULT_FILTER };
  });
  const snapshotFilterKey = `${filter.query}|${filter.sortBy}|${filter.order}|${filter.active}`;
  const homeSnapshot = (() => {
    if (archiveCatalogDirty) return null;
    const snapshot = navSnapshot || (coldRestoreBoot ? loadHomeSnapshot() : null);
    if (!snapshot) return null;
    const cachedKey = `${snapshot.filter?.query || ''}|${snapshot.filter?.sortBy || DEFAULT_FILTER.sortBy}|${snapshot.filter?.order || DEFAULT_FILTER.order}|${!!snapshot.filter?.active}`;
    return cachedKey === snapshotFilterKey ? snapshot : null;
  })();
  const [history, setHistory] = useState([]);
  const [historyEntranceIds, setHistoryEntranceIds] = useState(() => new Set());
  const [historyExitIds, setHistoryExitIds] = useState(() => new Set());
  const historyRef = useRef(history);
  historyRef.current = history;
  const historyEntranceTimerRef = useRef(null);
  const historyExitTimerRef = useRef(null);
  const pendingHistoryRef = useRef(null);
  const historyMotionReadyRef = useRef(false);
  const [watchlist, setWatchlist] = useState([]);
  const [watchlistEntranceId, setWatchlistEntranceId] = useState('');
  const [watchlistExitIds, setWatchlistExitIds] = useState(() => new Set());
  const watchlistRef = useRef(watchlist);
  watchlistRef.current = watchlist;
  const watchlistEntranceTimerRef = useRef(null);
  const watchlistExitTimerRef = useRef(null);
  const pendingWatchlistRef = useRef(null);
  const [hideRead, setHideReadState] = useState(getHideRead);
  const hideReadRef = useRef(hideRead);
  hideReadRef.current = hideRead;
  const pendingHistoryHideReadRef = useRef(hideRead);
  const [randomHideRead, setRandomHideReadState] = useState(getRandomHideRead);
  const [cropCover, setCropCoverState] = useState(getCropCover);
  const [archiveBrowseMode, setArchiveBrowseModeState] = useState(() => getArchiveBrowseMode());
  const [archiveDisplayMode, setArchiveDisplayModeState] = useState(() => getArchiveDisplayMode());
  const [showConfig, setShowConfig] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState('general');
  const [settingsPanelHeight, setSettingsPanelHeight] = useState(null);
  const [configTransfer, setConfigTransfer] = useState(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [configNotice, setConfigNotice] = useState(null);
  const [historyDeleteTarget, setHistoryDeleteTarget] = useState(null);
  const [archiveMenu, setArchiveMenu] = useState(null);
  const [archiveDeleteTarget, setArchiveDeleteTarget] = useState(null);
  const [archiveDeleteSyncConfirmed, setArchiveDeleteSyncConfirmed] = useState(true);
  const [archiveSelectionMode, setArchiveSelectionMode] = useState(false);
  const [selectedArchiveIds, setSelectedArchiveIds] = useState(() => new Set());
  const [bulkDeletePending, setBulkDeletePending] = useState(false);
  const [bulkDeleteSyncConfirmed, setBulkDeleteSyncConfirmed] = useState(true);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState(null);
  const [bulkFavoritePending, setBulkFavoritePending] = useState(false);
  const [bulkFavoriteRunning, setBulkFavoriteRunning] = useState(false);
  const [bulkFavoriteProgress, setBulkFavoriteProgress] = useState(null);
  const [archiveFailureReport, setArchiveFailureReport] = useState(null);
  const [archiveDeleting, setArchiveDeleting] = useState(false);
  const [ehFavoriteDeleteSync, setEhFavoriteDeleteSyncState] = useState(getEhFavoriteDeleteSync);
  const [historySyncing, setHistorySyncing] = useState(false);
  const [watchlistChecking, setWatchlistChecking] = useState(false);
  const [ehCookieChecking, setEhCookieChecking] = useState(false);

  const [cfgWorkerUrl, setCfgWorkerUrl] = useState(getWorkerUrl());
  const [cfgSyncToken, setCfgSyncToken] = useState(getSyncToken());
  const [themePaletteMode, setThemePaletteMode] = useState(() => document.documentElement.dataset.theme || 'light');
  const [themePalettesDraft, setThemePalettesDraft] = useState(themePalettes);
  useEffect(() => {
    setThemePaletteMode(document.documentElement.dataset.theme || (themeMode === 'dark' ? 'dark' : 'light'));
  }, [themeMode]);
  const [readerSettings, setReaderSettings] = useState(readReaderSettings);
  const showHistoricalArchiveProgress = shouldShowArchiveProgress(readerSettings.progressBarVisibility, true);
  const showWatchlistArchiveProgress = shouldShowArchiveProgress(readerSettings.progressBarVisibility, false);
  const showGlobalArchiveProgress = shouldShowArchiveProgress(readerSettings.progressBarVisibility, false);
  const reserveGlobalProgressSpace = readerSettings.progressBarVisibility === ARCHIVE_PROGRESS_VISIBILITY.GLOBAL;
  const [randoms, setRandoms] = useState(() => {
    if (homeSnapshot && Array.isArray(homeSnapshot.randoms) && homeSnapshot.randoms.length > 0) {
      return homeSnapshot.randoms;
    }
    return [];
  });
  const [randomsUpdatedAt, setRandomsUpdatedAt] = useState(() => {
    const ps = homeSnapshot;
    if (!ps) return 0;
    return typeof ps.randomsUpdatedAt === 'number' ? ps.randomsUpdatedAt : (ps.ts || 0);
  });
  const [historyCollapsed, setHistoryCollapsed] = useState(() => readStoredCollapsed(HOME_COLLAPSE_STORAGE_KEYS.history, homeSnapshot?.historyCollapsed));
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(() => readStoredCollapsed(HOME_COLLAPSE_STORAGE_KEYS.watchlist, homeSnapshot?.watchlistCollapsed));
  const [randomCollapsed, setRandomCollapsed] = useState(() => readStoredCollapsed(HOME_COLLAPSE_STORAGE_KEYS.random, homeSnapshot?.randomCollapsed));

  useEffect(() => {
    try { localStorage.setItem(HOME_COLLAPSE_STORAGE_KEYS.history, historyCollapsed ? '1' : '0'); } catch {}
  }, [historyCollapsed]);

  useEffect(() => {
    try { localStorage.setItem(HOME_COLLAPSE_STORAGE_KEYS.watchlist, watchlistCollapsed ? '1' : '0'); } catch {}
  }, [watchlistCollapsed]);

  useEffect(() => {
    try { localStorage.setItem(HOME_COLLAPSE_STORAGE_KEYS.random, randomCollapsed ? '1' : '0'); } catch {}
  }, [randomCollapsed]);
  const [archives, setArchives] = useState(() => {
    if (homeSnapshot && Array.isArray(homeSnapshot.archives) && homeSnapshot.archives.length > 0) {
      return homeSnapshot.archives;
    }
    return [];
  });
  const [startOffset, setStartOffset] = useState(() => {
    const ps = homeSnapshot;
    return (ps && typeof ps.startOffset === 'number') ? ps.startOffset : 0;
  });
  const [hasMore, setHasMore] = useState(() => {
    const ps = homeSnapshot;
    return (ps && typeof ps.hasMore === 'boolean') ? ps.hasMore : true;
  });
  const [archiveTotal, setArchiveTotal] = useState(() => {
    const ps = homeSnapshot;
    return Number.isFinite(ps?.archiveTotal) ? ps.archiveTotal : null;
  });
  const [archivePage, setArchivePage] = useState(() => {
    const ps = homeSnapshot;
    return Number.isFinite(Number(ps?.archivePage)) ? Math.max(0, Number(ps.archivePage)) : 0;
  });
  const [archivePageInput, setArchivePageInput] = useState(() => {
    const ps = homeSnapshot;
    return String((Number.isFinite(Number(ps?.archivePage)) ? Math.max(0, Number(ps.archivePage)) : 0) + 1);
  });
  const [archivePageSize, setArchivePageSize] = useState(() => (
    Number.isFinite(Number(homeSnapshot?.archivePageSize)) ? Math.max(1, Number(homeSnapshot.archivePageSize)) : ARCHIVE_PAGE_SIZE
  ));
  const [loading, setLoading] = useState(false);
  const [archiveLoadError, setArchiveLoadError] = useState('');
  const [archivesRefreshing, setArchivesRefreshing] = useState(false);
  const [archiveRefreshPhase, dispatchArchiveRefresh] = useReducer(reduceArchiveRefreshPhase, 'idle');
  const [presets, setPresets] = useState(readFilterPresets);
  const [showPresets, setShowPresets] = useState(false);
  const [presetsClosing, setPresetsClosing] = useState(false);
  const [presetNameDialog, setPresetNameDialog] = useState(null);
  const [editingPreset, setEditingPreset] = useState('');
  const [presetDeleteTarget, setPresetDeleteTarget] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(() => homeSnapshot?.selectedCategory || null);
  const [categories, setCategories] = useState([]);
  const displayCategories = useMemo(() => sortCategoriesForDisplay(categories), [categories]);
  const [stackFilterControls, setStackFilterControls] = useState(window.innerWidth < FILTER_STACK_BREAKPOINT);
  const didFetchArchivesRef = useRef(false);
  const didApplyUrlFilterRef = useRef(false);
  const archivesSectionRef = useRef(null);
  const gridRef = useRef(null);
  const archivePageRef = useRef(archivePage);
  const archivePageSizeRef = useRef(archivePageSize);
  const sentinelRef = useRef(null);
  const pendingArchivesScrollRef = useRef(false);
  const archivesRef = useRef([]);
  const randomsRef = useRef([]);
  const randomFetchSeqRef = useRef(0);
  const randomsAutoFillBlockedRef = useRef(false);
  const randomsAutoFillInFlightRef = useRef(false);
  useEffect(() => { archivesRef.current = archives; }, [archives]);
  useEffect(() => { archivePageRef.current = archivePage; }, [archivePage]);
  useEffect(() => { archivePageSizeRef.current = archivePageSize; }, [archivePageSize]);
  useEffect(() => { randomsRef.current = randoms; }, [randoms]);
  const archivesLenRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const lastFetchedRef = useRef(0);
  const lastFetchedFilterRef = useRef('');
  const archiveFetchSeqRef = useRef(0);
  const archiveAbortControllerRef = useRef(null);
  const archiveRequestInFlightRef = useRef(false);
  const [isNarrow, setIsNarrow] = useState(window.innerWidth <= HOME_NARROW_MAX_WIDTH);
  const [serverOnline, setServerOnline] = useState(null);
  const [serverProbeRunning, setServerProbeRunning] = useState(false);
  const [pageReady, setPageReady] = useState(() => !!homeSnapshot || coldRestoreBoot || !bootState.isFreshRuntime);
  const [randomsLoading, setRandomsLoading] = useState(() => {
    const ps = homeSnapshot;
    return !(ps && Array.isArray(ps.randoms) && ps.randoms.length > 0);
  });
  const [randomsRefreshing, setRandomsRefreshing] = useState(false);
  const [watchlistOverflow, setWatchlistOverflow] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const coldRestoreRef = useRef(coldRestoreBoot);
  const navigationRestoreRef = useRef(!!navSnapshot && !!homeSnapshot);
  const verticalScrollRestoredRef = useRef(false);
  const wasBackgroundedRef = useRef(false);
  const resumeRefreshSuppressedUntilRef = useRef(0);
  const serverProbePromiseRef = useRef(null);
  const serverProbeLastAtRef = useRef(0);
  const archiveBrowseStateRef = useRef(null);
  archiveBrowseStateRef.current = {
    archiveBrowseMode,
    archivePage,
    archivePageSize,
    archiveTotal,
    filter,
    selectedCategory,
    startOffset,
  };

  const skipResumeTriggeredRefresh = useCallback(() => {
    const now = Date.now();
    if (!wasBackgroundedRef.current && now >= resumeRefreshSuppressedUntilRef.current) return false;
    wasBackgroundedRef.current = false;
    resumeRefreshSuppressedUntilRef.current = now + RESUME_REFRESH_SUPPRESS_MS;
    lastFetchedRef.current = now;
    return true;
  }, []);

  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth <= HOME_NARROW_MAX_WIDTH);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const handleHomeScroll = () => {
      setShowBackToTop(window.scrollY > 320);
    };
    handleHomeScroll();
    window.addEventListener('scroll', handleHomeScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleHomeScroll);
  }, []);

  const handleBackToTop = useCallback(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  }, []);

  const suggestActiveRef = useRef(false);
  const filterInputRef = useRef(null);
  const filterControlsRef = useRef(null);
  const presetMenuRef = useRef(null);
  const presetToggleRef = useRef(null);
  const settingsTriggerRef = useRef(null);
  const settingsDialogRef = useRef(null);
  const settingsPaneRef = useRef(null);
  const historyScroller = useHorizontalScroller();
  const watchlistScroller = useHorizontalScroller();
  const randomScroller = useHorizontalScroller();
  const getHistoryScrollerNode = historyScroller.getNode;
  const getWatchlistScrollerNode = watchlistScroller.getNode;
  const getRandomScrollerNode = randomScroller.getNode;

  const requestPresetMenuClose = useCallback(() => {
    if (!showPresets || presetsClosing) return;
    setPresetsClosing(true);
    setEditingPreset('');
  }, [presetsClosing, showPresets]);

  const togglePresetMenu = useCallback(() => {
    if (showPresets && !presetsClosing) {
      requestPresetMenuClose();
      return;
    }
    setPresetsClosing(false);
    setShowPresets(true);
  }, [presetsClosing, requestPresetMenuClose, showPresets]);

  const handlePresetMenuAnimationEnd = useCallback((event) => {
    if (event.target !== event.currentTarget || !presetsClosing) return;
    setPresetsClosing(false);
    setShowPresets(false);
  }, [presetsClosing]);

  const presetsOpen = showPresets && !presetsClosing;

  useEffect(() => {
    if (!showPresets) return undefined;
    const close = (event) => {
      if (event.type === 'keydown') {
        if (event.key === 'Escape') requestPresetMenuClose();
        return;
      }
      if (presetMenuRef.current?.contains(event.target) || presetToggleRef.current?.contains(event.target)) return;
      requestPresetMenuClose();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('focusin', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('focusin', close);
      document.removeEventListener('keydown', close);
    };
  }, [requestPresetMenuClose, showPresets]);

  const buildHomeStateSnapshot = useCallback((overrides = {}) => ({
    archives: archivesRef.current,
    randoms: randomsRef.current,
    randomsUpdatedAt,
    startOffset,
    hasMore,
    archiveTotal,
    archiveBrowseMode,
    archivePage,
    archivePageSize,
    filter,
    selectedCategory,
    historyCollapsed,
    watchlistCollapsed,
    randomCollapsed,
    scrollY: window.scrollY || window.pageYOffset || 0,
    historyScrollLeft: getHistoryScrollerNode?.()?.scrollLeft || 0,
    watchlistScrollLeft: getWatchlistScrollerNode?.()?.scrollLeft || 0,
    randomScrollLeft: getRandomScrollerNode?.()?.scrollLeft || 0,
    ...overrides,
  }), [archiveBrowseMode, archivePage, archivePageSize, archiveTotal, filter, getHistoryScrollerNode, getRandomScrollerNode, getWatchlistScrollerNode, hasMore, historyCollapsed, randomCollapsed, randomsUpdatedAt, selectedCategory, startOffset, watchlistCollapsed]);

  const saveCurrentHomeForNavigation = useCallback(() => {
    const snapshot = buildHomeStateSnapshot();
    saveHomeNavigationSnapshot(snapshot);
  }, [buildHomeStateSnapshot]);

  const handleSelectArchive = useCallback((archiveId, options) => {
    saveCurrentHomeForNavigation();
    onSelectArchive(archiveId, options);
  }, [onSelectArchive, saveCurrentHomeForNavigation]);

  const handleArchiveCardActivate = useCallback((archive) => {
    handleSelectArchive(archive?.arcid || archive?.id);
  }, [handleSelectArchive]);

  const handleNavigateHistory = useCallback(() => {
    saveCurrentHomeForNavigation();
    navigateHistory();
  }, [saveCurrentHomeForNavigation]);

  const handleNavigateWatchlist = useCallback(() => {
    saveCurrentHomeForNavigation();
    navigateWatchlist();
  }, [saveCurrentHomeForNavigation]);

  const handleNavigateDeduplicate = useCallback(() => {
    saveCurrentHomeForNavigation();
    setShowConfig(false);
    navigateDeduplicate();
  }, [saveCurrentHomeForNavigation]);

  const handleNavigateUpload = useCallback(() => {
    saveCurrentHomeForNavigation();
    setShowConfig(false);
    navigateUpload();
  }, [saveCurrentHomeForNavigation]);

  const handleExportConfig = () => {
    setExportDialogOpen(true);
  };

  const handleImportConfig = async () => {
    let value = '';
    try { value = await navigator.clipboard.readText(); } catch {}
    setConfigTransfer({ mode: 'import', value });
  };

  const handleConfirmImportConfig = async (encoded) => {
    const count = importConfig(encoded);
    const nextThemePalettes = readStoredThemePalettes();
    setThemePalettesDraft(nextThemePalettes);
    onThemePalettesChange?.(nextThemePalettes);
    setCfgWorkerUrl(getWorkerUrl());
    setCfgSyncToken(getSyncToken());
    setReaderSettings(readReaderSettings());
    setEhFavoriteDeleteSyncState(getEhFavoriteDeleteSync());
    setConfigTransfer(null);
    setConfigNotice({
      title: '导入完成',
      message: `已导入 ${count} 项配置。重新加载后生效。`,
    });
  };

  const updateReaderSettings = useCallback((updater) => {
    setReaderSettings((prev) => {
      const next = normalizeReaderSettings(typeof updater === 'function' ? updater(prev) : updater);
      writeReaderSettings(next);
      return next;
    });
  }, []);

  const handleCheckEhCookie = useCallback(async () => {
    const cookie = String(readerSettings.ehCookie || '').trim();
    if (!hasValidEhCookie(cookie)) {
      showToast('请先填写包含 ipb_member_id 和 ipb_pass_hash 的 Cookie。', 'error');
      return;
    }
    if (!hasValidWorkerConfig(cfgWorkerUrl, cfgSyncToken)) {
      showToast('请先填写有效的 Worker 端点和访问 Token。', 'error');
      return;
    }
    setEhCookieChecking(true);
    try {
      const response = await fetch(`${cfgWorkerUrl.replace(/\/$/, '')}/eh/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-token': cfgSyncToken },
        body: JSON.stringify({ cookie }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail || data?.error || `检测失败（HTTP ${response.status}）`);
      if (data.cookie && data.cookie !== cookie) updateReaderSettings((settings) => ({ ...settings, ehCookie: data.cookie }));
      const eOk = !!data.eHentai?.ok;
      const xOk = !!data.exHentai?.ok;
      const updated = data.refreshed || (data.cookie && data.cookie !== cookie);
      const text = `E-Hentai：${eOk ? '正常' : '失败'}；ExHentai：${xOk ? '正常' : '失败'}${updated ? '；已更新 igneous' : ''}`;
      showToast(text, eOk && xOk ? 'success' : 'info');
    } catch (error) {
      showToast(error?.message || '检测失败。', 'error');
    } finally {
      setEhCookieChecking(false);
    }
  }, [cfgSyncToken, cfgWorkerUrl, readerSettings.ehCookie, updateReaderSettings, showToast]);

  const watchlistWithProgress = useMemo(() => mergeWatchlistProgress(watchlist, history), [history, watchlist]);
  const watchlistAutoRemoveIds = useMemo(() => getWatchlistAutoRemoveIds(watchlistWithProgress), [watchlistWithProgress]);
  const watchlistIds = useMemo(() => new Set(watchlistWithProgress.map((item) => item.id || item.arcid).filter(Boolean)), [watchlistWithProgress]);

  useEffect(() => {
    if (watchlistAutoRemoveIds.length > 0) pruneWatchlistItems(watchlistAutoRemoveIds).catch(() => {});
  }, [watchlistAutoRemoveIds]);

  const handleOpenArchiveMenu = useCallback((archive, point, event, options = {}) => {
    if (archiveSelectionMode) return;
    const archiveId = archive?.arcid || archive?.id;
    const showRemoveWatchlist = options.showRemoveWatchlist ?? (archiveId ? watchlistIds.has(archiveId) : false);
    setArchiveMenu({ archive, x: point.x, y: point.y, ...options, showRemoveWatchlist });
  }, [archiveSelectionMode, watchlistIds]);

  const handleArchiveDownload = useCallback(async (archive) => {
    const archiveId = archive?.arcid || archive?.id;
    if (!archiveId) return;
    try {
      const { blob, filename } = await lrrApi.downloadArchive(archiveId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || `${archiveId}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      showToast(err.message || '下载失败', 'error');
    }
  }, [showToast]);

  const handleArchiveCopyLink = useCallback(async (archive) => {
    const archiveId = archive?.arcid || archive?.id;
    if (!archiveId) return;
    const url = `${window.location.origin}/?id=${encodeURIComponent(archiveId)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      prompt('复制档案链接:', url);
    }
  }, []);

  const handleClearArchiveProgress = useCallback(async (archive) => {
    const result = await clearConfiguredArchiveReadingProgress(archive);
    const archiveId = archive.arcid || archive.id;
    const update = (items) => items.map((item) => (
      (item.arcid || item.id) === archiveId ? { ...item, progress: result.page, page: result.page } : item
    ));
    setArchives(update);
    setRandoms(update);
    setWatchlist(update);
    if (!historyExitTimerRef.current) setHistory(getHistory());
    return result;
  }, []);

  useEffect(() => subscribeReadingProgressChanged(({ archiveId, page }) => {
    const update = (items) => items.map((item) => (
      String(item?.arcid || item?.id || '') === archiveId ? { ...item, progress: page, page } : item
    ));
    setArchives(update);
    setRandoms(update);
    setWatchlist(update);
    if (!historyExitTimerRef.current) setHistory(getHistory());
  }), []);

  const removeDeletedArchiveIds = useCallback((ids) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (idSet.size === 0) return;
    setArchives((prev) => prev.filter((arc) => !idSet.has(arc.arcid || arc.id)));
    setRandoms((prev) => prev.filter((arc) => !idSet.has(arc.arcid || arc.id)));
    setHistory((prev) => prev.filter((item) => !idSet.has(item.id)));
    setWatchlist((prev) => prev.filter((item) => !idSet.has(item.id || item.arcid)));
    setSelectedArchiveIds((prev) => {
      const next = new Set(prev);
      idSet.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const deleteArchiveWithSync = useCallback(async (archive, confirmationEnabled, onFavoriteError) => {
    return deleteArchiveWithFavoriteSync(archive, {
      syncEnabled: workerReady && ehFavoriteDeleteSync,
      confirmationEnabled,
      continueOnFavoriteError: true,
      onFavoriteError,
    });
  }, [ehFavoriteDeleteSync, workerReady]);

  const handleArchiveDelete = useCallback(async () => {
    if (!archiveDeleteTarget) return;
    const archiveId = archiveDeleteTarget.arcid || archiveDeleteTarget.id;
    const title = archiveDeleteTarget.title || archiveId;
    const ehFailures = [];
    setArchiveDeleting(true);
    try {
      const deletedId = await deleteArchiveWithSync(archiveDeleteTarget, archiveDeleteSyncConfirmed, ({ galleryUrl, error }) => {
        ehFailures.push({ url: galleryUrl, message: error?.message || 'E-Hentai 收藏夹删除失败' });
      });
      pruneWatchlistItem(deletedId).catch(() => {});
      removeDeletedArchiveIds([deletedId]);
      setArchiveDeleteTarget(null);
      if (ehFailures.length > 0) {
        setArchiveFailureReport({ ehFailures, lrrFailures: [], message: 'LANraragi 档案已删除，但 E-Hentai 收藏夹移除失败。' });
      }
    } catch (err) {
      setArchiveDeleteTarget(null);
      setArchiveFailureReport({
        ehFailures,
        lrrFailures: [{ id: archiveId, title, message: err?.message || '删除失败' }],
        message: '档案删除未全部完成，可稍后重试。',
      });
    } finally {
      setArchiveDeleting(false);
    }
  }, [archiveDeleteSyncConfirmed, archiveDeleteTarget, deleteArchiveWithSync, removeDeletedArchiveIds]);

  useEffect(() => {
    if (archives.length === 0 && randoms.length === 0) return;
    saveHomeSnapshot(buildHomeStateSnapshot({
      archives,
      randoms,
    }));
  }, [archives, buildHomeStateSnapshot, randoms, archiveBrowseMode, archivePage, archivePageSize, archiveTotal, filter, hasMore, historyCollapsed, randomCollapsed, randomsUpdatedAt, startOffset, watchlistCollapsed]);

  const scrollToArchives = useCallback(() => {
    const run = () => {
      const target = archivesSectionRef.current || gridRef.current;
      target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('q') && consumeArchivesScrollFlag()) {
      pendingArchivesScrollRef.current = true;
      scrollToArchives();
    }
  }, [scrollToArchives]);

  // Restore vertical scroll before first paint. Never write window scroll again after this point.
  useLayoutEffect(() => {
    if (!navigationRestoreRef.current || !homeSnapshot || verticalScrollRestoredRef.current) return;
    verticalScrollRestoredRef.current = true;
    if (typeof homeSnapshot.scrollY === 'number') {
      window.scrollTo({ top: homeSnapshot.scrollY, left: 0, behavior: 'auto' });
    }
  }, [homeSnapshot]);

  // Restore horizontal scrollers after mount. This effect must not modify window scroll.
  useEffect(() => {
    if (!navigationRestoreRef.current || !homeSnapshot) return undefined;
    const frame = requestAnimationFrame(() => {
      if (typeof homeSnapshot.historyScrollLeft === 'number') {
        const el = getHistoryScrollerNode?.();
        if (el) el.scrollLeft = homeSnapshot.historyScrollLeft;
      }
      if (typeof homeSnapshot.watchlistScrollLeft === 'number') {
        const el = getWatchlistScrollerNode?.();
        if (el) el.scrollLeft = homeSnapshot.watchlistScrollLeft;
      }
      if (typeof homeSnapshot.randomScrollLeft === 'number') {
        const el = getRandomScrollerNode?.();
        if (el) el.scrollLeft = homeSnapshot.randomScrollLeft;
      }
      navigationRestoreRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [getHistoryScrollerNode, getRandomScrollerNode, getWatchlistScrollerNode, homeSnapshot]);

  useEffect(() => {
    const el = filterControlsRef.current;
    if (!el) return undefined;
    const update = () => {
      const width = el.clientWidth || window.innerWidth;
      setStackFilterControls(width < FILTER_STACK_BREAKPOINT);
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const dismissFilterKeyboard = (event) => {
      const target = event.target;
      if (filterControlsRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-filter-popover="true"]')) return;
      filterInputRef.current?.blur();
    };
    document.addEventListener('pointerdown', dismissFilterKeyboard);
    return () => document.removeEventListener('pointerdown', dismissFilterKeyboard);
  }, []);

  useEffect(() => {
    if (!showConfig) return undefined;
    const dialog = settingsDialogRef.current;
    const previouslyFocused = document.activeElement;
    const getFocusable = () => Array.from(dialog?.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]):not(.settings-hint-wrap)',
    ) || []);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowConfig(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const focusFrame = requestAnimationFrame(() => {
      const firstFocusable = getFocusable()[0];
      if (firstFocusable) firstFocusable.focus();
      else dialog?.focus();
    });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [showConfig]);

  useLayoutEffect(() => {
    if (!showConfig) {
      setSettingsPanelHeight(null);
      return undefined;
    }
    const dialog = settingsDialogRef.current;
    const pane = settingsPaneRef.current;
    if (!dialog || !pane) return undefined;
    const activeContent = pane.querySelector('.settings-section.is-active > .settings-section-inner');
    const tabs = pane.querySelector('.settings-category-tabs');
    if (!activeContent || !tabs) return undefined;
    const updateHeight = () => {
      const paneStyle = getComputedStyle(pane);
      const paneInset = ['paddingTop', 'paddingBottom']
        .reduce((total, property) => total + (Number.parseFloat(paneStyle[property]) || 0), 0);
      const contentStyle = getComputedStyle(activeContent);
      const contentGap = Number.parseFloat(contentStyle.rowGap) || 0;
      const childrenHeight = Array.from(activeContent.children)
        .reduce((total, child) => total + child.scrollHeight, 0)
        + contentGap * Math.max(0, activeContent.children.length - 1);
      const contentHeight = Math.max(activeContent.scrollHeight, childrenHeight);
      const tabsStyle = getComputedStyle(tabs);
      const stacked = tabsStyle.flexDirection === 'row';
      const paneHeight = getSettingsPaneNaturalHeight({
        tabsHeight: tabs.scrollHeight,
        contentHeight,
        gap: stacked ? (Number.parseFloat(tabsStyle.marginBottom) || 0) : 0,
        inset: paneInset,
        stacked,
      });
      const fixedHeight = Array.from(dialog.children)
        .filter((child) => child !== pane)
        .reduce((total, child) => total + child.getBoundingClientRect().height, 0);
      const dialogFrame = dialog.offsetHeight - dialog.clientHeight;
      const overlay = dialog.parentElement;
      const overlayStyle = getComputedStyle(overlay);
      const viewportLimit = overlay.clientHeight - ['paddingTop', 'paddingBottom']
        .reduce((total, property) => total + (Number.parseFloat(overlayStyle[property]) || 0), 0);
      setSettingsPanelHeight(Math.min(Math.ceil(fixedHeight + paneHeight + dialogFrame), Math.floor(viewportLimit)));
    };
    updateHeight();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeight);
    observer?.observe(activeContent);
    window.addEventListener('resize', updateHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, [settingsCategory, showConfig]);

  const probeServerStatus = useCallback(async ({ silent = false, force = false } = {}) => {
    if (!force && serverProbePromiseRef.current) return serverProbePromiseRef.current;
    if (!force && Date.now() - serverProbeLastAtRef.current < 2500) {
      return serverProbePromiseRef.current || serverOnline;
    }

    const task = (async () => {
      serverProbeLastAtRef.current = Date.now();
      if (!silent) setServerProbeRunning(true);
      try {
        await loadServerInfo({ forceRefresh: true });
        setServerOnline(true);
        return true;
      } catch {
        setServerOnline(false);
        return false;
      } finally {
        if (!silent) setServerProbeRunning(false);
        serverProbePromiseRef.current = null;
      }
    })();

    serverProbePromiseRef.current = task;
    return task;
  }, [serverOnline]);

  const exitColdRestoreMode = useCallback(() => {
    if (!coldRestoreRef.current) return;
    coldRestoreRef.current = false;
    setServerOnline(null);
    probeServerStatus({ force: true });
    loadCategories().then(data => { if (Array.isArray(data)) setCategories(data); });
    startTagDBUpdateTimer();
    startCategoriesUpdateTimer();
    loadTagDB();
  }, [probeServerStatus]);

  const handleTagSelect = useCallback((tag) => {
    suggestActiveRef.current = false;
    setFilter(prev => {
      const newQuery = replaceCurrentFilterToken(prev.query, tag);
      return { ...prev, query: newQuery, active: true };
    });
    setTimeout(() => filterInputRef.current?.focus(), 50);
  }, []);

  // Load tag translation DB for search suggestions
  useEffect(() => {
    if (coldRestoreRef.current) return;
    loadTagDB();
  }, []);

  // Server health check
  useEffect(() => {
    if (coldRestoreRef.current) return;
    const cached = getStoredServerInfo();
    if (cached) setServerOnline(true);
    probeServerStatus({ silent: !!cached, force: true });
  }, [probeServerStatus]);

  // Load categories and start periodic update timers
  useEffect(() => {
    const cachedCategories = getStoredCategories();
    if (Array.isArray(cachedCategories) && cachedCategories.length > 0) {
      setCategories(cachedCategories);
    }

    if (coldRestoreRef.current) return undefined;

    loadCategories().then(data => { if (Array.isArray(data)) setCategories(data); });
    startTagDBUpdateTimer();
    startCategoriesUpdateTimer();
    return () => { stopTagDBUpdateTimer(); stopCategoriesUpdateTimer(); };
  }, []);

  useEffect(() => {
    const syncChangedCategory = (event) => {
      const changed = event.detail?.category;
      if (!changed?.id) return;
      setCategories(current => current.some(category => category.id === changed.id)
        ? current.map(category => (category.id === changed.id ? changed : category))
        : [...current, changed]);
      setSelectedCategory(current => (current?.id === changed.id ? changed : current));
    };
    window.addEventListener('lrr:categories-changed', syncChangedCategory);
    return () => window.removeEventListener('lrr:categories-changed', syncChangedCategory);
  }, []);

  // Sync filter to localStorage whenever it changes
  useEffect(() => {
    writeFilter(filter);
  }, [filter]);

  // Load minimal history state, then hydrate display metadata from LANraragi by arcid.
  useEffect(() => {
    const initialHistory = getHistory();
    historyRef.current = initialHistory;
    setHistory(initialHistory);
    historyMotionReadyRef.current = true;
    if (coldRestoreRef.current) {
      return;
    }
    loadHistoryState().then((state) => {
      // loadHistoryState emits lrr:history-changed after hydration. Let the
      // shared refresh handler apply the state so inserted/removed cards animate.
      hideReadRef.current = state.hideRead;
    }).catch(() => {
      const next = getHistory();
      const nextHideRead = getHideRead();
      historyRef.current = next;
      hideReadRef.current = nextHideRead;
      setHistory(next);
      setHideReadState(nextHideRead);
    });
  }, []);

  useEffect(() => {
    const showHistoryEntrance = (addedIds) => {
      if (addedIds.length === 0) return;
      if (historyEntranceTimerRef.current) clearTimeout(historyEntranceTimerRef.current);
      setHistoryEntranceIds(new Set(addedIds));
      historyEntranceTimerRef.current = setTimeout(() => {
        historyEntranceTimerRef.current = null;
        setHistoryEntranceIds(new Set());
      }, 320);
    };
    const refreshHistory = () => {
      const next = getHistory();
      const nextHideRead = getHideRead();
      if (!historyMotionReadyRef.current) {
        historyRef.current = next;
        hideReadRef.current = nextHideRead;
        setHistory(next);
        setHideReadState(nextHideRead);
        return;
      }
      const previousVisible = getVisibleContinueReadingItems(historyRef.current, hideReadRef.current);
      const nextVisible = getVisibleContinueReadingItems(next, nextHideRead);
      const removedIds = getRemovedArchiveIds(previousVisible, nextVisible);
      const reduceMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (removedIds.length > 0 && !reduceMotion) {
        if (historyExitTimerRef.current) clearTimeout(historyExitTimerRef.current);
        pendingHistoryRef.current = next;
        pendingHistoryHideReadRef.current = nextHideRead;
        setHistoryExitIds(new Set(removedIds));
        historyExitTimerRef.current = setTimeout(() => {
          historyExitTimerRef.current = null;
          const pending = pendingHistoryRef.current || getHistory();
          const pendingHideRead = pendingHistoryHideReadRef.current;
          pendingHistoryRef.current = null;
          const addedIds = getNewlyAddedArchiveIds(
            getVisibleContinueReadingItems(historyRef.current, hideReadRef.current),
            getVisibleContinueReadingItems(pending, pendingHideRead),
          );
          historyRef.current = pending;
          hideReadRef.current = pendingHideRead;
          setHistory(pending);
          setHideReadState(pendingHideRead);
          setHistoryExitIds(new Set());
          showHistoryEntrance(addedIds);
        }, 220);
      } else {
        if (historyExitTimerRef.current) clearTimeout(historyExitTimerRef.current);
        historyExitTimerRef.current = null;
        pendingHistoryRef.current = null;
        setHistoryExitIds(new Set());
        const addedIds = getNewlyAddedArchiveIds(previousVisible, nextVisible);
        historyRef.current = next;
        hideReadRef.current = nextHideRead;
        setHistory(next);
        setHideReadState(nextHideRead);
        showHistoryEntrance(addedIds);
      }
    };
    window.addEventListener('lrr:history-changed', refreshHistory);
    return () => {
      window.removeEventListener('lrr:history-changed', refreshHistory);
      if (historyEntranceTimerRef.current) clearTimeout(historyEntranceTimerRef.current);
      if (historyExitTimerRef.current) clearTimeout(historyExitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setWatchlist(getWatchlist());
    if (!coldRestoreRef.current) {
      loadWatchlistState().then((state) => setWatchlist(state.items)).catch(() => setWatchlist(getWatchlist()));
    }
  }, []);

  useEffect(() => {
    const showWatchlistEntrance = (addedId) => {
      if (addedId) {
        if (watchlistEntranceTimerRef.current) clearTimeout(watchlistEntranceTimerRef.current);
        setWatchlistEntranceId(addedId);
        watchlistEntranceTimerRef.current = setTimeout(() => {
          watchlistEntranceTimerRef.current = null;
          setWatchlistEntranceId('');
        }, 320);
      }
    };
    const applyWatchlistChange = (next) => {
      const removedIds = getRemovedArchiveIds(watchlistRef.current, next);
      const reduceMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (removedIds.length > 0 && !reduceMotion) {
        if (watchlistExitTimerRef.current) clearTimeout(watchlistExitTimerRef.current);
        pendingWatchlistRef.current = next;
        setWatchlistExitIds(new Set(removedIds));
        watchlistExitTimerRef.current = setTimeout(() => {
          watchlistExitTimerRef.current = null;
          const pending = pendingWatchlistRef.current || getWatchlist();
          pendingWatchlistRef.current = null;
          const addedId = getNewlyAddedArchiveId(watchlistRef.current, pending);
          watchlistRef.current = pending;
          setWatchlist(pending);
          setWatchlistExitIds(new Set());
          showWatchlistEntrance(addedId);
        }, 220);
        return;
      }
      if (watchlistExitTimerRef.current) {
        clearTimeout(watchlistExitTimerRef.current);
        watchlistExitTimerRef.current = null;
        pendingWatchlistRef.current = null;
        setWatchlistExitIds(new Set());
      }
      const addedId = getNewlyAddedArchiveId(watchlistRef.current, next);
      watchlistRef.current = next;
      setWatchlist(next);
      showWatchlistEntrance(addedId);
    };
    const refreshWatchlist = () => applyWatchlistChange(getWatchlist());
    window.addEventListener('lrr:watchlist-changed', refreshWatchlist);
    return () => {
      window.removeEventListener('lrr:watchlist-changed', refreshWatchlist);
      if (watchlistEntranceTimerRef.current) clearTimeout(watchlistEntranceTimerRef.current);
      if (watchlistExitTimerRef.current) clearTimeout(watchlistExitTimerRef.current);
    };
  }, []);

  // Fetch randoms — but only if not already hydrated from page-state cache
  useEffect(() => {
    const ps = homeSnapshot;
    if (ps && Array.isArray(ps.randoms) && ps.randoms.length > 0) {
      // Already have randoms from cache — skip fetch, just mark ready
      setPageReady(true);
      if (!shouldRevalidateHydratedRandoms(ps, bootState)) return undefined;
      const timer = setTimeout(() => {
        fetchRandoms({ background: true, preferFresh: true });
      }, 450);
      return () => clearTimeout(timer);
    }
    if (coldRestoreRef.current) {
      setPageReady(true);
      setRandomsLoading(false);
      return undefined;
    }
    fetchRandoms();
    setPageReady(true);
    return undefined;
  }, []);

  // bfcache / visibility / keep-alive guard:
  // - Bump timestamps on restore to avoid spurious re-fetches.
  // - Pause resource-heavy operations when hidden to reduce memory pressure
  //   (makes iOS more likely to suspend via bfcache instead of killing).
  useEffect(() => {
    const persistBackgroundSnapshot = () => {
      markBackground({ kind: 'home' });
      saveHomeSnapshot(buildHomeStateSnapshot());
    };
    const bump = () => { lastFetchedRef.current = Date.now(); };
    const suppressResumeRefresh = () => {
      skipResumeTriggeredRefresh();
    };
    const handlePageShow = (e) => {
      if (e.persisted) suppressResumeRefresh();
    };
    let restartTimer = null;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (wasBackgroundedRef.current) suppressResumeRefresh();
        else bump();
        probeServerStatus({ silent: true });
        // Delay timer restarts by 5s — the wake-up window is when iOS
        // decides whether to keep or kill the process.  Avoid adding
        // network/CPU load during this critical period.
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          startTagDBUpdateTimer();
          startCategoriesUpdateTimer();
        }, 5000);
      } else {
        wasBackgroundedRef.current = true;
        clearTimeout(restartTimer);
        stopTagDBUpdateTimer();
        stopCategoriesUpdateTimer();
        persistBackgroundSnapshot();
      }
    };
    const handlePageHide = () => {
      wasBackgroundedRef.current = true;
      clearTimeout(restartTimer);
      stopTagDBUpdateTimer();
      stopCategoriesUpdateTimer();
      persistBackgroundSnapshot();
      // Keep mounted Blob URLs valid across bfcache/background restores.
      // The browser releases them with the document when the page is discarded.
    };
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        probeServerStatus({ silent: true });
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearTimeout(restartTimer);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [buildHomeStateSnapshot, probeServerStatus, skipResumeTriggeredRefresh]);

  // Lock body scroll when config modal is open
  useEffect(() => {
    if (showConfig) {
      return acquireBodyScrollLock();
    }
    return undefined;
  }, [showConfig]);

  useEffect(() => {
    const update = () => {
      // Paged mode only: in scroll mode the batch size is fixed
      // (ARCHIVE_PAGE_SIZE) and re-fetching on resize would reset the list.
      if (archiveBrowseMode === ARCHIVE_BROWSE_MODES.scroll) return;
      const gridWidth = gridRef.current?.clientWidth || window.innerWidth - 32;
      const gap = window.innerWidth <= HOME_NARROW_MAX_WIDTH ? 10 : 16;
      const cols = Math.max(1, Math.floor((gridWidth + gap) / (150 + gap)));
      const nextPageSize = getSmartArchivePageSize({ columns: cols, rows: 4, minimum: 20 });
      if (nextPageSize === archivePageSizeRef.current) return;
      const nextPage = getArchivePageAfterResize(archivePageRef.current, archivePageSizeRef.current, nextPageSize);
      archivePageRef.current = nextPage;
      archivePageSizeRef.current = nextPageSize;
      setArchivePage(nextPage);
      setArchivePageInput(String(nextPage + 1));
      setArchivePageSize(nextPageSize);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [archiveBrowseMode, cropCover]);

  const archiveSideEffectsRef = useRef({ exitColdRestoreMode, scrollToArchives });
  archiveSideEffectsRef.current = { exitColdRestoreMode, scrollToArchives };

  const doFetch = useCallback(async (isReset, options = {}) => {
    const current = archiveBrowseStateRef.current;
    const mode = options.modeOverride || current.archiveBrowseMode;
    const {
      background = false,
      force = false,
      clearSearchCache = false,
      filterOverride = null,
      pageIndex = mode === ARCHIVE_BROWSE_MODES.paged ? current.archivePage : 0,
    } = options;
    const selectedCategoryOverride = Object.hasOwn(options, 'selectedCategoryOverride')
      ? options.selectedCategoryOverride
      : current.selectedCategory;
    const effectiveFilter = filterOverride || current.filter;
    const isUntaggedMode = selectedCategoryOverride?.id === UNTAGGED_CATEGORY_ID;
    const isStaticCategoryMode = !!selectedCategoryOverride && !isUntaggedMode && !String(selectedCategoryOverride.search || '').trim();
    const hasActiveTextFilter = effectiveFilter.active && !!String(effectiveFilter.query || '').trim();
    archiveSideEffectsRef.current.exitColdRestoreMode();
    const now = Date.now();
    const isPagedMode = mode === ARCHIVE_BROWSE_MODES.paged;
    const pageSize = isPagedMode ? current.archivePageSize : ARCHIVE_PAGE_SIZE;
    const requestedPage = clampArchivePage(pageIndex, current.archiveTotal, current.archivePageSize);
    const filterKey = `${selectedCategoryOverride?.id || ''}|${effectiveFilter.query}|${effectiveFilter.sortBy}|${effectiveFilter.order}|${effectiveFilter.active}|${mode}|${pageSize}|${isPagedMode ? requestedPage : 'scroll'}`;
    if (isReset && !force && lastFetchedFilterRef.current === filterKey && now - lastFetchedRef.current < 2500) return;
    if (!isReset && archiveRequestInFlightRef.current) return false;

    archiveRequestInFlightRef.current = true;
    const markArchiveFetchCompleted = () => {
      lastFetchedFilterRef.current = filterKey;
      lastFetchedRef.current = Date.now();
    };
    archiveAbortControllerRef.current?.abort();
    const controller = new AbortController();
    archiveAbortControllerRef.current = controller;
    const fetchSeq = ++archiveFetchSeqRef.current;
    if (isReset && !hasActiveTextFilter && (isUntaggedMode || isStaticCategoryMode) && !background) {
      setArchives([]);
      setStartOffset(0);
      setArchiveTotal(null);
      setHasMore(false);
    }
    if (background) {
      setLoading(false);
      setArchivesRefreshing(true);
    } else {
      setArchivesRefreshing(false);
      setLoading(true);
    }
    setArchiveLoadError('');
    try {
      if (clearSearchCache) {
        try { await lrrApi.clearSearchCache(); } catch (e) { console.warn('清理搜索缓存失败，继续刷新档案列表', e); }
      }
      if (!hasActiveTextFilter && (isUntaggedMode || isStaticCategoryMode)) {
        const ids = isUntaggedMode
          ? await lrrApi.getUntaggedArchives({ signal: controller.signal })
          : (selectedCategoryOverride.archives || []).filter((id) => !String(id).startsWith('TANK_'));
        if (fetchSeq !== archiveFetchSeqRef.current) return false;
        if (ids.length === 0) {
          setArchiveTotal(0);
          setArchivePage(0);
          setArchivePageInput('1');
          setArchives([]);
          setStartOffset(0);
          setHasMore(false);
          markArchiveFetchCompleted();
          return true;
        }
        const total = ids.length;
        const nextPage = isPagedMode ? clampArchivePage(requestedPage, total, pageSize) : 0;
        const batchStart = isPagedMode ? getArchivePageStart(nextPage, pageSize) : (isReset ? 0 : current.startOffset);
        const batchIds = ids.slice(batchStart, batchStart + pageSize);
        const data = await loadArchiveMetadataBatch(
          batchIds,
          (id) => lrrApi.getArchive(id, { signal: controller.signal }),
          { signal: controller.signal, ignoreMissing: true },
        );
        if (fetchSeq !== archiveFetchSeqRef.current) return false;
        setArchiveTotal(total);
        setArchivePage(nextPage);
        setArchivePageInput(String(nextPage + 1));
        setArchives((prev) => (isPagedMode || isReset ? data : [...prev, ...data]));
        setStartOffset(batchStart + batchIds.length);
        setHasMore(batchStart + batchIds.length < total);
        markArchiveFetchCompleted();
        return true;
      }
      const query = hasActiveTextFilter
        ? String(effectiveFilter.query || '').trim()
        : (selectedCategoryOverride?.search || '');
      const searchOptions = {
        signal: controller.signal,
        category: !isUntaggedMode ? selectedCategoryOverride?.id : '',
        untaggedOnly: isUntaggedMode,
      };
      const start = isPagedMode ? getArchivePageStart(requestedPage, pageSize) : (isReset ? 0 : current.startOffset);
      let res = await lrrApi.search(query, start, effectiveFilter.sortBy, effectiveFilter.order, searchOptions);
      let data = res.data || [];
      if (isPagedMode && data.length > 0 && data.length < pageSize) {
        let nextStart = start + data.length;
        while (data.length < pageSize) {
          const nextRes = await lrrApi.search(query, nextStart, effectiveFilter.sortBy, effectiveFilter.order, searchOptions);
          const nextData = nextRes.data || [];
          if (nextData.length === 0) break;
          data = [...data, ...nextData].slice(0, pageSize);
          nextStart += nextData.length;
          res = nextRes;
          const nextTotal = getArchiveSearchTotal(nextRes, nextData.length, null);
          if (Number.isFinite(nextTotal) && nextStart >= nextTotal) break;
        }
      }
      if (isPagedMode && data.length > pageSize) data = data.slice(0, pageSize);
      if (fetchSeq !== archiveFetchSeqRef.current) return false;
      const total = getArchiveSearchTotal(res, data.length, isReset ? null : current.archiveTotal);
      setArchiveTotal(total);
      if (isPagedMode) {
        const nextPage = clampArchivePage(requestedPage, total, pageSize);
        setArchivePage(nextPage);
        setArchivePageInput(String(nextPage + 1));
        setArchives(data);
        setStartOffset(start + data.length);
        setHasMore(Number.isFinite(total) ? nextPage < getArchivePageCount(total, pageSize) - 1 : data.length > 0);
      } else if (isReset) {
        setArchivePage(0);
        setArchivePageInput('1');
        setArchives(data);
        setStartOffset(data.length);
        setHasMore(Number.isFinite(total) ? data.length < total : data.length > 0);
      } else {
        setArchives(prev => [...prev, ...data]);
        setStartOffset(start + data.length);
        setHasMore(Number.isFinite(total) ? start + data.length < total : data.length > 0);
      }
      markArchiveFetchCompleted();
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return false;
      if (fetchSeq !== archiveFetchSeqRef.current) return false;
      controller.abort();
      console.error('获取档案列表失败', e);
      setArchiveLoadError(e?.message || (isUntaggedMode ? '获取无标签档案失败，请重试' : '获取档案列表失败，请重试'));
      return false;
    } finally {
      if (fetchSeq === archiveFetchSeqRef.current) {
        if (archiveAbortControllerRef.current === controller) archiveAbortControllerRef.current = null;
        archiveRequestInFlightRef.current = false;
        if (background) setArchivesRefreshing(false);
        else setLoading(false);
        if (isReset && pendingArchivesScrollRef.current) {
          pendingArchivesScrollRef.current = false;
          setTimeout(archiveSideEffectsRef.current.scrollToArchives, 80);
        }
      }
    }
  }, []);

  useEffect(() => () => {
    archiveFetchSeqRef.current += 1;
    archiveRequestInFlightRef.current = false;
    archiveAbortControllerRef.current?.abort();
  }, []);

  // Sync state to refs for IntersectionObserver (avoids stale closures)
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { loadingRef.current = loading || archivesRefreshing; }, [archivesRefreshing, loading]);

  // Infinite scroll: IntersectionObserver on bottom sentinel
  // Re-create observer whenever archives length or filter changes (doFetch gets fresh closure)
  useEffect(() => { archivesLenRef.current = archives.length; }, [archives.length]);

  useEffect(() => {
    if (!supportsAutomaticArchiveLoading) return undefined;
    const sentinel = sentinelRef.current;
    if (archiveBrowseMode !== ARCHIVE_BROWSE_MODES.scroll) return undefined;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && archivesLenRef.current > 0 && hasMoreRef.current && !archiveRequestInFlightRef.current) {
          doFetch(false);
        }
      },
      // Fetch the next batch while the bottom is still 800px away: on a
      // remote server the round-trip should finish before the user arrives.
      { rootMargin: '800px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [archiveBrowseMode, archives.length, doFetch, filter.query, filter.sortBy, filter.order, filter.active, supportsAutomaticArchiveLoading]);

  // Watch for new filter arrivals from tag clicks (poll localStorage briefly)
  useEffect(() => {
    const checkStoredFilter = () => {
      const stored = readFilter();
      if (stored && stored.active) {
        setFilter(prev => {
          if (prev.query !== stored.query || prev.sortBy !== stored.sortBy || prev.order !== stored.order || prev.active !== stored.active) {
            return { ...DEFAULT_FILTER, ...stored };
          }
          return prev;
        });
      }
    };
    checkStoredFilter();
    const handleFilterArrival = (event) => {
      if (event.detail?.scrollToArchives) {
        pendingArchivesScrollRef.current = true;
        scrollToArchives();
      }
      checkStoredFilter();
    };
    window.addEventListener('filter-arrival', handleFilterArrival);
    return () => window.removeEventListener('filter-arrival', handleFilterArrival);
  }, [scrollToArchives]);

  // Fetch archives when filter changes
  useEffect(() => {
    const hasHydratedArchives = homeSnapshot && Array.isArray(homeSnapshot.archives) && homeSnapshot.archives.length > 0;
    if (coldRestoreRef.current && hasHydratedArchives) return;
    if (!archiveCatalogDirty && navigationRestoreRef.current && hasHydratedArchives) {
      didFetchArchivesRef.current = true;
      lastFetchedRef.current = Date.now();
      return;
    }
    const firstFetch = !didFetchArchivesRef.current;
    didFetchArchivesRef.current = true;
    doFetch(true, { force: firstFetch || archiveCatalogDirty, clearSearchCache: archiveCatalogDirty });
  }, [archiveBrowseMode, archiveCatalogDirty, archivePage, archivePageSize, doFetch, filter.query, filter.sortBy, filter.order, filter.active, selectedCategory?.id]);

  // Handle popstate (browser back/forward)
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('q');
      if (q) {
        setFilter(prev => {
          const next = { ...prev, query: readRouteFilterQuery(q), active: true };
          writeFilter(next);
          return next;
        });
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const fetchRandoms = useCallback(async ({ background = false, preferFresh = true, append = false, silent = false } = {}) => {
    const requestSeq = ++randomFetchSeqRef.current;
    exitColdRestoreMode();
    if (!append) randomsAutoFillBlockedRef.current = false;
    if (background && !silent) setRandomsRefreshing(true);
    else if (!background) setRandomsLoading(true);
    const currentIds = new Set(getRandomBatchIds(randomsRef.current));
    const recentIds = new Set(readRecentRandomIds());
    try {
      const requestCount = append ? RANDOMS_BATCH_SIZE : RANDOMS_BATCH_SIZE * RANDOMS_DEFAULT_BATCHES;
      // Fire the freshness attempts in parallel instead of serially: same
      // worst-case latency as one request, but more candidates to score, and
      // remote round-trips no longer stack (3 x 6.5s serial before).
      const attemptCount = preferFresh ? RANDOMS_FETCH_ATTEMPTS : 1;
      let bestBatch = [];
      let bestScore = Number.NEGATIVE_INFINITY;
      let lastError = null;
      const results = await Promise.all(Array.from({ length: attemptCount }, async () => {
        try {
          const res = await withAbortTimeout(
            (signal) => lrrApi.getRandom(requestCount, { signal }),
            RANDOMS_REQUEST_TIMEOUT_MS,
          );
          return filterRandomArchives(Array.isArray(res?.data) ? res.data : [], history, randomHideRead);
        } catch (error) {
          lastError = error;
          return null;
        }
      }));
      if (requestSeq !== randomFetchSeqRef.current) return 0;
      for (const batch of results) {
        if (!batch) continue;
        const score = preferFresh ? scoreRandomBatch(batch, currentIds, recentIds) : 0;
        if (score > bestScore) {
          bestBatch = batch;
          bestScore = score;
        }
      }
      // Only fail when every attempt failed; a successful (even empty) batch is
      // a valid result — empty just means hide-read filtered everything.
      const allAttemptsFailed = results.every((batch) => !batch);
      if (allAttemptsFailed && lastError) throw lastError;

      const plannedAdditions = [];
      if (append) {
        const seen = new Set(currentIds);
        bestBatch.forEach((item) => {
          const id = item?.arcid || item?.id;
          if (!id || seen.has(id)) return;
          seen.add(id);
          plannedAdditions.push(item);
        });
      }

      setRandoms((prev) => {
        if (!append) return bestBatch;
        const seen = new Set(getRandomBatchIds(prev));
        const additions = bestBatch.filter((item) => {
          const id = item?.arcid || item?.id;
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        if (additions.length === 0) return prev;
        return [...prev, ...additions].slice(0, RANDOMS_FILL_MAX_ITEMS);
      });
      setRandomsUpdatedAt(Date.now());

      const nextIds = getRandomBatchIds(bestBatch);
      const mergedRecentIds = [
        ...nextIds,
        ...readRecentRandomIds().filter((id) => !nextIds.includes(id)),
      ];
      writeRecentRandomIds(mergedRecentIds);
      return append ? plannedAdditions.length : bestBatch.length;
    } catch (e) {
      if (requestSeq !== randomFetchSeqRef.current) return 0;
      if (!background && !silent) showToast(`随机推荐获取失败：${e?.message || '未知错误'}`, 'error');
      if (randomsRef.current.length > 0) setRandoms(randomsRef.current);
      return 0;
    } finally {
      if (background && !silent) {
        if (requestSeq === randomFetchSeqRef.current) setRandomsRefreshing(false);
      } else if (!background) {
        if (requestSeq === randomFetchSeqRef.current) setRandomsLoading(false);
      }
    }
  }, [exitColdRestoreMode, history, randomHideRead, showToast]);

  useEffect(() => () => {
    randomFetchSeqRef.current += 1;
  }, []);

  useEffect(() => {
    if (
      randomCollapsed ||
      randomsLoading ||
      randomsRefreshing ||
      randoms.length === 0 ||
      randoms.length >= RANDOMS_FILL_MAX_ITEMS ||
      randomsAutoFillBlockedRef.current
    ) return undefined;

    let disposed = false;
    const frames = [];
    const timers = [];
    const needsFill = () => {
      const el = getRandomScrollerNode?.();
      return !!el && el.scrollWidth <= el.clientWidth + 8;
    };
    const fillUntilOverflow = async () => {
      if (disposed || randomsAutoFillInFlightRef.current || !needsFill()) return;
      randomsAutoFillInFlightRef.current = true;
      let emptyRuns = 0;
      try {
        while (!disposed && needsFill() && randomsRef.current.length < RANDOMS_FILL_MAX_ITEMS) {
          const before = randomsRef.current.length;
          const added = await fetchRandoms({ background: true, preferFresh: true, append: true, silent: true });
          await waitForPaint();
          const after = randomsRef.current.length;
          const grew = Math.max(Number(added) || 0, after - before);
          if (grew <= 0) {
            emptyRuns += 1;
            if (emptyRuns >= 2) {
              randomsAutoFillBlockedRef.current = true;
              break;
            }
            await delay(120);
          } else {
            emptyRuns = 0;
          }
        }
      } finally {
        randomsAutoFillInFlightRef.current = false;
      }
    };
    const scheduleCheck = (delayMs = 0) => {
      const timer = setTimeout(() => {
        const frame = requestAnimationFrame(fillUntilOverflow);
        frames.push(frame);
      }, delayMs);
      timers.push(timer);
    };

    [0, 80, 220, 520, 920, 1400].forEach(scheduleCheck);

    const el = getRandomScrollerNode?.();
    let observer = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => scheduleCheck(40));
      observer.observe(el);
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      timers.forEach(clearTimeout);
      frames.forEach(cancelAnimationFrame);
    };
  }, [fetchRandoms, getRandomScrollerNode, randomCollapsed, randoms.length, randomsLoading, randomsRefreshing]);

  useEffect(() => {
    if (watchlistCollapsed || watchlist.length === 0) {
      setWatchlistOverflow(false);
      return undefined;
    }

    let disposed = false;
    const frames = [];
    const timers = [];
    const updateOverflow = () => {
      if (disposed) return;
      const el = getWatchlistScrollerNode?.();
      if (!el) return;
      setWatchlistOverflow(el.scrollWidth > el.clientWidth + 8);
    };
    const scheduleCheck = (delayMs = 0) => {
      const timer = setTimeout(() => {
        const frame = requestAnimationFrame(updateOverflow);
        frames.push(frame);
      }, delayMs);
      timers.push(timer);
    };

    [0, 80, 220, 520].forEach(scheduleCheck);
    const el = getWatchlistScrollerNode?.();
    let observer = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => scheduleCheck(40));
      observer.observe(el);
    }
    window.addEventListener('resize', updateOverflow);

    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', updateOverflow);
      timers.forEach(clearTimeout);
      frames.forEach(cancelAnimationFrame);
    };
  }, [getWatchlistScrollerNode, watchlist.length, watchlistCollapsed]);

  const displayArchives = archives;

  const visibleArchiveIds = useMemo(() => (
    displayArchives.map((arc) => arc.arcid || arc.id).filter(Boolean)
  ), [displayArchives]);

  const selectedArchiveList = useMemo(() => {
    if (selectedArchiveIds.size === 0) return [];
    const idSet = selectedArchiveIds;
    return archives.filter((arc) => idSet.has(arc.arcid || arc.id));
  }, [archives, selectedArchiveIds]);

  const allVisibleSelected = visibleArchiveIds.length > 0 && visibleArchiveIds.every((id) => selectedArchiveIds.has(id));

  useEffect(() => {
    if (selectedArchiveIds.size === 0) return;
    const archiveIds = new Set(archives.map((arc) => arc.arcid || arc.id).filter(Boolean));
    setSelectedArchiveIds((prev) => {
      let changed = false;
      const next = new Set();
      prev.forEach((id) => {
        if (archiveIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [archives, selectedArchiveIds.size]);

  const toggleArchiveSelectionMode = useCallback(() => {
    setArchiveMenu(null);
    setArchiveSelectionMode((prev) => {
      if (prev) setSelectedArchiveIds(new Set());
      return !prev;
    });
  }, []);

  const toggleArchiveSelection = useCallback((archive) => {
    const archiveId = archive?.arcid || archive?.id;
    if (!archiveId) return;
    setSelectedArchiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(archiveId)) next.delete(archiveId);
      else next.add(archiveId);
      return next;
    });
  }, []);

  const requestArchiveDelete = useCallback((archive) => {
    setArchiveDeleteSyncConfirmed(true);
    setArchiveDeleteTarget(archive);
  }, []);

  const requestBulkArchiveDelete = useCallback(() => {
    setBulkDeleteSyncConfirmed(true);
    setBulkDeleteProgress(null);
    setBulkDeletePending(true);
  }, []);

  const toggleSelectAllVisibleArchives = useCallback(() => {
    setSelectedArchiveIds((prev) => {
      const next = new Set(prev);
      if (visibleArchiveIds.length === 0) return next;
      const allSelected = visibleArchiveIds.every((id) => next.has(id));
      visibleArchiveIds.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }, [visibleArchiveIds]);

  const handleBulkArchiveFavorite = useCallback(async () => {
    if (selectedArchiveList.length === 0) return;
    const total = selectedArchiveList.length;
    const failures = [];
    setBulkFavoritePending(true);
    setBulkFavoriteRunning(true);
    setBulkFavoriteProgress({ label: '准备收藏', current: 0, total, detail: '正在整理所选档案' });
    for (const archive of selectedArchiveList) {
      const archiveId = archive?.arcid || archive?.id;
      const title = archive?.title || archiveId;
      setBulkFavoriteProgress((current) => ({
        label: '正在收藏',
        current: current?.current || 0,
        total,
        detail: title,
      }));
      try {
        await setArchiveFavorite(archiveId, true);
      } catch (error) {
        failures.push({ id: archiveId, title, message: error?.message || '收藏失败' });
      }
      setBulkFavoriteProgress((current) => ({
        label: '正在收藏',
        current: Math.min(total, (current?.current || 0) + 1),
        total,
        detail: title,
      }));
    }
    setBulkFavoriteRunning(false);
    setBulkFavoriteProgress({
      label: failures.length > 0 ? '收藏完成，部分失败' : '收藏完成',
      current: total,
      total,
      detail: failures.length > 0 ? `${failures.length} 个档案收藏失败` : `已收藏 ${total} 个档案`,
    });
    if (failures.length > 0) {
      setBulkFavoritePending(false);
      setArchiveFailureReport({
        ehFailures: [],
        lrrFailures: failures,
        lrrHeading: 'LANraragi 收藏失败',
        message: '其余档案已加入收藏夹。失败项可稍后重试。',
      });
    }
  }, [selectedArchiveList]);

  const handleBulkArchiveDelete = useCallback(async () => {
    if (selectedArchiveList.length === 0) return;
    setArchiveDeleting(true);
    const total = selectedArchiveList.length;
    const deletedIds = [];
    const ehFailures = [];
    const lrrFailures = [];
    setBulkDeleteProgress({ label: '准备删除', current: 0, total, detail: '正在整理所选档案' });
    for (const archive of selectedArchiveList) {
      const archiveId = archive?.arcid || archive?.id;
      const title = archive?.title || archiveId;
      setBulkDeleteProgress({ label: '正在删除', current: deletedIds.length + lrrFailures.length, total, detail: title });
      try {
        const deletedId = await deleteArchiveWithFavoriteSync(archive, {
          syncEnabled: workerReady && ehFavoriteDeleteSync,
          confirmationEnabled: bulkDeleteSyncConfirmed,
          continueOnFavoriteError: true,
          onFavoriteError: ({ galleryUrl, error }) => {
            ehFailures.push({ url: galleryUrl, message: error?.message || 'E-Hentai 收藏夹删除失败' });
          },
        });
        deletedIds.push(deletedId);
      } catch (err) {
        lrrFailures.push({ id: archiveId, title, message: err.message || '删除失败' });
      }
      setBulkDeleteProgress({ label: '正在删除', current: deletedIds.length + lrrFailures.length, total, detail: title });
    }
    if (deletedIds.length > 0) {
      pruneWatchlistItems(deletedIds).catch(() => {});
      removeDeletedArchiveIds(deletedIds);
    }
    setBulkDeleteProgress({
      label: ehFailures.length > 0 || lrrFailures.length > 0 ? '删除完成，部分失败' : '删除完成',
      current: total,
      total,
      detail: `已删除 ${deletedIds.length} 个档案`,
    });
    await waitForPaint();
    setArchiveDeleting(false);
    setBulkDeletePending(false);
    if (ehFailures.length === 0 && lrrFailures.length === 0) {
      setArchiveSelectionMode(false);
      setSelectedArchiveIds(new Set());
      return;
    }
    setArchiveFailureReport({
      ehFailures,
      lrrFailures,
      message: '已完成其余删除操作。失败档案仍保持选中，可稍后重试。',
    });
  }, [bulkDeleteSyncConfirmed, ehFavoriteDeleteSync, removeDeletedArchiveIds, selectedArchiveList, workerReady]);

  const archiveCountLabel = useMemo(() => {
    if (loading) return '正在获取结果...';
    if (selectedCategory?.id === UNTAGGED_CATEGORY_ID && Number.isFinite(archiveTotal)) return `无标签 ${archiveTotal.toLocaleString()} 个`;
    if (archiveBrowseMode === ARCHIVE_BROWSE_MODES.paged) {
      if (Number.isFinite(archiveTotal)) {
        return `${archivePage + 1}/${getArchivePageCount(archiveTotal, archivePageSize)}页 · ${Number(archiveTotal).toLocaleString()}个`;
      }
      return archives.length > 0 ? `${archivePage + 1}页 · ${archives.length}个` : `${archivePage + 1}页`;
    }
    if (Number.isFinite(archiveTotal)) {
      return filter.active
        ? `筛选结果 ${Number(archiveTotal).toLocaleString()} 个`
        : `共 ${Number(archiveTotal).toLocaleString()} 个档案`;
    }
    if (archives.length > 0) {
      return hasMore
        ? `已加载 ${archives.length.toLocaleString()}+ 个`
        : `共 ${archives.length.toLocaleString()} 个档案`;
    }
    return filter.active ? '筛选结果 0 个' : '共 0 个档案';
  }, [archiveBrowseMode, archivePage, archivePageSize, archiveTotal, archives.length, filter.active, hasMore, loading, selectedCategory]);

  const archivePageCount = useMemo(() => getArchivePageCount(archiveTotal, archivePageSize), [archivePageSize, archiveTotal]);
  const archiveRequestBusy = loading || archivesRefreshing;
  const canGoPrevArchivePage = archiveBrowseMode === ARCHIVE_BROWSE_MODES.paged && archivePage > 0 && !archiveRequestBusy;
  const canGoNextArchivePage = archiveBrowseMode === ARCHIVE_BROWSE_MODES.paged && !archiveRequestBusy && (Number.isFinite(archiveTotal) ? archivePage < archivePageCount - 1 : hasMore);
  const goArchivePage = useCallback((page) => {
    if (archiveRequestBusy) return;
    const nextPage = clampArchivePage(page, archiveTotal, archivePageSize);
    setArchivePage(nextPage);
    setArchivePageInput(String(nextPage + 1));
    pendingArchivesScrollRef.current = true;
  }, [archivePageSize, archiveRequestBusy, archiveTotal]);
  const submitArchivePageInput = useCallback(() => {
    const page = Math.max(1, Math.floor(Number(archivePageInput) || 1)) - 1;
    goArchivePage(page);
  }, [archivePageInput, goArchivePage]);

  const handleManualRefreshArchives = useCallback(async () => {
    requestPresetMenuClose();
    dispatchArchiveRefresh('start');
    const refreshed = await doFetch(true, { background: true, force: true, clearSearchCache: true });
    if (!refreshed) {
      dispatchArchiveRefresh('fail');
      return;
    }
    dispatchArchiveRefresh('replace');
    requestAnimationFrame(() => dispatchArchiveRefresh('finish'));
  }, [doFetch, requestPresetMenuClose]);

  useEffect(() => {
    if (didApplyUrlFilterRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (!q) return;
    didApplyUrlFilterRef.current = true;
    const next = { ...DEFAULT_FILTER, query: readRouteFilterQuery(q), active: true };
    writeFilter(next);
    setFilter(prev => (
      prev.query === next.query &&
      prev.sortBy === next.sortBy &&
      prev.order === next.order &&
      prev.active === next.active
        ? prev
        : next
    ));
  }, []);

  const handleCategoryClick = useCallback((cat) => {
    const nextCategory = selectedCategory?.id === cat.id ? null : cat;
    const query = filter.query || '';
    const nextFilter = { ...filter, active: !!query.trim() };
    lastFetchedFilterRef.current = '';
    lastFetchedRef.current = 0;
    writeFilter(nextFilter);
    setFilter(nextFilter);
    setSelectedCategory(nextCategory);
    setLoading(true);
    setArchiveTotal(null);
    setArchivePage(0);
    setArchivePageInput('1');
    navigateHome({ query: query.trim(), replace: true });
  }, [filter, selectedCategory]);

  const clearFilter = () => {
    const cleared = { ...DEFAULT_FILTER };
    writeFilter(cleared);
    setFilter(cleared);
    setArchiveTotal(null);
    setArchivePage(0);
    setArchivePageInput('1');
    navigateHome({ replace: true });
  };

  const applyFilter = (q, s, o, categoryOverride = null) => {
    const query = q || '';
    const trimmedQuery = query.trim();
    const next = { query, sortBy: s, order: o, active: !!trimmedQuery };
    writeFilter(next);
    setFilter(next);
    setSelectedCategory(categoryOverride);
    setArchiveTotal(null);
    setArchivePage(0);
    setArchivePageInput('1');
    navigateHome({ query: trimmedQuery, replace: true });
  };

  const handleSearch = () => {
    if (!hasArchiveSearchQuery(filter.query)) return;
    applyFilter(filter.query, filter.sortBy, filter.order, selectedCategory);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      requestPresetMenuClose();
      return;
    }
    if (e.key === 'Enter') {
      filterInputRef.current?.blur();
      if (suggestActiveRef.current) return;
      handleSearch();
    }
  };

  const savePreset = () => setPresetNameDialog({ mode: 'create', value: '' });

  const loadPreset = (p) => {
    applyFilter(p.query, p.sortBy, p.order, selectedCategory);
    requestPresetMenuClose();
  };

  const filteredHistory = useMemo(() => {
    return getVisibleContinueReadingItems(history, hideRead);
  }, [history, hideRead]);

  const handleToggleHideRead = useCallback(() => {
    setHideRead(!hideReadRef.current).catch(() => {});
  }, []);

  const handleToggleRandomHideRead = useCallback(() => {
    setRandomHideReadState((value) => {
      const next = !value;
      setRandomHideRead(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!randomHideRead) return;
    setRandoms((items) => filterRandomArchives(items, history, true));
  }, [history, randomHideRead]);

  const handleToggleCropCover = useCallback(() => {
    setCropCoverState(v => {
      const next = !v;
      setCropCover(next);
      return next;
    });
  }, []);

  const handleArchiveBrowseModeChange = useCallback((mode) => {
    const next = mode === ARCHIVE_BROWSE_MODES.paged ? ARCHIVE_BROWSE_MODES.paged : ARCHIVE_BROWSE_MODES.scroll;
    setArchiveBrowseMode(next);
    setArchiveBrowseModeState(next);
    setArchivePage(0);
    setArchivePageInput('1');
    setStartOffset(0);
    setHasMore(true);
  }, []);

  const handleArchiveDisplayModeChange = useCallback((mode) => {
    const next = mode === ARCHIVE_DISPLAY_MODES.compact ? ARCHIVE_DISPLAY_MODES.compact : ARCHIVE_DISPLAY_MODES.card;
    setArchiveDisplayMode(next);
    setArchiveDisplayModeState(next);
  }, []);

  const ehFavoriteCookieValid = hasValidEhCookie(readerSettings.ehCookie || getEhCookie());
  const ehFavoriteSyncReady = ehFavoriteCookieValid && workerReady;

  useEffect(() => {
    if (!ehFavoriteSyncReady && ehFavoriteDeleteSync) {
      setEhFavoriteDeleteSync(false);
      setEhFavoriteDeleteSyncState(false);
    }
  }, [ehFavoriteSyncReady, ehFavoriteDeleteSync]);

  const handleToggleEhFavoriteDeleteSync = useCallback(() => {
    if (!ehFavoriteSyncReady) {
      setEhFavoriteDeleteSync(false);
      setEhFavoriteDeleteSyncState(false);
      return;
    }
    setEhFavoriteDeleteSyncState(v => {
      const next = !v;
      setEhFavoriteDeleteSync(next);
      return next;
    });
  }, [ehFavoriteSyncReady]);

  const handleSyncHistory = useCallback(async () => {
    if (!workerReady || historySyncing) return;
    setHistorySyncing(true);
    try {
      const state = await loadHistoryState({ force: true });
      if (!historyExitTimerRef.current) {
        historyRef.current = state.histories;
        hideReadRef.current = state.hideRead;
        setHistory(state.histories);
        setHideReadState(state.hideRead);
      }
    } finally {
      setHistorySyncing(false);
    }
  }, [historySyncing, workerReady]);

  const handleCheckWatchlist = useCallback(async () => {
    if (watchlistChecking) return;
    setWatchlistChecking(true);
    try {
      await runHistoryExistenceCheck({ force: true });
      if (!historyExitTimerRef.current) setHistory(getHistory());
      if (!watchlistExitTimerRef.current) setWatchlist(getWatchlist());
    } finally {
      setWatchlistChecking(false);
    }
  }, [watchlistChecking]);

  const requestRemoveHistory = useCallback((archive) => {
    setHistoryDeleteTarget(archive);
  }, []);

  const removeHistoryArchive = useCallback(async (archive) => {
    const archiveId = archive?.id || archive?.arcid;
    if (!archiveId) return;
    try {
      await removeHistoryItem(archiveId);
      setHistoryDeleteTarget(null);
    } catch (error) {
      showToast(`删除历史记录失败：${error?.message || '未知错误'}`, 'error');
    }
  }, [showToast]);

  const addWatchlistArchive = useCallback((archive) => {
    if (!archive?.arcid && !archive?.id) return;
    addWatchlistItem(archive).catch(() => {});
    if (!watchlistExitTimerRef.current) setWatchlist(getWatchlist());
  }, []);

  const removeWatchlistArchive = useCallback(async (archive) => {
    const archiveId = archive?.id || archive?.arcid;
    if (!archiveId) return;
    try {
      await removeWatchlistItem(archiveId);
    } catch (error) {
      showToast(`移除待看档案失败：${error?.message || '未知错误'}`, 'error');
    }
  }, [showToast]);

  const handleRemoveHistory = useCallback(() => {
    removeHistoryArchive(historyDeleteTarget);
  }, [historyDeleteTarget, removeHistoryArchive]);
  const randomSkeletonCount = getRandomSkeletonCount(window.innerWidth, isNarrow);

  return (
    <>
    <div className="home-shell">
      <div className="home-topbar">
        <div className="home-brand">
          <h1 className="home-brand-title" translate="no" aria-label="Readoshi">
            <span className="home-brand-logo" aria-hidden="true" />
            <span className="home-project-name" aria-hidden="true">Readoshi</span>
            <button
                type="button"
                onClick={() => probeServerStatus({ force: true })}
                aria-label="探测 LRR 服务器状态"
                title={serverProbeRunning ? '正在探测 LRR 服务器' : (serverOnline ? '点击重新探测 LRR 服务器' : 'LRR 服务器异常，点击重试')}
                className={`btn btn-quiet btn-icon server-status-button${serverProbeRunning ? ' is-probing' : ''}${serverOnline === null ? ' is-pending' : (serverOnline ? ' is-online' : ' is-offline')}`}
              >
                {serverProbeRunning && (
                  <>
                    <span className="server-status-ripple server-status-ripple-primary" />
                    <span className="server-status-ripple server-status-ripple-secondary" />
                  </>
                )}
                <span className="server-status-dot" />
            </button>
          </h1>
          <div className="home-welcome">
            <span>欢迎回来</span><span className="home-welcome-detail">，继续你的探索之旅</span>
          </div>
        </div>
        <div className="home-actions">
          <button
            className="btn btn-secondary btn-icon theme-mode-btn"
            type="button"
            onClick={onThemeModeChange}
            title={`切换主题，当前为${THEME_MODE_LABELS[themeMode] || THEME_MODE_LABELS.auto}`}
            aria-label={`当前主题：${THEME_MODE_LABELS[themeMode] || THEME_MODE_LABELS.auto}`}
          >
            <ThemeModeGlyph mode={themeMode} size={18} />
          </button>
          <button className="btn btn-secondary home-action-button" onClick={() => {
            setCfgWorkerUrl(getWorkerUrl());
            setCfgSyncToken(getSyncToken());
            setThemePalettesDraft(themePalettes);
            setThemePaletteMode(document.documentElement.dataset.theme || 'light');
            setReaderSettings(readReaderSettings());
            setShowConfig(true);
          }} ref={settingsTriggerRef}>设置</button>
          <button className="btn btn-secondary home-action-button" onClick={onLogout}>退出</button>
        </div>
      </div>

      {history.length > 0 && (
        <section className="content-band section-reveal section-reveal-delay-1">
          <div className="home-carousel-header">
            <SectionHeading glyph="continue" onClick={handleNavigateHistory} title="查看全部历史记录">继续阅读</SectionHeading>
            <div className="home-carousel-actions">
              {workerReady && (
              <button
                type="button"
                className={`btn btn-secondary home-compact-action${historySyncing ? ' is-loading' : ''}`}
                onClick={handleSyncHistory}
                disabled={historySyncing}
                title="从 Worker 刷新阅读历史"
              >
                {historySyncing ? '刷新中' : '刷新'}
              </button>
              )}
              <CollapseButton
                collapsed={historyCollapsed}
                onClick={() => setHistoryCollapsed(v => !v)}
                title={historyCollapsed ? '展开继续阅读' : '收起继续阅读'}
              />
            </div>
          </div>
          <div className="home-carousel-collapse" style={{ maxHeight: historyCollapsed ? '0px' : HOME_CAROUSEL_EXPANDED_HEIGHT }}>
            <div ref={historyScroller.ref} onWheelCapture={historyScroller.onWheelCapture} onScroll={historyScroller.onScroll} onMouseDown={historyScroller.onMouseDown} onClickCapture={historyScroller.onClickCapture} onDragStart={historyScroller.onDragStart} style={{ gap: isNarrow ? '10px' : '16px', padding: getHomeCarouselPadding(isNarrow), ...historyScroller.getTouchScrollStyle(), ...historyScroller.getMouseScrollStyle() }} className="no-scrollbar home-carousel-scroller">
              {filteredHistory.length > 0 ? (
                <>
                  {filteredHistory.slice(0, 10).map(h => (
                    <ArchiveCard key={`hist-${h.id}`} className={[watchlistIds.has(h.id) ? 'watchlist-card' : '', historyExitIds.has(String(h.id)) ? 'home-carousel-card-exit' : (historyEntranceIds.has(String(h.id)) ? 'home-carousel-card-enter' : '')].filter(Boolean).join(' ') || undefined} archive={h} onClick={() => handleSelectArchive(h.id)} onArchiveContextMenu={(archive, point, event) => handleOpenArchiveMenu(archive, point, event, { showRemoveHistory: true })} longPressTitle="打开菜单" currentPage={h.page} showProgressBar={showHistoricalArchiveProgress} reserveProgressSpace={reserveGlobalProgressSpace} noCrop={!cropCover} cacheOnly={coldRestoreRef.current} eagerThumbnail />
                  ))}
                  {filteredHistory.length > 10 && (
                    <button
                      type="button"
                      onClick={handleNavigateHistory}
                      className="btn btn-quiet history-view-all-btn"
                      style={{ width: isNarrow ? '54px' : '68px', minWidth: isNarrow ? '54px' : '68px' }}
                      title="查看全部阅读历史"
                      aria-label="查看全部阅读历史"
                    >
                      <span className="history-view-all-arrow" aria-hidden="true">
                        <svg viewBox="0 0 36 48" width="36" height="48" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 8l14 16L8 40" />
                          <path d="M18 8l14 16-14 16" />
                        </svg>
                      </span>
                    </button>
                  )}
                </>
              ) : (
                <div className="home-empty-history">所有档案均已读完</div>
              )}
            </div>
          </div>
        </section>
      )}

      {!pageReady && history.length === 0 && (
        <section className="content-band section-reveal section-reveal-delay-1">
          <div className="home-carousel-header">
            <SectionHeading glyph="continue">继续阅读</SectionHeading>
          </div>
          <div className="no-scrollbar home-carousel-scroller" style={{ padding: isNarrow ? '8px 14px 16px' : '8px 20px 16px' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={`hsk-${i}`} showProgress={showHistoricalArchiveProgress} />
            ))}
          </div>
        </section>
      )}

      {watchlist.length > 0 && (
        <section className="content-band section-reveal section-reveal-delay-1">
          <div className="home-carousel-header">
            <SectionHeading glyph="watchlist" onClick={handleNavigateWatchlist} title="查看全部待看档案">待看档案</SectionHeading>
            <div className="home-carousel-actions">
              <button
                type="button"
                className={`btn btn-secondary home-compact-action${watchlistChecking ? ' is-loading' : ''}`}
                onClick={handleCheckWatchlist}
                disabled={watchlistChecking}
                title="检查待看档案是否仍存在于 LANraragi"
              >
                {watchlistChecking ? '检查中' : '刷新'}
              </button>
              <CollapseButton
                collapsed={watchlistCollapsed}
                onClick={() => setWatchlistCollapsed(v => !v)}
                title={watchlistCollapsed ? '展开待看档案' : '收起待看档案'}
              />
            </div>
          </div>
          <div className="home-carousel-collapse" style={{ maxHeight: watchlistCollapsed ? '0px' : HOME_CAROUSEL_EXPANDED_HEIGHT }}>
            <div ref={watchlistScroller.ref} onWheelCapture={watchlistScroller.onWheelCapture} onScroll={watchlistScroller.onScroll} onMouseDown={watchlistScroller.onMouseDown} onClickCapture={watchlistScroller.onClickCapture} onDragStart={watchlistScroller.onDragStart} style={{ gap: isNarrow ? '10px' : '16px', padding: getHomeCarouselPadding(isNarrow), ...watchlistScroller.getTouchScrollStyle(), ...watchlistScroller.getMouseScrollStyle() }} className="no-scrollbar home-carousel-scroller">
              {watchlistWithProgress.map(item => (
                <ArchiveCard key={`watch-${item.id || item.arcid}`} className={watchlistExitIds.has(String(item.id || item.arcid)) ? 'home-carousel-card-exit' : (watchlistEntranceId === String(item.id || item.arcid) ? 'home-carousel-card-enter' : undefined)} archive={item} onClick={() => handleSelectArchive(item.id || item.arcid)} onArchiveContextMenu={(archive, point, event) => handleOpenArchiveMenu(archive, point, event, { showRemoveWatchlist: true })} longPressTitle="打开菜单" currentPage={item.page} showProgressBar={showWatchlistArchiveProgress} reserveProgressSpace={reserveGlobalProgressSpace} noCrop={!cropCover} cacheOnly={coldRestoreRef.current} eagerThumbnail />
              ))}
              {watchlistOverflow && (
                <button
                  type="button"
                  onClick={handleNavigateWatchlist}
                  className="btn btn-quiet history-view-all-btn"
                  style={{ width: isNarrow ? '54px' : '68px', minWidth: isNarrow ? '54px' : '68px' }}
                  title="查看全部待看档案"
                  aria-label="查看全部待看档案"
                >
                  <span className="history-view-all-arrow" aria-hidden="true">
                    <svg viewBox="0 0 36 48" width="36" height="48" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 8l14 16L8 40" />
                      <path d="M18 8l14 16-14 16" />
                    </svg>
                  </span>
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {randomsLoading ? (
        <section className="content-band section-reveal section-reveal-delay-2">
          <div className="home-carousel-header">
            <SectionHeading glyph="random">随机漫游</SectionHeading>
            <button className="btn btn-secondary home-compact-action" onClick={() => fetchRandoms({ preferFresh: true })} disabled={randomsLoading || randomsRefreshing}>刷新</button>
          </div>
          <div className="no-scrollbar home-carousel-scroller" style={{ padding: isNarrow ? '8px 14px 16px' : '8px 20px 16px' }}>
            {Array.from({ length: randomSkeletonCount }).map((_, i) => (
              <SkeletonCard key={`rsk-${i}`} showProgress={showGlobalArchiveProgress} />
            ))}
          </div>
        </section>
      ) : randoms.length > 0 ? (
        <section className="content-band section-reveal section-reveal-delay-2">
          <div className="home-carousel-header">
            <SectionHeading glyph="random">随机漫游</SectionHeading>
            <div className="home-carousel-actions home-random-actions">
            <button className="btn btn-secondary home-compact-action" onClick={() => fetchRandoms({ preferFresh: true })} disabled={randomsLoading || randomsRefreshing}>刷新</button>
              <CollapseButton
                collapsed={randomCollapsed}
                onClick={() => setRandomCollapsed(v => !v)}
                title={randomCollapsed ? '展开随机漫游' : '收起随机漫游'}
              />
            </div>
          </div>
          <div className="home-carousel-collapse" style={{ maxHeight: randomCollapsed ? '0px' : HOME_CAROUSEL_EXPANDED_HEIGHT }}>
            <div ref={randomScroller.ref} onWheelCapture={randomScroller.onWheelCapture} onScroll={randomScroller.onScroll} onMouseDown={randomScroller.onMouseDown} onClickCapture={randomScroller.onClickCapture} onDragStart={randomScroller.onDragStart} style={{ gap: isNarrow ? '10px' : '16px', padding: getHomeCarouselPadding(isNarrow), ...randomScroller.getTouchScrollStyle(), ...randomScroller.getMouseScrollStyle() }} className="no-scrollbar home-carousel-scroller">
              {randomsRefreshing ? Array.from({ length: randomSkeletonCount }).map((_, i) => (
                <SkeletonCard key={`rrsk-${i}`} showProgress={showGlobalArchiveProgress} />
              )) : randoms.map(arc => (
                <ArchiveCard key={`rnd-${arc.arcid}`} className={watchlistIds.has(arc.arcid || arc.id) ? 'watchlist-card' : undefined} archive={arc} onClick={() => handleSelectArchive(arc.arcid)} onArchiveContextMenu={handleOpenArchiveMenu} showProgressBar={showGlobalArchiveProgress} reserveProgressSpace={reserveGlobalProgressSpace} noCrop={!cropCover} cacheOnly={coldRestoreRef.current} eagerThumbnail />
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className="content-band section-reveal section-reveal-delay-2">
          <div className="home-carousel-header">
            <SectionHeading glyph="random">随机漫游</SectionHeading>
            <button className="btn btn-secondary home-compact-action" onClick={() => fetchRandoms({ preferFresh: true })} disabled={randomsLoading || randomsRefreshing}>{randomsRefreshing ? '刷新中' : '刷新'}</button>
          </div>
          <div className="home-random-empty">
            暂无随机漫游结果
          </div>
        </section>
      )}

      <section ref={archivesSectionRef} className="surface archive-workspace section-reveal section-reveal-delay-3">
        <div className="archive-toolbar">
          <div className="archive-toolbar-primary">
            <div className="archive-toolbar-summary">
              <SectionHeading glyph="archives" style={{ lineHeight: 1 }}>全部档案</SectionHeading>
              <span className="archive-count-badge">
                {archiveCountLabel}
              </span>
            </div>
            <div className="archive-toolbar-actions">
              <button
                className="btn btn-secondary home-compact-action"
                onClick={toggleArchiveSelectionMode}
                disabled={archiveDeleting}
              >
                {archiveSelectionMode ? '取消多选' : '多选'}
              </button>
              <button
                className={`btn btn-secondary home-compact-action${archivesRefreshing ? ' is-loading' : ''}`}
                onClick={handleManualRefreshArchives}
                disabled={loading || archivesRefreshing || archiveDeleting}
                title="清理 LANraragi 搜索缓存并重新获取档案列表"
              >
                {archivesRefreshing ? '刷新中' : '刷新'}
              </button>
            </div>
          </div>

          <div className="archive-selection-actions" data-open={archiveSelectionMode ? 'true' : 'false'} aria-hidden={!archiveSelectionMode}>
            <div className="archive-selection-actions-inner">
              <span className="archive-count-badge archive-selection-count-badge" aria-live="polite">已选 {selectedArchiveIds.size} 个</span>
              <button className="btn btn-primary home-compact-action archive-selection-primary" tabIndex={archiveSelectionMode ? 0 : -1} onClick={toggleSelectAllVisibleArchives} disabled={visibleArchiveIds.length === 0 || archiveDeleting}>
                {allVisibleSelected ? '取消全选' : '全选当前'}
              </button>
              <button className="btn btn-secondary home-compact-action" tabIndex={archiveSelectionMode ? 0 : -1} onClick={handleBulkArchiveFavorite} disabled={selectedArchiveIds.size === 0 || archiveDeleting || bulkFavoriteRunning}>
                {bulkFavoriteRunning ? '收藏中…' : '收藏所选'}
              </button>
              <button className="btn btn-danger archive-selection-delete" tabIndex={archiveSelectionMode ? 0 : -1} onClick={requestBulkArchiveDelete} disabled={selectedArchiveIds.size === 0 || archiveDeleting}>
                {archiveDeleting ? '删除中…' : '删除所选'}
              </button>
            </div>
          </div>

          <div
            ref={filterControlsRef}
            style={{
              display: 'flex',
              gap: `${FILTER_LAYOUT_GAP}px`,
              flexDirection: stackFilterControls ? 'column' : 'row',
              flexWrap: 'nowrap',
              alignItems: stackFilterControls ? 'stretch' : 'center',
            }}
          >
            <div style={{ flex: stackFilterControls || isNarrow ? '1 1 100%' : `1 1 ${FILTER_INPUT_MIN_WIDTH}px`, minWidth: stackFilterControls || isNarrow ? '100%' : `${FILTER_INPUT_MIN_WIDTH}px`, maxWidth: '100%', position: 'relative' }}>
              <input
                ref={filterInputRef}
                type="text"
                name="archive-search"
                autoComplete="off"
                aria-label="搜索标签或标题"
                className="field archive-search-field"
                style={{ width: '100%', boxSizing: 'border-box', paddingRight: filter.query ? '66px' : '38px' }}
                placeholder={filter.active ? `筛选: ${filter.query}` : '搜索标签或标题… 按回车筛选'}
                value={filter.query}
                onChange={(e) => {
                  requestPresetMenuClose();
                  const val = e.target.value;
                  if (val === '' && filter.active) {
                    clearFilter();
                  } else {
                    setFilter(prev => ({ ...prev, query: val, active: false }));
                  }
                }}
                onKeyDown={handleKeyDown}
              />
              {filter.query && (
                <button
                  className="btn btn-quiet btn-icon input-clear-btn archive-search-clear"
                  onClick={() => clearFilter()}
                  title="清除筛选"
                ><ToolbarGlyph name="close" size={14} /></button>
              )}
              <button
                type="button"
                className="btn btn-quiet btn-icon input-clear-btn archive-search-preset-toggle"
                ref={presetToggleRef}
                onClick={() => {
                  suggestActiveRef.current = false;
                  togglePresetMenu();
                }}
                title={presetsOpen ? '关闭筛选预设' : '打开筛选预设'}
                aria-label="筛选预设"
              >
                <svg className="archive-search-preset-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style={{ transform: presetsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  <path d="M6 9l6 6 6-6z" />
                </svg>
              </button>
              {!showPresets && (
                <TagSuggest
                  inputValue={filter.query}
                  onSelectTag={handleTagSelect}
                  containerRef={filterInputRef}
                  onSetActive={(v) => { suggestActiveRef.current = v; }}
                />
              )}
              {showPresets && (
                <div
                  className={`archive-search-presets dropdown-animate${presetsClosing ? ' is-closing' : ''}`}
                  ref={presetMenuRef}
                  aria-hidden={presetsClosing}
                  inert={presetsClosing ? '' : undefined}
                  onAnimationEnd={handlePresetMenuAnimationEnd}
                >
                  <div className="archive-search-preset-heading">
                    <span>已保存的筛选方案</span>
                    <button className="btn btn-secondary" onClick={savePreset}>
                      + 保存当前筛选
                    </button>
                  </div>
                  {presets.length === 0 ? (
                    <div className="archive-search-empty">
                      暂无预设。设置筛选条件后点击「保存当前筛选」。
                    </div>
                  ) : (
                    <div className="archive-search-preset-list">
                      {presets.map(p => (
                        <div key={p.name} className="archive-search-preset-row">
                          <button
                            className="btn btn-quiet archive-search-preset-apply"
                            onClick={() => loadPreset(p)}
                            title={`${p.query} / ${p.sortBy} / ${p.order}`}
                          >
                            {p.name}
                          </button>
                          <button
                            type="button"
                            className="btn btn-quiet btn-icon archive-search-preset-edit"
                            onClick={() => setEditingPreset(current => current === p.name ? '' : p.name)}
                            aria-label={`编辑 ${p.name}`}
                            aria-expanded={editingPreset === p.name}
                          >
                            <ToolbarGlyph name="edit" size={16} />
                          </button>
                          {editingPreset === p.name && <div className="archive-search-preset-actions dropdown-animate">
                            <button type="button" className="btn btn-quiet archive-search-preset-action" onClick={() => { setPresetNameDialog({ mode: 'rename', value: p.name }); setEditingPreset(''); }}>重命名</button>
                            <button type="button" className="btn btn-danger archive-search-preset-action" onClick={() => { setPresetDeleteTarget(p.name); setEditingPreset(''); }}>删除</button>
                          </div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '12px', flex: stackFilterControls ? '1 1 100%' : `0 1 ${FILTER_ACTIONS_MIN_WIDTH}px`, minWidth: stackFilterControls ? '100%' : `${FILTER_ACTIONS_MIN_WIDTH}px`, width: stackFilterControls ? '100%' : 'auto' }}>
              <CustomSelect
                compact
                style={{ flex: '1.35 1 0' }}
                value={filter.sortBy}
                onChange={(v) => setFilter(prev => ({ ...prev, sortBy: v }))}
                options={[{ label: '按添加时间', value: 'date_added' }, { label: '按标题', value: 'title' }]}
              />
              <CustomSelect
                compact
                style={{ flex: '0.65 1 0' }}
                value={filter.order}
                onChange={(v) => setFilter(prev => ({ ...prev, order: v }))}
                options={[{ label: '倒序', value: 'desc' }, { label: '正序', value: 'asc' }]}
              />
              <button className="btn btn-primary archive-search-submit" onClick={handleSearch}>
                筛选
              </button>
            </div>
          </div>
        </div>

        <div className="archive-category-list">
          {displayCategories.map(cat => {
            const isActive = selectedCategory?.id === cat.id;
            const label = getCategoryDisplayName(cat);
            const isFavorites = cat?.name === FAVORITES_CATEGORY_NAME;
            return (
              <button
                key={cat.id}
                className={`btn btn-secondary archive-category-button${isActive ? ' is-active' : ''}`}
                onClick={() => handleCategoryClick(cat)}
                title={label}
              >
                {isFavorites && <ToolbarGlyph name="favorite" size={15} color="currentColor" />}
                {label.length > 12 ? label.slice(0, 12) + '...' : label}
              </button>
            );
          })}
          {(() => {
            const isActive = selectedCategory?.id === UNTAGGED_CATEGORY_ID;
            return (
              <button
                key={UNTAGGED_CATEGORY_ID}
                className={`btn btn-secondary archive-category-button${isActive ? ' is-active' : ''}`}
              onClick={() => handleCategoryClick(UNTAGGED_CATEGORY)}
                title="无标签"
              >
                无标签
              </button>
            );
          })()}
        </div>

        <ArchiveGrid ref={gridRef} displayMode={archiveDisplayMode} className={archiveBrowseMode === ARCHIVE_BROWSE_MODES.paged ? 'is-paged' : ''} data-refresh-phase={archiveRefreshPhase} aria-busy={archivesRefreshing} style={{ gap: isNarrow ? '10px' : '16px' }}>
          {archives.length === 0 && loading ? (
            Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={`gsk-${i}`} showProgress={showGlobalArchiveProgress} />)
          ) : (
            displayArchives.map((arc) => (
              <ArchiveCard key={arc.arcid || arc.id} displayMode={archiveDisplayMode} className={watchlistIds.has(arc.arcid || arc.id) ? 'watchlist-card' : undefined} archive={arc} onClick={handleArchiveCardActivate} onArchiveContextMenu={handleOpenArchiveMenu} showProgressBar={showGlobalArchiveProgress} reserveProgressSpace={reserveGlobalProgressSpace} noCrop={!cropCover} cacheOnly={coldRestoreRef.current} selectionMode={archiveSelectionMode} selected={selectedArchiveIds.has(arc.arcid || arc.id)} onSelectToggle={toggleArchiveSelection} />
            ))
          )}
        </ArchiveGrid>

        {archives.length === 0 && !loading && (
          <div className="archive-feedback-empty" role={archiveLoadError ? 'alert' : 'status'} aria-live="polite">
            {archiveLoadError || (selectedCategory?.id === UNTAGGED_CATEGORY_ID ? '没有无标签档案' : (filter.active ? '没有匹配的档案，请尝试其他筛选条件' : '仓库为空，请先在 LANraragi 中添加档案'))}
          </div>
        )}

        {archiveLoadError && archives.length > 0 && (
          <div className="archive-feedback-error" role="alert" aria-live="polite">
            {archiveLoadError}
          </div>
        )}

        <div className="archive-sentinel" ref={sentinelRef} />

        <div className="archive-pagination-shell">
          {archiveBrowseMode === ARCHIVE_BROWSE_MODES.paged ? (
            <div className="archive-pagination-controls">
              <button className="btn btn-secondary archive-pagination-button" onClick={() => goArchivePage(archivePage - 1)} disabled={!canGoPrevArchivePage}>上一页</button>
              <span className="archive-pagination-jump">
                第
                <input
                  className="field no-spinner"
                  type="text"
                  inputMode="numeric"
                  aria-label="跳转到档案页码"
                  value={archivePageInput}
                  onChange={(event) => setArchivePageInput(event.target.value.replace(/[^\d]/g, ''))}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !archiveRequestBusy) submitArchivePageInput(); }}
                  disabled={archiveRequestBusy}
                />
                页
                {Number.isFinite(archiveTotal) && <span className="archive-pagination-total">/ {archivePageCount}</span>}
              </span>
              <button className="btn btn-secondary archive-pagination-button" onClick={submitArchivePageInput} disabled={archiveRequestBusy}>跳转</button>
              <button className="btn btn-secondary archive-pagination-button" onClick={() => goArchivePage(archivePage + 1)} disabled={!canGoNextArchivePage}>下一页</button>
            </div>
          ) : hasMore ? (
            supportsAutomaticArchiveLoading ? (
              loading || archivesRefreshing ? (
                <div className="archive-loading-status">加载中…</div>
              ) : null
            ) : (
              <button className="btn btn-primary archive-load-more" onClick={() => doFetch(false)} disabled={loading || archivesRefreshing}>
                {loading ? '加载中…' : '加载更多'}
              </button>
            )
          ) : (archives.length > 0 && (
            <div className="archive-end-status">— 已经到底啦 —</div>
          ))}
        </div>
      </section>
    </div>
    <button
      type="button"
      aria-label="返回顶部"
      title="返回顶部"
      className={`btn btn-secondary btn-icon home-back-to-top${showBackToTop ? ' is-visible' : ''}`}
      onClick={handleBackToTop}
    >
      ↑
    </button>
    {showConfig && createPortal(
      <div className="settings-overlay" role="presentation" onClick={() => setShowConfig(false)}>
        <form ref={settingsDialogRef} className="surface settings-panel settings-panel-form settings-panel-height-animate" style={{ height: settingsPanelHeight == null ? 'auto' : `${settingsPanelHeight}px` }} role="dialog" aria-modal="true" aria-labelledby="home-settings-title" tabIndex={-1} onClick={e => e.stopPropagation()} onSubmit={(e) => {
          e.preventDefault();
          setWorkerUrl(cfgWorkerUrl);
          setSyncToken(cfgSyncToken);
          onThemePalettesChange?.(themePalettesDraft);
          setShowConfig(false);
        }}>
          <div className="settings-panel-header">
            <h2 className="settings-title" id="home-settings-title">设置</h2>
          </div>

          <div className="settings-panel-scroll settings-layout" ref={settingsPaneRef}>

          <div className="settings-category-tabs" role="tablist" aria-label="设置分类">
            {[
              ['general', '通用'],
              ['worker', 'Worker'],
              ['palette', '配色'],
              ['tools', '工具'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`home-settings-tab-${key}`}
                aria-controls={`home-settings-panel-${key}`}
                aria-selected={settingsCategory === key}
                className={`btn btn-quiet settings-category-tab${settingsCategory === key ? ' is-active' : ''}`}
                onClick={() => setSettingsCategory(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div id="home-settings-panel-general" role="tabpanel" aria-labelledby="home-settings-tab-general" aria-hidden={settingsCategory !== 'general'} inert={settingsCategory === 'general' ? undefined : ''} className={`settings-section${settingsCategory === 'general' ? ' is-active' : ''}`}>
            <div className="settings-section-inner">
              <div className="settings-group">
                <CacheSettings />
              </div>
              <div className="settings-group">
                <div className="settings-row">
                  <SettingHint text={'作用：将横版或方形封面裁成统一的竖向比例。\n影响：只改变书库缩略图，不修改档案原图。'}>裁剪封面</SettingHint>
                  <div className="settings-control settings-toggle-control"><ToggleSwitch checked={cropCover} onChange={handleToggleCropCover} label="裁剪封面" /></div>
                </div>

                <label className="settings-row">
                  <SettingHint text={'禁止：所有档案卡片都不显示阅读进度。\n仅历史记录：只在阅读历史中显示进度提示。\n全局：有阅读进度的档案卡片均会显示。'}>显示进度条</SettingHint>
                  <div className="settings-control">
                    <CustomSelect
                      ariaLabel="显示进度条"
                      value={readerSettings.progressBarVisibility}
                      onChange={(value) => updateReaderSettings((settings) => ({ ...settings, progressBarVisibility: value }))}
                      options={[
                        { label: '禁止', value: ARCHIVE_PROGRESS_VISIBILITY.DISABLED },
                        { label: '仅历史记录', value: ARCHIVE_PROGRESS_VISIBILITY.HISTORY },
                        { label: '全局', value: ARCHIVE_PROGRESS_VISIBILITY.GLOBAL },
                      ]}
                      compact
                    />
                  </div>
                </label>
              </div>
              <div className="settings-group">
                <label className="settings-row">
                  <SettingHint text={'滚动模式：到达列表底部时自动加载更多。\n分页模式：每次显示一页档案，使用页码切换。'}>档案浏览模式</SettingHint>
                  <div className="settings-control">
                    <CustomSelect
                      value={archiveBrowseMode}
                      onChange={handleArchiveBrowseModeChange}
                      options={[{ label: '滚动', value: ARCHIVE_BROWSE_MODES.scroll }, { label: '分页', value: ARCHIVE_BROWSE_MODES.paged }]}
                      compact
                    />
                  </div>
                </label>

                <label className="settings-row">
                  <SettingHint text={'卡片模式：显示封面卡片。\n紧凑模式：每行显示标题、进度、日期、作者和标签。'}>档案显示模式</SettingHint>
                  <div className="settings-control">
                    <CustomSelect
                      value={archiveDisplayMode}
                      onChange={handleArchiveDisplayModeChange}
                      options={[{ label: '卡片', value: ARCHIVE_DISPLAY_MODES.card }, { label: '紧凑', value: ARCHIVE_DISPLAY_MODES.compact }]}
                      compact
                    />
                  </div>
                </label>

                <div className="settings-row">
                  <SettingHint text={'开启：阅读进度可随跳转回退到较早页面。\n关闭：只保留已到达的最高页码。'}>允许阅读进度回溯</SettingHint>
                  <div className="settings-control settings-toggle-control"><ToggleSwitch
                    checked={readerSettings.allowProgressRegression}
                    onChange={(checked) => updateReaderSettings((settings) => ({ ...settings, allowProgressRegression: checked }))}
                    label="允许阅读进度回溯"
                  /></div>
                </div>

                <div className="settings-row">
                  <SettingHint text={'作用：隐藏已读至最后一页的档案。\n影响：只精简阅读历史列表，不会删除阅读记录。'}>历史记录中隐藏已读完</SettingHint>
                  <div className="settings-control settings-toggle-control"><ToggleSwitch checked={hideRead} onChange={handleToggleHideRead} label="历史记录中隐藏已读完" /></div>
                </div>
                <div className="settings-row">
                  <SettingHint text={'作用：随机漫游时隐藏已读至最后一页的档案。\n影响：首页和快速跳转使用同一筛选，不会删除阅读记录。'}>随机漫游中隐藏已读完</SettingHint>
                  <div className="settings-control settings-toggle-control"><ToggleSwitch checked={randomHideRead} onChange={handleToggleRandomHideRead} label="随机漫游中隐藏已读完" /></div>
                </div>
              </div>
            </div>
          </div>

          <div id="home-settings-panel-worker" role="tabpanel" aria-labelledby="home-settings-tab-worker" aria-hidden={settingsCategory !== 'worker'} inert={settingsCategory === 'worker' ? undefined : ''} className={`settings-section${settingsCategory === 'worker' ? ' is-active' : ''}`}>
            <div className="settings-section-inner">
              <div className="settings-group">
                <div className="settings-row">
                  <SettingHint text={'作用：在阅读器中显示来源画廊的评论。\n条件：必须填写能访问该画廊的 E-Hentai Cookie。'}>启用 E-Hentai 评论区</SettingHint>
                  <ToggleSwitch checked={readerSettings.ehEnabled} onChange={() => updateReaderSettings((s) => ({ ...s, ehEnabled: !s.ehEnabled }))} label="启用 E-Hentai 评论区" />
                </div>
                <div
                  className={`settings-eh-details${readerSettings.ehEnabled ? ' is-expanded' : ''}`}
                  style={{ transform: readerSettings.ehEnabled ? 'none' : 'translateY(-6px)' }}
                  aria-hidden={!readerSettings.ehEnabled}
                >
                  <div className="settings-eh-details-inner">
                  <div className="settings-eh-cookie-field">
                    <SettingHint className="settings-field-label" text={'作用：访问 E-Hentai 画廊和评论。\n条件：同步删除收藏还需要 ipb_member_id 与 ipb_pass_hash。'}>E-Hentai Cookie</SettingHint>
                    <div className="eh-cookie-input-row">
                      <SecretInput
                        name="e-hentai-cookie"
                        ariaLabel="E-Hentai Cookie"
                        value={readerSettings.ehCookie || ''}
                        onChange={(e) => updateReaderSettings((s) => ({ ...s, ehCookie: e.target.value }))}
                        placeholder="igneous=…; ipb_member_id=…; ipb_pass_hash=…"
                         className="settings-eh-cookie-input"
                      />
                  <button type="button" className="btn btn-secondary eh-cookie-check-btn" onClick={handleCheckEhCookie} disabled={ehCookieChecking}>
                        {ehCookieChecking ? '检测中' : '检测'}
                      </button>
                    </div>
                  </div>
                  <label className="settings-row">
                    <SettingHint text={'作用：隐藏低于此分数的评论。\n填 0：显示全部评论，不按分数过滤。'}>最低展示分数</SettingHint>
                    <input type="text" inputMode="numeric" pattern="-?[0-9]*" className="field no-spinner eh-settings-number-field"
                      value={String(readerSettings.ehMinScore)}
                      onChange={(e) => { const v = e.target.value; const n = parseInt(v, 10); if (!isNaN(n) && n >= -999) updateReaderSettings((s) => ({ ...s, ehMinScore: n })); else if (v === '' || v === '-') updateReaderSettings((s) => ({ ...s, ehMinScore: 0 })); }}
                      onBlur={() => { const n = parseInt(readerSettings.ehMinScore, 10); if (isNaN(n)) updateReaderSettings((s) => ({ ...s, ehMinScore: 0 })); }}
                    />
                  </label>
                  <label className="settings-row">
                    <SettingHint text={'作用：限制每个档案加载的评论数量。\n范围：1–200 条。'}>最多展示数量</SettingHint>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" className="field no-spinner eh-settings-number-field"
                      value={String(readerSettings.ehMaxComments)}
                      onChange={(e) => { const v = sanitizeUnsignedIntegerInput(e.target.value); const n = parseInt(v, 10); if (!isNaN(n) && n >= 1 && n <= 200) updateReaderSettings((s) => ({ ...s, ehMaxComments: n })); }}
                      onBlur={() => { const n = parseInt(readerSettings.ehMaxComments, 10); if (isNaN(n) || n < 1) updateReaderSettings((s) => ({ ...s, ehMaxComments: 45 })); else if (n > 200) updateReaderSettings((s) => ({ ...s, ehMaxComments: 200 })); }}
                    />
                  </label>
                  <label className="settings-row">
                    <SettingHint text={'按分数：根据评论评分排序。\n按时间：根据评论发布时间排序。'}>排序方式</SettingHint>
                    <div className="eh-settings-select-wrap">
                      <CustomSelect
                        value={readerSettings.ehSortMethod}
                        options={[{ label: '分数', value: 'score' }, { label: '时间', value: 'time' }]}
                        onChange={(v) => updateReaderSettings((s) => ({ ...s, ehSortMethod: v }))}
                        compact
                      />
                    </div>
                  </label>
                  <label className="settings-row">
                    <SettingHint text={'倒序：最高分或最新评论优先。\n正序：最低分或最早评论优先。'}>排序方向</SettingHint>
                    <div className="eh-settings-select-wrap">
                      <CustomSelect
                        value={readerSettings.ehSortOrder}
                        options={[{ label: '倒序', value: 'desc' }, { label: '正序', value: 'asc' }]}
                        onChange={(v) => updateReaderSettings((s) => ({ ...s, ehSortOrder: v }))}
                        compact
                      />
                    </div>
                  </label>
                  </div>
                </div>
              </div>
              <div className="settings-group">
                {workerReady && <div className="settings-row">
                  <SettingHint text={ehFavoriteSyncReady ? '作用：删除档案时，同时移除 source 指向的 E-Hentai 收藏。\n控制：仍可在每次删除确认时单独取消同步。' : '当前不可用。\n条件：配置 Worker、访问 Token，并提供含 ipb_member_id 与 ipb_pass_hash 的 E-Hentai Cookie。'}>同步删除 E-Hentai 收藏夹</SettingHint>
                  <ToggleSwitch checked={ehFavoriteDeleteSync && ehFavoriteSyncReady} onChange={handleToggleEhFavoriteDeleteSync} disabled={!ehFavoriteSyncReady} label="同步删除 E-Hentai 收藏夹" />
                </div>}
                <div>
                  <SettingHint className="settings-field-label" text={'作用：启用多设备阅读历史、待看列表和收藏删除同步。\n条件：Worker 端点必须是可访问的 HTTPS 地址。'}>Cloudflare Worker 端点</SettingHint>
                  <input type="url" inputMode="url" name="worker-url" autoComplete="off" spellCheck={false} aria-label="Cloudflare Worker 端点" className="field settings-worker-url"
                    value={cfgWorkerUrl}
                    onChange={(e) => setCfgWorkerUrl(e.target.value)}
                    placeholder="https://lrr-sync.example.workers.dev"
                  />
                </div>

                <div>
                  <SettingHint className="settings-field-label" text={'作用：识别同一同步账户；使用相同 Token 的设备会共享数据。\n条件：先将 Token 写入 Worker KV 的 tokens 字段。'}>访问 Token</SettingHint>
                  <SecretInput
                    name="sync-token"
                    ariaLabel="访问 Token"
                    value={cfgSyncToken}
                    onChange={(e) => setCfgSyncToken(e.target.value)}
                    placeholder="需与 KV 空间 tokens 字段中的 Token 保持一致"
                  />
                </div>
              </div>
            </div>
          </div>

          <div id="home-settings-panel-palette" role="tabpanel" aria-labelledby="home-settings-tab-palette" aria-hidden={settingsCategory !== 'palette'} inert={settingsCategory === 'palette' ? undefined : ''} className={`settings-section${settingsCategory === 'palette' ? ' is-active' : ''}`}>
            <div className="settings-section-inner">
              <div className="settings-group">
              <div className="theme-palette-mode-tabs" role="tablist" aria-label="自定义配色模式">
                {['light', 'dark'].map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={themePaletteMode === mode}
                    className={`btn btn-quiet theme-palette-mode-tab${themePaletteMode === mode ? ' is-active' : ''}`}
                    onClick={() => setThemePaletteMode(mode)}
                  >
                    <ThemeModeGlyph mode={mode} size={18} />
                    {mode === 'light' ? '浅色模式' : '深色模式'}
                  </button>
                ))}
              </div>
              <div className="theme-palette-grid">
                {[
                  ['accent', '主强调色'],
                  ['secondary', '辅助色'],
                  ['background', '底色'],
                ].map(([key, label]) => (
                  <ThemeColorPicker
                    key={key}
                    label={label}
                    value={themePalettesDraft?.[themePaletteMode]?.[key] || DEFAULT_THEME_PALETTES[themePaletteMode][key]}
                    onChange={(value) => setThemePalettesDraft((current) => ({
                      ...(current || {}),
                      [themePaletteMode]: {
                        ...(current?.[themePaletteMode] || DEFAULT_THEME_PALETTES[themePaletteMode]),
                        [key]: value,
                      },
                    }))}
                  />
                ))}
              </div>
              <div className="theme-palette-actions">
                <span className="theme-palette-status" aria-live="polite">
                  {themePalettesDraft?.[themePaletteMode] ? `${themePaletteMode === 'light' ? '浅色' : '深色'}模式已启用自定义色彩语言` : `当前使用${themePaletteMode === 'light' ? '浅色' : '深色'}内置主题配色`}
                </span>
                <button type="button" className="btn btn-quiet theme-palette-reset" onClick={() => setThemePalettesDraft((current) => {
                  if (!current?.[themePaletteMode]) return current;
                  const next = { ...current };
                  delete next[themePaletteMode];
                  return next.light || next.dark ? next : null;
                })}>
                  恢复当前模式默认配色
                </button>
              </div>
              </div>
            </div>
          </div>

          <div id="home-settings-panel-tools" role="tabpanel" aria-labelledby="home-settings-tab-tools" aria-hidden={settingsCategory !== 'tools'} inert={settingsCategory === 'tools' ? undefined : ''} className={`settings-section settings-section-tools${settingsCategory === 'tools' ? ' is-active' : ''}`}>
            <div className="settings-section-inner">
              <div className="settings-group">
                <div className="settings-tool-grid">
                <button type="button" className="btn btn-secondary settings-tool-button" onClick={handleNavigateUpload}>上传档案</button>
                <button type="button" className="btn btn-secondary settings-tool-button" onClick={handleNavigateDeduplicate}>重复档案检测</button>
                <button type="button" className="btn btn-secondary settings-tool-button" onClick={handleExportConfig}>导出配置</button>
                <button type="button" className="btn btn-secondary settings-tool-button" onClick={handleImportConfig}>导入配置</button>
              </div>
              </div>
            </div>
          </div>

          </div>

          <div className="settings-panel-footer">
            <div className="settings-panel-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowConfig(false)}>
                取消
              </button>
              <button type="submit" className="btn btn-primary">
                保存
              </button>
            </div>
            <div className="settings-panel-version">
              <AppVersion compact />
            </div>
          </div>
        </form>
      </div>,
      document.body
    )}
    <ArchiveContextMenu
      menu={archiveMenu}
      onClose={() => setArchiveMenu(null)}
      onRead={(archive, options) => handleSelectArchive(archive.arcid || archive.id, options)}
      onReadIncognito={(archive, options) => handleSelectArchive(archive.arcid || archive.id, { ...options, incognito: true })}
      onClearProgress={handleClearArchiveProgress}
      onEditMetadata={(archive, options) => { saveCurrentHomeForNavigation(); navigateToMetadata(archive.arcid || archive.id, options); }}
      onDownload={handleArchiveDownload}
      onCopyLink={handleArchiveCopyLink}
      onDelete={requestArchiveDelete}
      onRemoveHistory={removeHistoryArchive}
      onAddWatchlist={addWatchlistArchive}
      onRemoveWatchlist={removeWatchlistArchive}
    />
    <ConfirmDialog
      open={!!archiveDeleteTarget}
      title="确认删除档案"
      message={archiveDeleteTarget ? `将从 LANraragi 中删除“${archiveDeleteTarget.title || archiveDeleteTarget.arcid || archiveDeleteTarget.id}”。此操作不可撤销。` : ''}
      confirmLabel={archiveDeleting ? '删除中...' : '确认删除'}
      cancelLabel="取消"
      onConfirm={handleArchiveDelete}
      onCancel={() => { if (!archiveDeleting) setArchiveDeleteTarget(null); }}
      confirmDisabled={archiveDeleting}
    >
      {workerReady && ehFavoriteDeleteSync && (
        <EhFavoriteDeleteSwitch checked={archiveDeleteSyncConfirmed} onChange={setArchiveDeleteSyncConfirmed} disabled={archiveDeleting} />
      )}
    </ConfirmDialog>
    <ConfirmDialog
      open={bulkFavoritePending}
      title="收藏所选档案"
      message={bulkFavoriteRunning ? '正在将所选档案加入 LANraragi 收藏夹。' : '所选档案收藏操作已完成。'}
      confirmLabel={bulkFavoriteRunning ? '收藏中…' : '关闭'}
      showCancel={false}
      destructive={false}
      onConfirm={() => { if (!bulkFavoriteRunning) setBulkFavoritePending(false); }}
      onCancel={() => { if (!bulkFavoriteRunning) setBulkFavoritePending(false); }}
      confirmDisabled={bulkFavoriteRunning}
      dismissOnBackdrop={!bulkFavoriteRunning}
    >
      <ExecutionProgressPanel progress={bulkFavoriteProgress} />
    </ConfirmDialog>
    <ConfirmDialog
      open={bulkDeletePending}
      title="确认批量删除档案"
      message={`将从 LANraragi 中删除选中的 ${selectedArchiveIds.size} 个档案。此操作不可撤销。`}
      confirmLabel={archiveDeleting ? '删除中...' : '确认删除'}
      cancelLabel="取消"
      onConfirm={handleBulkArchiveDelete}
      onCancel={() => { if (!archiveDeleting) setBulkDeletePending(false); }}
      confirmDisabled={archiveDeleting}
      dismissOnBackdrop={!archiveDeleting}
    >
      {workerReady && ehFavoriteDeleteSync && (
        <EhFavoriteDeleteSwitch checked={bulkDeleteSyncConfirmed} onChange={setBulkDeleteSyncConfirmed} disabled={archiveDeleting} />
      )}
      <ExecutionProgressPanel progress={bulkDeleteProgress} />
    </ConfirmDialog>
    <ArchiveDeletionFailureDialog
      report={archiveFailureReport}
      message={archiveFailureReport?.message}
      onClose={() => setArchiveFailureReport(null)}
    />
    <TextInputDialog
      open={!!presetNameDialog}
      title={presetNameDialog?.mode === 'rename' ? '重命名筛选方案' : '为当前筛选方案命名'}
      initialValue={presetNameDialog?.value || ''}
      onCancel={() => setPresetNameDialog(null)}
      onConfirm={(name) => {
        setPresets(presetNameDialog?.mode === 'rename'
          ? renameFilterPreset(presetNameDialog.value, name)
          : saveFilterPreset({ name, query: filter.query, sortBy: filter.sortBy, order: filter.order }));
        setPresetNameDialog(null);
      }}
    />
    <ConfirmDialog
      open={!!presetDeleteTarget}
      title="删除筛选方案"
      message={presetDeleteTarget ? `将删除“${presetDeleteTarget}”。` : ''}
      confirmLabel="删除"
      cancelLabel="取消"
      onCancel={() => setPresetDeleteTarget('')}
      onConfirm={() => { setPresets(deleteFilterPreset(presetDeleteTarget)); setPresetDeleteTarget(''); }}
    />
    <ConfirmDialog
      open={!!historyDeleteTarget}
      title="确认删除阅读记录"
      message={historyDeleteTarget ? `将“${historyDeleteTarget.title}”从继续阅读中移除。再次阅读该档案时会重新加入历史记录。` : ''}
      confirmLabel="确认删除"
      cancelLabel="取消"
      onConfirm={handleRemoveHistory}
      onCancel={() => setHistoryDeleteTarget(null)}
    />
    <ConfigTransferDialog
      open={!!configTransfer}
      mode={configTransfer?.mode}
      initialValue={configTransfer?.value}
      onCancel={() => setConfigTransfer(null)}
      onConfirm={handleConfirmImportConfig}
    />
    <ConfigExportDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} />
    <ConfirmDialog
      open={!!configNotice}
      title={configNotice?.title || ''}
      message={configNotice?.message || ''}
      confirmLabel="重新加载"
      showCancel={false}
      destructive={false}
      initialFocusSelector="[data-dialog-confirm]"
      onCancel={() => {}}
      onConfirm={() => window.location.reload()}
    />
    </>
  );
}
