import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, useReducer } from 'react';
import { createPortal } from 'react-dom';
import { loadArchiveMetadataBatch, lrrApi } from '../lib/api';
import { getHistory, getHideRead, setHideRead, getCropCover, setCropCover, getArchiveBrowseMode, setArchiveBrowseMode, removeHistoryItem, loadHistoryState } from '../lib/history';
import { addWatchlistItem, getWatchlist, getWatchlistAutoRemoveIds, loadWatchlistState, mergeWatchlistProgress, removeWatchlistItem, removeWatchlistItems } from '../lib/watchlist';
import { loadTagDB, startTagDBUpdateTimer, stopTagDBUpdateTimer } from '../lib/tags';
import { getWorkerUrl, setWorkerUrl, getSyncToken, setSyncToken, exportConfig, importConfig, hasValidWorkerConfig } from '../lib/worker-config';
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
import SettingHint from '../components/SettingHint';
import { HomeSectionGlyph, ThemeModeGlyph, ToolbarGlyph, getSectionGlyphColor } from '../components/AppGlyphs';
import { deleteFilterPreset, readFilterPresets, renameFilterPreset, saveFilterPreset } from '../lib/filterPresets';
import { getCategoryDisplayName, getStoredCategories, loadCategories, setArchiveFavorite, sortCategoriesForDisplay, startCategoriesUpdateTimer, stopCategoriesUpdateTimer } from '../lib/categories';
import { claimColdRestoreRoute, consumeHomeNavigationSnapshot, getBootState, loadHomeSnapshot, markBackground, saveHomeNavigationSnapshot, saveHomeSnapshot } from '../lib/sessionState';
import { getStoredServerInfo, loadServerInfo } from '../lib/serverInfoCache';
import { useHorizontalScroller } from '../lib/horizontalScroller';
import { navigateDeduplicate, navigateHistory, navigateHome, navigateToMetadata, navigateUpload, navigateWatchlist } from '../lib/navigation';
import { ARCHIVE_BROWSE_MODES, ARCHIVE_PAGE_SIZE, clampArchivePage, getArchivePageAfterResize, getArchivePageCount, getArchivePageStart, getSmartArchivePageSize } from '../lib/archivePagination';
import { reduceArchiveRefreshPhase } from '../lib/archiveRefreshMotion';
import { ARCHIVE_PROGRESS_VISIBILITY, shouldShowArchiveProgress } from '../lib/archiveProgress';
import { clearConfiguredArchiveReadingProgress } from '../lib/archiveProgressActions';
import { subscribeReadingProgressChanged } from '../lib/readingProgress';
import { migrateLegacyStorageKey } from '../lib/configScope';
import { DEFAULT_READER_SETTINGS, READER_SETTINGS_KEY, normalizeReaderSettings } from '../lib/readerSettings';
import { getArchiveSearchTotal } from '../lib/archiveSearch';

const FILTER_KEY = 'lrr_filter';
const RANDOMS_RECENT_KEY = 'lrr_random_recent_v1';
const RANDOMS_BATCH_SIZE = 8;
const RANDOMS_DEFAULT_BATCHES = 2;
const RANDOMS_FILL_MAX_ITEMS = 24;
const RANDOMS_FETCH_ATTEMPTS = 3;
const RANDOMS_RECENT_LIMIT = 48;
const RANDOMS_REQUEST_TIMEOUT_MS = 6500;
const RANDOMS_RETRY_DELAY_MS = 350;
const ARCHIVES_SCROLL_KEY = 'lrr_scroll_archives_on_arrival';
const RANDOMS_REVALIDATE_STALE_MS = 10 * 60 * 1000;
const RANDOMS_RESTORE_GRACE_MS = 90 * 1000;
const RESUME_REFRESH_SUPPRESS_MS = 10 * 1000;
const FILTER_INPUT_MIN_WIDTH = 400;
const FILTER_ACTIONS_MIN_WIDTH = 320;
const FILTER_LAYOUT_GAP = 12;
const FILTER_STACK_BREAKPOINT = FILTER_INPUT_MIN_WIDTH + FILTER_ACTIONS_MIN_WIDTH + FILTER_LAYOUT_GAP;
const HOME_CAROUSEL_EXPANDED_HEIGHT = '420px';
const UNTAGGED_CATEGORY_ID = '__untagged__';
const UNTAGGED_CATEGORY = Object.freeze({ id: UNTAGGED_CATEGORY_ID, name: '无标签' });

function getHomeCarouselPadding(isNarrow) {
  return `12px ${isNarrow ? 14 : 20}px 20px`;
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
    <div style={{
      flexShrink: 0, minWidth: '150px', width: '150px',
      background: 'var(--surface-1)',
      borderRadius: '14px',
      border: '1px solid rgba(255,255,255,0.08)',
      display: 'flex', flexDirection: 'column', padding: '12px',
      overflow: 'hidden',
    }}>
      <div style={{
        width: '100%', height: '210px',
        borderRadius: '8px',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div className="shimmer-strip" style={{ position: 'absolute', inset: 0 }} />
      </div>
      {showProgress && (
        <div style={{ width: '100%', height: '3px', marginTop: '2px', borderRadius: '999px', background: 'rgba(74,159,240,0.22)' }} />
      )}
      <div style={{
        height: '12px', borderRadius: '4px',
        background: 'rgba(255,255,255,0.05)',
        width: '84%', marginTop: '12px',
      }} />
      <div style={{
        height: '12px', borderRadius: '4px',
        background: 'rgba(255,255,255,0.04)',
        width: '66%', marginTop: '8px',
      }} />
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: '10px',
      }}>
        <div style={{
          height: '8px', borderRadius: '4px',
          background: 'rgba(255,255,255,0.04)',
          width: '36%',
        }} />
        <div style={{
          height: '8px', borderRadius: '4px',
          background: 'rgba(255,255,255,0.04)',
          width: '30%',
        }} />
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
    <h2 style={{ fontSize: '18px', lineHeight: 1.2, margin: 0, display: 'flex', alignItems: 'center', gap: '10px', ...style }}>
      {onClick ? (
        <button
          type="button"
          className="section-heading-link"
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
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-sub)', opacity: 0.8, padding: '4px', borderRadius: '4px', display: 'flex' }}
    >
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" style={{ transition: 'transform 0.3s', transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
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

export default function Home({ onSelectArchive, onLogout, themeMode = 'auto', onThemeModeChange }) {
  const supportsAutomaticArchiveLoading = typeof IntersectionObserver !== 'undefined';
  const workerReady = hasValidWorkerConfig();
  const [navSnapshot] = useState(() => consumeHomeNavigationSnapshot());
  const [coldRestoreBoot] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('q')) return false;
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
    const snapshot = navSnapshot || (coldRestoreBoot ? loadHomeSnapshot() : null);
    if (!snapshot) return null;
    const cachedKey = `${snapshot.filter?.query || ''}|${snapshot.filter?.sortBy || DEFAULT_FILTER.sortBy}|${snapshot.filter?.order || DEFAULT_FILTER.order}|${!!snapshot.filter?.active}`;
    return cachedKey === snapshotFilterKey ? snapshot : null;
  })();
  const [history, setHistory] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [hideRead, setHideReadState] = useState(getHideRead);
  const [cropCover, setCropCoverState] = useState(getCropCover);
  const [archiveBrowseMode, setArchiveBrowseModeState] = useState(() => getArchiveBrowseMode());
  const [showConfig, setShowConfig] = useState(false);
  const [configTransfer, setConfigTransfer] = useState(null);
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

  const [cfgWorkerUrl, setCfgWorkerUrl] = useState(getWorkerUrl());
  const [cfgSyncToken, setCfgSyncToken] = useState(getSyncToken());
  const [readerSettings, setReaderSettings] = useState(readReaderSettings);
  const showHistoricalArchiveProgress = shouldShowArchiveProgress(readerSettings.progressBarVisibility, true);
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
  const [historyCollapsed, setHistoryCollapsed] = useState(() => !!homeSnapshot?.historyCollapsed);
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(() => !!homeSnapshot?.watchlistCollapsed);
  const [randomCollapsed, setRandomCollapsed] = useState(() => !!homeSnapshot?.randomCollapsed);
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
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 600);
  const [serverOnline, setServerOnline] = useState(null);
  const [serverProbeRunning, setServerProbeRunning] = useState(false);
  const [pageReady, setPageReady] = useState(() => !!homeSnapshot || coldRestoreBoot || !bootState.isFreshRuntime);
  const [randomsLoading, setRandomsLoading] = useState(() => {
    const ps = homeSnapshot;
    return !(ps && Array.isArray(ps.randoms) && ps.randoms.length > 0);
  });
  const [randomsRefreshing, setRandomsRefreshing] = useState(false);
  const [watchlistOverflow, setWatchlistOverflow] = useState(false);
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
    const check = () => setIsNarrow(window.innerWidth < 600);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const suggestActiveRef = useRef(false);
  const filterInputRef = useRef(null);
  const filterControlsRef = useRef(null);
  const historyScroller = useHorizontalScroller();
  const watchlistScroller = useHorizontalScroller();
  const randomScroller = useHorizontalScroller();
  const getHistoryScrollerNode = historyScroller.getNode;
  const getWatchlistScrollerNode = watchlistScroller.getNode;
  const getRandomScrollerNode = randomScroller.getNode;

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

  const handleSelectArchive = useCallback((archiveId) => {
    saveCurrentHomeForNavigation();
    onSelectArchive(archiveId);
  }, [onSelectArchive, saveCurrentHomeForNavigation]);

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
    setConfigTransfer({ mode: 'export', value: exportConfig() });
  };

  const handleImportConfig = async () => {
    let value = '';
    try { value = await navigator.clipboard.readText(); } catch {}
    setConfigTransfer({ mode: 'import', value });
  };

  const handleConfirmImportConfig = async (encoded) => {
    const count = importConfig(encoded);
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

  const watchlistWithProgress = useMemo(() => mergeWatchlistProgress(watchlist, history), [history, watchlist]);
  const watchlistAutoRemoveIds = useMemo(() => getWatchlistAutoRemoveIds(watchlistWithProgress), [watchlistWithProgress]);
  const watchlistIds = useMemo(() => new Set(watchlistWithProgress.map((item) => item.id || item.arcid).filter(Boolean)), [watchlistWithProgress]);

  useEffect(() => {
    if (watchlistAutoRemoveIds.length > 0) removeWatchlistItems(watchlistAutoRemoveIds).catch(() => {});
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
      alert(err.message || '下载失败');
    }
  }, []);

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
    setHistory(getHistory());
    return result;
  }, []);

  useEffect(() => subscribeReadingProgressChanged(({ archiveId, page }) => {
    const update = (items) => items.map((item) => (
      String(item?.arcid || item?.id || '') === archiveId ? { ...item, progress: page, page } : item
    ));
    setArchives(update);
    setRandoms(update);
    setWatchlist(update);
    setHistory(getHistory());
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
      removeWatchlistItem(deletedId).catch(() => {});
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
  }, [archiveDeleteSyncConfirmed, archiveDeleteTarget, deleteArchiveWithSync, removeDeletedArchiveIds, removeWatchlistItem]);

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
    (async () => {
      setHistory(getHistory());
      if (!coldRestoreRef.current) {
        loadHistoryState().then((state) => {
          setHistory(state.histories);
          setHideReadState(state.hideRead);
        }).catch(() => {
          setHistory(getHistory());
          setHideReadState(getHideRead());
        });
      }
    })();
  }, []);

  useEffect(() => {
    const refreshHistory = () => {
      setHistory(getHistory());
      setHideReadState(getHideRead());
    };
    window.addEventListener('lrr:history-changed', refreshHistory);
    return () => window.removeEventListener('lrr:history-changed', refreshHistory);
  }, []);

  useEffect(() => {
    setWatchlist(getWatchlist());
    if (!coldRestoreRef.current) {
      loadWatchlistState().then((state) => setWatchlist(state.items)).catch(() => setWatchlist(getWatchlist()));
    }
  }, []);

  useEffect(() => {
    const refreshWatchlist = () => setWatchlist(getWatchlist());
    window.addEventListener('lrr:watchlist-changed', refreshWatchlist);
    return () => window.removeEventListener('lrr:watchlist-changed', refreshWatchlist);
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
      const gridWidth = gridRef.current?.clientWidth || window.innerWidth - 32;
      const gap = window.innerWidth < 600 ? 10 : 16;
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
  }, [cropCover]);

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
      { rootMargin: '200px' },
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
    if (navigationRestoreRef.current && hasHydratedArchives) {
      didFetchArchivesRef.current = true;
      lastFetchedRef.current = Date.now();
      return;
    }
    const firstFetch = !didFetchArchivesRef.current;
    didFetchArchivesRef.current = true;
    doFetch(true, { force: firstFetch });
  }, [archiveBrowseMode, archivePage, archivePageSize, doFetch, filter.query, filter.sortBy, filter.order, filter.active, selectedCategory?.id]);

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
    exitColdRestoreMode();
    if (!append) randomsAutoFillBlockedRef.current = false;
    if (background && !silent) setRandomsRefreshing(true);
    else if (!background) setRandomsLoading(true);
    const currentIds = new Set(getRandomBatchIds(randomsRef.current));
    const recentIds = new Set(readRecentRandomIds());
    try {
      let bestBatch = [];
      let bestScore = Number.NEGATIVE_INFINITY;
      const requestCount = append ? RANDOMS_BATCH_SIZE : RANDOMS_BATCH_SIZE * RANDOMS_DEFAULT_BATCHES;

      for (let attempt = 0; attempt < RANDOMS_FETCH_ATTEMPTS; attempt += 1) {
        let batch = [];
        try {
          const res = await withAbortTimeout(
            (signal) => lrrApi.getRandom(requestCount, { signal }),
            RANDOMS_REQUEST_TIMEOUT_MS,
          );
          batch = Array.isArray(res?.data) ? res.data : [];
        } catch (e) {
          if (attempt >= RANDOMS_FETCH_ATTEMPTS - 1) throw e;
          await delay(RANDOMS_RETRY_DELAY_MS);
          continue;
        }
        const score = preferFresh ? scoreRandomBatch(batch, currentIds, recentIds) : attempt;

        if (score > bestScore) {
          bestBatch = batch;
          bestScore = score;
        }

        if (!preferFresh || score >= requestCount * 5) break;
      }

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
      console.error('随机推荐获取失败', e);
      if (randomsRef.current.length > 0) setRandoms(randomsRef.current);
      return 0;
    } finally {
      if (background && !silent) setRandomsRefreshing(false);
      else if (!background) setRandomsLoading(false);
    }
  }, [exitColdRestoreMode]);

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
      removeWatchlistItems(deletedIds).catch(() => {});
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
  }, [bulkDeleteSyncConfirmed, ehFavoriteDeleteSync, removeDeletedArchiveIds, removeWatchlistItems, selectedArchiveList, workerReady]);

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
    setShowPresets(false);
    dispatchArchiveRefresh('start');
    const refreshed = await doFetch(true, { background: true, force: true, clearSearchCache: true });
    if (!refreshed) {
      dispatchArchiveRefresh('fail');
      return;
    }
    dispatchArchiveRefresh('replace');
    requestAnimationFrame(() => dispatchArchiveRefresh('finish'));
  }, [doFetch]);

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
    applyFilter(filter.query, filter.sortBy, filter.order, selectedCategory);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (suggestActiveRef.current) return;
      handleSearch();
    }
  };

  const savePreset = () => setPresetNameDialog({ mode: 'create', value: '' });

  const loadPreset = (p) => {
    applyFilter(p.query, p.sortBy, p.order, selectedCategory);
    setShowPresets(false);
  };

  const filteredHistory = useMemo(() => {
    if (!hideRead) return history;
    return history.filter(h => !(h.total > 0 && h.page >= h.total));
  }, [history, hideRead]);

  const handleToggleHideRead = useCallback(() => {
    setHideReadState(v => {
      const next = !v;
      setHideRead(next).catch(() => {});
      return next;
    });
  }, []);

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
      setHistory(state.histories);
      setHideReadState(state.hideRead);
    } finally {
      setHistorySyncing(false);
    }
  }, [historySyncing, workerReady]);

  const handleCheckWatchlist = useCallback(async () => {
    if (watchlistChecking) return;
    setWatchlistChecking(true);
    try {
      await runHistoryExistenceCheck({ force: true });
      setHistory(getHistory());
      setWatchlist(getWatchlist());
    } finally {
      setWatchlistChecking(false);
    }
  }, [watchlistChecking]);

  const requestRemoveHistory = useCallback((archive) => {
    setHistoryDeleteTarget(archive);
  }, []);

  const removeHistoryArchive = useCallback((archive) => {
    const archiveId = archive?.id || archive?.arcid;
    if (!archiveId) return;
    removeHistoryItem(archiveId).catch(() => {});
    setHistory((prev) => prev.filter((item) => item.id !== archiveId));
    setHistoryDeleteTarget(null);
  }, []);

  const addWatchlistArchive = useCallback((archive) => {
    if (!archive?.arcid && !archive?.id) return;
    addWatchlistItem(archive).catch(() => {});
    setWatchlist(getWatchlist());
  }, []);

  const removeWatchlistArchive = useCallback((archive) => {
    const archiveId = archive?.id || archive?.arcid;
    if (!archiveId) return;
    removeWatchlistItem(archiveId).catch(() => {});
    setWatchlist((prev) => prev.filter((item) => (item.id || item.arcid) !== archiveId));
  }, []);

  const handleRemoveHistory = useCallback(() => {
    removeHistoryArchive(historyDeleteTarget);
  }, [historyDeleteTarget, removeHistoryArchive]);

  return (
    <>
    <style>{`
      @keyframes serverProbeRipple {
        0% { transform: scale(0.9); opacity: 0; }
        20% { opacity: 0.5; }
        100% { transform: scale(1.95); opacity: 0; }
      }
      .history-view-all-arrow {
        color: rgba(255,255,255,0.34);
        transform: translateY(0);
        transition: color 0.18s ease, transform 0.18s ease;
      }
      .history-view-all-btn:hover .history-view-all-arrow {
        color: var(--accent);
        transform: translateX(4px);
      }
      .section-heading-link {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
        transform-origin: left center;
        transition: transform 0.16s ease;
      }
      .section-heading-link:hover {
        transform: scale(1.04);
      }
      .section-heading-link:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 4px;
        border-radius: 4px;
      }
    `}</style>
    <div style={{ padding: isNarrow ? '16px 10px' : '24px 20px', maxWidth: '1680px', margin: '0 auto' }}>
      <div className="home-topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '18px', marginBottom: '32px', flexWrap: 'wrap' }}>
        <div className="home-brand">
          <h1 className="home-brand-title" translate="no" aria-label="Readoshi" style={{ fontWeight: 600, margin: '0 0 8px 0', fontSize: '28px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="home-brand-logo" aria-hidden="true" />
            <span className="home-project-name" aria-hidden="true">Readoshi</span>
            {serverOnline !== null && (
              <button
                type="button"
                onClick={() => probeServerStatus({ force: true })}
                aria-label="探测 LRR 服务器状态"
                title={serverProbeRunning ? '正在探测 LRR 服务器' : '点击重新探测 LRR 服务器'}
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '18px',
                  height: '18px',
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  cursor: serverProbeRunning ? 'wait' : 'pointer',
                  flexShrink: 0,
                }}
              >
                {serverProbeRunning && (
                  <>
                    <span style={{
                      position: 'absolute',
                      inset: '1px',
                      borderRadius: '50%',
                      border: `1px solid ${serverOnline ? 'rgba(76,175,80,0.30)' : 'rgba(244,67,54,0.30)'}`,
                      animation: 'serverProbeRipple 1.4s ease-out infinite',
                    }} />
                    <span style={{
                      position: 'absolute',
                      inset: '1px',
                      borderRadius: '50%',
                      border: `1px solid ${serverOnline ? 'rgba(76,175,80,0.22)' : 'rgba(244,67,54,0.22)'}`,
                      animation: 'serverProbeRipple 1.4s ease-out 0.42s infinite',
                    }} />
                  </>
                )}
                <span style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: serverOnline ? '#4caf50' : '#f44336',
                  boxShadow: serverOnline
                    ? '0 0 8px rgba(76,175,80,0.72)'
                    : '0 0 8px rgba(244,67,54,0.72)',
                  transition: 'background 0.3s ease, box-shadow 0.3s ease, transform 0.2s ease',
                  transform: serverProbeRunning ? 'scale(1.08)' : 'scale(1)',
                }} />
              </button>
            )}
          </h1>
          <div className="home-welcome" style={{ color: 'var(--text-sub)', fontSize: '14px' }}>
            <span>欢迎回来</span><span className="home-welcome-detail">，继续你的探索之旅</span>
          </div>
        </div>
        <div className="home-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            className="btn theme-mode-btn"
            type="button"
            onClick={onThemeModeChange}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            title={`切换主题，当前为${THEME_MODE_LABELS[themeMode] || THEME_MODE_LABELS.auto}`}
            aria-label={`当前主题：${THEME_MODE_LABELS[themeMode] || THEME_MODE_LABELS.auto}`}
          >
            <ThemeModeGlyph mode={themeMode} size={18} />
          </button>
          <button className="btn" onClick={() => {
            setCfgWorkerUrl(getWorkerUrl());
            setCfgSyncToken(getSyncToken());
            setReaderSettings(readReaderSettings());
            setShowConfig(true);
          }} style={{ fontSize: '13px' }}>设置</button>
          <button className="btn" onClick={onLogout} style={{ fontSize: '13px' }}>退出</button>
        </div>
      </div>

      {history.length > 0 && (
        <section className="glass-panel section-reveal section-reveal-delay-1" style={{ marginBottom: '32px', padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="home-carousel-header">
            <SectionHeading glyph="continue" onClick={handleNavigateHistory} title="查看全部历史记录">继续阅读</SectionHeading>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {workerReady && (
              <button
                type="button"
                className="btn"
                onClick={handleSyncHistory}
                disabled={historySyncing}
                style={{ padding: '6px 12px', fontSize: '12px' }}
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
          <div style={{ overflow: 'hidden', transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)', maxHeight: historyCollapsed ? '0px' : HOME_CAROUSEL_EXPANDED_HEIGHT }}>
            <div ref={historyScroller.ref} onWheelCapture={historyScroller.onWheelCapture} onScroll={historyScroller.onScroll} onMouseDown={historyScroller.onMouseDown} onClickCapture={historyScroller.onClickCapture} onDragStart={historyScroller.onDragStart} style={{ display: 'flex', gap: isNarrow ? '10px' : '16px', overflowX: 'auto', overflowY: 'hidden', padding: getHomeCarouselPadding(isNarrow), position: 'relative', zIndex: 1, ...historyScroller.getTouchScrollStyle(), ...historyScroller.getMouseScrollStyle() }} className="no-scrollbar">
              {filteredHistory.length > 0 ? (
                <>
                  {filteredHistory.slice(0, 10).map(h => (
                    <ArchiveCard key={`hist-${h.id}`} className={watchlistIds.has(h.id) ? 'watchlist-card' : undefined} archive={h} onClick={() => handleSelectArchive(h.id)} onArchiveContextMenu={(archive, point, event) => handleOpenArchiveMenu(archive, point, event, { showRemoveHistory: true })} longPressTitle="打开菜单" currentPage={h.page} showProgressBar={showHistoricalArchiveProgress} reserveProgressSpace={reserveGlobalProgressSpace} noCrop={!cropCover} cacheOnly={coldRestoreRef.current} />
                  ))}
                  {filteredHistory.length > 10 && (
                    <button
                      type="button"
                      onClick={handleNavigateHistory}
                      className="history-view-all-btn"
                      style={{
                        flexShrink: 0,
                        width: isNarrow ? '54px' : '68px',
                        minWidth: isNarrow ? '54px' : '68px',
                        height: '286px',
                        alignSelf: 'stretch',
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        boxShadow: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                      title="查看全部阅读历史"
                      aria-label="查看全部阅读历史"
                    >
                      <span className="history-view-all-arrow" aria-hidden="true" style={{ display: 'flex', alignItems: 'center' }}>
                        <svg viewBox="0 0 36 48" width="36" height="48" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 8l14 16L8 40" />
                          <path d="M18 8l14 16-14 16" />
                        </svg>
                      </span>
                    </button>
                  )}
                </>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--text-sub)', padding: '4px 0', whiteSpace: 'nowrap' }}>所有档案均已读完</div>
              )}
            </div>
          </div>
        </section>
      )}

      {!pageReady && history.length === 0 && (
        <section className="glass-panel section-reveal section-reveal-delay-1" style={{ marginBottom: '32px', padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="home-carousel-header">
            <SectionHeading glyph="continue">继续阅读</SectionHeading>
          </div>
          <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', overflowY: 'hidden', overscrollBehaviorX: 'contain', overscrollBehaviorY: 'contain', padding: isNarrow ? '8px 14px 16px' : '8px 20px 16px', position: 'relative', zIndex: 1 }} className="no-scrollbar">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={`hsk-${i}`} showProgress={showHistoricalArchiveProgress} />
            ))}
          </div>
        </section>
      )}

      {watchlist.length > 0 && (
        <section className="glass-panel section-reveal section-reveal-delay-1" style={{ marginBottom: '32px', padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="home-carousel-header">
            <SectionHeading glyph="watchlist" onClick={handleNavigateWatchlist} title="查看全部待看档案">待看档案</SectionHeading>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="btn"
                onClick={handleCheckWatchlist}
                disabled={watchlistChecking}
                style={{ padding: '6px 12px', fontSize: '12px', opacity: watchlistChecking ? 0.72 : 1 }}
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
          <div style={{ overflow: 'hidden', transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)', maxHeight: watchlistCollapsed ? '0px' : HOME_CAROUSEL_EXPANDED_HEIGHT }}>
            <div ref={watchlistScroller.ref} onWheelCapture={watchlistScroller.onWheelCapture} onScroll={watchlistScroller.onScroll} onMouseDown={watchlistScroller.onMouseDown} onClickCapture={watchlistScroller.onClickCapture} onDragStart={watchlistScroller.onDragStart} style={{ display: 'flex', gap: isNarrow ? '10px' : '16px', overflowX: 'auto', overflowY: 'hidden', padding: getHomeCarouselPadding(isNarrow), position: 'relative', zIndex: 1, ...watchlistScroller.getTouchScrollStyle(), ...watchlistScroller.getMouseScrollStyle() }} className="no-scrollbar">
              {watchlistWithProgress.map(item => (
                <ArchiveCard key={`watch-${item.id || item.arcid}`} archive={item} onClick={() => handleSelectArchive(item.id || item.arcid)} onArchiveContextMenu={(archive, point, event) => handleOpenArchiveMenu(archive, point, event, { showRemoveWatchlist: true })} longPressTitle="打开菜单" currentPage={item.page} showProgressBar={showHistoricalArchiveProgress} reserveProgressSpace={reserveGlobalProgressSpace} noCrop={!cropCover} cacheOnly={coldRestoreRef.current} />
              ))}
              {watchlistOverflow && (
                <button
                  type="button"
                  onClick={handleNavigateWatchlist}
                  className="history-view-all-btn"
                  style={{
                    flexShrink: 0,
                    width: isNarrow ? '54px' : '68px',
                    minWidth: isNarrow ? '54px' : '68px',
                    height: '286px',
                    alignSelf: 'stretch',
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    boxShadow: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                  title="查看全部待看档案"
                  aria-label="查看全部待看档案"
                >
                  <span className="history-view-all-arrow" aria-hidden="true" style={{ display: 'flex', alignItems: 'center' }}>
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
        <section className="glass-panel section-reveal section-reveal-delay-2" style={{ marginBottom: '40px', padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="home-carousel-header">
            <SectionHeading glyph="random">随机漫游</SectionHeading>
            <button className="btn" onClick={() => fetchRandoms({ preferFresh: true })} disabled={randomsRefreshing} style={{ padding: '6px 14px', fontSize: '12px', opacity: randomsRefreshing ? 0.72 : 1 }}>刷新</button>
          </div>
          <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', overflowY: 'hidden', overscrollBehaviorX: 'contain', overscrollBehaviorY: 'contain', padding: isNarrow ? '8px 14px 16px' : '8px 20px 16px', position: 'relative', zIndex: 1 }} className="no-scrollbar">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={`rsk-${i}`} showProgress={showGlobalArchiveProgress} />
            ))}
          </div>
        </section>
      ) : randoms.length > 0 ? (
        <section className="glass-panel section-reveal section-reveal-delay-2" style={{ marginBottom: '40px', padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="home-carousel-header">
            <SectionHeading glyph="random">随机漫游</SectionHeading>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button className="btn" onClick={() => fetchRandoms({ preferFresh: true })} disabled={randomsRefreshing} style={{ padding: '6px 14px', fontSize: '12px', opacity: randomsRefreshing ? 0.72 : 1 }}>刷新</button>
              <CollapseButton
                collapsed={randomCollapsed}
                onClick={() => setRandomCollapsed(v => !v)}
                title={randomCollapsed ? '展开随机漫游' : '收起随机漫游'}
              />
            </div>
          </div>
          <div style={{ overflow: 'hidden', transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)', maxHeight: randomCollapsed ? '0px' : HOME_CAROUSEL_EXPANDED_HEIGHT }}>
            <div ref={randomScroller.ref} onWheelCapture={randomScroller.onWheelCapture} onScroll={randomScroller.onScroll} onMouseDown={randomScroller.onMouseDown} onClickCapture={randomScroller.onClickCapture} onDragStart={randomScroller.onDragStart} style={{ display: 'flex', gap: isNarrow ? '10px' : '16px', overflowX: 'auto', overflowY: 'hidden', padding: getHomeCarouselPadding(isNarrow), position: 'relative', zIndex: 1, ...randomScroller.getTouchScrollStyle(), ...randomScroller.getMouseScrollStyle() }} className="no-scrollbar">
              {randomsRefreshing ? Array.from({ length: Math.max(5, Math.min(8, randoms.length || 5)) }).map((_, i) => (
                <SkeletonCard key={`rrsk-${i}`} showProgress={showGlobalArchiveProgress} />
              )) : randoms.map(arc => (
                <ArchiveCard key={`rnd-${arc.arcid}`} className={watchlistIds.has(arc.arcid || arc.id) ? 'watchlist-card' : undefined} archive={arc} onClick={() => handleSelectArchive(arc.arcid)} onArchiveContextMenu={handleOpenArchiveMenu} showProgressBar={showGlobalArchiveProgress} reserveProgressSpace={reserveGlobalProgressSpace} noCrop={!cropCover} cacheOnly={coldRestoreRef.current} />
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className="glass-panel section-reveal section-reveal-delay-2" style={{ marginBottom: '40px', padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="home-carousel-header">
            <SectionHeading glyph="random">随机漫游</SectionHeading>
            <button className="btn" onClick={() => fetchRandoms({ preferFresh: true })} disabled={randomsRefreshing} style={{ padding: '6px 14px', fontSize: '12px', opacity: randomsRefreshing ? 0.72 : 1 }}>{randomsRefreshing ? '刷新中' : '刷新'}</button>
          </div>
          <div style={{ padding: isNarrow ? '10px 14px 18px' : '10px 20px 20px', color: 'var(--text-sub)', fontSize: '13px' }}>
            暂无随机漫游结果
          </div>
        </section>
      )}

      <section ref={archivesSectionRef} className="glass-panel section-reveal section-reveal-delay-3" style={{ padding: isNarrow ? '20px 14px' : '24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
          <div className="archive-toolbar-primary" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <div className="archive-toolbar-summary" style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <SectionHeading glyph="archives" style={{ lineHeight: 1 }}>全部档案</SectionHeading>
              <span className="archive-count-badge">
                {archiveCountLabel}
              </span>
            </div>
            <div className="archive-toolbar-actions" style={{ display: 'flex', gap: isNarrow ? '4px' : '8px', flexShrink: 0, alignItems: 'center', justifyContent: 'flex-end' }}>
              <button
                className="btn"
                style={{ padding: '6px 12px', fontSize: '12px' }}
                onClick={toggleArchiveSelectionMode}
                disabled={archiveDeleting}
              >
                {archiveSelectionMode ? '取消多选' : '多选'}
              </button>
              <button
                className="btn"
                style={{ padding: '6px 12px', fontSize: '12px', opacity: archivesRefreshing ? 0.72 : 1 }}
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
              <button className="btn archive-selection-primary" tabIndex={archiveSelectionMode ? 0 : -1} style={{ padding: '6px 12px', fontSize: '12px' }} onClick={toggleSelectAllVisibleArchives} disabled={visibleArchiveIds.length === 0 || archiveDeleting}>
                {allVisibleSelected ? '取消全选' : '全选当前'}
              </button>
              <button className="btn" tabIndex={archiveSelectionMode ? 0 : -1} style={{ padding: '6px 12px', fontSize: '12px' }} onClick={handleBulkArchiveFavorite} disabled={selectedArchiveIds.size === 0 || archiveDeleting || bulkFavoriteRunning}>
                {bulkFavoriteRunning ? '收藏中…' : '收藏所选'}
              </button>
              <button className="btn archive-selection-delete" tabIndex={archiveSelectionMode ? 0 : -1} onClick={requestBulkArchiveDelete} disabled={selectedArchiveIds.size === 0 || archiveDeleting}>
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
                className="input-glass"
                style={{ width: '100%', boxSizing: 'border-box', paddingRight: filter.query ? '66px' : '38px' }}
                placeholder={filter.active ? `筛选: ${filter.query}` : '搜索标签或标题... 按回车筛选'}
                value={filter.query}
                onChange={(e) => {
                  if (showPresets) setShowPresets(false);
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
                  className="input-clear-btn"
                  onClick={() => clearFilter()}
                  style={{
                    position: 'absolute', right: '36px', top: '0', bottom: '0',
                    display: 'flex', alignItems: 'center',
                  }}
                  title="清除筛选"
                >✕</button>
              )}
              <button
                type="button"
                className="input-clear-btn"
                onClick={() => {
                  suggestActiveRef.current = false;
                  setShowPresets(v => !v);
                }}
                style={{
                  position: 'absolute', right: '8px', top: '0', bottom: '0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '24px',
                }}
                title={showPresets ? '关闭筛选预设' : '打开筛选预设'}
                aria-label="筛选预设"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style={{ transition: 'transform 0.2s ease', transform: showPresets ? 'rotate(180deg)' : 'rotate(0deg)' }}>
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
                <div className="archive-search-presets dropdown-animate">
                  <div className="archive-search-preset-heading">
                    <span>已保存的筛选方案</span>
                    <button className="btn" onClick={savePreset}>
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
                            className="archive-search-preset-apply"
                            onClick={() => loadPreset(p)}
                            title={`${p.query} / ${p.sortBy} / ${p.order}`}
                          >
                            {p.name}
                          </button>
                          <button
                            type="button"
                            className="archive-search-preset-edit"
                            onClick={() => setEditingPreset(current => current === p.name ? '' : p.name)}
                            aria-label={`编辑 ${p.name}`}
                            aria-expanded={editingPreset === p.name}
                          >
                            <ToolbarGlyph name="edit" size={16} />
                          </button>
                          {editingPreset === p.name && <div className="archive-search-preset-actions dropdown-animate">
                            <button type="button" onClick={() => { setPresetNameDialog({ mode: 'rename', value: p.name }); setEditingPreset(''); }}>重命名</button>
                            <button type="button" className="is-danger" onClick={() => { setPresetDeleteTarget(p.name); setEditingPreset(''); }}>删除</button>
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
              <button className="btn" style={{ padding: '8px 18px', fontSize: '13px', whiteSpace: 'nowrap', flexShrink: 0 }} onClick={handleSearch}>
                筛选
              </button>
            </div>
          </div>
        </div>

        <div className="archive-category-list" style={{ display: 'flex', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center', justifyContent: 'center' }}>
          {displayCategories.map(cat => {
            const isActive = selectedCategory?.id === cat.id;
            const label = getCategoryDisplayName(cat);
            return (
              <button
                key={cat.id}
                className="btn archive-category-button"
                onClick={() => handleCategoryClick(cat)}
                style={{
                  fontWeight: isActive ? 600 : 400,
                  borderRadius: '18px',
                  ...(isActive ? {
                    background: 'var(--accent)',
                    borderColor: 'var(--accent)',
                    color: 'white',
                    transform: 'translateY(-2px)',
                  } : {}),
                }}
                title={label}
              >
                {label.length > 12 ? label.slice(0, 12) + '...' : label}
              </button>
            );
          })}
          {(() => {
            const isActive = selectedCategory?.id === UNTAGGED_CATEGORY_ID;
            return (
              <button
                key={UNTAGGED_CATEGORY_ID}
                className="btn archive-category-button"
              onClick={() => handleCategoryClick(UNTAGGED_CATEGORY)}
                style={{
                  fontWeight: isActive ? 600 : 400,
                  borderRadius: '18px',
                  ...(isActive ? {
                    background: 'var(--accent)',
                    borderColor: 'var(--accent)',
                    color: 'white',
                    transform: 'translateY(-2px)',
                  } : {}),
                }}
                title="无标签"
              >
                无标签
              </button>
            );
          })()}
        </div>

        <ArchiveGrid ref={gridRef} className={archiveBrowseMode === ARCHIVE_BROWSE_MODES.paged ? 'is-paged' : ''} data-refresh-phase={archiveRefreshPhase} aria-busy={archivesRefreshing} style={{ gap: isNarrow ? '10px' : '16px' }}>
          {archives.length === 0 && loading ? (
            Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={`gsk-${i}`} showProgress={showGlobalArchiveProgress} />)
          ) : (
            displayArchives.map((arc) => (
              <ArchiveCard key={arc.arcid || arc.id} className={watchlistIds.has(arc.arcid || arc.id) ? 'watchlist-card' : undefined} archive={arc} onClick={() => handleSelectArchive(arc.arcid)} onArchiveContextMenu={handleOpenArchiveMenu} showProgressBar={showGlobalArchiveProgress} reserveProgressSpace={reserveGlobalProgressSpace} noCrop={!cropCover} cacheOnly={coldRestoreRef.current} selectionMode={archiveSelectionMode} selected={selectedArchiveIds.has(arc.arcid || arc.id)} onSelectToggle={toggleArchiveSelection} />
            ))
          )}
        </ArchiveGrid>

        {archives.length === 0 && !loading && (
          <div role={archiveLoadError ? 'alert' : 'status'} aria-live="polite" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-sub)', fontSize: '14px' }}>
            {archiveLoadError || (selectedCategory?.id === UNTAGGED_CATEGORY_ID ? '没有无标签档案' : (filter.active ? '没有匹配的档案，请尝试其他筛选条件' : '仓库为空，请先在 LANraragi 中添加档案'))}
          </div>
        )}

        {archiveLoadError && archives.length > 0 && (
          <div role="alert" aria-live="polite" style={{ textAlign: 'center', padding: '12px', color: 'var(--text-sub)', fontSize: '14px' }}>
            {archiveLoadError}
          </div>
        )}

        <div ref={sentinelRef} style={{ height: '1px' }} />

        <div style={{ textAlign: 'center', marginTop: '36px', paddingBottom: '12px' }}>
          {archiveBrowseMode === ARCHIVE_BROWSE_MODES.paged ? (
            <div className="archive-pagination-controls">
              <button className="btn" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={() => goArchivePage(archivePage - 1)} disabled={!canGoPrevArchivePage}>上一页</button>
              <span className="archive-pagination-jump">
                第
                <input
                  className="input-glass no-spinner"
                  type="text"
                  inputMode="numeric"
                  value={archivePageInput}
                  onChange={(event) => setArchivePageInput(event.target.value.replace(/[^\d]/g, ''))}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !archiveRequestBusy) submitArchivePageInput(); }}
                  disabled={archiveRequestBusy}
                />
                页
                {Number.isFinite(archiveTotal) && <span className="archive-pagination-total">/ {archivePageCount}</span>}
              </span>
              <button className="btn" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={submitArchivePageInput} disabled={archiveRequestBusy}>跳转</button>
              <button className="btn" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={() => goArchivePage(archivePage + 1)} disabled={!canGoNextArchivePage}>下一页</button>
            </div>
          ) : hasMore ? (
            supportsAutomaticArchiveLoading ? (
              loading || archivesRefreshing ? (
                <div style={{ color: 'var(--text-sub)' }}>加载中...</div>
              ) : null
            ) : (
              <button className="btn" style={{ padding: '10px 40px' }} onClick={() => doFetch(false)} disabled={loading || archivesRefreshing}>
                {loading ? '加载中...' : '加载更多'}
              </button>
            )
          ) : (archives.length > 0 && (
            <div style={{ color: 'var(--text-sub)' }}>— 已经到底啦 —</div>
          ))}
        </div>
      </section>
    </div>
    {showConfig && createPortal(
      <div className="settings-overlay" onClick={() => setShowConfig(false)} style={{
        position: 'fixed', inset: 0, zIndex: 100000,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <form className="glass-panel settings-panel" onClick={e => e.stopPropagation()} onSubmit={(e) => {
          e.preventDefault();
          setWorkerUrl(cfgWorkerUrl);
          setSyncToken(cfgSyncToken);
          setShowConfig(false);
        }} style={{
          padding: 0, display: 'flex', flexDirection: 'column', gap: 0,
          overflow: 'hidden',
        }}>
          <div className="settings-panel-header" style={{ textAlign: 'center', padding: '28px 28px 12px' }}>
            <h2 className="settings-title">设置</h2>
          </div>

          <div className="settings-panel-scroll">

          <div className="settings-section">
            <div className="settings-section-title">通用设置</div>
            <div className="settings-subgroup">
              <div className="settings-subgroup-title">缓存</div>
              <CacheSettings />
            </div>
            <div className="settings-subgroup">
              <div className="settings-subgroup-title">档案显示</div>
          <div className="settings-row">
            <SettingHint text={'作用：将横版或方形封面裁成统一的竖向比例。\n影响：只改变书库缩略图，不修改档案原图。'}>裁剪封面</SettingHint>
            <div className="settings-control settings-toggle-control"><ToggleSwitch checked={cropCover} onChange={handleToggleCropCover} label="裁剪封面" /></div>
          </div>

          <label className="settings-row">
            <SettingHint text={'禁止：所有档案卡片都不显示阅读进度。\n仅历史记录：保持历史与待看组件中的进度提示。\n全局：有阅读进度的档案卡片均会显示。'}>显示进度条</SettingHint>
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
            <div className="settings-subgroup">
              <div className="settings-subgroup-title">浏览与记录</div>

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
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">E-Hentai 评论区</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label className="settings-row">
                <SettingHint text={'作用：在阅读器中显示来源画廊的评论。\n条件：必须填写能访问该画廊的 E-Hentai Cookie。'}>启用 E-Hentai 评论区</SettingHint>
                <ToggleSwitch checked={readerSettings.ehEnabled} onChange={() => updateReaderSettings((s) => ({ ...s, ehEnabled: !s.ehEnabled }))} label="启用 E-Hentai 评论区" />
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <SettingHint className="settings-field-label" text={'作用：访问 E-Hentai 画廊和评论。\n条件：同步删除收藏还需要 ipb_member_id 与 ipb_pass_hash。'}>E-Hentai Cookie</SettingHint>
                <span className="secret-input-shell" data-secret={readerSettings.ehCookie || ''}>
                  <input type="text" name="e-hentai-cookie" autoComplete="off" spellCheck={false} aria-label="E-Hentai Cookie" className="input-glass secret-input"
                    value={readerSettings.ehCookie || ''}
                    onChange={(e) => updateReaderSettings((s) => ({ ...s, ehCookie: e.target.value }))}
                    placeholder="igneous=…; ipb_member_id=…; ipb_pass_hash=…"
                    style={{ padding: '8px 10px', fontSize: '12px', width: '100%', boxSizing: 'border-box' }}
                  />
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: '12px',
                  maxHeight: readerSettings.ehEnabled ? '220px' : '0px',
                  opacity: readerSettings.ehEnabled ? 1 : 0,
                  overflow: readerSettings.ehEnabled ? 'visible' : 'hidden',
                  transform: readerSettings.ehEnabled ? 'none' : 'translateY(-6px)',
                  transition: 'max-height 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease, transform 0.28s cubic-bezier(0.4,0,0.2,1)',
                  pointerEvents: readerSettings.ehEnabled ? 'auto' : 'none',
                }}
                aria-hidden={!readerSettings.ehEnabled}
              >
                  <label className="settings-row">
                    <SettingHint text={'作用：隐藏低于此分数的评论。\n填 0：显示全部评论，不按分数过滤。'}>最低展示分数</SettingHint>
                    <input type="text" inputMode="numeric" pattern="-?[0-9]*" className="input-glass no-spinner"
                      value={String(readerSettings.ehMinScore)}
                      onChange={(e) => { const v = e.target.value; const n = parseInt(v, 10); if (!isNaN(n) && n >= -999) updateReaderSettings((s) => ({ ...s, ehMinScore: n })); else if (v === '' || v === '-') updateReaderSettings((s) => ({ ...s, ehMinScore: 0 })); }}
                      onBlur={() => { const n = parseInt(readerSettings.ehMinScore, 10); if (isNaN(n)) updateReaderSettings((s) => ({ ...s, ehMinScore: 0 })); }}
                      style={{ width: '52px', padding: '5px 6px', fontSize: '12px', textAlign: 'center' }}
                    />
                  </label>
                  <label className="settings-row">
                    <SettingHint text={'作用：限制每个档案加载的评论数量。\n范围：1–200 条。'}>最多展示数量</SettingHint>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" className="input-glass no-spinner"
                      value={String(readerSettings.ehMaxComments)}
                      onChange={(e) => { const v = e.target.value; const n = parseInt(v, 10); if (!isNaN(n) && n >= 1 && n <= 200) updateReaderSettings((s) => ({ ...s, ehMaxComments: n })); }}
                      onBlur={() => { const n = parseInt(readerSettings.ehMaxComments, 10); if (isNaN(n) || n < 1) updateReaderSettings((s) => ({ ...s, ehMaxComments: 45 })); else if (n > 200) updateReaderSettings((s) => ({ ...s, ehMaxComments: 200 })); }}
                      style={{ width: '52px', padding: '5px 6px', fontSize: '12px', textAlign: 'center' }}
                    />
                  </label>
                  <label className="settings-row">
                    <SettingHint text={'按分数：根据评论评分排序。\n按时间：根据评论发布时间排序。'}>排序方式</SettingHint>
                    <div style={{ width: '110px', flexShrink: 0 }}>
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
                    <div style={{ width: '110px', flexShrink: 0 }}>
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

          {workerReady && <div className="settings-row">
            <SettingHint text={ehFavoriteSyncReady ? '作用：删除档案时，同时移除 source 指向的 E-Hentai 收藏。\n控制：仍可在每次删除确认时单独取消同步。' : '当前不可用。\n条件：配置 Worker、访问 Token，并提供含 ipb_member_id 与 ipb_pass_hash 的 E-Hentai Cookie。'}>同步删除 E-Hentai 收藏夹</SettingHint>
            <ToggleSwitch checked={ehFavoriteDeleteSync && ehFavoriteSyncReady} onChange={handleToggleEhFavoriteDeleteSync} disabled={!ehFavoriteSyncReady} label="同步删除 E-Hentai 收藏夹" />
          </div>}

          <div className="settings-section">
            <div className="settings-section-title">Worker 设置</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <SettingHint className="settings-field-label" text={'作用：启用多设备阅读历史、待看列表和收藏删除同步。\n条件：Worker 端点必须是可访问的 HTTPS 地址。'}>Cloudflare Worker 端点</SettingHint>
                <input type="url" inputMode="url" name="worker-url" autoComplete="off" spellCheck={false} aria-label="Cloudflare Worker 端点" className="input-glass"
                  value={cfgWorkerUrl}
                  onChange={(e) => setCfgWorkerUrl(e.target.value)}
                  placeholder="https://lrr-sync.example.workers.dev"
                  style={{ padding: '8px 12px', fontSize: '13px' }}
                />
              </div>

              <div>
                <SettingHint className="settings-field-label" text={'作用：识别同一同步账户；使用相同 Token 的设备会共享数据。\n条件：先将 Token 写入 Worker KV 的 tokens 字段。'}>访问 Token</SettingHint>
                <span className="secret-input-shell" data-secret={cfgSyncToken}>
                  <input type="text" name="sync-token" autoComplete="off" spellCheck={false} aria-label="访问 Token" className="input-glass secret-input"
                    value={cfgSyncToken}
                    onChange={(e) => setCfgSyncToken(e.target.value)}
                    placeholder="需与 KV 空间 tokens 字段中的 Token 保持一致"
                    style={{ padding: '8px 12px', fontSize: '13px' }}
                  />
                </span>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">工具</div>
            <div className="settings-tool-grid">
              <button type="button" className="btn" onClick={handleNavigateUpload} style={{ width: '100%', padding: '10px', fontSize: '13px' }}>上传档案</button>
              <button type="button" className="btn" onClick={handleNavigateDeduplicate} style={{ width: '100%', padding: '10px', fontSize: '13px' }}>重复档案检测</button>
            </div>
            <div style={{ borderTop: '1px solid var(--glass-border)', marginTop: '14px' }} />
          </div>

          </div>

          <div className="settings-panel-footer">
            <div className="settings-panel-actions">
              <button type="button" className="btn"
                onClick={handleExportConfig}
                style={{ padding: '9px', fontSize: '12px' }}>
                导出配置
              </button>
              <button type="button" className="btn"
                onClick={handleImportConfig}
                style={{ padding: '9px', fontSize: '12px' }}>
                导入配置
              </button>
            </div>

            <div className="settings-panel-actions">
              <button type="button" className="btn" onClick={() => setShowConfig(false)} style={{ padding: '10px' }}>
                取消
              </button>
              <button type="submit" className="btn" style={{ padding: '10px' }}>
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
      onRead={(archive) => handleSelectArchive(archive.arcid || archive.id)}
      onClearProgress={handleClearArchiveProgress}
      onEditMetadata={(archive) => { saveCurrentHomeForNavigation(); navigateToMetadata(archive.arcid || archive.id); }}
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
