import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { encodeApiKey, lrrApi } from '../lib/api';
import { flushHistorySync, getHistory, saveHistory, getHideRead, removeHistoryItem, loadHistoryState } from '../lib/history';
import { clampProgressPage } from '../lib/historyProgressCache';
import { getWatchlist, loadWatchlistState, mergeWatchlistProgress, removeWatchlistItem } from '../lib/watchlist';
import { getReaderArchiveListMeta } from '../lib/readerArchiveList';
import { isArchiveMissingError } from '../lib/historyMaintenance';
import { translateTag, categorizeTags } from '../lib/tags';
import { getCachedImage, getImage, primeImage, deleteImageKeys, IMAGE_LOAD_PRIORITY } from '../lib/imageCache';
import { createImageDecodeQueue } from '../lib/imageLoadQueue';
import { decodeImageSource, getReaderPreviewSource } from '../lib/readerPreviewDecode';
import { DEFAULT_READER_SETTINGS, READER_SETTINGS_KEY, normalizeReaderSettings, prepareReaderSettingsForArchiveChange } from '../lib/readerSettings';
import { SUPER_RESOLUTION_MODELS, detectSuperResolutionSupport } from '../lib/superResolution';
import {
  clearArchiveProgressMarker,
  getArchiveProgressPercent,
  hasArchiveProgressMarker,
  hasArchiveReadingProgress,
  shouldPersistArchiveReadingProgress,
  shouldShowArchiveProgress,
} from '../lib/archiveProgress';
import { clearConfiguredArchiveReadingProgress } from '../lib/archiveProgressActions';
import { rememberArchiveProgressInCatalog } from '../lib/archiveMetadataCache';
import { getReaderSkeletonToolbarGroups } from '../lib/readerSkeletonLayout';
import { createReaderRenderState, getReaderCapabilities, loadReaderBootstrapResource, readerRenderReducer } from '../lib/readerRenderPipeline';
import {
  getReaderArchivePanelModel,
  getReaderArchivePanelWindow,
  getCenteredToolbarTitleWidth,
  getDrawerRowStride,
  getContentLanguage,
  isIosWebKitPlatform,
  isReaderMobileViewport,
  resolvePageIndicatorPlacement,
  resolveReaderToolbarMode,
} from '../lib/readerUiState';
import { computeContainedImageRect } from '../lib/pageIndicatorLayout';
import { classifyWebtoonSeams, compareSeamPixels, sampleImageSeam } from '../lib/webtoonDetector';
import { detectImageBorderInsets } from '../lib/readerImageTransform';
import { getWorkerUrl, getSyncToken, hasValidWorkerConfig } from '../lib/worker-config';
import { getBootState, markBackground, loadReaderSnapshot, saveReaderSnapshot } from '../lib/sessionState';
import { getStoredServerInfo, loadServerInfo } from '../lib/serverInfoCache';
import { navigateHistory, navigateHome, navigateToArchive, navigateToMetadata, navigateWatchlist, parseRouteFromLocation } from '../lib/navigation';
import { filterRandomArchives, getRandomHideRead } from '../lib/randomArchiveFilter';
import Recommendations from '../components/Recommendations';
import EhComments from '../components/EhComments';
import ConfirmDialog from '../components/ConfirmDialog';
import SettingHint from '../components/SettingHint';
import CustomSelect from '../components/CustomSelect';
import ToggleSwitch from '../components/ToggleSwitch';
import { HomeSectionGlyph, NamespaceGlyph, stripDecoratedLabel, ToolbarGlyph } from '../components/AppGlyphs';
import ArchivePageThumbnail from '../components/ArchivePageThumbnail';
import { acquireBodyScrollLock } from '../lib/bodyScrollLock';
import {
  buildReaderSpreads,
  classifyMangaPageSizes,
  findSpreadIndex,
  getContainedHalfFrame,
  getAdjacentSpreadLocation,
  getSpreadProgressPage,
  getImmersiveSpreadGeometry,
  getPendingSpreadRenderState,
  getReaderDecodeWindow,
  hasWebtoonTag,
  isWidePageSize,
  resolveAutoReadingLayout,
} from '../lib/readerLayout';

const readerImageDecodeQueue = createImageDecodeQueue({ maxConcurrent: 3 });

// Pre-generate the scaled preview for an adjacent page while the decode queue
// is idle. The page blob comes from the shared fetch queue (key-deduped with
// primePageBlob), and the produced preview lands in previewCache so a later
// flip only decodes the small image instead of the full original + webp encode.
async function primePagePreview(pageUrl, { enabled = true, sourceSize, priority = IMAGE_LOAD_PRIORITY.PRELOAD } = {}) {
  if (!pageUrl || !enabled || typeof createImageBitmap !== 'function') return;
  const src = await resolvePageImageSource(pageUrl, {
    cacheOnly: false,
    allowNetworkFallback: true,
    priority,
  });
  if (!src) return;
  const { promise } = readerImageDecodeQueue.schedule(`preview:${pageUrl}`, async (signal) => {
    await getReaderPreviewSource(src, {
      enabled,
      fullPrecision: false,
      sourceSize,
      signal,
    });
  }, IMAGE_LOAD_PRIORITY.PRELOAD);
  await promise.catch(() => {});
}

// ===== Authenticated Image Component =====
const getConfiguredServerUrl = () => {
  try {
    return (localStorage.getItem('lrr_server_url') || '').replace(/\/$/, '');
  } catch {
    return '';
  }
};

const isLanraragiAssetPath = (pathname) => (
  pathname.startsWith('/api/') ||
  pathname.startsWith('/reader/') ||
  pathname.startsWith('/download/')
);

const archiveHasNewMarker = (archive) => {
  const marker = archive?.isnew ?? archive?.is_new ?? archive?.isNew ?? archive?.new;
  if (marker === true || marker === 1) return true;
  return ['1', 'true', 'new'].includes(String(marker ?? '').trim().toLowerCase());
};

const clearArchiveNewMarker = (archive) => ({
  ...archive,
  isnew: false,
  is_new: false,
  isNew: false,
  new: false,
});

const toLocalUrl = (url) => {
  if (!url) return url;
  const serverUrl = getConfiguredServerUrl();
  try {
    const parsed = new URL(url, window.location.origin);
    if (serverUrl && parsed.origin === window.location.origin && isLanraragiAssetPath(parsed.pathname)) {
      return `${serverUrl}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    if (import.meta.env.DEV && parsed.origin === window.location.origin) {
      return parsed.pathname + parsed.search + parsed.hash;
    }
    return parsed.href;
  } catch {
    if (serverUrl && url.startsWith('/')) return `${serverUrl}${url}`;
    return url;
  }
};

async function resolvePageImageSource(pageUrl, {
  cacheOnly = false,
  allowNetworkFallback = true,
  priority = IMAGE_LOAD_PRIORITY.NORMAL,
  onNetworkStart,
} = {}) {
  if (!pageUrl) return null;
  const normalized = toLocalUrl(pageUrl);
  const key = localStorage.getItem('lrr_api_key') || '';
  if (cacheOnly && !allowNetworkFallback) {
    return getCachedImage(normalized);
  }
  return getImage(normalized, async (signal) => {
    const headers = {};
    if (key) headers.Authorization = `Bearer ${encodeApiKey(key)}`;
    onNetworkStart?.();
    const res = await fetch(normalized, { headers, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  }, { priority });
}

const DRAWER_COLUMNS = 3;
const DRAWER_GAP = 12;
const DRAWER_OVERSCAN_ROWS = 4;
const DRAWER_TRANSITION_MS = 300;
const IMMERSIVE_TOUCH_ACTIVATION_GUARD_MS = 500;
const READER_OVERLAY_SCROLL_SELECTOR = '[data-reader-overlay-scroll], [data-select-dropdown="true"]';
const PageImage = React.forwardRef(({
  pageUrl,
  pageIndex,
  style,
  className,
  isImmersive,
  cacheOnly = false,
  loadingLabel,
  loadingHint,
  errorLabel,
  onLoadStart,
  onReady,
  onError,
  cropSide = null,
  rotateWide = false,
  onNaturalSize,
  cropBorders = false,
  priority = IMAGE_LOAD_PRIORITY.NORMAL,
  serializedDecode = false,
  previewDecodeEnabled = false,
  fullPrecision = false,
  sourceSize,
}, fwdRef) => {
  const [imgSrc, setImgSrc] = useState(null);
  const [loadState, setLoadState] = useState(() => (pageUrl ? 'loading' : 'idle'));
  const [showLoadingStatus, setShowLoadingStatus] = useState(false);
  const [networkPending, setNetworkPending] = useState(false);
  const [allowNetworkFallback, setAllowNetworkFallback] = useState(() => !cacheOnly);
  const requestSeqRef = useRef(0);
  const readyPageUrlRef = useRef(null);
  const readyPrecisionRef = useRef(null);
  const visibleSourceRef = useRef(null);
  const imgRef = useRef(null);
  const shellRef = useRef(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [shellSize, setShellSize] = useState({ width: 0, height: 0 });
  const [cropInsets, setCropInsets] = useState({ top: 0, right: 0, bottom: 0, left: 0 });

  useEffect(() => {
    if (!cacheOnly) {
      setAllowNetworkFallback(true);
    }
  }, [cacheOnly]);

  const setRefs = useCallback((el) => {
    imgRef.current = el;
    if (!fwdRef) return;
    if (typeof fwdRef === 'function') fwdRef(el);
    else fwdRef.current = el;
  }, [fwdRef]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;
    const update = () => {
      const next = { width: shell.clientWidth, height: shell.clientHeight };
      setShellSize((prev) => (
        prev.width === next.width && prev.height === next.height ? prev : next
      ));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const precisionKey = previewDecodeEnabled && !fullPrecision ? 'optimized' : 'full';
    const preserveReadySource = readyPageUrlRef.current === pageUrl && readyPrecisionRef.current === precisionKey;
    if (preserveReadySource) {
      setShowLoadingStatus(false);
      setNetworkPending(false);
      return undefined;
    }

    let isMounted = true;
    let decodeTicket = null;
    const requestSeq = ++requestSeqRef.current;
    setShowLoadingStatus(false);
    setNetworkPending(false);
    if (!pageUrl) {
      readyPageUrlRef.current = null;
      readyPrecisionRef.current = null;
      visibleSourceRef.current = null;
      setLoadState('idle');
      setImgSrc(null);
      return undefined;
    }
    if (!serializedDecode || !visibleSourceRef.current) {
      readyPageUrlRef.current = null;
      readyPrecisionRef.current = null;
      visibleSourceRef.current = null;
      setLoadState('loading');
      setImgSrc(null);
    }

    (async () => {
      onLoadStart?.(pageIndex);

      try {
        const src = await resolvePageImageSource(pageUrl, {
          cacheOnly,
          allowNetworkFallback,
          priority,
          onNetworkStart: () => {
            if (isMounted && requestSeq === requestSeqRef.current) setNetworkPending(true);
          },
        });
        if (!isMounted || requestSeq !== requestSeqRef.current) return;
        setNetworkPending(false);
        if (src) {
          if (serializedDecode) {
            decodeTicket = readerImageDecodeQueue.schedule(`page:${pageUrl}:${requestSeq}`, async (signal) => {
              if (!isMounted || requestSeq !== requestSeqRef.current) return;
              const resolved = await getReaderPreviewSource(src, {
                enabled: previewDecodeEnabled,
                fullPrecision,
                sourceSize,
                signal,
              });
              const decoded = await decodeImageSource(resolved.src, { signal });
              if (!isMounted || requestSeq !== requestSeqRef.current || !imgRef.current) return;
              readyPageUrlRef.current = pageUrl;
              readyPrecisionRef.current = precisionKey;
              visibleSourceRef.current = resolved.src;
              const resolvedNaturalSize = {
                width: resolved.width || decoded.width,
                height: resolved.height || decoded.height,
              };
              let nextCropInsets = { top: 0, right: 0, bottom: 0, left: 0 };
              if (cropBorders) {
                try { nextCropInsets = detectImageBorderInsets(decoded.image); } catch {}
              }
              setNaturalSize(resolvedNaturalSize);
              onNaturalSize?.(pageIndex, resolvedNaturalSize);
              setCropInsets(nextCropInsets);
              setImgSrc(resolved.src);
              setLoadState('ready');
              onReady?.(pageIndex);
            }, priority);
            await decodeTicket.promise;
            return;
          }
          setImgSrc(src);
          return;
        }
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
          return;
        }
        if (!visibleSourceRef.current) setLoadState('error');
        onError?.(pageIndex);
      } catch (error) {
        if (!isMounted || requestSeq !== requestSeqRef.current) return;
        if (error?.name === 'AbortError') return;
        setNetworkPending(false);
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
          return;
        }
        if (!visibleSourceRef.current) setLoadState('error');
        onError?.(pageIndex);
      }
    })();

    return () => {
      isMounted = false;
      decodeTicket?.cancel();
    };
  }, [allowNetworkFallback, cacheOnly, cropBorders, fullPrecision, onError, onLoadStart, onNaturalSize, onReady, pageIndex, pageUrl, previewDecodeEnabled, priority, serializedDecode, sourceSize]);

  useEffect(() => {
    if (!networkPending) {
      setShowLoadingStatus(false);
      return undefined;
    }
    const timer = setTimeout(() => setShowLoadingStatus(true), 180);
    return () => clearTimeout(timer);
  }, [networkPending, pageUrl]);

  const handleMountedImageLoad = useCallback(async (event) => {
    if (serializedDecode) return;
    const image = event.currentTarget;
    if (image !== imgRef.current || image.src !== imgSrc) return;
    readyPageUrlRef.current = pageUrl;
    readyPrecisionRef.current = 'full';
    visibleSourceRef.current = imgSrc;
    if (typeof image.decode === 'function') {
      try { await image.decode(); } catch {}
    }
    if (image !== imgRef.current || image.src !== imgSrc) return;
    setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
    onNaturalSize?.(pageIndex, { width: image.naturalWidth, height: image.naturalHeight });
    if (cropBorders) {
      try { setCropInsets(detectImageBorderInsets(image)); } catch {}
    }
    setLoadState('ready');
    onReady?.(pageIndex);
  }, [cropBorders, imgSrc, onNaturalSize, onReady, pageIndex, pageUrl, serializedDecode]);

  const handleMountedImageError = useCallback(() => {
    readyPageUrlRef.current = null;
    setLoadState('error');
    onError?.(pageIndex);
  }, [onError, pageIndex]);

  const isReady = !!imgSrc && loadState === 'ready';
  useEffect(() => {
    if (!cropBorders) {
      setCropInsets({ top: 0, right: 0, bottom: 0, left: 0 });
      return;
    }
    const image = imgRef.current;
    if (!isReady || !image?.complete || !image.naturalWidth) return;
    try { setCropInsets(detectImageBorderInsets(image)); } catch {}
  }, [cropBorders, isReady, imgSrc]);
  const isWide = isReady && isWidePageSize(naturalSize);
  const showCrop = isWide && !!cropSide;
  const showRotate = isWide && rotateWide;
  const cropFrame = showCrop ? getContainedHalfFrame(naturalSize, shellSize, cropSide) : null;
  const pageShellStyle = isReady ? style : {
    ...style,
    width: '100%',
    height: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
  };
  return (
    <div
      ref={shellRef}
      className={[className, 'reader-page-image-shell'].filter(Boolean).join(' ')}
      style={{
        ...pageShellStyle,
        position: 'relative',
        overflow: 'hidden',
        minWidth: 0,
        minHeight: 0,
        background: isImmersive ? 'var(--immersive-bg)' : 'transparent',
      }}
    >
      <img
        ref={setRefs}
        src={imgSrc || undefined}
        className={isReady && !serializedDecode ? 'reader-content-fade-in' : undefined}
        alt="Comic Content"
        draggable={false}
        loading="eager"
        decoding="async"
        onLoad={handleMountedImageLoad}
        onError={handleMountedImageError}
        onContextMenu={(e) => isImmersive && e.preventDefault()}
        style={{
          display: cropFrame ? 'none' : 'block',
          width: showRotate ? 'auto' : (style?.width || '100%'),
          height: showRotate ? 'auto' : (style?.height || '100%'),
          maxWidth: showRotate ? `${shellSize.height}px` : style?.maxWidth,
          maxHeight: showRotate ? `${shellSize.width}px` : style?.maxHeight,
          objectFit: style?.objectFit || 'contain',
          opacity: isReady ? 1 : 0,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          pointerEvents: isImmersive ? 'none' : 'auto',
          WebkitUserDrag: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          transform: showRotate ? 'rotate(90deg)' : style?.transform,
          transformOrigin: 'center center',
          ...(cropBorders ? { clipPath: `inset(${cropInsets.top * 100}% ${cropInsets.right * 100}% ${cropInsets.bottom * 100}% ${cropInsets.left * 100}%)` } : {}),
        }}
      />
      {cropFrame && (
        <img
          src={imgSrc}
          alt="Comic Content"
          draggable={false}
          decoding="async"
          style={{
            position: 'absolute',
            top: `${cropFrame.top}px`,
            left: `${cropFrame.left}px`,
            width: `${cropFrame.width}px`,
            height: `${cropFrame.height}px`,
            maxWidth: 'none',
            maxHeight: 'none',
            objectFit: 'fill',
            clipPath: cropSide === 'left' ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)',
            userSelect: 'none',
            pointerEvents: isImmersive ? 'none' : 'auto',
          }}
        />
      )}
      {!isReady && (loadState === 'error' || showLoadingStatus) && (
        <div
          className="reader-image-loading-status"
          role="status" aria-live="polite"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            padding: '18px',
            textAlign: 'center',
            pointerEvents: 'none',
            color: loadState === 'error' ? 'var(--danger)' : 'var(--text-main)',
          }}
        >
          <div style={{ fontSize: 'clamp(18px, 2.2vw, 28px)', lineHeight: 1.35, fontWeight: 750, letterSpacing: '0.3px', textWrap: 'balance' }}>
            {loadState === 'error' ? (errorLabel || '图片加载失败') : (loadingLabel || '正在加载图像…')}
          </div>
          <div style={{ fontSize: 'clamp(13px, 1.4vw, 18px)', fontWeight: 600, color: loadState === 'error' ? 'var(--danger-text)' : 'var(--text-sub)' }}>
            {loadState === 'error' ? '稍后可再次翻页重试' : (loadingHint || '图像就绪后会立即显示')}
          </div>
        </div>
      )}
    </div>
  );
});

const ReaderArchiveThumb = ({ archiveId, cacheOnly = false }) => {
  const [src, setSrc] = useState(null);
  const [allowNetworkFallback, setAllowNetworkFallback] = useState(() => !cacheOnly);
  useEffect(() => {
    if (!cacheOnly) {
      setAllowNetworkFallback(true);
    }
  }, [cacheOnly]);
  useEffect(() => {
    let m = true;
    (async () => {
      if (!archiveId) return;
      try {
        const blobUrl = cacheOnly && !allowNetworkFallback
          ? await getCachedImage(`thumb:hist:${archiveId}`)
          : await getImage(`thumb:hist:${archiveId}`, async (signal) => {
              const base = (localStorage.getItem('lrr_server_url') || '').replace(/\/$/, '');
              const key = localStorage.getItem('lrr_api_key') || '';
              const h = {};
              if (key) h['Authorization'] = `Bearer ${encodeApiKey(key)}`;
              const r = await fetch(`${base}/api/archives/${archiveId}/thumbnail`, { headers: h, signal });
              if (!r.ok) throw new Error();
              return r.blob();
            });
        if (!m) return;
        if (blobUrl) {
          setSrc(blobUrl);
          return;
        }
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
        }
      } catch {
        if (!m) return;
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
        }
      }
    })();
    return () => { m = false; };
  }, [allowNetworkFallback, archiveId, cacheOnly]);
  return (
    <div style={{ width: '48px', height: '66px', borderRadius: '5px', overflow: 'hidden', flexShrink: 0, background: 'var(--cover-bg)' }}>
      {src && <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
    </div>
  );
};

function ReaderArchiveListPanel({ type, title, items, emptyMessage, cacheOnly, onDelete, activeType, onTypeChange, onViewMore, onRetry, progressBarVisibility, top }) {
  const panelWindow = getReaderArchivePanelWindow(type, items);
  const panelRef = useRef(null);
  const contentRef = useRef(null);
  const [readerArchivePanelHeight, setReaderArchivePanelHeight] = useState(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const handleWheel = (event) => {
      const atTop = panel.scrollTop <= 0;
      const atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1;
      if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
        event.preventDefault();
      }
      event.stopPropagation();
    };
    panel.addEventListener('wheel', handleWheel, { passive: false });
    return () => panel.removeEventListener('wheel', handleWheel);
  }, []);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    const updateHeight = () => {
      const viewportLimit = Math.floor(window.innerHeight * 0.7);
      setReaderArchivePanelHeight(Math.min(Math.ceil(content.scrollHeight) + 2, viewportLimit));
    };
    updateHeight();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeight);
    observer?.observe(content);
    window.addEventListener('resize', updateHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      data-panel={type}
      data-reader-overlay-scroll
      className="reader-archive-panel reader-panel-surface glass-panel dropdown-animate no-scrollbar"
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: 'max(20px, calc(var(--app-safe-area-left) + 12px))',
        zIndex: 9999,
        padding: 0,
        borderRadius: '14px',
        width: 'min(360px, calc(100vw - 40px))',
        boxSizing: 'border-box',
        maxHeight: `calc(100dvh - ${top}px - max(12px, calc(var(--app-safe-area-bottom) + 8px)))`,
        height: readerArchivePanelHeight == null ? 'auto' : `${readerArchivePanelHeight}px`,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        touchAction: 'pan-y',
        WebkitOverflowScrolling: 'touch',
        boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
        border: '1px solid var(--reader-control-border)',
        transition: 'height 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <div ref={contentRef} style={{ padding: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '12px', borderBottom: '1px solid var(--reader-control-border)', paddingBottom: '8px' }}>
        <span style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: 600 }}>{title}</span>
        <div className="reader-panel-tabs" role="group" aria-label="档案列表类型">
          {[
            ['history', '阅读历史'],
            ['watchlist', '待看档案'],
            ['random', '随机漫游'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="reader-panel-tab"
              aria-pressed={activeType === value}
              onClick={() => onTypeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: '12px', color: 'var(--text-sub)', padding: '8px 0', display: 'grid', gap: '10px' }}>
          <span>{emptyMessage}</span>
          {onRetry && <button type="button" className="reader-panel-view-more" onClick={onRetry}>重试</button>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {panelWindow.items.map((item) => {
            const id = item.id || item.arcid;
            const tags = (item.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
            const showNs = new Set(['category', 'parody', 'male', 'female']);
            const displayTags = tags
              .filter((tag) => showNs.has(tag.split(':')[0].toLowerCase()))
              .map((tag) => {
                const separator = tag.indexOf(':');
                if (separator <= 0) return tag;
                return translateTag(tag.slice(0, separator).toLowerCase(), tag.slice(separator + 1).trim());
              })
              .filter(Boolean)
              .slice(0, 6);
            const meta = getReaderArchiveListMeta(item, type);
            const progressPct = getArchiveProgressPercent(item);
            const showProgress = progressPct != null && shouldShowArchiveProgress(progressBarVisibility, type !== 'random');

            return (
              <div
                key={id}
                onClick={() => navigateToArchive(id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigateToArchive(id);
                  }
                }}
                role="button"
                tabIndex={0}
                className="reader-archive-list-item"
                style={{
                  display: 'flex', gap: '10px', alignItems: 'center',
                  padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--glass-border)',
                  transition: 'background-color 0.15s ease, border-color 0.15s ease',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <ReaderArchiveThumb archiveId={id} cacheOnly={cacheOnly} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </div>
                  {displayTags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '4px' }}>
                      {displayTags.map((tag, index) => (
                        <span key={index} style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', color: 'var(--text-sub)', background: 'color-mix(in srgb, var(--surface-3) 84%, var(--text-sub))', border: '1px solid color-mix(in srgb, var(--glass-border-hover) 58%, transparent)', whiteSpace: 'nowrap' }}>{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right', minWidth: '52px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-sub)' }}>
                    {meta.timestamp ? new Date(meta.timestamp).toLocaleDateString() : ''}
                  </div>
                  {meta.progress && (
                    <div style={{ fontSize: '10px', color: 'var(--accent)', marginTop: '2px' }}>{meta.progress}</div>
                  )}
                </div>
                {onDelete && <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(item);
                  }}
                  style={{
                    background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                    fontSize: '16px', lineHeight: 1, padding: '2px 4px', borderRadius: '4px', flexShrink: 0,
                  }}
                  title={type === 'watchlist' ? '移出待看' : '删除历史'}
                  aria-label={type === 'watchlist' ? `将${item.title || '档案'}移出待看` : `删除${item.title || '档案'}的历史记录`}
                >
                  ×
                </button>}
                {showProgress && (
                  <div className="reader-archive-progress" role="progressbar" aria-label="阅读进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progressPct}>
                    <div className="reader-archive-progress-fill" style={{ width: `${progressPct}%` }} />
                  </div>
                )}
              </div>
            );
          })}
          {panelWindow.hasMore && onViewMore && (
            <button
              type="button"
              className="reader-panel-view-more"
              onClick={onViewMore}
              aria-label={`查看全部${type === 'history' ? '阅读历史' : '待看档案'}，共 ${panelWindow.total} 本`}
            >
              查看更多（共 {panelWindow.total} 本）
            </button>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

function normalizePageUrl(rawUrl, serverUrl) {
  if (!rawUrl) return '';
  let url = rawUrl.replace(/^\.\/+/, '/').replace(/\/page&path=/, '/page?path=');
  if (!url.startsWith('http')) return `${serverUrl}${url.startsWith('/') ? url : `/${url}`}`;
  try {
    const parsed = new URL(url);
    if (serverUrl && parsed.origin === window.location.origin && isLanraragiAssetPath(parsed.pathname)) {
      return `${serverUrl}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {}
  return url;
}

function formatArchiveSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** unitIndex);
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: amount >= 100 ? 0 : amount >= 10 ? 1 : 2,
  }).format(amount);
  return `${formatted}\u00a0${units[unitIndex]}`;
}

async function primePageBlob(pageUrl, priority = IMAGE_LOAD_PRIORITY.PRELOAD) {
  if (!pageUrl) return false;
  const normalized = toLocalUrl(pageUrl);
  const key = localStorage.getItem('lrr_api_key') || '';
  return primeImage(normalized, async (signal) => {
    const headers = {};
    if (key) headers.Authorization = `Bearer ${encodeApiKey(key)}`;
    const res = await fetch(normalized, { headers, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  }, { priority });
}

function getNormalReaderFrameHeight(isMobile, toolbarHeight = 'var(--reader-toolbar-height, 68px)') {
  const navRowHeight = isMobile ? 92 : 96;
  // Only cap unusually tall viewports; common phones stay below a 2:1 frame ratio.
  return `min(calc(100dvh - ${toolbarHeight} - 24px - ${navRowHeight}px), calc((100vw - 32px) * 2))`;
}

const normalReaderStageShellStyle = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  maxWidth: '1300px',
  width: '100%',
  margin: '0 auto',
  padding: '24px 16px 0 16px',
};

const normalReaderStageLayoutStyle = {
  ...normalReaderStageShellStyle,
  flex: '0 0 auto',
};

const skeletonViewportStyle = {
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
};

function forceWindowScrollTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function getNormalReaderFrameStyle(isMobile, toolbarHeight = 'var(--reader-toolbar-height, 68px)') {
  const height = getNormalReaderFrameHeight(isMobile, toolbarHeight);
  return {
    flex: '0 0 auto',
    minHeight: height,
    height,
    maxHeight: height,
    maxWidth: '850px',
    width: '100%',
    marginLeft: 'auto',
    marginRight: 'auto',
    background: 'var(--reader-stage-bg)',
    border: '1px solid var(--reader-stage-border)',
    borderRadius: '16px',
    padding: isMobile ? '16px' : '24px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    boxShadow: '0 18px 50px rgba(0,0,0,0.34), inset 0 1px 0 color-mix(in srgb, var(--reader-overlay-text) 3.5%, transparent)',
    boxSizing: 'border-box',
  };
}

function getTopBarButtonStyle(isMobile, disabled = false) {
  return {
    padding: isMobile ? '8px 10px' : '8px 14px',
    minWidth: isMobile ? '40px' : 'unset',
    height: isMobile ? '40px' : 'auto',
    background: 'var(--reader-control-bg)',
    border: '1px solid var(--reader-control-border)',
    color: 'var(--reader-control-text)',
    borderRadius: '8px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: isMobile ? '16px' : '13px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: isMobile ? '0' : '6px',
    transition: 'background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease',
    opacity: disabled ? 0.45 : 1,
    flexShrink: 0,
  };
}

function getPageNavButtonStyle(isMobile) {
  return {
    width: isMobile ? '52px' : '56px',
    height: isMobile ? '52px' : '56px',
    background: 'var(--reader-control-bg)',
    border: '1px solid var(--reader-control-border)',
    color: 'var(--reader-control-text)',
    borderRadius: isMobile ? '10px' : '12px',
    cursor: 'pointer',
    fontSize: isMobile ? '20px' : '22px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    transition: 'background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease',
    flexShrink: 0,
  };
}

function useReaderToolbarMode(isMobile, layoutKey = null) {
  const toolbarRef = useRef(null);
  const [mode, setMode] = useState(isMobile ? 'mobile' : 'full');

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return undefined;
    const update = () => {
      const availableWidth = toolbar.clientWidth;
      const left = toolbar.querySelector('.reader-toolbar-group-left');
      const right = toolbar.querySelector('.reader-toolbar-group-right');
      const title = toolbar.querySelector('.reader-toolbar-title');
      const titleContent = title?.querySelector('.reader-toolbar-title-content');
      const buttons = (group) => Array.from(group?.querySelectorAll('button, .reader-toolbar-button') || []);
      const fullGroupWidth = (group, gap) => {
        const groupButtons = buttons(group);
        return groupButtons.reduce((sum, button) => {
          const label = button.querySelector('.reader-toolbar-label');
          return sum + Math.max(40, (label?.scrollWidth || button.scrollWidth || 0) + 28);
        }, 0) + Math.max(0, groupButtons.length - 1) * gap;
      };
      const leftButtons = buttons(left).length;
      const rightButtons = buttons(right).length;
      const leftButtonRects = buttons(left).map((button) => button.getBoundingClientRect());
      const rightButtonRects = buttons(right).map((button) => button.getBoundingClientRect());
      const safeTitleWidth = getCenteredToolbarTitleWidth({
        toolbar: toolbar.getBoundingClientRect(),
        leftGroup: leftButtonRects.length ? { right: Math.max(...leftButtonRects.map((rect) => rect.right)) } : null,
        rightGroup: rightButtonRects.length ? { left: Math.min(...rightButtonRects.map((rect) => rect.left)) } : null,
      });
      const titleWidthValue = `${safeTitleWidth}px`;
      if (toolbar.style.getPropertyValue('--reader-toolbar-title-width') !== titleWidthValue) {
        toolbar.style.setProperty('--reader-toolbar-title-width', titleWidthValue);
      }
      const root = toolbar.closest('.reader-root');
      const toolbarHeightValue = `${toolbar.getBoundingClientRect().height}px`;
      if (root?.style.getPropertyValue('--reader-toolbar-height') !== toolbarHeightValue) {
        root.style.setProperty('--reader-toolbar-height', toolbarHeightValue);
      }
      const titleWidth = titleContent
        ? Math.max(Math.ceil(titleContent.getBoundingClientRect().width), 80)
        : 0;
      const computed = getComputedStyle(toolbar);
      const horizontalPadding = (Number.parseFloat(computed.paddingLeft) || 0) + (Number.parseFloat(computed.paddingRight) || 0);
      const groupGaps = 32;
      const fullLeftWidth = fullGroupWidth(left, 16);
      const fullRightWidth = fullGroupWidth(right, 8);
      const iconLeftWidth = (leftButtons * 40) + (Math.max(0, leftButtons - 1) * 6);
      const iconRightWidth = (rightButtons * 40) + (Math.max(0, rightButtons - 1) * 6);
      const measured = {
        full: (Math.max(fullLeftWidth, fullRightWidth) * 2) + titleWidth + horizontalPadding + groupGaps,
        icons: (Math.max(iconLeftWidth, iconRightWidth) * 2) + titleWidth + horizontalPadding + groupGaps,
      };
      setMode(resolveReaderToolbarMode({
        isMobile,
        availableWidth,
        fullRequiredWidth: measured.full || availableWidth,
        iconRequiredWidth: measured.icons || availableWidth,
      }));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    toolbar.querySelectorAll('.reader-toolbar-group, .reader-toolbar-title').forEach((node) => observer.observe(node));
    document.fonts?.ready?.then(update).catch(() => {});
    return () => observer.disconnect();
  }, [isMobile, layoutKey]);

  return { toolbarRef, mode };
}

function ReaderToolbarButtonContent({ icon, label, size = 18 }) {
  return (
    <span className="reader-toolbar-button-content" aria-hidden="true">
      <span className="reader-toolbar-icon"><ToolbarGlyph name={icon} size={size} /></span>
      <span className="reader-toolbar-label">{label}</span>
    </span>
  );
}

function ReaderStageSkeleton({ title = '', hasMeta = false, hasPages = false, isMobile = false }) {
  const { toolbarRef, mode } = useReaderToolbarMode(isMobile);
  const compact = mode !== 'full';
  const topBtnStyle = getTopBarButtonStyle(compact);
  const toolbarGroups = getReaderSkeletonToolbarGroups(compact);
  const pageNavBtnStyle = getPageNavButtonStyle(isMobile);
  const frameStyle = getNormalReaderFrameStyle(isMobile);
  return (
    <div className="reader-root" style={{ minHeight: '100vh', background: 'transparent' }}>
      <div style={skeletonViewportStyle}>
        <div
          ref={toolbarRef}
          className="reader-toolbar"
          data-reader-toolbar
          data-mobile={isMobile ? 'true' : 'false'}
          data-mode={mode}
          data-compact={compact ? 'true' : 'false'}
          style={{
            padding: '14px 24px',
            background: 'var(--reader-toolbar-bg)',
            backdropFilter: 'blur(16px)',
            borderBottom: '1px solid var(--reader-control-border)',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
            columnGap: '16px',
            alignItems: 'center',
            position: 'relative',
          }}
        >
          <div className="reader-toolbar-group reader-toolbar-group-left" style={{ gridColumn: '1', display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '16px', minWidth: 0 }}>
            {toolbarGroups.left.map((label, index) => (
              <div
                key={index}
                className="reader-toolbar-button reader-toolbar-skeleton"
                style={{
                  ...topBtnStyle,
                  ...(compact ? { width: '40px', height: '40px', padding: 0 } : {}),
                  color: 'transparent',
                  background: 'var(--reader-skeleton-base)',
                  borderColor: 'var(--reader-control-border)',
                }}
              >
                {label}
              </div>
            ))}
          </div>
          {!compact && (
            <div
              className="reader-toolbar-title"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 'min(var(--reader-toolbar-title-width, 240px), calc(100% - 48px))',
                minWidth: 0,
                height: '18px',
                borderRadius: '8px',
                background: title ? 'transparent' : 'var(--reader-skeleton-base)',
                color: title ? 'var(--text-main)' : 'transparent',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textAlign: 'center',
                fontSize: '15px',
                fontWeight: 700,
              }}
            >
              <span className="reader-toolbar-title-content" style={{ display: 'inline-block' }}>
                {title || 'loading'}
              </span>
            </div>
          )}
          {compact && <span style={{ minWidth: 0 }} />}
          <div className="reader-toolbar-group reader-toolbar-group-right" style={{ gridColumn: '3', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: isMobile ? '6px' : '8px', minWidth: 0 }}>
            {toolbarGroups.right.map((label, index) => (
              <div
                key={index}
                className="reader-toolbar-button reader-toolbar-skeleton"
                style={{
                  ...topBtnStyle,
                  ...(compact ? { width: '40px', height: '40px', padding: 0 } : {}),
                  color: 'transparent',
                  background: 'var(--reader-skeleton-base)',
                  borderColor: 'var(--reader-control-border)',
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        <div style={normalReaderStageLayoutStyle}>
          <div
            className="reader-shell-pulse reader-stage-frame"
            style={frameStyle}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                maxWidth: '100%',
                maxHeight: '100%',
                minWidth: 0,
                borderRadius: '8px',
                background: 'var(--reader-skeleton-base)',
                border: '1px solid var(--reader-control-border)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div className="shimmer-strip" style={{ position: 'absolute', inset: 0 }} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: isMobile ? '18px' : '24px', padding: '20px 8px', flexShrink: 0 }}>
            <div className="reader-skeleton-surface" style={pageNavBtnStyle} />
            <div className="reader-skeleton-surface" style={{ width: hasPages ? '72px' : '96px', height: '18px', borderRadius: '8px' }} />
            <div className="reader-skeleton-surface" style={pageNavBtnStyle} />
          </div>
        </div>

        {hasMeta && (
          <div style={{ maxWidth: '1300px', width: '100%', margin: '0 auto', padding: '0 16px 24px 16px' }}>
            <div className="section-reveal section-reveal-delay-2" style={{ display: 'grid', gap: '20px' }}>
              <div className="reader-panel-surface glass-panel" style={{ minHeight: '168px' }} />
              <div className="reader-panel-surface glass-panel" style={{ minHeight: '220px' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReaderStageSlot({ status, onRetry }) {
  if (status === 'error') {
    return (
      <div className="reader-stage-slot reader-slot-error" role="status" aria-live="polite">
        <strong>页面列表加载失败</strong>
        <span>请检查 LANraragi 连接后重试。</span>
        <button type="button" className="reader-stage-retry" onClick={onRetry}>重新加载</button>
      </div>
    );
  }
  if (status === 'empty') {
    return (
      <div className="reader-stage-slot" role="status" aria-live="polite">
        <strong>档案没有可显示页面</strong>
        <span>请检查档案内容或重新提取页面。</span>
      </div>
    );
  }
  return (
    <div className="reader-stage-slot reader-shell-pulse" role="status" aria-live="polite">
      <div className="shimmer-strip" aria-hidden="true" />
      <span className="reader-stage-slot-label">正在加载页面列表…</span>
    </div>
  );
}

export default function Reader({ archiveId, onBack, coldRestoreBoot = false, incognito = false }) {
  const persistReadingProgress = !incognito;
  const workerReady = hasValidWorkerConfig();
  const bootState = getBootState();
  const readerSnapshotRef = useRef(null);
  if (readerSnapshotRef.current === null) {
    const fallbackReaderSnapshot = persistReadingProgress ? loadReaderSnapshot(archiveId) : null;
    readerSnapshotRef.current = coldRestoreBoot
      ? fallbackReaderSnapshot
      : ((bootState.wasDiscarded || bootState.navigationType === 'reload') ? fallbackReaderSnapshot : null);
  }
  const readerSnapshot = readerSnapshotRef.current;
  const hasSnapshot = !!readerSnapshot;
  const coldRestoreRef = useRef(!!readerSnapshot);
  const serverUrlRef = useRef((localStorage.getItem('lrr_server_url') || '').replace(/\/$/, ''));
  const serverInfoRef = useRef(getStoredServerInfo());
  const containerRef = useRef(null);
  // ===== Core States =====
  const [archive, setArchive] = useState(() => readerSnapshot?.archive || null);
  const [pages, setPages] = useState(() => Array.isArray(readerSnapshot?.pages) ? readerSnapshot.pages : []);
  const [currentIndex, setCurrentIndex] = useState(() => {
    const next = readerSnapshot?.currentIndex;
    return typeof next === 'number' && next >= 0 ? next : 0;
  });
  const [splitPart, setSplitPart] = useState(() => (
    readerSnapshot?.splitPart === 1 ? 1 : 0
  ));
  const [pageSizes, setPageSizes] = useState({});
  const pageSizesRef = useRef(pageSizes);
  pageSizesRef.current = pageSizes;
  const [displayedIndex, setDisplayedIndex] = useState(() => {
    const next = readerSnapshot?.displayedIndex;
    return typeof next === 'number' && next >= 0 ? next : 0;
  });
  const [renderState, dispatchRender] = useReducer(
    readerRenderReducer,
    {
      hasMetadata: !!readerSnapshot?.archive,
      hasManifest: Array.isArray(readerSnapshot?.pages) && readerSnapshot.pages.length > 0,
      hasSelection: hasSnapshot,
    },
    createReaderRenderState,
  );
  const [bootstrapRetryToken, setBootstrapRetryToken] = useState(0);

  // ===== UI States =====
  const [viewMode, setViewMode] = useState(() => readerSnapshot?.viewMode || 'normal');
  const [showUI, setShowUI] = useState(true);
  const [showHeader, setShowHeader] = useState(() => readerSnapshot?.showHeader ?? true);
  const [showDrawer, setShowDrawer] = useState(false);
  const [drawerSide, setDrawerSide] = useState('right');
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState('general');
  const [srSupport] = useState(() => detectSuperResolutionSupport());
  const [srToast, setSrToast] = useState('');
  const srToastTimerRef = useRef(null);
  const [showArchivePanel, setShowArchivePanel] = useState(false);
  const [immersiveControlsSide, setImmersiveControlsSide] = useState(null);
  const [archivePanelType, setArchivePanelType] = useState('history');
  const [randomEntries, setRandomEntries] = useState([]);
  const [randomEntriesLoading, setRandomEntriesLoading] = useState(false);
  const [randomEntriesError, setRandomEntriesError] = useState('');
  const [historyDeleteTarget, setHistoryDeleteTarget] = useState(null);
  const [coverSetting, setCoverSetting] = useState(false);
  const [coverSetPage, setCoverSetPage] = useState(0);
  const [coverConfirmPage, setCoverConfirmPage] = useState(0);
  const [progressClearing, setProgressClearing] = useState(false);
  const [progressNotice, setProgressNotice] = useState('');
  const [progressSyncNotice, setProgressSyncNotice] = useState('');
  const [thumbnailQueueState, setThumbnailQueueState] = useState('idle');
  const [thumbnailQueueRetryToken, setThumbnailQueueRetryToken] = useState(0);
  const [drawerPrefetchSet, setDrawerPrefetchSet] = useState(() => new Set());
  const [drawerViewport, setDrawerViewport] = useState({ height: 0, scrollTop: 0, width: 0 });
  const [assetCacheOnly, setAssetCacheOnly] = useState(() => hasSnapshot);
  const [historyEntries, setHistoryEntries] = useState(() => getHistory());
  const [watchlistEntries, setWatchlistEntries] = useState(() => getWatchlist());
  const [hideRead] = useState(getHideRead);
  const [randomHideRead] = useState(getRandomHideRead);
  const [isMobile, setIsMobile] = useState(() => isReaderMobileViewport(window.innerWidth));
  const { toolbarRef, mode: toolbarMode } = useReaderToolbarMode(isMobile, viewMode);
  const toolbarCompact = toolbarMode !== 'full';
  const isIosWebKit = useMemo(() => isIosWebKitPlatform(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
  ), []);
  const [serverTracksProgress, setServerTracksProgress] = useState(() => {
    const stored = getStoredServerInfo();
    if (stored && typeof stored.server_tracks_progress === 'boolean') {
      return stored.server_tracks_progress;
    }
    return null;
  });
  const [pageLoadPhase, setPageLoadPhase] = useState(() => ({
    status: pages.length > 0 ? 'loading' : 'idle',
    visibleIndex: typeof readerSnapshot?.displayedIndex === 'number' && readerSnapshot.displayedIndex >= 0
      ? readerSnapshot.displayedIndex
      : 0,
    targetIndex: typeof readerSnapshot?.currentIndex === 'number' && readerSnapshot.currentIndex >= 0
      ? readerSnapshot.currentIndex
      : 0,
    shownAt: 0,
  }));
  const { canShowMetadata, canShowPageCount, canNavigate, canRenderPage } = getReaderCapabilities(renderState, pages.length);
  const currentPageReady = canRenderPage
    && pageLoadPhase.status === 'ready'
    && pageLoadPhase.targetIndex === currentIndex;
  const [secondaryContentReady, setSecondaryContentReady] = useState(false);

  useLayoutEffect(() => {
    forceWindowScrollTop();
    const frame = requestAnimationFrame(forceWindowScrollTop);
    const timer = setTimeout(forceWindowScrollTop, 80);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [archiveId]);

  useEffect(() => {
    if (!canRenderPage) return undefined;
    const frame = requestAnimationFrame(forceWindowScrollTop);
    return () => cancelAnimationFrame(frame);
  }, [archiveId, canRenderPage]);

  // ===== Zoom =====
  const [zoomScale, setZoomScale] = useState(() => readerSnapshot?.zoomScale || 1.0);
  const fullPrecisionDecode = zoomScale > 1.0;

  // ===== Pan (drag-to-scroll when zoomed) =====
  const [panX, setPanX] = useState(() => readerSnapshot?.panX || 0);
  const [panY, setPanY] = useState(() => readerSnapshot?.panY || 0);

  // Reset pan offset whenever zoom returns to 100%
  useEffect(() => {
    if (zoomScale === 1.0) {
      panRef.current = { x: 0, y: 0, startX: 0, startY: 0, originX: 0, originY: 0 };
      setPanX(0);
      setPanY(0);
    }
  }, [zoomScale]);

  // ===== Settings (persisted across archives) =====
  const [settings, setSettingsState] = useState(() => {
    try {
      return normalizeReaderSettings(JSON.parse(localStorage.getItem(READER_SETTINGS_KEY)));
    } catch {}
    return { ...DEFAULT_READER_SETTINGS };
  });
  const [autoWebtoon, setAutoWebtoon] = useState(false);
  const [autoMangaEligible, setAutoMangaEligible] = useState(false);
  const [readerContainerWidth, setReaderContainerWidth] = useState(() => window.innerWidth);
  const [readerContainerHeight, setReaderContainerHeight] = useState(() => window.innerHeight);
  const effectiveReadingLayout = settings.readingLayout === 'auto'
    ? resolveAutoReadingLayout({ isWebtoon: autoWebtoon, isManga: autoMangaEligible, containerWidth: readerContainerWidth })
    : settings.readingLayout;
  const webtoonActive = effectiveReadingLayout === 'webtoon';
  const splitWidePages = useMemo(() => {
    const result = new Set();
    if (!settings.splitWidePagesEnabled || webtoonActive) return result;
    for (const [rawIndex, size] of Object.entries(pageSizes)) {
      if (isWidePageSize(size)) result.add(Number(rawIndex));
    }
    return result;
  }, [pageSizes, settings.splitWidePagesEnabled, webtoonActive]);
  const readerSpreads = useMemo(() => buildReaderSpreads({
    pageCount: pages.length,
    doublePage: effectiveReadingLayout === 'double',
    splitWidePages,
    direction: settings.direction,
  }), [effectiveReadingLayout, pages.length, settings.direction, splitWidePages]);
  const currentSpreadIndex = findSpreadIndex(readerSpreads, { pageIndex: currentIndex, splitPart });
  const currentSpread = readerSpreads[Math.max(0, currentSpreadIndex)] || [];
  const currentSpreadPageIndices = new Set(currentSpread.map((unit) => unit.pageIndex));
  const adjacentDecodePageIndices = [...new Set(
    getReaderDecodeWindow(readerSpreads, currentSpreadIndex)
      .flatMap((spread) => spread.map((unit) => unit.pageIndex)),
  )].filter((pageIndex) => !currentSpreadPageIndices.has(pageIndex));
  const snapshotSaveTimerRef = useRef(null);

  const [preloadInput, setPreloadInput] = useState(String(settings.preloadCount));
  const [decodeConcurrencyInput, setDecodeConcurrencyInput] = useState(String(settings.maxConcurrentDecodes));
  const [autoTurnInput, setAutoTurnInput] = useState(String(settings.autoTurnInterval));
  const archiveRef = useRef(archive);
  const pagesRef = useRef(pages);
  const currentIndexRefSnapshot = useRef(currentIndex);
  const splitPartRef = useRef(splitPart);
  const displayedIndexRef = useRef(displayedIndex);
  const viewModeSnapshotRef = useRef(viewMode);
  const pageLoadPhaseRef = useRef(pageLoadPhase);
  const bootstrapGenerationRef = useRef(0);

  useEffect(() => { archiveRef.current = archive; }, [archive]);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { currentIndexRefSnapshot.current = currentIndex; }, [currentIndex]);
  useEffect(() => { splitPartRef.current = splitPart; }, [splitPart]);
  useEffect(() => { displayedIndexRef.current = displayedIndex; }, [displayedIndex]);
  useEffect(() => { viewModeSnapshotRef.current = viewMode; }, [viewMode]);
  useEffect(() => { pageLoadPhaseRef.current = pageLoadPhase; }, [pageLoadPhase]);

  useEffect(() => {
    if (currentPageReady) setSecondaryContentReady(true);
  }, [currentPageReady]);

  useEffect(() => {
    const refreshHistory = () => setHistoryEntries(getHistory());
    window.addEventListener('lrr:history-changed', refreshHistory);
    return () => window.removeEventListener('lrr:history-changed', refreshHistory);
  }, []);

  useEffect(() => () => { flushHistorySync().catch(() => {}); }, []);

  useEffect(() => {
    if (!secondaryContentReady) return undefined;
    loadHistoryState().then((state) => setHistoryEntries(state.histories)).catch(() => {});
    return undefined;
  }, [secondaryContentReady]);

  useEffect(() => {
    const refreshWatchlist = () => setWatchlistEntries(getWatchlist());
    window.addEventListener('lrr:watchlist-changed', refreshWatchlist);
    if (secondaryContentReady) {
      loadWatchlistState().then((state) => setWatchlistEntries(state.items)).catch(() => {});
    }
    return () => window.removeEventListener('lrr:watchlist-changed', refreshWatchlist);
  }, [secondaryContentReady]);

  const saveReaderStateSnapshot = useCallback(() => {
    if (!persistReadingProgress || !archiveRef.current || pagesRef.current.length === 0) return;
    saveReaderSnapshot({
      archiveId,
      archive: archiveRef.current,
      pages: pagesRef.current,
      currentIndex: currentIndexRefSnapshot.current,
      splitPart: splitPartRef.current,
      displayedIndex: displayedIndexRef.current,
      viewMode: viewModeSnapshotRef.current,
      showHeader,
      zoomScale: zoomScaleRef.current,
      panX: panRef.current.x,
      panY: panRef.current.y,
    });
  }, [archiveId, persistReadingProgress, showHeader]);
  useEffect(() => {
    serverInfoRef.current = { ...(serverInfoRef.current || {}), server_tracks_progress: serverTracksProgress };
  }, [serverTracksProgress]);

  useEffect(() => {
    if (!secondaryContentReady) return undefined;
    let cancelled = false;
    loadServerInfo().then((info) => {
      if (cancelled) return;
      serverInfoRef.current = info;
      if (typeof info?.server_tracks_progress === 'boolean') {
        setServerTracksProgress(info.server_tracks_progress);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [secondaryContentReady]);

  const exitColdRestoreMode = useCallback(async () => {
    if (!coldRestoreRef.current) return serverInfoRef.current;
    coldRestoreRef.current = false;
    setAssetCacheOnly(false);
    try {
      const info = await loadServerInfo();
      serverInfoRef.current = info;
      if (typeof info?.server_tracks_progress === 'boolean') {
        setServerTracksProgress(info.server_tracks_progress);
      }
      return info;
    } catch {
      return serverInfoRef.current;
    }
  }, []);

  useEffect(() => {
    if (!canRenderPage || !assetCacheOnly) return undefined;
    const timer = setTimeout(() => {
      void exitColdRestoreMode();
    }, 1200);
    return () => clearTimeout(timer);
  }, [assetCacheOnly, canRenderPage, exitColdRestoreMode]);

  const updateSettings = useCallback((updater) => {
    setSettingsState((prev) => {
      const next = normalizeReaderSettings(typeof updater === 'function' ? updater(prev) : updater);
      localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(next));
      setPreloadInput(String(next.preloadCount));
      setDecodeConcurrencyInput(String(next.maxConcurrentDecodes));
      setAutoTurnInput(String(next.autoTurnInterval));
      return next;
    });
  }, []);

  useEffect(() => {
    readerImageDecodeQueue.setMaxConcurrent(settings.maxConcurrentDecodes);
  }, [settings.maxConcurrentDecodes]);

  useEffect(() => {
    updateSettings(prepareReaderSettingsForArchiveChange);
  }, [archiveId, updateSettings]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const updateReaderContainerSize = () => {
      setReaderContainerWidth(container.clientWidth || window.innerWidth);
      setReaderContainerHeight(container.clientHeight || window.innerHeight);
    };
    updateReaderContainerSize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateReaderContainerSize);
      return () => window.removeEventListener('resize', updateReaderContainerSize);
    }
    const observer = new ResizeObserver(updateReaderContainerSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!secondaryContentReady || settings.readingLayout !== 'auto') {
      setAutoWebtoon(false);
      setAutoMangaEligible(false);
      return undefined;
    }
    if (hasWebtoonTag(archive?.tags)) {
      setAutoWebtoon(true);
      setAutoMangaEligible(false);
      return undefined;
    }
    if (pages.length < 2) {
      setAutoWebtoon(false);
      setAutoMangaEligible(false);
      return undefined;
    }
    let active = true;
    const detectorImages = new Map();
    (async () => {
      const seams = [];
      const pageSizeSamples = [];
      const count = Math.min(12, pages.length - 1);
      const loadDetectorImage = async (pageUrl) => {
        const source = await resolvePageImageSource(pageUrl);
        return new Promise((resolve, reject) => {
          const image = new Image();
          detectorImages.set(image, reject);
          image.onload = () => {
            detectorImages.delete(image);
            resolve(image);
          };
          image.onerror = (error) => {
            detectorImages.delete(image);
            reject(error);
          };
          image.src = source;
        });
      };
      let previousImage = await loadDetectorImage(pages[0]);
      pageSizeSamples.push({ width: previousImage.naturalWidth, height: previousImage.naturalHeight });
      for (let index = 0; index < count; index++) {
        if (!active) return;
        const nextImage = await loadDetectorImage(pages[index + 1]);
        pageSizeSamples.push({ width: nextImage.naturalWidth, height: nextImage.naturalHeight });
        seams.push(compareSeamPixels(await sampleImageSeam(previousImage, 'bottom'), await sampleImageSeam(nextImage, 'top')));
        previousImage = nextImage;
      }
      const result = classifyWebtoonSeams(seams, { minimumValid: pages.length <= 3 ? 1 : 3 });
      if (active) {
        setAutoWebtoon(result.isWebtoon);
        setAutoMangaEligible(classifyMangaPageSizes(pageSizeSamples).isManga);
      }
    })().catch(() => {
      if (active) {
        setAutoWebtoon(false);
        setAutoMangaEligible(false);
      }
    });
    return () => {
      active = false;
      detectorImages.forEach((reject, image) => {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
        reject(new DOMException('Reader unmounted', 'AbortError'));
      });
      detectorImages.clear();
    };
  }, [archive?.tags, pages, secondaryContentReady, settings.readingLayout]);

  useEffect(() => {
    if (!archive || pages.length === 0) return;
    if (snapshotSaveTimerRef.current) clearTimeout(snapshotSaveTimerRef.current);
    snapshotSaveTimerRef.current = setTimeout(() => {
      snapshotSaveTimerRef.current = null;
      saveReaderStateSnapshot();
    }, 250);
    return () => {
      if (snapshotSaveTimerRef.current) {
        clearTimeout(snapshotSaveTimerRef.current);
        snapshotSaveTimerRef.current = null;
      }
    };
  }, [archive, pages, currentIndex, splitPart, displayedIndex, viewMode, zoomScale, panX, panY, saveReaderStateSnapshot]);

  useEffect(() => {
    if (splitPart !== 1) return;
    const stillSplit = currentSpread.some((unit) => (
      unit.pageIndex === currentIndex && unit.splitPart === 1 && unit.cropSide
    ));
    if (!stillSplit) setSplitPart(0);
  }, [currentIndex, currentSpread, splitPart]);

  useEffect(() => {
    if (pages.length === 0) {
      setPageLoadPhase({ status: 'idle', visibleIndex: 0, targetIndex: 0, shownAt: 0 });
      return;
    }
    setPageLoadPhase((prev) => {
      const visibleIndex = Math.max(0, Math.min(prev.visibleIndex, pages.length - 1));
      const targetIndex = Math.max(0, Math.min(currentIndex, pages.length - 1));
      const targetChanged = targetIndex !== prev.targetIndex;
      const visibleChanged = visibleIndex !== prev.visibleIndex;
      if (!targetChanged && !visibleChanged) return prev;
      return {
        status: targetChanged && targetIndex !== visibleIndex ? 'loading' : prev.status,
        visibleIndex,
        targetIndex,
        shownAt: targetChanged && targetIndex !== visibleIndex ? Date.now() : prev.shownAt,
      };
    });
  }, [currentIndex, pages.length]);

  // Lock body scroll in immersive mode
  useEffect(() => {
    if (viewMode === 'immersive') {
      return acquireBodyScrollLock();
    }
    return undefined;
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'immersive') return undefined;
    const applyStatusBar = (hidden) => {
      try {
        window.ReadoshiAndroid?.setStatusBarHidden(hidden);
      } catch {}
    };
    applyStatusBar(true);
    return () => applyStatusBar(false);
  }, [viewMode]);

  useEffect(() => {
    if (!showSettingsPanel && !showDrawer) return undefined;
    const containReaderOverlayScroll = (event) => {
      if (event.target?.closest?.(READER_OVERLAY_SCROLL_SELECTOR)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('wheel', containReaderOverlayScroll, { capture: true, passive: false });
    document.addEventListener('touchmove', containReaderOverlayScroll, { capture: true, passive: false });
    return () => {
      document.removeEventListener('wheel', containReaderOverlayScroll, true);
      document.removeEventListener('touchmove', containReaderOverlayScroll, true);
    };
  }, [showDrawer, showSettingsPanel]);

  // ── bfcache / visibility / keep-alive guard ──
  const lastFetchedRef = useRef(0);
  useEffect(() => {
    const bump = () => { lastFetchedRef.current = Date.now(); };
    const handlePageShow = (e) => { if (e.persisted) bump(); };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        bump();
      } else {
        if (persistReadingProgress) markBackground({ kind: 'reader', archiveId });
        saveReaderStateSnapshot();
      }
      // No timers to restart in Reader — just bump the ref
    };
    // Release memory on pagehide to reduce kill likelihood
    const handlePageHide = () => {
      if (persistReadingProgress) markBackground({ kind: 'reader', archiveId });
      saveReaderStateSnapshot();
    };
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [archiveId, persistReadingProgress, saveReaderStateSnapshot]);

  // ===== Swipe engine (100% ref+RAF — zero React re-render during drag) =====
  const isSwipingRef = useRef(false);
  const swipeRef = useRef({ startX: 0, startY: 0, offset: 0 });
  const swipeRAF = useRef(null);
  const swipeStartTimeRef = useRef(0);
  const swipeDidMoveRef = useRef(false);
  const swipeContainerRef = useRef(null);
  const imgCurrRef = useRef(null);
  const imgCurrSecondRef = useRef(null);
  const imgLeftRef = useRef(null);
  const imgLeftSecondRef = useRef(null);
  const imgRightRef = useRef(null);
  const imgRightSecondRef = useRef(null);
  const leftDivRef = useRef(null);
  const rightDivRef = useRef(null);
  const immersiveLoadSeqRef = useRef(0);
  const readerCleanupTimersRef = useRef(new Set());
  const watchlistAutoRemovedRef = useRef(new Set());
  const highestObservedPageRef = useRef(new Map());
  const highestLrrSyncedPageRef = useRef(new Map());
  const highestLrrQueuedPageRef = useRef(new Map());
  const lrrProgressChainRef = useRef(new Map());
  const lrrProgressRetryTimersRef = useRef(new Map());
  const commitPageTargetRef = useRef(null);
  const viewModeRef = useRef(viewMode);
  const currentIndexRef = useRef(0);
  const splitPartCurrentRef = useRef(0);
  const currentSpreadIndexRef = useRef(0);
  const readerSpreadsRef = useRef([]);
  const allowProgressRegressionRef = useRef(settings.allowProgressRegression);
  allowProgressRegressionRef.current = settings.allowProgressRegression;

  const scheduleReaderCleanupTimer = useCallback((callback, delay) => {
    const timer = setTimeout(() => {
      readerCleanupTimersRef.current.delete(timer);
      callback();
    }, delay);
    readerCleanupTimersRef.current.add(timer);
    return timer;
  }, []);

  const enqueueLrrProgressSync = useCallback((id, page, { keepalive = false } = {}) => {
    const targetPage = Math.max(0, Number.parseInt(page, 10) || 0);
    if (!persistReadingProgress || !id || targetPage <= 0) return Promise.resolve();

    const syncedPage = highestLrrSyncedPageRef.current.get(id) || 0;
    const queuedPage = highestLrrQueuedPageRef.current.get(id) || 0;
    const allowRegression = allowProgressRegressionRef.current;
    if (!allowRegression && targetPage <= syncedPage) return lrrProgressChainRef.current.get(id) || Promise.resolve();
    if (targetPage === queuedPage && !keepalive) {
      return lrrProgressChainRef.current.get(id) || Promise.resolve();
    }

    highestLrrQueuedPageRef.current.set(id, targetPage);
    const previous = lrrProgressChainRef.current.get(id) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        if ((highestLrrQueuedPageRef.current.get(id) || 0) !== targetPage) return;
        const latestSyncedPage = highestLrrSyncedPageRef.current.get(id) || 0;
        if (targetPage === latestSyncedPage) return;
        if (!allowProgressRegressionRef.current && targetPage < latestSyncedPage) return;
        await lrrApi.updateProgress(id, targetPage, { keepalive });
        rememberArchiveProgressInCatalog(id, targetPage);
        highestLrrSyncedPageRef.current.set(id, targetPage);
        setProgressSyncNotice('');
      })
      .catch(() => {
        setProgressSyncNotice('阅读进度同步失败，将自动重试。');
        if ((highestLrrQueuedPageRef.current.get(id) || 0) === targetPage) {
          const oldTimer = lrrProgressRetryTimersRef.current.get(id);
          if (oldTimer) clearTimeout(oldTimer);
          const timer = setTimeout(() => {
            lrrProgressRetryTimersRef.current.delete(id);
            enqueueLrrProgressSync(id, targetPage);
          }, 5000);
          lrrProgressRetryTimersRef.current.set(id, timer);
        }
      });

    lrrProgressChainRef.current.set(id, next);
    next.finally(() => {
      if (lrrProgressChainRef.current.get(id) === next) {
        lrrProgressChainRef.current.delete(id);
      }
    });
    return next;
  }, [persistReadingProgress]);

  useEffect(() => {
    const flushProgress = ({ keepalive = false } = {}) => {
      if (!persistReadingProgress || !serverTracksProgress || !archiveId) return;
      const page = clampProgressPage(highestObservedPageRef.current.get(archiveId) || 0, pages.length);
      enqueueLrrProgressSync(archiveId, page, { keepalive });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushProgress({ keepalive: true });
    };
    const handlePageHide = () => flushProgress({ keepalive: true });
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibility);
      flushProgress();
    };
  }, [archiveId, enqueueLrrProgressSync, pages.length, persistReadingProgress, serverTracksProgress]);

  // ===== Zoom refs =====
  const zoomScaleRef = useRef(zoomScale);
  const isZoomingRef = useRef(false);
  const zoomWrapperRef = useRef(null);
  const zoomTransformFrameRef = useRef(null);
  const zoomTransformAnimatedRef = useRef(false);
  const wheelZoomCommitTimerRef = useRef(null);
  const webtoonContainerRef = useRef(null);
  const webtoonScrollRafRef = useRef(null);
  const lastTapRef = useRef(0);
  const lastTapPosRef = useRef({ x: 0, y: 0 });
  const singleTapTimerRef = useRef(null);
  const pinchStartRef = useRef({ dist: 0, scale: 1.0, cx: 0, cy: 0 });
  const overshootTimerRef = useRef(null);
  const skipNextClickRef = useRef(false);
  const lastTouchTimeRef = useRef(0);
  const immersiveControlsTimerRef = useRef(null);
  const immersiveTouchGuardUntilRef = useRef(0);

  // ===== Pan refs =====
  const panRef = useRef({ x: panX, y: panY, startX: 0, startY: 0, originX: panX, originY: panY });
  const isPanningRef = useRef(false);

  const hideImmersiveControls = useCallback(() => {
    if (immersiveControlsTimerRef.current) clearTimeout(immersiveControlsTimerRef.current);
    immersiveControlsTimerRef.current = null;
    setImmersiveControlsSide(null);
  }, []);

  const holdImmersiveControls = useCallback((side) => {
    const nextSide = side === 'left' ? 'left' : 'right';
    if (immersiveControlsTimerRef.current) clearTimeout(immersiveControlsTimerRef.current);
    immersiveControlsTimerRef.current = null;
    setImmersiveControlsSide(nextSide);
  }, []);

  const revealImmersiveControls = useCallback((side) => {
    const nextSide = side === 'left' ? 'left' : 'right';
    holdImmersiveControls(nextSide);
    immersiveControlsTimerRef.current = setTimeout(() => {
      immersiveControlsTimerRef.current = null;
      setImmersiveControlsSide(null);
    }, 2500);
  }, [holdImmersiveControls]);

  const armImmersiveTouchGuard = useCallback(() => {
    immersiveTouchGuardUntilRef.current = Date.now() + IMMERSIVE_TOUCH_ACTIVATION_GUARD_MS;
  }, []);

  const consumeImmersiveTouchClick = useCallback((event) => {
    if (Date.now() >= immersiveTouchGuardUntilRef.current) return;
    immersiveTouchGuardUntilRef.current = 0;
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent?.stopImmediatePropagation?.();
  }, []);

  const scheduleZoomTransform = useCallback((animated = false) => {
    zoomTransformAnimatedRef.current = animated;
    if (zoomTransformFrameRef.current) return;
    zoomTransformFrameRef.current = requestAnimationFrame(() => {
      zoomTransformFrameRef.current = null;
      const wrapper = zoomWrapperRef.current;
      if (!wrapper) return;
      wrapper.style.transition = zoomTransformAnimatedRef.current ? 'transform 0.15s ease-out' : 'none';
      wrapper.style.transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${zoomScaleRef.current})`;
    });
  }, []);

  const commitZoomTransform = useCallback((animated = false) => {
    scheduleZoomTransform(animated);
    setPanX(panRef.current.x);
    setPanY(panRef.current.y);
    setZoomScale(zoomScaleRef.current);
  }, [scheduleZoomTransform]);

  const applyZoomAtPoint = useCallback((nextScale, focalX = window.innerWidth / 2, focalY = window.innerHeight / 2, commit = true) => {
    const prevScale = zoomScaleRef.current || 1;
    let scale = Math.max(1, Math.min(5, nextScale));

    if (scale <= 1.01) {
      scale = 1;
      panRef.current = { x: 0, y: 0, startX: 0, startY: 0, originX: 0, originY: 0 };
      zoomScaleRef.current = scale;
      if (commit) commitZoomTransform(true);
      else scheduleZoomTransform();
      return scale;
    }

    const ratio = scale / Math.max(prevScale, 0.001);
    const originX = window.innerWidth / 2;
    const originY = window.innerHeight / 2;
    const focalOffsetX = focalX - originX;
    const focalOffsetY = focalY - originY;
    const maxTx = Math.max(0, (scale - 1) * window.innerWidth / 2);
    const maxTy = Math.max(0, (scale - 1) * window.innerHeight / 2);
    const nextX = Math.max(-maxTx, Math.min(maxTx, ratio * panRef.current.x + (1 - ratio) * focalOffsetX));
    const nextY = Math.max(-maxTy, Math.min(maxTy, ratio * panRef.current.y + (1 - ratio) * focalOffsetY));

    panRef.current = { ...panRef.current, x: nextX, y: nextY };
    zoomScaleRef.current = scale;
    if (commit) commitZoomTransform(true);
    else scheduleZoomTransform();
    return scale;
  }, [commitZoomTransform, scheduleZoomTransform]);

  useEffect(() => () => {
    if (zoomTransformFrameRef.current) cancelAnimationFrame(zoomTransformFrameRef.current);
    if (wheelZoomCommitTimerRef.current) clearTimeout(wheelZoomCommitTimerRef.current);
    if (webtoonScrollRafRef.current) cancelAnimationFrame(webtoonScrollRafRef.current);
  }, []);

  // ===== Refs =====
  const autoTurnTimerRef = useRef(null);
  const progressBarRef = useRef(null);
  const indicatorRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const drawerGridRef = useRef(null);
  const drawerPanelRef = useRef(null);
  const drawerReturnFocusRef = useRef(null);
  const drawerTransitionTimerRef = useRef(null);
  const drawerOpenFrameRef = useRef(null);

  const clearDrawerTransition = useCallback(() => {
    if (drawerTransitionTimerRef.current) {
      clearTimeout(drawerTransitionTimerRef.current);
      drawerTransitionTimerRef.current = null;
    }
    if (drawerOpenFrameRef.current) {
      cancelAnimationFrame(drawerOpenFrameRef.current);
      drawerOpenFrameRef.current = null;
    }
  }, []);

  const openDrawerAfterSideChange = useCallback((side) => {
    setDrawerSide(side);
    drawerOpenFrameRef.current = requestAnimationFrame(() => setShowDrawer(true));
  }, []);

  const closeThumbnailDrawer = useCallback(() => {
    clearDrawerTransition();
    setShowDrawer(false);
  }, [clearDrawerTransition]);

  const openThumbnailDrawer = useCallback((side = 'right') => {
    clearDrawerTransition();
    if (document.activeElement instanceof HTMLElement) drawerReturnFocusRef.current = document.activeElement;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setDrawerSide(side);
      setShowDrawer(true);
      return;
    }
    if (showDrawer && drawerSide === side) return;
    if (showDrawer) {
      setShowDrawer(false);
      drawerTransitionTimerRef.current = setTimeout(() => {
        drawerTransitionTimerRef.current = null;
        openDrawerAfterSideChange(side);
      }, DRAWER_TRANSITION_MS);
      return;
    }
    openDrawerAfterSideChange(side);
  }, [clearDrawerTransition, drawerSide, openDrawerAfterSideChange, showDrawer]);

  useEffect(() => () => clearDrawerTransition(), [clearDrawerTransition]);

  useEffect(() => {
    if (!showDrawer) return undefined;
    const panel = drawerPanelRef.current;
    const previouslyFocused = drawerReturnFocusRef.current || document.activeElement;
    const getFocusable = () => Array.from(panel?.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) || []);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeThumbnailDrawer();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
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
    const focusFrame = requestAnimationFrame(() => getFocusable()[0]?.focus() || panel?.focus());
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [closeThumbnailDrawer, showDrawer]);

  const releaseReaderImageElements = useCallback(() => {
    [imgLeftRef.current, imgLeftSecondRef.current, imgCurrRef.current, imgCurrSecondRef.current, imgRightRef.current, imgRightSecondRef.current].forEach((image) => {
      if (!image) return;
      image.onload = null;
      image.onerror = null;
      image.style.display = 'none';
      image.removeAttribute('src');
      delete image.dataset.pageIndex;
      delete image.dataset.readerUnit;
    });
  }, []);

  useLayoutEffect(() => () => {
    immersiveLoadSeqRef.current += 1;
    readerImageDecodeQueue.cancelAll();
    if (swipeRAF.current) {
      cancelAnimationFrame(swipeRAF.current);
      swipeRAF.current = null;
    }
    readerCleanupTimersRef.current.forEach((timer) => clearTimeout(timer));
    readerCleanupTimersRef.current.clear();
    lrrProgressRetryTimersRef.current.forEach((timer) => clearTimeout(timer));
    lrrProgressRetryTimersRef.current.clear();
    releaseReaderImageElements();
  }, [releaseReaderImageElements]);

  // ===== isMobile detection =====
  useEffect(() => {
    const check = () => setIsMobile(isReaderMobileViewport(window.innerWidth));
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ===== Immersive image loader (raw img.src via ref — never unmounts) =====
  useLayoutEffect(() => {
    if (viewMode !== 'immersive' || webtoonActive || pages.length === 0 || currentSpreadIndex < 0) return;
    const idx = currentIndex;
    const activeSpreadIndex = currentSpreadIndex;
    const activeSpread = readerSpreads[activeSpreadIndex] || [];
    const loadSeq = immersiveLoadSeqRef.current + 1;
    immersiveLoadSeqRef.current = loadSeq;
    let alive = true;
    let resizeObserver = null;
    let decodeSequence = 0;
    const decodeTickets = [];
    const key = localStorage.getItem('lrr_api_key') || '';

    const applyUnitStyle = (image, unit) => {
      const sourceSize = {
        width: Number(image.dataset.sourceWidth) || image.naturalWidth,
        height: Number(image.dataset.sourceHeight) || image.naturalHeight,
      };
      const wide = isWidePageSize(sourceSize);
      const cropped = wide && !!unit?.cropSide;
      const slot = image.parentElement;
      const slotSize = { width: slot?.clientWidth || 0, height: slot?.clientHeight || 0 };
      const cropFrame = cropped
        ? getContainedHalfFrame(
          sourceSize,
          slotSize,
          unit.cropSide,
        )
        : null;
      image.style.position = cropped ? 'absolute' : 'static';
      image.style.top = cropFrame ? `${cropFrame.top}px` : '';
      image.style.left = cropFrame ? `${cropFrame.left}px` : '';
      const rotated = !cropped && settings.rotateWidePagesEnabled && wide;
      image.style.width = cropFrame ? `${cropFrame.width}px` : (rotated ? 'auto' : '100%');
      image.style.height = cropFrame ? `${cropFrame.height}px` : (rotated ? 'auto' : '100%');
      image.style.maxWidth = cropped ? 'none' : (rotated ? `${slotSize.height}px` : '100%');
      image.style.maxHeight = cropped ? 'none' : (rotated ? `${slotSize.width}px` : '100%');
      image.style.objectFit = cropped ? 'fill' : 'contain';
      image.style.clipPath = cropped
        ? (unit.cropSide === 'left' ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)')
        : 'none';
      image.style.transform = rotated ? 'rotate(90deg)' : 'none';
      image.style.transformOrigin = 'center center';
    };

    const loadImg = async (imgRef, unit, priority, preserveVisible = false) => {
      const pageUrl = unit ? pages[unit.pageIndex] : null;
      const pageIndex = unit?.pageIndex;
      if (!pageUrl || !imgRef.current) return false;
      try {
        const initialImage = imgRef.current;
        const unitKey = `${pageIndex}:${unit.splitPart}`;
        if (!preserveVisible && initialImage.dataset.readerUnit !== unitKey) {
          initialImage.style.display = 'none';
          delete initialImage.dataset.pageIndex;
          delete initialImage.dataset.readerUnit;
        }
        const normalized = toLocalUrl(pageUrl);
        const src = assetCacheOnly
          ? await getCachedImage(normalized)
          : await getImage(normalized, async (signal) => {
            const headers = {};
            if (key) headers.Authorization = `Bearer ${encodeApiKey(key)}`;
            const res = await fetch(normalized, { headers, signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.blob();
          }, { priority });
        if (!alive || loadSeq !== immersiveLoadSeqRef.current) return false;
        if (!alive || loadSeq !== immersiveLoadSeqRef.current || !imgRef.current) return false;
        if (src) {
          const image = imgRef.current;
          const precisionKey = settings.optimizedImageDecodeEnabled && !fullPrecisionDecode ? 'optimized' : 'full';
          const imageAlreadyReady = image.dataset.pageIndex === String(pageIndex)
            && image.dataset.decodePrecision === precisionKey
            && image.complete
            && image.naturalWidth > 0;
          if (imageAlreadyReady) {
            return () => {
              image.dataset.readerUnit = unitKey;
              applyUnitStyle(image, unit);
              image.style.display = '';
              return true;
            };
          }
          const decodeTicket = readerImageDecodeQueue.schedule(
            `immersive:${loadSeq}:${unitKey}:${decodeSequence++}`,
            async (signal) => {
              const resolved = await getReaderPreviewSource(src, {
                enabled: settings.optimizedImageDecodeEnabled,
                fullPrecision: fullPrecisionDecode,
                sourceSize: pageSizesRef.current[pageIndex],
                signal,
              });
              const decoded = await decodeImageSource(resolved.src, { signal });
              return {
                src: resolved.src,
                width: resolved.width || decoded.width,
                height: resolved.height || decoded.height,
              };
            },
            priority,
          );
          decodeTickets.push(decodeTicket);
          const decoded = await decodeTicket.promise;
          if (!alive || loadSeq !== immersiveLoadSeqRef.current || image !== imgRef.current) return false;
          return () => {
            if (!alive || loadSeq !== immersiveLoadSeqRef.current || image !== imgRef.current) return false;
            image.src = decoded.src;
            image.dataset.sourceWidth = String(decoded.width);
            image.dataset.sourceHeight = String(decoded.height);
            image.dataset.decodePrecision = precisionKey;
            image.dataset.pageIndex = String(pageIndex);
            image.dataset.readerUnit = unitKey;
            setPageSizes((previous) => {
              const current = previous[pageIndex];
              if (current?.width === decoded.width && current?.height === decoded.height) return previous;
              return { ...previous, [pageIndex]: { width: decoded.width, height: decoded.height } };
            });
            applyUnitStyle(image, unit);
            image.style.display = '';
            return true;
          };
        }
        return false;
      } catch {
        return false;
      }
    };
    const unloadImg = (imgRef) => {
      if (imgRef.current) {
        imgRef.current.src = '';
        imgRef.current.style.display = 'none';
        delete imgRef.current.dataset.pageIndex;
        delete imgRef.current.dataset.readerUnit;
        delete imgRef.current.dataset.decodePrecision;
      }
    };

    const l2r = settings.direction === 'ltr';
    const leftSpreadIndex = activeSpreadIndex + (l2r ? -1 : 1);
    const rightSpreadIndex = activeSpreadIndex + (l2r ? 1 : -1);
    const decodeWindow = new Set(getReaderDecodeWindow(readerSpreads, activeSpreadIndex));
    const leftSpreadCandidate = readerSpreads[leftSpreadIndex] || [];
    const rightSpreadCandidate = readerSpreads[rightSpreadIndex] || [];
    const leftSpread = decodeWindow.has(leftSpreadCandidate) ? leftSpreadCandidate : [];
    const rightSpread = decodeWindow.has(rightSpreadCandidate) ? rightSpreadCandidate : [];
    const styleEntries = [
      [imgCurrRef, activeSpread[0]],
      [imgCurrSecondRef, activeSpread[1]],
      [imgLeftRef, leftSpread[0]],
      [imgLeftSecondRef, leftSpread[1]],
      [imgRightRef, rightSpread[0]],
      [imgRightSecondRef, rightSpread[1]],
    ];
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        for (const [ref, unit] of styleEntries) {
          if (unit && ref.current?.naturalWidth) applyUnitStyle(ref.current, unit);
        }
      });
      for (const [ref] of styleEntries) {
        if (ref.current?.parentElement) resizeObserver.observe(ref.current.parentElement);
      }
    }
    const loadSpread = async (refs, spread, priority, preserveVisible = false) => {
      const first = spread[0]
        ? loadImg(refs[0], spread[0], priority, preserveVisible)
        : Promise.resolve(false);
      const second = spread[1]
        ? loadImg(refs[1], spread[1], priority, preserveVisible)
        : Promise.resolve(() => { unloadImg(refs[1]); return true; });
      const commits = await Promise.all([first, second]);
      if (commits.some((commit) => typeof commit !== 'function')) return false;
      let committed = true;
      commits.forEach((commit) => { committed = commit() && committed; });
      return committed;
    };

    loadSpread([imgCurrRef, imgCurrSecondRef], activeSpread, IMAGE_LOAD_PRIORITY.CRITICAL, true).then((ok) => {
      if (!alive || loadSeq !== immersiveLoadSeqRef.current) return;
      if (currentIndexRef.current !== idx || currentSpreadIndexRef.current !== activeSpreadIndex) return;
      if (ok) {
        setDisplayedIndex(idx);
        setPageLoadPhase((prev) => (
          idx !== prev.targetIndex
            ? prev
            : { status: 'ready', visibleIndex: idx, targetIndex: idx, shownAt: prev.shownAt }
        ));
        void loadSpread([imgLeftRef, imgLeftSecondRef], leftSpread, IMAGE_LOAD_PRIORITY.ADJACENT);
        void loadSpread([imgRightRef, imgRightSecondRef], rightSpread, IMAGE_LOAD_PRIORITY.ADJACENT);
      } else {
        setPageLoadPhase((prev) => (
          idx !== prev.targetIndex
            ? prev
            : { ...prev, status: 'error' }
        ));
      }
    });
    return () => {
      alive = false;
      decodeTickets.forEach((ticket) => ticket.cancel());
      resizeObserver?.disconnect();
    };
  }, [assetCacheOnly, currentIndex, currentSpreadIndex, fullPrecisionDecode, pages, readerSpreads, settings.direction, settings.optimizedImageDecodeEnabled, settings.rotateWidePagesEnabled, viewMode, webtoonActive]);

  // ===== Immersive corner controls =====
  useEffect(() => {
    return () => {
      if (immersiveControlsTimerRef.current) clearTimeout(immersiveControlsTimerRef.current);
    };
  }, [viewMode]);

  // ===== Page number visibility with overlap detection =====
  const pageIndicatorVisibilityMode = settings.pageIndicatorVisibilityMode;
  const [pageNumVisible, setPageNumVisible] = useState(true);
  const [pageIndicatorMode, setPageIndicatorMode] = useState('pinned');
  const pageIndicatorModeRef = useRef('pinned');
  const pageNumTimerRef = useRef(null);
  const pageIndicatorTransientActiveRef = useRef(false);
  const pageNumVisibleRef = useRef(true);
  pageIndicatorModeRef.current = pageIndicatorMode;
  pageNumVisibleRef.current = pageNumVisible;


  const showTransientPageIndicator = useCallback((duration = 1400) => {
    if (pageNumTimerRef.current) clearTimeout(pageNumTimerRef.current);
    pageIndicatorTransientActiveRef.current = true;
    setPageNumVisible(true);
    setPageIndicatorMode('transient');
    pageNumTimerRef.current = setTimeout(() => {
      pageIndicatorTransientActiveRef.current = false;
      pageNumTimerRef.current = null;
      setPageNumVisible(false);
    }, duration);
  }, []);

  const checkIndicatorOverlap = useCallback((preferVisible = false) => {
    const indicator = indicatorRef.current;
    const imgEl = imgCurrRef.current;
    if (!indicator || !imgEl) return;

    const imageRect = imgEl.getBoundingClientRect();
    const renderRect = computeContainedImageRect(imageRect, imgEl.naturalWidth, imgEl.naturalHeight);
    const measuredRect = indicator.getBoundingClientRect();
    const loweredShift = isMobile ? 10 : 8;
    const currentShift = pageIndicatorModeRef.current === 'lowered'
      ? loweredShift
      : (pageNumVisibleRef.current ? 0 : 12);
    const baseRect = {
      left: measuredRect.left,
      right: measuredRect.right,
      top: measuredRect.top - currentShift,
      bottom: measuredRect.bottom - currentShift,
    };
    const previousPlacement = pageNumVisibleRef.current ? pageIndicatorModeRef.current : 'hidden';
    const placement = resolvePageIndicatorPlacement(previousPlacement, renderRect, baseRect, loweredShift);
    if (placement === 'pinned' || placement === 'lowered') {
      if (pageNumTimerRef.current) clearTimeout(pageNumTimerRef.current);
      pageNumTimerRef.current = null;
      pageIndicatorTransientActiveRef.current = false;
      setPageIndicatorMode(placement);
      setPageNumVisible(true);
      return;
    }

    if (preferVisible) {
      showTransientPageIndicator();
      return;
    }

    if (pageIndicatorTransientActiveRef.current) {
      setPageIndicatorMode('transient');
      setPageNumVisible(true);
      return;
    }

    setPageIndicatorMode('transient');
    setPageNumVisible(false);
  }, [isMobile, showTransientPageIndicator]);

  useEffect(() => {
    if (viewMode !== 'immersive' || pageIndicatorVisibilityMode !== 'auto') {
      setPageNumVisible(true);
      setPageIndicatorMode('pinned');
      if (pageNumTimerRef.current) clearTimeout(pageNumTimerRef.current);
      pageNumTimerRef.current = null;
      pageIndicatorTransientActiveRef.current = false;
      if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
      return;
    }

    if (pageNumTimerRef.current) clearTimeout(pageNumTimerRef.current);
    pageNumTimerRef.current = null;
    pageIndicatorTransientActiveRef.current = false;
    setPageNumVisible(true);
    setPageIndicatorMode('pinned');

    let overlapFrame = 0;
    const scheduleOverlapCheck = () => {
      if (overlapFrame) return;
      overlapFrame = requestAnimationFrame(() => {
        overlapFrame = 0;
        checkIndicatorOverlap();
      });
    };
    overlapFrame = requestAnimationFrame(() => {
      overlapFrame = 0;
      checkIndicatorOverlap(true);
    });
    const ro = new ResizeObserver(scheduleOverlapCheck);
    resizeObserverRef.current = ro;

    const imgEl = imgCurrRef.current;
    if (imgEl) {
      ro.observe(imgEl);
      imgEl.addEventListener('load', scheduleOverlapCheck);
    }
    window.addEventListener('resize', scheduleOverlapCheck, { passive: true });
    window.visualViewport?.addEventListener('resize', scheduleOverlapCheck, { passive: true });
    window.visualViewport?.addEventListener('scroll', scheduleOverlapCheck, { passive: true });

    return () => {
      if (pageNumTimerRef.current) clearTimeout(pageNumTimerRef.current);
      pageNumTimerRef.current = null;
      pageIndicatorTransientActiveRef.current = false;
      ro.disconnect();
      if (overlapFrame) cancelAnimationFrame(overlapFrame);
      if (imgEl) imgEl.removeEventListener('load', scheduleOverlapCheck);
      window.removeEventListener('resize', scheduleOverlapCheck);
      window.visualViewport?.removeEventListener('resize', scheduleOverlapCheck);
      window.visualViewport?.removeEventListener('scroll', scheduleOverlapCheck);
    };
  }, [viewMode, pageIndicatorVisibilityMode, checkIndicatorOverlap]);

  // ===== Inject scrollbar-hide CSS =====
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'lrr-reader-scrollbar-hidden';
    style.innerHTML = `
      .no-scrollbar::-webkit-scrollbar { display: none !important; }
      .no-scrollbar { scrollbar-width: none !important; -ms-overflow-style: none !important; }
      [data-reader-immersive-stage="true"]:not([data-webtoon="true"]) { touch-action: none !important; }
      .reader-page-enter { transform: translateX(100%); }
      .reader-page-enter-active { transform: translateX(0); transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1); }
      .reader-page-exit { transform: translateX(0); }
      .reader-page-exit-active { transform: translateX(-100%); transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1); }
    `;
    document.head.appendChild(style);
    return () => { const el = document.getElementById('lrr-reader-scrollbar-hidden'); if (el) el.remove(); };
  }, []);

  // ===== 1. Init archive =====
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++bootstrapGenerationRef.current;
    const isActive = () => !controller.signal.aborted && generation === bootstrapGenerationRef.current;
    const init = async () => {
      const serverUrl = serverUrlRef.current;

      if (coldRestoreRef.current && readerSnapshot) {
        const progressWasCleared = hasArchiveProgressMarker(archiveId);
        let restoredArchive = readerSnapshot.archive || null;
        if (persistReadingProgress && archiveHasNewMarker(restoredArchive) && !progressWasCleared) {
          try {
            await lrrApi.updateProgress(archiveId, 1);
            rememberArchiveProgressInCatalog(archiveId, 1);
            highestLrrSyncedPageRef.current.set(archiveId, Math.max(1, highestLrrSyncedPageRef.current.get(archiveId) || 0));
            restoredArchive = clearArchiveNewMarker(restoredArchive);
          } catch {}
        }
        if (!isActive()) return;
        const restoredPages = Array.isArray(readerSnapshot.pages) ? readerSnapshot.pages : [];
        const restoredLrrProgress = clampProgressPage(restoredArchive?.progress, restoredPages.length);
        const restoredLocalProgress = clampProgressPage(Number.parseInt(
          getHistory().find((item) => item.id === archiveId)?.page,
          10,
        ) || 0, restoredPages.length);
        const restoredSnapshotProgress = clampProgressPage((readerSnapshot.currentIndex || 0) + 1, restoredPages.length);
        const restoredCanonicalProgress = allowProgressRegressionRef.current
          ? (restoredLocalProgress || restoredLrrProgress)
          : Math.max(restoredLrrProgress, restoredLocalProgress);
        const restoredHighestPage = progressWasCleared ? 0 : restoredCanonicalProgress;
        highestLrrSyncedPageRef.current.set(archiveId, progressWasCleared ? 0 : restoredLrrProgress);
        highestObservedPageRef.current.set(archiveId, restoredHighestPage);
        const restoredIndex = progressWasCleared ? 0 : Math.min(
          Math.max(0, restoredPages.length - 1),
          Math.max(readerSnapshot.currentIndex || 0, restoredHighestPage - 1),
        );
        setArchive(restoredArchive);
        setPages(restoredPages);
        setCurrentIndex(restoredIndex);
        setDisplayedIndex(restoredIndex);
        setPageLoadPhase({
          status: 'loading',
          visibleIndex: restoredIndex,
          targetIndex: restoredIndex,
          shownAt: Date.now(),
        });
        setViewMode(readerSnapshot.viewMode || 'normal');
        setShowHeader(readerSnapshot.showHeader ?? true);
        const restoredZoom = readerSnapshot.zoomScale || 1.0;
        const restoredPanX = readerSnapshot.panX || 0;
        const restoredPanY = readerSnapshot.panY || 0;
        zoomScaleRef.current = restoredZoom;
        panRef.current = { x: restoredPanX, y: restoredPanY, startX: 0, startY: 0, originX: restoredPanX, originY: restoredPanY };
        setZoomScale(restoredZoom);
        setPanX(restoredPanX);
        setPanY(restoredPanY);
        dispatchRender({ type: 'reset', hasMetadata: !!restoredArchive, hasManifest: restoredPages.length > 0, hasSelection: true });
        return;
      }

      const retainedArchive = archiveRef.current;
      const retainedPages = pagesRef.current;
      dispatchRender({
        type: 'reset',
        hasMetadata: !!retainedArchive,
        hasManifest: retainedPages.length > 0,
        hasSelection: false,
      });

      const metadataPromise = retainedArchive ? Promise.resolve(retainedArchive) : (async () => {
        try {
          const meta = await loadReaderBootstrapResource(
            () => lrrApi.getArchive(archiveId, { signal: controller.signal }),
            { isActive },
          );
          if (!isActive()) throw new DOMException('Reader bootstrap aborted', 'AbortError');
          archiveRef.current = meta;
          setArchive(meta);
          dispatchRender({ type: 'ready', resource: 'metadata' });
          if (persistReadingProgress && archiveHasNewMarker(meta) && !hasArchiveProgressMarker(archiveId)) {
            void lrrApi.updateProgress(archiveId, 1).then(() => {
              if (!isActive()) return;
              rememberArchiveProgressInCatalog(archiveId, 1);
              highestLrrSyncedPageRef.current.set(archiveId, Math.max(1, highestLrrSyncedPageRef.current.get(archiveId) || 0));
              const updatedMeta = { ...clearArchiveNewMarker(meta), progress: Math.max(1, Number.parseInt(meta.progress, 10) || 0) };
              archiveRef.current = updatedMeta;
              setArchive(updatedMeta);
            }).catch(() => {});
          }
          return meta;
        } catch (error) {
          if (!controller.signal.aborted) {
            dispatchRender({ type: 'error', resource: 'metadata', error });
            if (isArchiveMissingError(error)) removeHistoryItem(archiveId).catch(() => {});
          }
          throw error;
        }
      })();

      const manifestPromise = retainedPages.length > 0 ? Promise.resolve(retainedPages) : (async () => {
        try {
          const response = await loadReaderBootstrapResource(
            () => lrrApi.getArchiveFiles(archiveId, { signal: controller.signal }),
            { isActive },
          );
          if (!isActive()) throw new DOMException('Reader bootstrap aborted', 'AbortError');
          const extractedPages = (response.pages || []).map((url) => normalizePageUrl(url, serverUrl)).filter(Boolean);
          pagesRef.current = extractedPages;
          setPages(extractedPages);
          dispatchRender({ type: 'ready', resource: 'manifest' });
          return extractedPages;
        } catch (error) {
          if (!controller.signal.aborted) {
            dispatchRender({ type: 'error', resource: 'manifest', error });
            if (isArchiveMissingError(error)) removeHistoryItem(archiveId).catch(() => {});
          }
          throw error;
        }
      })();

      const [metadataResult, manifestResult] = await Promise.allSettled([metadataPromise, manifestPromise]);
      if (!isActive()) return;
      if (manifestResult.status === 'fulfilled') {
        const meta = metadataResult.status === 'fulfilled' ? metadataResult.value : archiveRef.current;
        const extractedPages = manifestResult.value;
        setPages(extractedPages);
        const lrrProgress = clampProgressPage(meta?.progress, extractedPages.length);
        const localProgress = clampProgressPage(Number.parseInt(
          getHistory().find((item) => item.id === archiveId)?.page,
          10,
        ) || 0, extractedPages.length);
        const progressWasCleared = hasArchiveProgressMarker(archiveId);
        const savedProgress = progressWasCleared
          ? 0
          : (allowProgressRegressionRef.current ? (localProgress || lrrProgress) : Math.max(lrrProgress, localProgress));
        highestLrrSyncedPageRef.current.set(archiveId, progressWasCleared ? 0 : lrrProgress);
        highestObservedPageRef.current.set(archiveId, savedProgress);
        if (savedProgress > 0 && savedProgress <= extractedPages.length) {
          setCurrentIndex(savedProgress - 1);
          setDisplayedIndex(savedProgress - 1);
          setPageLoadPhase({ status: 'loading', visibleIndex: savedProgress - 1, targetIndex: savedProgress - 1, shownAt: Date.now() });
        } else {
          setDisplayedIndex(0);
          setPageLoadPhase({ status: extractedPages.length > 0 ? 'loading' : 'idle', visibleIndex: 0, targetIndex: 0, shownAt: extractedPages.length > 0 ? Date.now() : 0 });
        }
        dispatchRender({ type: 'ready', resource: 'selection' });
      } else if (!controller.signal.aborted) {
        dispatchRender({ type: 'error', resource: 'selection', error: manifestResult.reason });
        console.error('画廊页面列表加载失败:', manifestResult.reason);
      }
    };
    void init();
    return () => controller.abort();
  }, [archiveId, bootstrapRetryToken, persistReadingProgress, readerSnapshot]);

  // ===== 2. Save progress =====
  useEffect(() => {
    if (archive && pages.length > 0 && persistReadingProgress) {
      if (settings.splitWidePagesEnabled && !webtoonActive
        && currentSpread.some((unit) => !pageSizes[unit.pageIndex])) return undefined;
      const page = getSpreadProgressPage(currentSpread);
      const archiveId = archive.arcid || archive.id;
      const progressWasCleared = hasArchiveProgressMarker(archiveId);
      if (!shouldPersistArchiveReadingProgress(progressWasCleared, page)) {
        highestObservedPageRef.current.set(archiveId, 0);
        return undefined;
      }
      if (progressWasCleared) clearArchiveProgressMarker(archiveId);
      const observedPage = highestObservedPageRef.current.get(archiveId) || 0;
      const highestPage = clampProgressPage(
        settings.allowProgressRegression ? page : Math.max(observedPage, page),
        pages.length,
      );
      highestObservedPageRef.current.set(archiveId, highestPage);
      saveHistory(archive, highestPage, {
        immediateRemote: serverTracksProgress === false,
        allowRegression: settings.allowProgressRegression,
      }).catch(() => {});
      setHistoryEntries(getHistory());
      const totalPages = Number(archive.pagecount || pages.length) || 0;
      if (archiveId && totalPages > 0 && highestPage / totalPages > 0.8 && !watchlistAutoRemovedRef.current.has(archiveId)) {
        watchlistAutoRemovedRef.current.add(archiveId);
        removeWatchlistItem(archiveId).catch(() => {});
      }
      if (serverTracksProgress && archiveId) {
        enqueueLrrProgressSync(archiveId, highestPage);
      }
    }
    return undefined;
  }, [archive, currentSpread, enqueueLrrProgressSync, pageSizes, pages, persistReadingProgress, serverTracksProgress, settings.allowProgressRegression, settings.splitWidePagesEnabled, webtoonActive]);

  // ===== Pointer down =====
  const handlePointerDown = useCallback((e) => {
    if (viewMode !== 'immersive' || webtoonActive) return;

    const touches = e.touches;
    const isTouchEvent = !!touches;

    if (isTouchEvent && touches.length >= 2) {
      isZoomingRef.current = true;
      isSwipingRef.current = false;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      pinchStartRef.current = {
        dist: Math.hypot(dx, dy),
        scale: zoomScaleRef.current,
        cx: (touches[0].clientX + touches[1].clientX) / 2,
        cy: (touches[0].clientY + touches[1].clientY) / 2,
      };
      return;
    }

    // Mobile browsers synthesize a mousedown event 100-300ms after touchstart.
    // If this mousedown arrives within 500ms of a real touch, skip tap tracking
    // to avoid falsely detecting a single tap as a double-tap.
    const now = Date.now();
    if (!isTouchEvent && now - lastTouchTimeRef.current < 500) return;
    if (isTouchEvent) lastTouchTimeRef.current = now;

    const clientX = isTouchEvent ? touches[0].clientX : e.clientX;
    const clientY = isTouchEvent ? touches[0].clientY : e.clientY;

    // Double-tap detection (works in both 100% and zoomed states)
    const dxTap = Math.abs(clientX - lastTapPosRef.current.x);
    const dyTap = Math.abs(clientY - lastTapPosRef.current.y);
    if (now - lastTapRef.current < 350 && dxTap < 30 && dyTap < 30) {
      if (singleTapTimerRef.current) { clearTimeout(singleTapTimerRef.current); singleTapTimerRef.current = null; }
      lastTapRef.current = 0;
      skipNextClickRef.current = true;
      const isZoomed = zoomScaleRef.current !== 1.0;
      const w = window.innerWidth;
      if (isZoomed) {
        applyZoomAtPoint(1.0, clientX, clientY);
      } else if (clientX >= w * 0.42 && clientX <= w * 0.58) {
        applyZoomAtPoint(1.75, clientX, clientY);
      }
      return;
    }
    lastTapRef.current = now;
    lastTapPosRef.current = { x: clientX, y: clientY };

    if (zoomScaleRef.current !== 1.0) {
      isPanningRef.current = true;
      panRef.current = {
        x: panRef.current.x, y: panRef.current.y,
        startX: clientX, startY: clientY,
        originX: panRef.current.x, originY: panRef.current.y,
      };
      swipeDidMoveRef.current = false;
      return;
    }

    swipeRef.current = { startX: clientX, startY: clientY, offset: 0 };
    swipeStartTimeRef.current = Date.now();
    swipeDidMoveRef.current = false;
    isSwipingRef.current = true;
    if (swipeRAF.current) { cancelAnimationFrame(swipeRAF.current); swipeRAF.current = null; }
    const sctr = swipeContainerRef.current;
    if (sctr) { sctr.style.transition = 'none'; sctr.style.transform = 'translateX(0px)'; }
    if (leftDivRef.current)  { leftDivRef.current.style.transition = 'none'; leftDivRef.current.style.transform = 'translateX(-100%)'; }
    if (rightDivRef.current) { rightDivRef.current.style.transition = 'none'; rightDivRef.current.style.transform = 'translateX(100%)'; }
  }, [applyZoomAtPoint, viewMode, webtoonActive]);

  // ===== Pointer move (RAF-batched — translateX only, zero adjacent manipulation) =====
  const handlePointerMove = useCallback((e) => {
    if (viewMode !== 'immersive' || webtoonActive) return;

    const touches = e.touches;
    if (touches && touches.length >= 2 && isZoomingRef.current) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchStartRef.current.dist > 0) {
        let scale = pinchStartRef.current.scale * (dist / pinchStartRef.current.dist);
        if (scale > 3.15) scale = 3.15;
        if (scale < 0.95) scale = 0.95;
        const cx = (touches[0].clientX + touches[1].clientX) / 2;
        const cy = (touches[0].clientY + touches[1].clientY) / 2;
        applyZoomAtPoint(scale, cx, cy, false);
      }
      return;
    }
    const moveClientX = touches ? touches[0].clientX : e.clientX;
    const moveClientY = touches ? touches[0].clientY : e.clientY;
    if (zoomScaleRef.current !== 1.0 || !isSwipingRef.current) {
      if (isPanningRef.current) {
        const dx = moveClientX - panRef.current.startX;
        const dy = moveClientY - panRef.current.startY;
        panRef.current.x = panRef.current.originX + dx;
        panRef.current.y = panRef.current.originY + dy;
        scheduleZoomTransform();
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) swipeDidMoveRef.current = true;
      }
      return;
    }

    const clientX = moveClientX;
    const clientY = moveClientY;
    const deltaX = clientX - swipeRef.current.startX;
    const deltaY = clientY - swipeRef.current.startY;
    if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return;
    swipeDidMoveRef.current = true;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      const curIdx = currentSpreadIndexRef.current;
      const totalPages = readerSpreadsRef.current.length;
      const l2r = settings.direction === 'ltr';
      const atFirst = curIdx === 0;
      const atLast = curIdx >= totalPages - 1;
      const toPrev = l2r ? (deltaX > 0) : (deltaX < 0);
      const toNext = l2r ? (deltaX < 0) : (deltaX > 0);
      const isBoundary = (atFirst && toPrev) || (atLast && toNext);

      // Always record the raw delta so handlePointerUp can evaluate the real
      // distance and velocity — clamping the visual transform must not clip the
      // data that the up-handler uses for the flip decision.
      swipeRef.current.offset = deltaX;

      if (!swipeRAF.current) {
        swipeRAF.current = requestAnimationFrame(() => {
          const raw = swipeRef.current.offset;
          const clamped = isBoundary ? Math.max(-50, Math.min(50, raw)) : raw;
          const sctr = swipeContainerRef.current;
          const ldiv = leftDivRef.current;
          const rdiv = rightDivRef.current;
          if (sctr) sctr.style.transform = `translateX(${clamped}px)`;
          if (!isBoundary || !(atFirst && toPrev)) {
            if (ldiv) ldiv.style.transform = `translateX(calc(-100% + ${clamped}px))`;
          }
          if (!isBoundary || !(atLast && toNext)) {
            if (rdiv) rdiv.style.transform = `translateX(calc(100% + ${clamped}px))`;
          }
          swipeRAF.current = null;
        });
      }
    }
  }, [applyZoomAtPoint, scheduleZoomTransform, settings.direction, viewMode, webtoonActive]);

  // ===== Pointer up =====
  const handlePointerUp = useCallback(() => {
    if (webtoonActive) return;
    if (isZoomingRef.current) {
      isZoomingRef.current = false;
      pinchStartRef.current.dist = 0;
      // Snap back from overshoot
      const s = zoomScaleRef.current;
      let target = s;
      if (s > 3.0) target = 3.0;
      else if (s > 2.95) target = 3.0;
      if (s < 1.0) target = 1.0;
      else if (s < 1.05) target = 1.0;
      if (target !== s) {
        applyZoomAtPoint(target, pinchStartRef.current.cx || window.innerWidth / 2, pinchStartRef.current.cy || window.innerHeight / 2);
      } else {
        commitZoomTransform();
      }
      return;
    }
    if (isPanningRef.current) {
      isPanningRef.current = false;
      const s = zoomScaleRef.current;
      const maxTx = Math.max(0, (s - 1) * window.innerWidth / 2);
      const maxTy = Math.max(0, (s - 1) * window.innerHeight / 2);
      panRef.current.x = Math.max(-maxTx, Math.min(maxTx, panRef.current.x));
      panRef.current.y = Math.max(-maxTy, Math.min(maxTy, panRef.current.y));
      commitZoomTransform(true);
      return;
    }
    if (zoomScaleRef.current !== 1.0 || !isSwipingRef.current) return;
    isSwipingRef.current = false;

    if (swipeRAF.current) { cancelAnimationFrame(swipeRAF.current); swipeRAF.current = null; }

    const animOut = (off) => {
      const s = swipeContainerRef.current, l = leftDivRef.current, r = rightDivRef.current;
      [s, l, r].forEach(el => { if (el) el.style.transition = 'transform 150ms ease-out'; });
      if (s) s.style.transform = `translateX(${off}px)`;
      if (l) l.style.transform = `translateX(calc(-100% + ${off}px))`;
      if (r) r.style.transform = `translateX(calc(100% + ${off}px))`;
    };
    const animReset = (off) => {
      const s = swipeContainerRef.current, l = leftDivRef.current, r = rightDivRef.current;
      [s, l, r].forEach(el => { if (el) el.style.transition = 'transform 180ms ease-out'; });
      if (s) s.style.transform = `translateX(${off}px)`;
      if (l) l.style.transform = `translateX(calc(-100% + ${off}px))`;
      if (r) r.style.transform = `translateX(calc(100% + ${off}px))`;
    };
    const resetAll = () => {
      const s = swipeContainerRef.current, l = leftDivRef.current, r = rightDivRef.current;
      if (s) { s.style.transition = 'none'; s.style.transform = 'translateX(0px)'; }
      if (l) { l.style.transition = 'none'; l.style.transform = 'translateX(-100%)'; }
      if (r) { r.style.transition = 'none'; r.style.transform = 'translateX(100%)'; }
    };

    const deltaX = swipeRef.current.offset;
    const elapsed = Math.max(Date.now() - swipeStartTimeRef.current, 1);
    const velocity = Math.abs(deltaX) / elapsed;

    const imgEl = imgCurrRef.current;
    const imgWidth = imgEl ? imgEl.offsetWidth : window.innerWidth;
    const threshold = Math.max(imgWidth * 0.20, 55);

    const l2r = settings.direction === 'ltr';
    const curIdx = currentSpreadIndexRef.current;
    const totalPages = readerSpreadsRef.current.length;
    const atFirst = curIdx === 0;
    const atLast = curIdx >= totalPages - 1;
    const toPrev = l2r ? (deltaX > 0) : (deltaX < 0);
    const toNext = l2r ? (deltaX < 0) : (deltaX > 0);
    const spreadDelta = toPrev ? -1 : 1;
    const targetLocation = getAdjacentSpreadLocation(
      readerSpreadsRef.current,
      { pageIndex: currentIndexRef.current, splitPart: splitPartCurrentRef.current },
      spreadDelta,
    );
    const nextIdx = targetLocation?.pageIndex ?? currentIndexRef.current;

    const shouldFlip = Math.abs(deltaX) > threshold || velocity > 0.55;

    if (atFirst && toPrev) {
      animReset(0);
      scheduleReaderCleanupTimer(resetAll, 180);
      return;
    }

    if (atLast && toNext) {
      if (shouldFlip && Math.abs(deltaX) > 8) {
        animOut((deltaX > 0 ? 1 : -1) * window.innerWidth);
        scheduleReaderCleanupTimer(() => {
          flushSync(() => {
            setViewMode('normal');
          });
          resetAll();
        }, 150);
        return;
      } else {
        animReset(0);
        scheduleReaderCleanupTimer(resetAll, 180);
        return;
      }
    }

    if (shouldFlip && Math.abs(deltaX) > 8) {
      const dir = deltaX > 0 ? 1 : -1;
      animOut(dir * window.innerWidth);
      scheduleReaderCleanupTimer(() => {
        const targetIndex = nextIdx;
        const targetSplitPart = targetLocation?.splitPart ?? 0;
        flushSync(() => {
          commitPageTargetRef.current?.(targetIndex, {
            targetSplitPart,
            showIndicator: true,
            preserveSwipePosition: true,
          });
        });
        resetAll();
      }, 150);
      return;
    }

    animReset(0);
    scheduleReaderCleanupTimer(resetAll, 180);
  }, [applyZoomAtPoint, commitZoomTransform, scheduleReaderCleanupTimer, settings.direction, webtoonActive]);

  // ===== Click zones: left 45% / middle 10% / right 45% (top 12% excluded on mobile) =====
  const handleScreenClick = useCallback((e) => {
    if (viewMode !== 'immersive' || webtoonActive) return;
    if (skipNextClickRef.current) { skipNextClickRef.current = false; return; }
    if (swipeDidMoveRef.current) { swipeDidMoveRef.current = false; return; }
    if (zoomScaleRef.current !== 1.0) return;
    if (immersiveControlsSide) {
      hideImmersiveControls();
      return;
    }

    const x = e.clientX;
    const w = window.innerWidth;

    if (x < w * 0.45) {
      settings.direction === 'ltr' ? handlePrevRef.current() : handleNextRef.current();
    } else if (x > w * 0.55) {
      settings.direction === 'ltr' ? handleNextRef.current() : handlePrevRef.current();
    }
  }, [hideImmersiveControls, immersiveControlsSide, viewMode, settings.direction, webtoonActive]);

  // ===== Wheel zoom =====
  useEffect(() => {
    if (viewMode !== 'immersive' || webtoonActive) return;
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (showDrawer) return;
      if (e.cancelable) e.preventDefault();
      const delta = -e.deltaY * 0.002;
      let s = zoomScaleRef.current + delta;
      if (s < 1) s = 1;
      if (s > 5) s = 5;
      if (Math.abs(s - zoomScaleRef.current) > 0.01) {
        applyZoomAtPoint(s, e.clientX, e.clientY, false);
        if (wheelZoomCommitTimerRef.current) clearTimeout(wheelZoomCommitTimerRef.current);
        wheelZoomCommitTimerRef.current = setTimeout(() => {
          wheelZoomCommitTimerRef.current = null;
          commitZoomTransform();
        }, 80);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelZoomCommitTimerRef.current) {
        clearTimeout(wheelZoomCommitTimerRef.current);
        wheelZoomCommitTimerRef.current = null;
      }
    };
  }, [applyZoomAtPoint, commitZoomTransform, showDrawer, viewMode, webtoonActive]);

  const promoteImmersiveTarget = useCallback((targetIndex, targetSplitPart) => {
    if (viewMode !== 'immersive' || webtoonActive || currentSpreadIndex < 0) return false;
    const targetSpreadIndex = findSpreadIndex(readerSpreads, {
      pageIndex: targetIndex,
      splitPart: targetSplitPart,
    });
    if (targetSpreadIndex < 0 || Math.abs(targetSpreadIndex - currentSpreadIndex) !== 1) return false;

    const l2r = settings.direction === 'ltr';
    const leftSpreadIndex = currentSpreadIndex + (l2r ? -1 : 1);
    const sourceRefs = targetSpreadIndex === leftSpreadIndex
      ? [imgLeftRef, imgLeftSecondRef]
      : [imgRightRef, imgRightSecondRef];
    const targetRefs = [imgCurrRef, imgCurrSecondRef];
    const targetSpread = readerSpreads[targetSpreadIndex] || [];
    const sourcesReady = targetSpread.length > 0 && targetSpread.every((unit, index) => {
      const source = sourceRefs[index]?.current;
      return source
        && (source.currentSrc || source.src)
        && source.dataset.pageIndex === String(unit.pageIndex)
        && source.dataset.readerUnit === `${unit.pageIndex}:${unit.splitPart}`
        && source.style.display !== 'none'
        && source.complete
        && source.naturalWidth > 0;
    });
    if (!sourcesReady) return false;

    targetRefs.forEach((targetRef, index) => {
      const target = targetRef.current;
      const source = sourceRefs[index]?.current;
      const unit = targetSpread[index];
      if (!target) return;
      if (!source || !unit) {
        target.src = '';
        target.style.display = 'none';
        delete target.dataset.pageIndex;
        delete target.dataset.readerUnit;
        delete target.dataset.decodePrecision;
        delete target.dataset.sourceWidth;
        delete target.dataset.sourceHeight;
        return;
      }
      target.src = source.currentSrc || source.src;
      target.style.display = '';
      target.dataset.pageIndex = String(unit.pageIndex);
      target.dataset.readerUnit = source.dataset.readerUnit;
      target.dataset.decodePrecision = source.dataset.decodePrecision;
      target.dataset.sourceWidth = source.dataset.sourceWidth;
      target.dataset.sourceHeight = source.dataset.sourceHeight;
    });
    return true;
  }, [currentSpreadIndex, readerSpreads, settings.direction, viewMode, webtoonActive]);

  const commitPageTarget = useCallback((targetIndex, { targetSplitPart = 0, resetZoom = true, showIndicator = false, assumeVisible = false, preserveSwipePosition = false } = {}) => {
    if (pages.length === 0) return;
    const bounded = Math.max(0, Math.min(targetIndex, pages.length - 1));
    const promoted = promoteImmersiveTarget(bounded, targetSplitPart);
    const visibleImmediately = assumeVisible || promoted;
    void exitColdRestoreMode();
    if (resetZoom) {
      zoomScaleRef.current = 1.0;
      panRef.current = { x: 0, y: 0, startX: 0, startY: 0, originX: 0, originY: 0 };
      scheduleZoomTransform();
      setPanX(0);
      setPanY(0);
      setZoomScale(1.0);
    }
    if (showIndicator && viewMode === 'immersive') {
      showTransientPageIndicator();
      requestAnimationFrame(() => checkIndicatorOverlap(true));
    }
    if (visibleImmediately) {
      setDisplayedIndex(bounded);
    }
    setSplitPart(targetSplitPart === 1 ? 1 : 0);
    setCurrentIndex(bounded);
    setPageLoadPhase((prev) => ({
      status: visibleImmediately || bounded === prev.visibleIndex ? 'ready' : 'loading',
      visibleIndex: visibleImmediately ? bounded : prev.visibleIndex,
      targetIndex: bounded,
      shownAt: visibleImmediately || bounded === prev.visibleIndex ? prev.shownAt : Date.now(),
    }));
    if (!preserveSwipePosition && swipeContainerRef.current) swipeContainerRef.current.style.transform = 'translateX(0px)';
  }, [checkIndicatorOverlap, exitColdRestoreMode, pages.length, promoteImmersiveTarget, scheduleZoomTransform, showTransientPageIndicator, viewMode]);
  commitPageTargetRef.current = commitPageTarget;

  // ===== 3. Auto turn timer =====
  useEffect(() => {
    const pageReady = pageLoadPhase.status === 'ready' && pageLoadPhase.targetIndex === currentIndex;
    if (settings.autoTurnActive && viewMode === 'immersive' && !webtoonActive && pageReady) {
      if (progressBarRef.current) {
        progressBarRef.current.style.transition = 'none';
        progressBarRef.current.style.width = '0%';
        void progressBarRef.current.offsetWidth;
        progressBarRef.current.style.transition = `width ${settings.autoTurnInterval}s linear`;
        progressBarRef.current.style.width = '100%';
      }
      autoTurnTimerRef.current = setTimeout(() => handleNextRef.current(), settings.autoTurnInterval * 1000);
    } else {
      if (autoTurnTimerRef.current) clearTimeout(autoTurnTimerRef.current);
      if (progressBarRef.current) {
        progressBarRef.current.style.transition = 'none';
        progressBarRef.current.style.width = '0%';
      }
    }
    return () => { if (autoTurnTimerRef.current) clearTimeout(autoTurnTimerRef.current); };
  }, [settings.autoTurnActive, currentIndex, splitPart, currentSpreadIndex, settings.autoTurnInterval, viewMode, pageLoadPhase.status, pageLoadPhase.targetIndex, webtoonActive]);

  // ===== Page flip =====
  const handleNext = useCallback(() => {
    const target = getAdjacentSpreadLocation(readerSpreads, { pageIndex: currentIndex, splitPart }, 1);
    if (!target || currentSpreadIndex >= readerSpreads.length - 1) {
      if (viewMode !== 'immersive') return;
      setViewMode('normal');
      return;
    }
    commitPageTarget(target.pageIndex, { targetSplitPart: target.splitPart, showIndicator: viewMode === 'immersive' });
  }, [commitPageTarget, currentIndex, currentSpreadIndex, readerSpreads, splitPart, viewMode]);

  const handlePrev = useCallback(() => {
    const target = getAdjacentSpreadLocation(readerSpreads, { pageIndex: currentIndex, splitPart }, -1);
    if (!target || currentSpreadIndex <= 0) return;
    commitPageTarget(target.pageIndex, { targetSplitPart: target.splitPart, showIndicator: viewMode === 'immersive' });
  }, [commitPageTarget, currentIndex, currentSpreadIndex, readerSpreads, splitPart, viewMode]);

  const handleClearCurrentProgress = useCallback(async () => {
    if (!archive || progressClearing) return;
    setProgressClearing(true);
    setProgressNotice('');
    try {
      const id = archive.arcid || archive.id;
      const retryTimer = lrrProgressRetryTimersRef.current.get(id);
      if (retryTimer) clearTimeout(retryTimer);
      lrrProgressRetryTimersRef.current.delete(id);
      highestLrrQueuedPageRef.current.set(id, 0);
      await (lrrProgressChainRef.current.get(id) || Promise.resolve()).catch(() => {});
      const result = await clearConfiguredArchiveReadingProgress(archive);
      highestObservedPageRef.current.set(id, result.page);
      highestLrrSyncedPageRef.current.set(id, result.page);
      highestLrrQueuedPageRef.current.set(id, result.page);
      setArchive((previous) => {
        const next = previous ? { ...previous, progress: result.page, page: result.page } : previous;
        archiveRef.current = next;
        return next;
      });
      setHistoryEntries(getHistory());
      commitPageTarget(0, { targetSplitPart: 0 });
      setProgressNotice(result.fallback ? '服务器不支持清零，已回退到第一页。' : '阅读进度已清除，已返回第一页。');
    } catch (error) {
      setProgressNotice(`清除阅读进度失败：${error?.message || '未知错误'}`);
    } finally {
      setProgressClearing(false);
    }
  }, [archive, commitPageTarget, progressClearing]);

  const handleNextRef = useRef(handleNext);
  const handlePrevRef = useRef(handlePrev);
  handleNextRef.current = handleNext;
  handlePrevRef.current = handlePrev;
  viewModeRef.current = viewMode;

  const handlePageVisualLoadStart = useCallback((pageIndex) => {
    if (typeof pageIndex !== 'number') return;
    setPageLoadPhase((prev) => (
      pageIndex !== prev.targetIndex
        ? prev
        : { ...prev, status: 'loading' }
    ));
  }, []);

  const handlePageNaturalSize = useCallback((pageIndex, size) => {
    if (!Number.isInteger(pageIndex) || !size?.width || !size?.height) return;
    setPageSizes((previous) => {
      const current = previous[pageIndex];
      if (current?.width === size.width && current?.height === size.height) return previous;
      return { ...previous, [pageIndex]: size };
    });
  }, []);

  const handleWebtoonScroll = useCallback(() => {
    if (webtoonScrollRafRef.current) return;
    webtoonScrollRafRef.current = requestAnimationFrame(() => {
      webtoonScrollRafRef.current = null;
      const container = webtoonContainerRef.current;
      if (!container) return;
      const viewport = container.getBoundingClientRect();
      const centerY = viewport.top + viewport.height / 2;
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      container.querySelectorAll('[data-webtoon-page]').forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) return;
        const distance = Math.abs((rect.top + rect.bottom) / 2 - centerY);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = Number.parseInt(element.dataset.webtoonPage, 10);
        }
      });
      if (!Number.isInteger(bestIndex) || bestIndex < 0 || bestIndex === currentIndexRef.current) return;
      currentIndexRef.current = bestIndex;
      setSplitPart(0);
      setCurrentIndex(bestIndex);
      setDisplayedIndex(bestIndex);
      setPageLoadPhase((previous) => ({
        status: 'ready',
        visibleIndex: bestIndex,
        targetIndex: bestIndex,
        shownAt: previous.shownAt,
      }));
    });
  }, []);

  useLayoutEffect(() => {
    if (!webtoonActive) return undefined;
    const frame = requestAnimationFrame(() => {
      const container = webtoonContainerRef.current;
      const target = container?.querySelector(`[data-webtoon-page="${currentIndexRef.current}"]`);
      if (!container || !target) return;
      container.scrollTop = Math.max(0, target.offsetTop - (container.clientHeight - target.clientHeight) / 2);
      handleWebtoonScroll();
    });
    return () => cancelAnimationFrame(frame);
  }, [handleWebtoonScroll, viewMode, webtoonActive]);

  const handlePageVisualReady = useCallback((pageIndex) => {
    if (typeof pageIndex !== 'number') return;
    setDisplayedIndex(pageIndex);
    setPageLoadPhase((prev) => (
      pageIndex !== prev.targetIndex
        ? prev
        : { status: 'ready', visibleIndex: pageIndex, targetIndex: pageIndex, shownAt: prev.shownAt }
    ));
  }, []);

  const normalSpreadKey = currentSpread
    .map((unit) => `${unit.pageIndex}:${unit.splitPart}`)
    .join('|');
  const normalSpreadReadyRef = useRef({ key: '', pages: new Set() });
  if (normalSpreadReadyRef.current.key !== normalSpreadKey) {
    normalSpreadReadyRef.current = { key: normalSpreadKey, pages: new Set() };
  }
  const handleNormalSpreadUnitReady = useCallback((pageIndex) => {
    const readyState = normalSpreadReadyRef.current;
    if (readyState.key !== normalSpreadKey) return;
    readyState.pages.add(pageIndex);
    if (currentSpread.every((unit) => readyState.pages.has(unit.pageIndex))) {
      handlePageVisualReady(currentIndex);
    }
  }, [currentIndex, currentSpread, handlePageVisualReady, normalSpreadKey]);

  const handlePageVisualError = useCallback((pageIndex) => {
    if (typeof pageIndex !== 'number') return;
    setPageLoadPhase((prev) => (
      pageIndex !== prev.targetIndex
        ? prev
        : { ...prev, status: 'error' }
    ));
  }, []);

  const confirmRemoveHistory = useCallback(() => {
    if (!historyDeleteTarget?.id) return;
    removeHistoryItem(historyDeleteTarget.id).catch(() => {});
    setHistoryEntries(getHistory());
    setHistoryDeleteTarget(null);
  }, [historyDeleteTarget]);

  const handleRemoveWatchlist = useCallback((item) => {
    const id = item?.id || item?.arcid;
    if (!id) return;
    removeWatchlistItem(id).finally(() => setWatchlistEntries(getWatchlist()));
  }, []);

  const handleSetCover = useCallback(() => {
    if (!archiveId || pages.length === 0 || coverSetting) return;
    setCoverConfirmPage(currentIndex + 1);
  }, [archiveId, coverSetting, currentIndex, pages.length]);

  const confirmSetCover = useCallback(async () => {
    if (!archiveId || !coverConfirmPage || coverSetting) return;
    const page = coverConfirmPage;
    setCoverSetting(true);
    try {
      await lrrApi.setArchiveThumbnail(archiveId, page);
      await deleteImageKeys([`thumb:${archiveId}`, `thumb:hist:${archiveId}`]);
      setCoverSetPage(page);
      setCoverConfirmPage(0);
      scheduleReaderCleanupTimer(() => setCoverSetPage((prev) => (prev === page ? 0 : prev)), 1800);
    } catch (err) {
      alert(err.message || '设置封面失败');
    } finally {
      setCoverSetting(false);
    }
  }, [archiveId, coverConfirmPage, coverSetting, scheduleReaderCleanupTimer]);

  // ===== Back handler: immersive → normal mode, not home =====
  const handleGoBack = useCallback(() => {
    if (viewMode === 'immersive') {
      setViewMode('normal');
    } else {
      if (archive && pages.length > 0) {
        const highestPage = clampProgressPage(Math.max(
          highestObservedPageRef.current.get(archiveId) || 0,
          getSpreadProgressPage(currentSpread),
        ), pages.length);
        if (persistReadingProgress && shouldPersistArchiveReadingProgress(hasArchiveProgressMarker(archiveId), highestPage)) {
          saveHistory(archive, highestPage).then(() => flushHistorySync()).catch(() => {});
          if (serverTracksProgress) enqueueLrrProgressSync(archiveId, highestPage);
          setHistoryEntries(getHistory());
        }
      }
      onBack();
    }
  }, [archive, archiveId, currentSpread, enqueueLrrProgressSync, onBack, pages.length, persistReadingProgress, serverTracksProgress, viewMode]);

  // ===== Preload indices =====
  const getPreloadIndices = () => {
    const indices = [];
    const forwardFirst = settings.direction === 'ltr' ? 1 : -1;
    for (let i = 1; i <= settings.preloadCount; i++) {
      const primary = currentIndex + (i * forwardFirst);
      const secondary = currentIndex - (i * forwardFirst);
      if (primary >= 0 && primary < pages.length) indices.push(primary);
      if (secondary >= 0 && secondary < pages.length) indices.push(secondary);
    }
    return indices;
  };

  const currentTags = archive?.tags?.split(',').map((t) => t.trim()).filter(Boolean) || [];
  const sourceTag = currentTags.find((t) => t.toLowerCase().startsWith('source:'));
  const rawSourceUrl = sourceTag ? sourceTag.replace(/source:\s*/i, '') : null;
  const sourceUrl = (() => {
    if (!rawSourceUrl) return null;
    try {
      const u = new URL(/^https?:\/\//i.test(rawSourceUrl) ? rawSourceUrl : 'https://' + rawSourceUrl);
      if (u.hostname === 'e-hentai.org' || u.hostname === 'exhentai.org') return rawSourceUrl;
    } catch {}
    return null;
  })();
  const groupedTags = useMemo(() => categorizeTags(currentTags), [archive?.tags]);
  const archiveSizeLabel = formatArchiveSize(archive?.size ?? archive?.filesize ?? archive?.file_size);

  const historyList = useMemo(() => {
    return hideRead ? historyEntries.filter(h => !(h.total > 0 && h.page >= h.total)) : historyEntries;
  }, [hideRead, historyEntries]);
  const watchlistWithProgress = useMemo(
    () => mergeWatchlistProgress(watchlistEntries, historyEntries),
    [historyEntries, watchlistEntries],
  );
  const archivePanel = getReaderArchivePanelModel(archivePanelType, {
    historyItems: historyList,
    watchlistItems: watchlistWithProgress,
    randomItems: randomEntries,
    historyEmptyMessage: hideRead && historyEntries.length > 0 ? '所有档案均已读完' : '暂无阅读历史',
    watchlistEmptyMessage: '暂无待看档案',
    randomEmptyMessage: randomEntriesLoading ? '正在获取随机档案…' : (randomEntriesError || '暂无随机漫游结果'),
    removeHistory: setHistoryDeleteTarget,
    removeWatchlist: handleRemoveWatchlist,
  });

  const loadRandomEntries = useCallback(() => {
    let active = true;
    setRandomEntriesLoading(true);
    setRandomEntriesError('');
    lrrApi.getRandom(16)
      .then((response) => {
        const data = Array.isArray(response?.data) ? response.data : [];
        if (active) setRandomEntries(filterRandomArchives(data, historyEntries, randomHideRead));
      })
      .catch((error) => {
        if (active) {
          setRandomEntries([]);
          setRandomEntriesError(`随机档案加载失败：${error?.message || '请重试'}`);
        }
      })
      .finally(() => {
        if (active) setRandomEntriesLoading(false);
      });
    return () => { active = false; };
  }, [historyEntries, randomHideRead]);

  useEffect(() => {
    if (!showArchivePanel || archivePanelType !== 'random') return undefined;
    return loadRandomEntries();
  }, [archivePanelType, loadRandomEntries, showArchivePanel]);

  useEffect(() => {
    if (viewMode !== 'immersive') return;
    setShowSettingsPanel(false);
    setShowArchivePanel(false);
  }, [viewMode]);

  const drawerGridWidth = Math.max(0, drawerViewport.width || (isMobile ? 0 : 372));
  const drawerRowStride = getDrawerRowStride(drawerGridWidth);
  const drawerTotalRows = Math.ceil(pages.length / DRAWER_COLUMNS);
  const drawerVisibleStartRow = Math.max(0, Math.floor((drawerViewport.scrollTop / Math.max(drawerRowStride, 1))) - DRAWER_OVERSCAN_ROWS);
  const drawerVisibleEndRow = Math.min(
    drawerTotalRows,
    Math.ceil(((drawerViewport.scrollTop + drawerViewport.height) / Math.max(drawerRowStride, 1))) + DRAWER_OVERSCAN_ROWS,
  );
  const drawerSliceStart = drawerVisibleStartRow * DRAWER_COLUMNS;
  const drawerSliceEnd = Math.min(pages.length, Math.max(drawerSliceStart, drawerVisibleEndRow * DRAWER_COLUMNS));
  const drawerVisiblePages = pages.slice(drawerSliceStart, drawerSliceEnd);
  const drawerTopSpacer = drawerVisibleStartRow * drawerRowStride;
  const drawerBottomSpacer = Math.max(0, (drawerTotalRows - drawerVisibleEndRow) * drawerRowStride);

  useEffect(() => {
    if (!showDrawer || pages.length === 0) {
      setDrawerPrefetchSet(new Set());
      return undefined;
    }

    const firstWave = new Set();
    const preloadRadius = 6;
    for (let offset = -preloadRadius; offset <= preloadRadius; offset += 1) {
      const idx = currentIndex + offset;
      if (idx >= 0 && idx < pages.length) firstWave.add(idx);
    }
    const viewportStart = Math.max(0, drawerSliceStart - DRAWER_COLUMNS);
    const viewportEnd = Math.min(pages.length, drawerSliceEnd + DRAWER_COLUMNS);
    for (let idx = viewportStart; idx < viewportEnd; idx += 1) {
      firstWave.add(idx);
    }
    setDrawerPrefetchSet(firstWave);
    return undefined;
  }, [currentIndex, drawerSliceEnd, drawerSliceStart, pages.length, showDrawer]);

  useEffect(() => {
    if (!showDrawer || !archiveId || pages.length === 0 || assetCacheOnly) {
      if (!showDrawer) setThumbnailQueueState('idle');
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setThumbnailQueueState('loading');
      lrrApi.queueArchivePageThumbnails(archiveId)
        .then(() => { if (!cancelled) setThumbnailQueueState('ready'); })
        .catch((error) => {
          if (!cancelled) setThumbnailQueueState(error?.message || 'error');
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [archiveId, assetCacheOnly, pages.length, showDrawer, thumbnailQueueRetryToken]);

  useEffect(() => {
    if (!showDrawer) {
      setDrawerViewport((prev) => (prev.height === 0 && prev.scrollTop === 0 && prev.width === 0
        ? prev
        : { height: 0, scrollTop: 0, width: 0 }));
      return undefined;
    }

    const el = drawerGridRef.current;
    if (!el) return undefined;

    const updateViewport = () => {
      const nextTop = el.scrollTop;
      const nextHeight = el.clientHeight;
      const paddingRight = Number.parseFloat(window.getComputedStyle(el).paddingRight) || 0;
      const nextWidth = Math.max(0, Math.round(el.clientWidth - paddingRight));

      setDrawerViewport((prev) => {
        const prevRowStride = getDrawerRowStride(prev.width || nextWidth);
        const nextRowStride = getDrawerRowStride(nextWidth);
        const prevStartRow = Math.max(0, Math.floor((prev.scrollTop / Math.max(prevRowStride, 1))) - DRAWER_OVERSCAN_ROWS);
        const prevEndRow = Math.min(
          Math.ceil(pages.length / DRAWER_COLUMNS),
          Math.ceil(((prev.scrollTop + prev.height) / Math.max(prevRowStride, 1))) + DRAWER_OVERSCAN_ROWS,
        );
        const nextStartRow = Math.max(0, Math.floor((nextTop / Math.max(nextRowStride, 1))) - DRAWER_OVERSCAN_ROWS);
        const nextEndRow = Math.min(
          Math.ceil(pages.length / DRAWER_COLUMNS),
          Math.ceil(((nextTop + nextHeight) / Math.max(nextRowStride, 1))) + DRAWER_OVERSCAN_ROWS,
        );
        const next = {
          height: nextHeight,
          scrollTop: nextTop,
          width: nextWidth,
        };
        if (
          prev.height === next.height &&
          prev.width === next.width &&
          prevStartRow === nextStartRow &&
          prevEndRow === nextEndRow
        ) {
          return prev;
        }
        return next;
      });
    };

    updateViewport();
    el.addEventListener('scroll', updateViewport, { passive: true });
    window.addEventListener('resize', updateViewport);

    return () => {
      el.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [showDrawer]);

  useEffect(() => {
    if (!showDrawer) return;
    const el = drawerGridRef.current;
    if (!el || drawerRowStride <= 0) return;
    const targetRow = Math.max(0, Math.floor(currentIndex / DRAWER_COLUMNS) - 1);
    const targetTop = targetRow * drawerRowStride;
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const nextTop = Math.max(0, Math.min(targetTop, maxTop));
    if (Math.abs(el.scrollTop - nextTop) > 8) {
      el.scrollTop = nextTop;
      const paddingRight = Number.parseFloat(window.getComputedStyle(el).paddingRight) || 0;
      const nextWidth = Math.max(0, Math.round(el.clientWidth - paddingRight));
      setDrawerViewport((prev) => (
        prev.scrollTop === nextTop && prev.height === el.clientHeight && prev.width === nextWidth
          ? prev
          : { ...prev, scrollTop: nextTop, height: el.clientHeight, width: nextWidth }
      ));
    }
  }, [currentIndex, drawerRowStride, showDrawer]);

  useEffect(() => {
    if (!canRenderPage) return undefined;
    const timer = setTimeout(() => {
      const hasVisiblePage = pages.length > 0;
      const hasSource = !!sourceUrl;
      if (hasVisiblePage && assetCacheOnly) {
        void exitColdRestoreMode();
      } else if (hasSource) {
        const recPanel = document.querySelector('[data-lrr-recommendations]');
        const commentPanel = document.querySelector('[data-lrr-eh-comments]');
        if (!recPanel || !commentPanel) {
          void exitColdRestoreMode();
        }
      }
    }, 1800);
    return () => clearTimeout(timer);
  }, [assetCacheOnly, canRenderPage, exitColdRestoreMode, pages.length, sourceUrl]);

  useEffect(() => {
    if (pages.length === 0) return;
    if (coldRestoreRef.current) return;
    if (pageLoadPhase.status !== 'ready' || pageLoadPhase.targetIndex !== currentIndex) return;
    const indices = getPreloadIndices();
    indices.slice(0, settings.preloadCount).forEach((idx, order) => {
      const pageUrl = pages[idx];
      if (pageUrl) primePageBlob(pageUrl, IMAGE_LOAD_PRIORITY.ADJACENT - order).catch(() => {});
    });
    // Pre-generate previews for the two adjacent pages (front/back) at the
    // lowest decode priority: skipped while flipping, so the next flip only
    // decodes the small preview instead of the full original + webp encode.
    indices.slice(0, 2).forEach((idx) => {
      const pageUrl = pages[idx];
      if (pageUrl) {
        primePagePreview(pageUrl, {
          enabled: settings.optimizedImageDecodeEnabled,
          sourceSize: pageSizesRef.current[idx],
        }).catch(() => {});
      }
    });
  }, [currentIndex, pageLoadPhase.status, pageLoadPhase.targetIndex, pages, settings.direction, settings.optimizedImageDecodeEnabled, settings.preloadCount]);

  // ===== Outside-click to close panels =====
  useEffect(() => {
    if (!showSettingsPanel && !showArchivePanel) return;
    if (!canShowMetadata) return undefined;
    const handler = (e) => {
      const t = e.target;
      if (t?.closest?.('[data-panel]') || t?.closest?.('[data-panel-toggle]') || t?.closest?.('[data-select-dropdown]') || t?.closest?.('[data-dialog-root]') || t?.closest?.('[data-dialog-overlay]')) return;
      setShowSettingsPanel(false);
      setShowArchivePanel(false);
    };
    window.addEventListener('mousedown', handler, { passive: true });
    return () => window.removeEventListener('mousedown', handler);
  }, [canShowMetadata, showArchivePanel, showSettingsPanel]);

  const isLTR = settings.direction === 'ltr';
  const leftAction = isLTR ? handlePrev : handleNext;
  const rightAction = isLTR ? handleNext : handlePrev;
  const atFirstSpread = currentSpreadIndex <= 0;
  const atLastSpread = currentSpreadIndex >= readerSpreads.length - 1;
  const leftDisabled = !canNavigate || (isLTR ? atFirstSpread : atLastSpread);
  const rightDisabled = !canNavigate || (isLTR ? atLastSpread : atFirstSpread);

  const showSrToast = useCallback((message) => {
    setSrToast(message);
    if (srToastTimerRef.current) clearTimeout(srToastTimerRef.current);
    srToastTimerRef.current = setTimeout(() => setSrToast(''), 3600);
  }, []);

  const handleToggleSrEnabled = useCallback((enabled) => {
    if (enabled && !srSupport.supported) {
      showSrToast(srSupport.reason || '当前环境不支持超分。');
      return;
    }
    updateSettings((s) => ({ ...s, srEnabled: enabled }));
  }, [srSupport, showSrToast, updateSettings]);

  const btnBase = getTopBarButtonStyle(toolbarCompact);

  const navBtnBase = getPageNavButtonStyle(isMobile);
  const normalReaderFrameStyle = {
    ...getNormalReaderFrameStyle(isMobile),
    maxWidth: effectiveReadingLayout === 'double' ? '1300px' : '850px',
  };
  const scaleStyle = settings.scaleMode === 'fit-width' ? { width: '100%', height: 'auto', objectFit: 'contain' }
    : settings.scaleMode === 'fit-height' ? { width: 'auto', height: '100%', objectFit: 'contain' }
      : settings.scaleMode === 'original' ? { width: 'auto', height: 'auto', maxWidth: 'none', maxHeight: 'none', objectFit: 'none' }
        : { width: '100%', height: '100%', objectFit: 'contain' };
  const normalTargetIndex = Math.max(0, Math.min(currentIndex, Math.max(pages.length - 1, 0)));
  const targetPending = pages.length > 0 && currentIndex !== displayedIndex;
  const displayedSpreadIndex = findSpreadIndex(readerSpreads, { pageIndex: displayedIndex, splitPart });
  const displayedSpread = readerSpreads[Math.max(0, displayedSpreadIndex)] || [];
  const normalSpreadRenderState = getPendingSpreadRenderState(currentSpread, displayedSpread, targetPending);
  const normalPagePending = targetPending && !webtoonActive;
  const pageSwitchLabel = normalPagePending ? `正在切换到第 ${normalTargetIndex + 1} 页…` : '';
  const immersivePagePending = viewMode === 'immersive' && normalPagePending;
  const spreadPageNumbers = [...new Set(currentSpread.map((unit) => unit.pageIndex + 1))].sort((a, b) => a - b);
  const normalPageLabel = currentSpread.some((unit) => unit.cropSide)
    ? `${normalTargetIndex + 1}（${splitPart + 1}/2） / ${pages.length}`
    : `${spreadPageNumbers.join('–') || normalTargetIndex + 1} / ${pages.length}`;
  const immersiveLeftSpread = readerSpreads[currentSpreadIndex + (isLTR ? -1 : 1)] || [];
  const immersiveRightSpread = readerSpreads[currentSpreadIndex + (isLTR ? 1 : -1)] || [];
  const immersiveDoublePageGap = Math.min(6, Math.max(0, Number(settings.doublePageGap) || 0));
  const getImmersiveUnitRatio = (unit) => {
    const size = pageSizes[unit?.pageIndex];
    const width = Math.max(1, Number(size?.width) || 1);
    const height = Math.max(1, Number(size?.height) || 1);
    if (unit?.cropSide) return (width / 2) / height;
    return settings.rotateWidePagesEnabled && isWidePageSize(size) ? height / width : width / height;
  };
  const getImmersiveSpreadGeometryFor = (spread) => getImmersiveSpreadGeometry({
    viewportWidth: readerContainerWidth,
    viewportHeight: readerContainerHeight,
    gap: immersiveDoublePageGap,
    ratios: spread.map(getImmersiveUnitRatio),
  });
  const immersiveSlotStyle = {
    flex: '0 0 auto',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  };
  const getImmersiveSpreadSlotStyle = (spread, slotIndex) => {
    const geometry = getImmersiveSpreadGeometryFor(spread);
    return {
    ...immersiveSlotStyle,
    width: `${geometry.pageWidths[slotIndex] || 0}px`,
    justifyContent: 'center',
    boxSizing: 'border-box',
    };
  };
  const getImmersiveSpreadGroupStyle = (spread) => {
    const geometry = getImmersiveSpreadGeometryFor(spread);
    return {
      width: `${geometry.width}px`,
      height: `${geometry.height}px`,
      display: 'flex',
      gap: `${geometry.gap}px`,
      justifyContent: 'center',
      alignItems: 'center',
      flex: '0 0 auto',
    };
  };
  const pageIndicatorShouldRender = pageIndicatorVisibilityMode !== 'hidden';
  const pageIndicatorShouldShow = zoomScale === 1.0 && (
    pageIndicatorVisibilityMode === 'pinned' ||
    (pageIndicatorVisibilityMode === 'auto' && pageNumVisible)
  );
  // Keep swipe-related refs in sync (closure-free access for handlePointerMove/Up)
  currentIndexRef.current = currentIndex;
  splitPartCurrentRef.current = splitPart;
  currentSpreadIndexRef.current = Math.max(0, currentSpreadIndex);
  readerSpreadsRef.current = readerSpreads;
  const settingsPanelTop = Math.ceil(toolbarRef.current?.getBoundingClientRect().bottom || 0);

  return (
    <div
      ref={containerRef}
      className="reader-root"
      data-ios={isIosWebKit ? 'true' : 'false'}
      style={{
        minHeight: '100vh',
        background: viewMode === 'normal' ? 'transparent' : 'var(--immersive-bg)',
        color: viewMode === 'immersive' ? 'var(--immersive-text)' : 'var(--text-main)',
      }}
    >
      {progressSyncNotice && (
        <div className="reader-sync-status" role="status" aria-live="polite">{progressSyncNotice}</div>
      )}
      <div
        data-reader-normal-flow
        style={viewMode === 'normal'
          ? { display: 'flex', flexDirection: 'column', position: 'relative', touchAction: 'manipulation' }
          : { height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', touchAction: webtoonActive ? 'pan-y' : 'none' }}
      >
        {/* ===== Top Bar ===== */}
        {viewMode === 'normal' && (
        <div
          ref={toolbarRef}
          className="reader-toolbar"
          data-reader-toolbar
          data-mobile={isMobile ? 'true' : 'false'}
          data-mode={toolbarMode}
          data-compact={toolbarCompact ? 'true' : 'false'}
          style={{
            padding: '14px 24px',
            background: 'var(--reader-toolbar-bg)',
            backdropFilter: 'blur(16px)',
            borderBottom: '1px solid var(--reader-control-border)',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
            columnGap: '16px',
            alignItems: 'center',
            position: 'sticky',
            top: 0, left: 0, right: 0, zIndex: 100,
          }}
        >
          <div className="reader-toolbar-group reader-toolbar-group-left" style={{ gridColumn: '1', display: 'flex', alignItems: 'center', gap: toolbarCompact ? '6px' : '16px', minWidth: 0 }}>
            <button className="reader-toolbar-button" style={btnBase} onClick={handleGoBack} title="返回" aria-label="返回">
              <ReaderToolbarButtonContent icon="back" label="返回" size={20} />
            </button>
            {viewMode !== 'immersive' && (
              <button
                className="reader-toolbar-button"
                disabled={!canNavigate}
                style={{ ...btnBase, opacity: canNavigate ? 1 : 0.45, cursor: canNavigate ? 'pointer' : 'not-allowed' }}
                data-panel-toggle
                onClick={() => { if (canNavigate) { setShowArchivePanel((visible) => !visible); setShowSettingsPanel(false); } }}
                title="快速跳转"
                aria-label="打开快速跳转"
              >
                <ReaderToolbarButtonContent icon="quickJump" label="快速跳转" />
              </button>
            )}
          </div>

          {toolbarMode !== 'mobile' && (
            <span
              lang={getContentLanguage(archive?.title)}
              className="reader-toolbar-title"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: '15px',
                fontWeight: 'bold',
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                width: 'min(var(--reader-toolbar-title-width, 240px), calc(100% - 48px))',
                minWidth: 0,
              }}
            >
              <span className="reader-toolbar-title-content" style={{ display: 'inline-block' }}>
                {canShowMetadata ? archive?.title : (
                  <span
                    className={renderState.metadata.status === 'error' ? 'reader-slot-error' : 'reader-title-skeleton reader-shell-pulse'}
                    role="status"
                    aria-live="polite"
                  >
                    {renderState.metadata.status === 'error' ? '元数据加载失败' : '正在加载元数据…'}
                  </span>
                )}
              </span>
            </span>
          )}
          {toolbarMode === 'mobile' && <span style={{ minWidth: 0 }} />}

          <div className="reader-toolbar-group reader-toolbar-group-right" style={{ gridColumn: '3', display: 'flex', alignItems: 'center', gap: toolbarCompact ? '6px' : '8px', justifyContent: 'flex-end', minWidth: 0 }}>
            {viewMode === 'immersive' && !webtoonActive && (
              <button className="reader-toolbar-button" style={btnBase} onClick={() => updateSettings((s) => ({ ...s, autoTurnActive: !s.autoTurnActive }))} title={settings.autoTurnActive ? '停止翻页' : '自动翻页'} aria-label={settings.autoTurnActive ? '停止翻页' : '自动翻页'}>
                <ReaderToolbarButtonContent
                  icon={settings.autoTurnActive ? 'pause' : 'play'}
                  label={settings.autoTurnActive ? '停止翻页' : '自动翻页'}
                />
              </button>
            )}
            {viewMode === 'normal' && (
              <button
                className="reader-toolbar-button"
                disabled={!canRenderPage}
                style={{ ...btnBase, opacity: canRenderPage ? 1 : 0.45, cursor: canRenderPage ? 'pointer' : 'not-allowed' }}
                onClick={() => { if (canRenderPage) setViewMode('immersive'); }}
                title="沉浸模式"
                aria-label="沉浸模式"
              >
                <ReaderToolbarButtonContent icon="fullscreen" label="沉浸模式" />
              </button>
            )}
            <button
              className="reader-toolbar-button"
              disabled={!canNavigate || coverSetting}
              style={{
                ...btnBase,
                opacity: (!canNavigate || coverSetting) ? 0.45 : 1,
                cursor: (!canNavigate || coverSetting) ? 'not-allowed' : 'pointer',
              }}
              onClick={handleSetCover}
              title={`将当前第 ${currentIndex + 1} 页设为封面`}
              aria-label={`将当前第 ${currentIndex + 1} 页设为封面`}
            >
              <ReaderToolbarButtonContent
                icon="cover"
                label={coverSetting ? '设置中...' : coverSetPage === currentIndex + 1 ? '已设为封面' : '设为封面'}
              />
            </button>
            {viewMode !== 'immersive' && (
              <>
                <button className="reader-toolbar-button" style={btnBase} data-panel-toggle onClick={() => { setShowSettingsPanel((v) => !v); setShowArchivePanel(false); }} title="阅读设定" aria-label="阅读设定">
                  <ReaderToolbarButtonContent icon="settings" label="阅读设定" />
                </button>
              </>
            )}
            <button
              className="reader-toolbar-button"
              disabled={!canNavigate}
              style={{ ...btnBase, opacity: canNavigate ? 1 : 0.45, cursor: canNavigate ? 'pointer' : 'not-allowed' }}
              onClick={() => { if (canNavigate) openThumbnailDrawer('right'); }}
              title="缩略面板"
              aria-label="缩略面板"
            >
              <ReaderToolbarButtonContent icon="grid" label="缩略面板" />
            </button>
          </div>
        </div>
        )}

        {/* ===== Settings Panel ===== */}
        {showSettingsPanel && createPortal(
          <div data-panel="settings"
            className="reader-panel-surface glass-panel dropdown-animate"
            style={{
              position: 'fixed',
              top: `${settingsPanelTop + 8}px`,
              right: 'max(20px, calc(var(--app-safe-area-right) + 12px))',
              maxHeight: `calc(100dvh - ${settingsPanelTop + 8}px - max(12px, calc(var(--app-safe-area-bottom) + 8px)))`,
              zIndex: 9999,
              padding: '22px',
              borderRadius: '14px',
              width: 'min(380px, calc(100vw - 40px))',
              boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
              border: '1px solid var(--reader-control-border)',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div data-reader-overlay-scroll className="no-scrollbar" style={{ overflowY: 'auto', overscrollBehavior: 'contain', touchAction: 'pan-y', flex: 1 }}>
            <div className="settings-category-tabs" role="tablist" aria-label="阅读设置分类">
              {[
                ['general', '通用'],
                ['reading', '阅读'],
                ['other', '其他'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={settingsCategory === key}
                  className={`btn settings-category-tab${settingsCategory === key ? ' is-active' : ''}`}
                  onClick={() => setSettingsCategory(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 通用 */}
            <div className={`settings-section${settingsCategory === 'general' ? ' is-active' : ''}`}>
              <div className="settings-section-inner">
                <div className="settings-group">
                  <div className="settings-row">
                    <SettingHint text={'页码指示器：阅读时显示当前页/总页数。\n自动避让：图片靠近指示器时自动移动，避免遮挡。\n隐藏：不显示页码。'}>页码指示器</SettingHint>
                    <div className="settings-control"><CustomSelect value={settings.pageIndicatorVisibilityMode} options={[{ label: '自动避让', value: 'auto' }, { label: '始终显示', value: 'pinned' }, { label: '隐藏', value: 'hidden' }]} onChange={(v) => updateSettings((s) => ({ ...s, pageIndicatorVisibilityMode: v }))} compact /></div>
                  </div>
                  <div className="settings-row">
                    <SettingHint text={'适应屏幕：整页缩放到完全可见。\n适应宽度：按页面宽度铺满。\n适应高度：按视口高度铺满。\n原始尺寸：显示图片原始像素。'}>缩放模式</SettingHint>
                    <div className="settings-control"><CustomSelect value={settings.scaleMode} options={[{ label: '适应屏幕', value: 'fit-screen' }, { label: '适应宽度', value: 'fit-width' }, { label: '适应高度', value: 'fit-height' }, { label: '原始尺寸', value: 'original' }]} onChange={(v) => updateSettings((s) => ({ ...s, scaleMode: v }))} compact /></div>
                  </div>
                  <div className="settings-row">
                    <SettingHint text={'自动识别并裁掉图片四周的白色或空边，让画面更紧凑。'}>自动裁白边</SettingHint>
                    <div className="settings-control settings-toggle-control"><ToggleSwitch label="自动裁白边" checked={settings.cropBordersEnabled} onChange={(checked) => updateSettings((s) => ({ ...s, cropBordersEnabled: checked }))} /></div>
                  </div>
                  <div className="settings-row">
                    <SettingHint text={'提前加载后续页面的图片，翻页时更流畅。\n范围：1–10 页。'}>预加载</SettingHint>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" className="input-glass no-spinner"
                      value={preloadInput}
                      onChange={(e) => { const raw = e.target.value; setPreloadInput(raw); const n = parseInt(raw, 10); if (!isNaN(n) && n >= 1 && n <= 10) { updateSettings((s) => ({ ...s, preloadCount: n })); } }}
                      onBlur={() => { const n = parseInt(preloadInput, 10); if (isNaN(n) || n < 1) { setPreloadInput('1'); updateSettings((s) => ({ ...s, preloadCount: 1 })); } else if (n > 10) { setPreloadInput('10'); updateSettings((s) => ({ ...s, preloadCount: 10 })); } }}
                      style={{ width: '56px', padding: '5px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--reader-control-border)', background: 'var(--comment-input-bg)', color: 'var(--text-main)', textAlign: 'center' }}
                    />
                  </div>
                  <div className="settings-row">
                    <SettingHint text={'同时解码的最大图片数量。\n数值越高翻页越流畅，但更耗内存。\n范围：1–6。'}>最大同时解码</SettingHint>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" className="input-glass no-spinner"
                      value={decodeConcurrencyInput}
                      onChange={(e) => { const raw = e.target.value; setDecodeConcurrencyInput(raw); const n = parseInt(raw, 10); if (!isNaN(n) && n >= 1 && n <= 6) { updateSettings((s) => ({ ...s, maxConcurrentDecodes: n })); } }}
                      onBlur={() => { const n = parseInt(decodeConcurrencyInput, 10); const next = Math.max(1, Math.min(6, isNaN(n) ? 3 : n)); setDecodeConcurrencyInput(String(next)); updateSettings((s) => ({ ...s, maxConcurrentDecodes: next })); }}
                      style={{ width: '56px', padding: '5px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--reader-control-border)', background: 'var(--comment-input-bg)', color: 'var(--text-main)', textAlign: 'center' }}
                    />
                  </div>
                  <div className="settings-row">
                    <SettingHint text={'自动翻页模式下每页停留的秒数。\n范围：1–60 秒。'}>翻页间隔(秒)</SettingHint>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" className="input-glass no-spinner"
                      value={autoTurnInput}
                      onChange={(e) => { const raw = e.target.value; setAutoTurnInput(raw); const n = parseInt(raw, 10); if (!isNaN(n) && n >= 1 && n <= 60) { updateSettings((s) => ({ ...s, autoTurnInterval: n })); } }}
                      onBlur={() => { const n = parseInt(autoTurnInput, 10); if (isNaN(n) || n < 1) { setAutoTurnInput('1'); updateSettings((s) => ({ ...s, autoTurnInterval: 1 })); } else if (n > 60) { setAutoTurnInput('60'); updateSettings((s) => ({ ...s, autoTurnInterval: 60 })); } }}
                      style={{ width: '56px', padding: '5px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--reader-control-border)', background: 'var(--comment-input-bg)', color: 'var(--text-main)', textAlign: 'center' }}
                    />
                  </div>
                  <div className="settings-row">
                    <SettingHint text={'启用超分后，预先处理后续页面的图片数量。\n范围：0–10，0 表示关闭预超分。'}>预超分数量</SettingHint>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" className="input-glass no-spinner"
                      value={String(settings.srPreloadCount)}
                      onChange={(e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n) && n >= 0 && n <= 10) updateSettings((s) => ({ ...s, srPreloadCount: n })); }}
                      style={{ width: '56px', padding: '5px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--reader-control-border)', background: 'var(--comment-input-bg)', color: 'var(--text-main)', textAlign: 'center' }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 阅读 */}
            <div className={`settings-section${settingsCategory === 'reading' ? ' is-active' : ''}`}>
              <div className="settings-section-inner">
                <div className="settings-group">
                  <div className="settings-row">
                    <SettingHint text={'从左向右：第一页在左，向右翻页。\n从右向左：第一页在右，向左翻页（适合日漫）。'}>翻页流向</SettingHint>
                    <div className="settings-control"><CustomSelect
                      value={settings.direction}
                      options={[{ label: '从左向右', value: 'ltr' }, { label: '从右向左', value: 'rtl' }]}
                      onChange={(v) => updateSettings((s) => ({ ...s, direction: v }))}
                      compact
                    /></div>
                  </div>
                  <div className="settings-row">
                    <SettingHint text={'单页：每次显示一页。\n双页：跨页显示两页。\n滚动：纵向连续滚动。\n自动检测：根据画面自动选择。'}>阅读布局</SettingHint>
                    <div className="settings-control"><CustomSelect value={settings.readingLayout} options={[{ label: '单页', value: 'single' }, { label: '双页', value: 'double' }, { label: '滚动', value: 'webtoon' }, { label: '自动检测', value: 'auto' }]} onChange={(v) => updateSettings((s) => ({ ...s, readingLayout: v }))} compact /></div>
                  </div>
                  {[
                    ['splitWidePagesEnabled', '拆分宽页', '将过宽的横向跨页拆成两页依次显示。'],
                    ['rotateWidePagesEnabled', '旋转宽页', '将过宽的跨页旋转 90° 填满屏幕。'],
                    ['optimizedImageDecodeEnabled', '优化超大图片解码', '对超大图片使用分块解码，降低内存占用。'],
                  ].map(([key, label, hint]) => (
                    <div className="settings-row" key={key}>
                      <SettingHint text={hint}>{label}</SettingHint>
                      <div className="settings-control settings-toggle-control"><ToggleSwitch label={label} checked={settings[key]} onChange={(checked) => updateSettings((s) => ({ ...s, [key]: checked }))} /></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 其他（含超分） */}
            <div className={`settings-section${settingsCategory === 'other' ? ' is-active' : ''}`}>
              <div className="settings-section-inner">
                <div className="settings-group">
                  <div style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 600, marginBottom: '4px' }}>超分</div>
                  <div className="settings-row">
                    <SettingHint text={'整个超分功能的开关。\n开启后会在阅读页沉浸模式显示超分按钮，并在阅读设置中提供模型与自动化选项。'}>启用超分</SettingHint>
                    <div className="settings-control settings-toggle-control"><ToggleSwitch label="启用超分" checked={settings.srEnabled} disabled={!srSupport.supported && !settings.srEnabled} onChange={handleToggleSrEnabled} /></div>
                  </div>
                  {!srSupport.supported && <div style={{ fontSize: '11px', color: 'var(--danger-text)', marginTop: '2px' }}>{srSupport.reason}</div>}
                  <div className="settings-row">
                    <SettingHint text={'超分处理使用的模型。\n不同模型对画质和性能的侧重不同。'}>超分模型</SettingHint>
                    <div className="settings-control"><CustomSelect value={settings.srModel} options={SUPER_RESOLUTION_MODELS} onChange={(v) => updateSettings((s) => ({ ...s, srModel: v }))} compact /></div>
                  </div>
                  <div className="settings-row">
                    <SettingHint text={'对低分辨率图片自动启用超分。\n配合下方阈值，低于该尺寸的图片会自动处理。'}>自动启用超分</SettingHint>
                    <div className="settings-control settings-toggle-control"><ToggleSwitch label="自动启用超分" checked={settings.srAuto} onChange={(checked) => updateSettings((s) => ({ ...s, srAuto: checked }))} /></div>
                  </div>
                  <div className="settings-row">
                    <SettingHint text={'宽度低于此像素数的图片会自动超分。\n填 0：对所有图片都自动超分。'}>自动超分阈值</SettingHint>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" className="input-glass no-spinner"
                      value={String(settings.srAutoThreshold)}
                      onChange={(e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n) && n >= 0) updateSettings((s) => ({ ...s, srAutoThreshold: n })); }}
                      style={{ width: '56px', padding: '5px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--reader-control-border)', background: 'var(--comment-input-bg)', color: 'var(--text-main)', textAlign: 'center' }}
                    />
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        , document.body)}

        {srToast && createPortal(
          <div className="metadata-toast-stack" aria-live="polite">
            <div className="metadata-status-card is-error" role="alert">
              <span className="metadata-status-icon" aria-hidden="true">!</span>
              <span className="metadata-status-text">{srToast}</span>
              <button type="button" className="metadata-status-close" aria-label="关闭提示" onClick={() => setSrToast('')}>×</button>
            </div>
          </div>
        , document.body)}

        {viewMode !== 'immersive' && showArchivePanel && createPortal(
          <ReaderArchiveListPanel
            type={archivePanel.type}
            title={archivePanel.title}
            items={archivePanel.items}
            emptyMessage={archivePanel.emptyMessage}
            cacheOnly={assetCacheOnly}
            onDelete={archivePanel.onDelete}
            activeType={archivePanelType}
            onTypeChange={setArchivePanelType}
            onViewMore={archivePanelType === 'history'
              ? navigateHistory
              : (archivePanelType === 'watchlist' ? navigateWatchlist : null)}
            onRetry={archivePanelType === 'random' && randomEntriesError ? loadRandomEntries : null}
            progressBarVisibility={settings.progressBarVisibility}
            top={settingsPanelTop + 8}
          />
        , document.body)}

        {/* ===== Mode Switch ===== */}
        {viewMode === 'normal' ? (
          <div style={normalReaderStageLayoutStyle}>
            <div
              className="reader-stage-frame"
              style={{ ...normalReaderFrameStyle, position: 'relative' }}
            >
              {canRenderPage ? (webtoonActive ? (
                <div
                  ref={webtoonContainerRef}
                  className="reader-webtoon-flow"
                  onScroll={handleWebtoonScroll}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: settings.webtoonGap,
                    overflowX: 'hidden',
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  {pages.map((pageUrl, index) => {
                    const distance = Math.abs(index - currentIndex);
                    const priority = distance === 0
                      ? IMAGE_LOAD_PRIORITY.CRITICAL
                      : (distance === 1 ? IMAGE_LOAD_PRIORITY.ADJACENT : IMAGE_LOAD_PRIORITY.PRELOAD);
                    return (
                      <div key={pageUrl} data-webtoon-page={index} className="reader-webtoon-page" style={{ flex: '0 0 auto' }}>
                        <PageImage
                          pageUrl={pageUrl}
                          pageIndex={index}
                          isImmersive={false}
                          cacheOnly={assetCacheOnly}
                          priority={priority}
                          serializedDecode
                          previewDecodeEnabled={settings.optimizedImageDecodeEnabled}
                          sourceSize={pageSizes[index]}
                          onNaturalSize={handlePageNaturalSize}
                          onLoadStart={distance === 0 ? handlePageVisualLoadStart : undefined}
                          onReady={distance === 0 ? handlePageVisualReady : undefined}
                          onError={distance === 0 ? handlePageVisualError : undefined}
                          style={{ width: '100%', height: 'auto', maxWidth: '100%', objectFit: 'contain', borderRadius: 0 }}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: settings.scaleMode === 'original' ? 'flex-start' : 'center', gap: settings.doublePageGap, overflow: settings.scaleMode === 'original' ? 'auto' : 'hidden' }}>
                  {normalSpreadRenderState.units.map((unit, slotIndex) => {
                    const slotVisible = slotIndex < normalSpreadRenderState.visibleSlotCount;
                    return (
                    <div key={`spread-slot:${slotIndex}`} style={{ flex: slotVisible ? '1 1 0' : '0 0 0', width: slotVisible ? 'auto' : 0, minWidth: 0, height: '100%', display: 'flex', visibility: slotVisible ? 'visible' : 'hidden', pointerEvents: slotVisible ? 'auto' : 'none', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                      <PageImage
                        pageUrl={pages[unit.pageIndex]}
                        pageIndex={unit.pageIndex}
                        isImmersive={false}
                        cacheOnly={assetCacheOnly}
                        priority={IMAGE_LOAD_PRIORITY.CRITICAL}
                        style={{ ...scaleStyle, width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', borderRadius: '8px' }}
                        cropSide={unit.cropSide}
                        rotateWide={settings.rotateWidePagesEnabled}
                        cropBorders={settings.cropBordersEnabled}
                        serializedDecode
                        previewDecodeEnabled={settings.optimizedImageDecodeEnabled}
                        fullPrecision={fullPrecisionDecode}
                        sourceSize={pageSizes[unit.pageIndex]}
                        onNaturalSize={handlePageNaturalSize}
                        loadingLabel={`正在加载第 ${unit.pageIndex + 1} 页`}
                        loadingHint="正在请求图像"
                        errorLabel={`第 ${unit.pageIndex + 1} 页加载失败`}
                        onLoadStart={unit.pageIndex === currentIndex ? handlePageVisualLoadStart : undefined}
                        onReady={handleNormalSpreadUnitReady}
                        onError={unit.pageIndex === currentIndex ? handlePageVisualError : undefined}
                      />
                    </div>
                    );
                  })}
                </div>
              )) : (
                <ReaderStageSlot
                  status={renderState.manifest.status === 'error' ? 'error' : (renderState.manifest.status === 'ready' ? 'empty' : 'loading')}
                  onRetry={() => setBootstrapRetryToken((token) => token + 1)}
                />
              )}
              {viewMode === 'normal' && normalPagePending && (
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '24px',
                    textAlign: 'center',
                    background: 'var(--immersive-bg)',
                    color: 'var(--immersive-text)',
                    fontSize: 'clamp(18px, 3vw, 30px)',
                    fontWeight: 750,
                    pointerEvents: 'none',
                  }}
                >
                  {pageSwitchLabel}
                </div>
              )}
              {!webtoonActive && adjacentDecodePageIndices.length > 0 && (
                <div
                  aria-hidden="true"
                  style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
                >
                  {adjacentDecodePageIndices.map((pageIndex) => (
                    <PageImage
                      key={`decode-window:${pageIndex}`}
                      pageUrl={pages[pageIndex]}
                      pageIndex={pageIndex}
                      isImmersive={false}
                      cacheOnly={assetCacheOnly}
                      priority={IMAGE_LOAD_PRIORITY.ADJACENT}
                      serializedDecode
                      previewDecodeEnabled={settings.optimizedImageDecodeEnabled}
                      fullPrecision={fullPrecisionDecode}
                      sourceSize={pageSizes[pageIndex]}
                      onNaturalSize={handlePageNaturalSize}
                      style={{ width: '1px', height: '1px' }}
                    />
                  ))}
                </div>
              )}
            </div>

            {!webtoonActive && <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '24px', padding: '20px 8px', flexShrink: 0 }}>
              <button
                className="reader-page-nav-button"
                onClick={leftAction}
                disabled={leftDisabled}
                style={{ ...navBtnBase, opacity: leftDisabled ? 0.3 : 1 }}
              >
                ‹
              </button>
              <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-sub)', userSelect: 'none', minWidth: '60px', textAlign: 'center' }}>
                  {canShowPageCount ? normalPageLabel : '— / —'}
              </span>
              <button
                className="reader-page-nav-button"
                onClick={rightAction}
                disabled={rightDisabled}
                style={{ ...navBtnBase, opacity: rightDisabled ? 0.3 : 1 }}
              >
                ›
              </button>
            </div>}
          </div>
        ) : (
          // ===== Immersive Mode =====
          <div
            data-reader-immersive-stage="true"
            data-webtoon={webtoonActive ? 'true' : 'false'}
            style={{
              flex: 1,
              position: 'relative',
              width: '100%',
              height: '100%',
              overflow: webtoonActive ? 'hidden' : (zoomScale === 1.0 ? 'hidden' : 'visible'),
              background: 'var(--immersive-bg)',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              touchAction: webtoonActive ? 'pan-y' : 'none',
              cursor: 'default',
            }}
            onMouseDown={webtoonActive ? undefined : handlePointerDown}
            onMouseMove={webtoonActive ? undefined : handlePointerMove}
            onMouseUp={webtoonActive ? undefined : handlePointerUp}
            onMouseLeave={webtoonActive ? undefined : handlePointerUp}
            onTouchStart={webtoonActive ? undefined : handlePointerDown}
            onTouchMove={webtoonActive ? undefined : handlePointerMove}
            onTouchEnd={webtoonActive ? undefined : handlePointerUp}
            onClick={webtoonActive ? hideImmersiveControls : handleScreenClick}
          >
            <button
              type="button"
              className="reader-immersive-trigger reader-immersive-trigger-left"
              aria-label="显示左侧阅读控制"
              onPointerEnter={() => revealImmersiveControls('left')}
              onMouseDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => { event.stopPropagation(); armImmersiveTouchGuard(); revealImmersiveControls('left'); }}
              onClick={(event) => { event.stopPropagation(); revealImmersiveControls('left'); }}
            />
            <button
              type="button"
              className="reader-immersive-trigger reader-immersive-trigger-right"
              aria-label="显示右侧阅读控制"
              onPointerEnter={() => revealImmersiveControls('right')}
              onMouseDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => { event.stopPropagation(); armImmersiveTouchGuard(); revealImmersiveControls('right'); }}
              onClick={(event) => { event.stopPropagation(); revealImmersiveControls('right'); }}
            />
            {['left', 'right'].map((side) => (
              <div
                key={side}
                className="reader-immersive-controls"
                data-side={side}
                data-visible={immersiveControlsSide === side ? 'true' : 'false'}
                inert={immersiveControlsSide === side ? undefined : ''}
                onPointerEnter={() => holdImmersiveControls(side)}
                onPointerLeave={() => revealImmersiveControls(side)}
                onFocus={() => holdImmersiveControls(side)}
                onBlur={() => revealImmersiveControls(side)}
                onMouseDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClickCapture={consumeImmersiveTouchClick}
                onClick={(event) => event.stopPropagation()}
              >
                <button type="button" className="reader-immersive-control-button" tabIndex={immersiveControlsSide === side ? 0 : -1} onClick={() => { setViewMode('normal'); hideImmersiveControls(); }} title="退出沉浸模式" aria-label="退出沉浸模式">
                  <ToolbarGlyph name="close" size={20} />
                </button>
                {!webtoonActive && (
                  <button type="button" className="reader-immersive-control-button" tabIndex={immersiveControlsSide === side ? 0 : -1} onClick={() => { updateSettings((state) => ({ ...state, autoTurnActive: !state.autoTurnActive })); revealImmersiveControls(side); }} title={settings.autoTurnActive ? '停止翻页' : '自动翻页'} aria-label={settings.autoTurnActive ? '停止翻页' : '自动翻页'}>
                    <ToolbarGlyph name={settings.autoTurnActive ? 'pause' : 'play'} size={20} />
                  </button>
                )}
                <button type="button" className="reader-immersive-control-button" tabIndex={immersiveControlsSide === side ? 0 : -1} disabled={!canNavigate || coverSetting} onClick={() => { if (canNavigate && !coverSetting) handleSetCover(); revealImmersiveControls(side); }} title="设为封面" aria-label="设为封面">
                  <ToolbarGlyph name="cover" size={20} />
                </button>
                {settings.srEnabled && (
                  <button type="button" className="reader-immersive-control-button" tabIndex={immersiveControlsSide === side ? 0 : -1} onClick={() => { updateSettings((s) => ({ ...s, srEnabled: false })); showSrToast('超分已关闭'); revealImmersiveControls(side); }} title="关闭超分" aria-label="关闭超分">
                    <ToolbarGlyph name="superResolutionOff" size={20} />
                  </button>
                )}
                <button type="button" className="reader-immersive-control-button" tabIndex={immersiveControlsSide === side ? 0 : -1} disabled={!canNavigate} onClick={() => { if (canNavigate) openThumbnailDrawer(side); hideImmersiveControls(); }} title="缩略面板" aria-label="缩略面板">
                  <ToolbarGlyph name="grid" size={20} />
                </button>
              </div>
            ))}

            {webtoonActive && (
              <div
                ref={webtoonContainerRef}
                className="reader-webtoon-flow reader-webtoon-flow-immersive"
                onScroll={handleWebtoonScroll}
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 4,
                  overflowX: 'hidden',
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-y',
                  background: 'var(--immersive-bg)',
                }}
              >
                {pages.map((pageUrl, index) => (
                  <div key={pageUrl} data-webtoon-page={index} className="reader-webtoon-page">
                    <PageImage
                      pageUrl={pageUrl}
                      pageIndex={index}
                      isImmersive
                      cacheOnly={assetCacheOnly}
                      priority={Math.abs(index - currentIndex) <= 1 ? IMAGE_LOAD_PRIORITY.ADJACENT : IMAGE_LOAD_PRIORITY.PRELOAD}
                      serializedDecode
                      previewDecodeEnabled={settings.optimizedImageDecodeEnabled}
                      sourceSize={pageSizes[index]}
                      onNaturalSize={handlePageNaturalSize}
                      style={{ width: '100%', height: 'auto', maxWidth: '100%', objectFit: 'contain', borderRadius: 0 }}
                    />
                  </div>
                ))}
              </div>
            )}

            {!webtoonActive && settings.autoTurnActive && (
              <div
                ref={progressBarRef}
                style={{ position: 'absolute', top: 0, left: 0, height: '2px', background: 'var(--good)', width: '0%', zIndex: 120 }}
              />
            )}

            <div
              ref={leftDivRef}
              style={{
                position: 'absolute', inset: 0,
                display: webtoonActive ? 'none' : 'flex', justifyContent: 'center', alignItems: 'center',
                background: 'var(--immersive-bg)', zIndex: 1,
                transform: 'translateX(-100%)',
              }}
            >
              <div style={getImmersiveSpreadGroupStyle(immersiveLeftSpread)}>
                <div style={getImmersiveSpreadSlotStyle(immersiveLeftSpread, 0)}>
                  <img ref={imgLeftRef} alt="" style={{ display: 'none', userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none' }} draggable={false} />
                </div>
                <div style={{ ...getImmersiveSpreadSlotStyle(immersiveLeftSpread, 1), display: immersiveLeftSpread[1] ? 'flex' : 'none' }}>
                  <img ref={imgLeftSecondRef} alt="" style={{ display: 'none', userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none' }} draggable={false} />
                </div>
              </div>
            </div>

            <div
              ref={rightDivRef}
              style={{
                position: 'absolute', inset: 0,
                display: webtoonActive ? 'none' : 'flex', justifyContent: 'center', alignItems: 'center',
                background: 'var(--immersive-bg)', zIndex: 1,
                transform: 'translateX(100%)',
              }}
            >
              {immersiveRightSpread.length === 0 ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
                  color: 'color-mix(in srgb, var(--immersive-text) 60%, transparent)', userSelect: 'none', pointerEvents: 'none',
                }}>
                  <HomeSectionGlyph name="continue" size={48} color="color-mix(in srgb, var(--immersive-text) 60%, transparent)" style={{ opacity: 0.7 }} />
                  <span style={{ fontSize: '16px', letterSpacing: '2px' }}>继续滑动退出沉浸模式</span>
                </div>
              ) : (
                <div style={getImmersiveSpreadGroupStyle(immersiveRightSpread)}>
                  <div style={getImmersiveSpreadSlotStyle(immersiveRightSpread, 0)}>
                    <img ref={imgRightRef} alt="" style={{ display: 'none', userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none' }} draggable={false} />
                  </div>
                  <div style={{ ...getImmersiveSpreadSlotStyle(immersiveRightSpread, 1), display: immersiveRightSpread[1] ? 'flex' : 'none' }}>
                    <img ref={imgRightSecondRef} alt="" style={{ display: 'none', userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none' }} draggable={false} />
                  </div>
                </div>
              )}
            </div>

            <div
              ref={swipeContainerRef}
              style={{
                position: 'absolute', inset: 0,
                display: webtoonActive ? 'none' : 'flex', justifyContent: 'center', alignItems: 'center',
                zIndex: 2,
                transform: 'translateX(0px)',
                willChange: 'transform',
              }}
            >
              {immersivePagePending && (
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 3,
                    pointerEvents: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '16px',
                    padding: '24px',
                    textAlign: 'center',
                    background: 'var(--immersive-bg)',
                  }}
                >
                  <div style={{ fontSize: 'clamp(24px, 4vw, 40px)', lineHeight: 1.35, fontWeight: 800, color: 'var(--immersive-text)', letterSpacing: '0.5px', textWrap: 'balance' }}>
                    {pageSwitchLabel}
                  </div>
                </div>
              )}
              <div
                ref={zoomWrapperRef}
                style={{
                  ...getImmersiveSpreadGroupStyle(currentSpread),
                  display: 'flex', justifyContent: 'center', alignItems: 'center',
                  transform: `translate3d(${panX}px, ${panY}px, 0) scale(${zoomScale})`,
                  transformOrigin: 'center center',
                  transition: (isZoomingRef.current || isPanningRef.current) ? 'none' : 'transform 0.15s ease-out',
                  willChange: zoomScale > 1 ? 'transform' : 'auto',
                }}
              >
                <div style={getImmersiveSpreadSlotStyle(currentSpread, 0)}>
                  <img
                    ref={imgCurrRef}
                    alt=""
                    style={{ display: 'none', userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none' }}
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                </div>
                <div style={{ ...getImmersiveSpreadSlotStyle(currentSpread, 1), display: currentSpread[1] ? 'flex' : 'none' }}>
                  <img
                    ref={imgCurrSecondRef}
                    alt=""
                    style={{ display: 'none', userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none' }}
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                </div>
              </div>
            </div>

            {!webtoonActive && pageIndicatorShouldRender && (
              <div
                ref={indicatorRef}
                style={{
                  position: 'fixed',
                  bottom: `calc(env(safe-area-inset-bottom, 0px) + ${isMobile ? '12px' : '8px'})`,
                  left: isMobile ? '50%' : 'auto',
                  right: isMobile ? 'auto' : '20px',
                  padding: '4px 10px',
                  borderRadius: '16px',
                  background: 'color-mix(in srgb, var(--immersive-bg) 65%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--immersive-text) 12%, transparent)',
                  fontSize: '11px',
                  letterSpacing: '1px',
                  pointerEvents: 'none',
                  zIndex: 90,
                  opacity: pageIndicatorShouldShow ? 1 : 0,
                  transform: pageIndicatorShouldShow
                    ? (isMobile
                      ? `translateX(-50%) translateY(${pageIndicatorMode === 'lowered' ? '10px' : '0'})`
                      : `translateY(${pageIndicatorMode === 'lowered' ? '8px' : '0'})`)
                    : (isMobile ? 'translateX(-50%) translateY(12px)' : 'translateY(12px)'),
                  transition: 'opacity 0.28s ease, transform 0.32s cubic-bezier(0.22,1,0.36,1), bottom 0.28s cubic-bezier(0.22,1,0.36,1)',
                }}
              >
                {normalPageLabel}
              </div>
            )}
          </div>
        )}

        {archive && (
        <div
          data-reader-secondary-content
          aria-hidden={viewMode !== 'normal'}
          style={{ display: viewMode === 'normal' ? 'block' : 'none', maxWidth: '1300px', width: '100%', margin: '0 auto', padding: '0 16px 24px 16px' }}
        >
          <Recommendations currentArchive={archive} />
          {sourceUrl && (
            <EhComments
              sourceUrl={sourceUrl}
              ehEnabled={settings.ehEnabled}
              ehCookie={settings.ehCookie}
              ehWorker={workerReady ? getWorkerUrl() : ''}
              ehToken={getSyncToken()}
              onCookieRefresh={(newCookie) => updateSettings((s) => ({ ...s, ehCookie: newCookie }))}
              ehMinScore={settings.ehMinScore}
              ehMaxComments={settings.ehMaxComments}
              ehSortMethod={settings.ehSortMethod}
              ehSortOrder={settings.ehSortOrder}
            />
          )}
        </div>
        )}
      </div>

      {/* ===== Thumbnail Drawer ===== */}
      {createPortal(<div
        className="reader-thumbnail-drawer-overlay"
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          display: 'flex', justifyContent: drawerSide === 'left' ? 'flex-start' : 'flex-end',
          pointerEvents: showDrawer ? 'auto' : 'none',
          background: showDrawer ? 'var(--overlay-bg)' : 'transparent',
          backdropFilter: showDrawer ? 'blur(4px)' : 'blur(0px)',
          WebkitBackdropFilter: showDrawer ? 'blur(4px)' : 'blur(0px)',
          transition: 'background 0.25s ease, backdrop-filter 0.25s ease, -webkit-backdrop-filter 0.25s ease',
          overscrollBehavior: 'contain',
        }}
      >
        <div
          className="reader-thumbnail-drawer-backdrop"
          style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
          onClick={closeThumbnailDrawer}
          onWheel={(event) => { event.preventDefault(); event.stopPropagation(); }}
        />
        <div
          ref={drawerPanelRef}
          className="reader-panel-surface reader-thumbnail-drawer-panel"
          data-side={drawerSide}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reader-thumbnail-drawer-title"
          tabIndex={-1}
          style={{
            width: '100%', maxWidth: '420px', height: '100%', background: 'var(--reader-panel-bg)',
            display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1,
            boxShadow: drawerSide === 'left' ? '8px 0 32px rgba(0,0,0,0.5)' : '-8px 0 32px rgba(0,0,0,0.5)',
            transform: showDrawer ? 'translateX(0)' : `translateX(${drawerSide === 'left' ? '-100%' : '100%'})`,
            transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
          }}
          onClick={(e) => e.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--reader-control-border)', paddingBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
              <h3 id="reader-thumbnail-drawer-title" style={{ margin: 0, fontSize: '18px' }}>档案信息</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {hasArchiveReadingProgress(archive, historyEntries.find((item) => item.id === archiveId)?.page) && (
                <button className="reader-drawer-icon-button" disabled={progressClearing} onClick={handleClearCurrentProgress} title="清除阅读进度" aria-label="清除阅读进度">
                  <ToolbarGlyph name="resetProgress" size={18} />
                </button>
              )}
              <button className="reader-drawer-icon-button" onClick={() => navigateToMetadata(archiveId)} title="编辑元数据" aria-label="编辑元数据">
                <ToolbarGlyph name="metadata" size={18} />
              </button>
              <button className="reader-drawer-icon-button" onClick={closeThumbnailDrawer} aria-label="关闭缩略面板" title="关闭缩略面板" style={{ fontSize: '20px' }}>
                <ToolbarGlyph name="close" size={17} />
              </button>
            </div>
          </div>

          {progressNotice && <div role="status" aria-live="polite" style={{ margin: '-10px 0 12px', color: progressNotice.startsWith('清除阅读进度失败') ? 'var(--danger)' : 'var(--text-sub)', fontSize: '12px', textAlign: 'center' }}>{progressNotice}</div>}

          <div style={{ marginBottom: '20px', background: 'var(--surface-2)', borderRadius: '8px', display: 'flex', flexDirection: 'column', maxHeight: '35%', flexShrink: 0 }}>
            <div style={{ padding: '14px 14px 0 14px' }}>
              <div lang={getContentLanguage(archive?.title)} style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '14px', lineHeight: 1.4, wordBreak: 'break-word' }}>
                {archive?.title}
              </div>
            </div>
            <div data-reader-overlay-scroll className="no-scrollbar" style={{ overflowY: 'auto', overscrollBehavior: 'contain', touchAction: 'pan-y', padding: '0 14px 14px 14px', flex: 1 }}>
            {(() => {
              const grouped = groupedTags;
              if (grouped.length === 0) return <div style={{ color: 'var(--text-sub)', fontSize: '12px' }}>无标签</div>;
              return grouped.map((group) => (
                <div key={group.ns} style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: `color-mix(in srgb, ${group.color} 76%, var(--text-main))`, textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: '5px', lineHeight: '20px', whiteSpace: 'nowrap', background: `color-mix(in srgb, ${group.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${group.color} 36%, transparent)`, borderRadius: '5px', padding: '2px 6px' }}>
                      <NamespaceGlyph ns={group.ns} size={14} color={group.color} />
                      {stripDecoratedLabel(group.label)}
                    </span>
                    {group.tags.map(({ raw, value }) => (
                      <span
                        key={raw}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (group.ns === 'source') {
                            let url = raw.replace(/^source:\s*/i, '').trim();
                            if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
                            if (url) window.open(url, '_blank', 'noopener,noreferrer');
                          } else {
                            const query = `${raw.trim()}, `;
                            const filter = { query, sortBy: 'date_added', order: 'desc', active: true };
                            localStorage.setItem('lrr_filter', JSON.stringify(filter));
                            if (parseRouteFromLocation().kind === 'home') {
                              window.dispatchEvent(new CustomEvent('filter-arrival', { detail: { scrollToArchives: true } }));
                            } else {
                              navigateHome({ query, scrollToArchives: true });
                            }
                          }
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '2px 6px',
                          borderRadius: '5px',
                          background: `color-mix(in srgb, ${group.color} 10%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${group.color} 32%, transparent)`,
                          color: 'var(--text-main)',
                          fontSize: '10px',
                          whiteSpace: 'nowrap',
                          lineHeight: '1.5',
                          cursor: 'pointer',
                          transition: 'background-color 0.15s ease, border-color 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = `color-mix(in srgb, ${group.color} 18%, transparent)`;
                          e.currentTarget.style.borderColor = `color-mix(in srgb, ${group.color} 70%, transparent)`;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = `color-mix(in srgb, ${group.color} 10%, transparent)`;
                          e.currentTarget.style.borderColor = `color-mix(in srgb, ${group.color} 32%, transparent)`;
                        }}
                      >
                        {translateTag(group.ns, value)}
                      </span>
                    ))}
                  </div>
                </div>
              ));
            })()}
            </div>
          </div>

          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--text-sub)' }}>
            页面总览 · 共{pages.length}页{archiveSizeLabel ? ` · ${archiveSizeLabel}` : ''}
          </h4>
          {thumbnailQueueState === 'loading' && <div role="status" aria-live="polite" style={{ margin: '-4px 0 12px', color: 'var(--text-sub)', fontSize: '12px' }}>正在准备页面缩略图…</div>}
          {thumbnailQueueState !== 'idle' && thumbnailQueueState !== 'loading' && thumbnailQueueState !== 'ready' && (
            <div role="alert" aria-live="polite" style={{ margin: '-4px 0 12px', color: 'var(--danger-text)', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span>页面缩略图准备失败：{thumbnailQueueState}</span>
              <button type="button" className="btn" onClick={() => setThumbnailQueueRetryToken((token) => token + 1)} style={{ padding: '4px 8px', fontSize: '11px' }}>重试</button>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0 }}>
            <div
              ref={drawerGridRef}
              data-reader-overlay-scroll
              className="reader-drawer-scroll"
              style={{
                height: '100%',
                minHeight: 0,
                overflowY: 'auto',
                paddingRight: isMobile ? '14px' : '12px',
                WebkitOverflowScrolling: 'touch',
                overscrollBehavior: 'contain',
                overflowAnchor: 'none',
                touchAction: 'pan-y',
                scrollbarGutter: 'stable',
              }}
            >
              <div style={{ height: drawerTopSpacer, pointerEvents: 'none' }} />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${DRAWER_COLUMNS}, 1fr)`,
                  gap: `${DRAWER_GAP}px`,
                }}
              >
                {drawerVisiblePages.map((url, offset) => {
                  const idx = drawerSliceStart + offset;
                  return (
                    <button
                      key={url}
                      type="button"
                      data-reader-drawer-page
                      aria-label={`跳转到第 ${idx + 1} 页`}
                      onClick={() => { commitPageTarget(idx, { showIndicator: viewMode === 'immersive' }); closeThumbnailDrawer(); }}
                      style={{
                        position: 'relative',
                        width: '100%',
                        padding: 0,
                        font: 'inherit',
                        color: 'inherit',
                        textAlign: 'left',
                        border: currentIndex === idx ? '2px solid var(--accent)' : '1px solid var(--reader-control-border)',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        background: 'var(--cover-bg)',
                        paddingBottom: '130%',
                        height: 0,
                      }}
                    >
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <ArchivePageThumbnail archiveId={archiveId} pageIndex={idx} active={showDrawer} cacheOnly={assetCacheOnly} eager={drawerPrefetchSet.has(idx)} />
                      </div>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'var(--overlay-bg)', color: 'var(--reader-overlay-text)', fontSize: '11px', textAlign: 'center', padding: '2px 0' }}>
                        P. {idx + 1}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div style={{ height: drawerBottomSpacer, pointerEvents: 'none' }} />
            </div>
          </div>
          </div>
        </div>, document.body)}
      <ConfirmDialog
        open={!!historyDeleteTarget}
        title="确认删除阅读历史"
        message={historyDeleteTarget ? `将“${historyDeleteTarget.title}”从阅读历史中移除。再次阅读该档案时会重新加入历史记录。` : ''}
        confirmLabel="确认删除"
        cancelLabel="取消"
        onConfirm={confirmRemoveHistory}
        onCancel={() => setHistoryDeleteTarget(null)}
      />
      <ConfirmDialog
        open={!!coverConfirmPage}
        title="设为封面"
        message={coverConfirmPage ? `将当前第 ${coverConfirmPage} 页设置为“${archive?.title || archiveId}”的封面？` : ''}
        confirmLabel={coverSetting ? '设置中...' : '确认设置'}
        cancelLabel="取消"
        destructive={false}
        confirmDisabled={coverSetting}
        onConfirm={confirmSetCover}
        onCancel={() => { if (!coverSetting) setCoverConfirmPage(0); }}
      />

    </div>
  );
}



