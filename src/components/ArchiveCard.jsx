import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { translateTag, categorizeTags, NAMESPACE_COLORS_MAP } from '../lib/tags';
import { getCachedImage, getImage } from '../lib/imageCache';
import { navigateHome, parseRouteFromLocation } from '../lib/navigation';
import { NamespaceGlyph, stripDecoratedLabel } from './AppGlyphs';
import { useViewportWidth } from '../lib/viewport';
import { getArchiveProgressPercent } from '../lib/archiveProgress';
import { encodeApiKey } from '../lib/api';
import { scopedCacheKey } from '../lib/configScope';
import { isOutsideHorizontalViewport } from '../lib/horizontalScroller';
import { getContentLanguage } from '../lib/readerUiState';
import { ARCHIVE_CARD_WIDTH, WIDE_ARCHIVE_CARD_WIDTH } from '../lib/archiveGridLayout';

const NAMESPACE_COLORS = NAMESPACE_COLORS_MAP;
const archiveAspectRatioCache = new Map();
const ARCHIVE_TITLE_GAP = 8;
const ARCHIVE_TITLE_FONT_SIZE = 13;
const ARCHIVE_TITLE_LINE_HEIGHT = 1.5;
const ARCHIVE_TITLE_GLYPH_SAFETY_PX = 3;
const ARCHIVE_TITLE_VERTICAL_BUDGET = 51.7;
const nearViewportCallbacks = new Map();
let nearViewportObserver = null;

function observeNearViewport(node, onEnter) {
  if (typeof IntersectionObserver === 'undefined') {
    onEnter();
    return () => {};
  }
  if (!nearViewportObserver) {
    nearViewportObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = nearViewportCallbacks.get(entry.target);
        nearViewportCallbacks.delete(entry.target);
        nearViewportObserver.unobserve(entry.target);
        callback?.();
      }
    }, { rootMargin: '1200px 800px' });
  }
  nearViewportCallbacks.set(node, onEnter);
  nearViewportObserver.observe(node);
  return () => {
    nearViewportCallbacks.delete(node);
    nearViewportObserver?.unobserve(node);
  };
}

function calculatePanelPosition(cardRect, panelHeight, pointerY = null) {
  const panelWidth = 320;
  const panelMaxHeight = 440;
  const effectivePanelHeight = Math.min(
    panelMaxHeight,
    Math.max(1, Math.ceil(panelHeight || panelMaxHeight)),
  );
  const belowGap = 10;
  const aboveGap = 20;
  const sideGap = 10;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const centeredLeft = Math.min(
    Math.max(sideGap, cardRect.left + (cardRect.width - panelWidth) / 2),
    Math.max(sideGap, vw - panelWidth - sideGap),
  );

  const belowTop = cardRect.bottom + belowGap;
  if (belowTop + effectivePanelHeight <= vh - sideGap) {
    return { top: belowTop, left: centeredLeft };
  }

  const aboveTop = cardRect.top - effectivePanelHeight - aboveGap;
  if (aboveTop >= sideGap) {
    return { top: aboveTop, left: centeredLeft };
  }

  const centeredSideTop = cardRect.top + (cardRect.height - effectivePanelHeight) / 2;
  const pointerSafeTop = pointerY == null
    ? centeredSideTop
    : (pointerY + 18 + effectivePanelHeight <= vh - sideGap
      ? pointerY + 18
      : pointerY - effectivePanelHeight - 18);
  const sideTop = Math.min(Math.max(sideGap, pointerSafeTop), Math.max(sideGap, vh - effectivePanelHeight - sideGap));

  const rightLeft = cardRect.right + sideGap;
  if (rightLeft + panelWidth <= vw - sideGap) {
    return { top: sideTop, left: rightLeft };
  }

  const leftLeft = cardRect.left - panelWidth - sideGap;
  if (leftLeft >= sideGap) {
    return { top: sideTop, left: leftLeft };
  }

  return {
    top: sideTop,
    left: Math.min(Math.max(sideGap, centeredLeft), Math.max(sideGap, vw - panelWidth - sideGap)),
  };
}

export default function ArchiveCard({ archive, onClick, onLongPress, onArchiveContextMenu, longPressTitle = '', currentPage, progress, showProgressBar, reserveProgressSpace = false, noCrop, cacheOnly = false, wrapStyle, className, overlay, selectionMode = false, selected = false, onSelectToggle, disabled = false, archiveGridItemKey, archiveGridChildrenVersion, archiveGridLayoutVersion, onArchiveGridWidthChange }) {
  const id = archive.arcid || archive.id;
  const [hovered, setHovered] = useState(false);
  const [closing, setClosing] = useState(false);
  const [thumbSrc, setThumbSrc] = useState(null);
  const [thumbState, setThumbState] = useState('loading');
  const [retryKey, setRetryKey] = useState(0);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const isMobile = useViewportWidth() < 768;
  const [hasTouchInteraction, setHasTouchInteraction] = useState(() => (
    window.matchMedia?.('(hover: none), (pointer: coarse)').matches ?? false
  ));
  const touchInteractionRef = useRef(hasTouchInteraction);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const aspectCacheKey = scopedCacheKey(`aspect:${id}`);
  const [aspectRatio, setAspectRatio] = useState(() => archiveAspectRatioCache.get(aspectCacheKey) ?? null);
  const cardRef = useRef(null);
  const [thumbnailEligible, setThumbnailEligible] = useState(() => (
    typeof IntersectionObserver === 'undefined'
  ));
  const panelRef = useRef(null);
  const imgRef = useRef(null);
  const leaveTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const thumbObjectUrlRef = useRef(null);
  const [allowNetworkFallback, setAllowNetworkFallback] = useState(!cacheOnly);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const pointerStartRef = useRef(null);
  const hoverPointerYRef = useRef(null);

  useEffect(() => {
    if (thumbnailEligible || !cardRef.current) return undefined;
    return observeNearViewport(cardRef.current, () => setThumbnailEligible(true));
  }, [thumbnailEligible]);

  useEffect(() => {
    if (!cacheOnly) {
      setAllowNetworkFallback(true);
    }
  }, [cacheOnly]);

  const tags = archive.tags?.split(',').map((tag) => tag.trim()).filter(Boolean) || [];
  const categorizedTags = categorizeTags(tags);
  const archiveLanguage = getContentLanguage(archive.title);

  const totalPages = archive.pagecount || archive.total || 0;
  const current = currentPage || archive.progress || archive.page || 0;
  const pageInfo = current > 0 ? `${current}/${totalPages}页` : (totalPages > 0 ? `${totalPages}页` : '');

  const dateAddedStr = (() => {
    // 1) 优先从 tags 字符串中提取 date_added tag (LANraragi API 的标准数据来源)
    const tagsStr = (archive.tags || '').trim();
    if (tagsStr) {
      const m = tagsStr.match(/(?:^|,\s*)date_added:(\d+)/);
      if (m) {
        const sec = parseInt(m[1], 10);
        if (sec > 0) {
          const d = new Date(sec * 1000);
          if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          }
        }
      }
    }

    // 2) 回退：直接字段 date_added 或阅读历史中的 archive.time
    const direct = archive.date_added;
    const fallback = archive.time;
    if (!direct && !fallback) return '';

    try {
      const raw = direct || fallback;
      let d;
      if (typeof raw === 'number') {
        d = new Date(raw > 1e12 ? raw : raw * 1000);
      } else {
        const str = String(raw).trim();
        d = new Date(str);
        if (isNaN(d.getTime())) {
          const n = parseInt(str, 10);
          if (!isNaN(n) && n > 0) d = new Date(n > 1e12 ? n : n * 1000);
        }
      }
      if (!isNaN(d.getTime())) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    } catch {}

    return '';
  })();

  const progressPct = getArchiveProgressPercent(archive, { currentPage, progressPercent: progress });
  const showProgress = showProgressBar && progressPct != null;
  const reserveEmptyProgressSpace = reserveProgressSpace && !showProgress;

  const isWide = noCrop && aspectRatio != null && aspectRatio > 1.0;
  const baseMetaFontSize = isMobile ? 10.5 : 11;

  useLayoutEffect(() => {
    if (!archiveGridItemKey || !onArchiveGridWidthChange) return;
    onArchiveGridWidthChange(
      archiveGridItemKey,
      isWide ? WIDE_ARCHIVE_CARD_WIDTH : ARCHIVE_CARD_WIDTH,
    );
  }, [archiveGridItemKey, isWide, onArchiveGridWidthChange]);

  const rememberAspectRatio = useCallback((next) => {
    if (!Number.isFinite(next) || next <= 0) return;
    archiveAspectRatioCache.set(aspectCacheKey, next);
    setAspectRatio((prev) => (
      prev != null && Math.abs(prev - next) < 0.001 ? prev : next
    ));
  }, [aspectCacheKey]);

  const updateAspectRatio = useCallback((img) => {
    const nw = img?.naturalWidth;
    const nh = img?.naturalHeight;
    if (nw && nh) {
      rememberAspectRatio(nw / nh);
    }
  }, [rememberAspectRatio]);

  const handleImageLoad = useCallback((e) => {
    updateAspectRatio(e.target);
  }, [updateAspectRatio]);

  useEffect(() => {
    setAspectRatio(archiveAspectRatioCache.get(aspectCacheKey) ?? null);
  }, [aspectCacheKey]);

  useEffect(() => {
    if (thumbState !== 'ready' || !thumbSrc) return;
    updateAspectRatio(imgRef.current);
  }, [thumbSrc, thumbState, updateAspectRatio]);

  // Start near the viewport so initial covers are ready without flooding the queue.
  useEffect(() => {
    if (!thumbnailEligible) return undefined;
    let isMounted = true;

    const loadThumbnail = async () => {
      if (!id) { setThumbState('error'); return; }
      const hadVisibleThumb = !!thumbObjectUrlRef.current;
      if (!hadVisibleThumb) setThumbState('loading');

      try {
        const cacheKey = `thumb:${id}`;
        const src = cacheOnly && !allowNetworkFallback
          ? await getCachedImage(cacheKey)
          : await getImage(cacheKey, async (signal) => {
              const base = (localStorage.getItem('lrr_server_url') || '').replace(/\/$/, '');
              const key = localStorage.getItem('lrr_api_key') || '';
              const headers = {};
              if (key) headers['Authorization'] = `Bearer ${encodeApiKey(key)}`;
              const res = await fetch(`${base}/api/archives/${id}/thumbnail`, { headers, signal });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.blob();
            });
        if (!isMounted) return;
        if (src) {
          thumbObjectUrlRef.current = src;
          setThumbSrc(src);
          setThumbState('ready');
        } else {
          if (cacheOnly && !allowNetworkFallback) {
            setAllowNetworkFallback(true);
            return;
          }
          if (!hadVisibleThumb) setThumbState('error');
        }
      } catch (e) {
        if (!isMounted) return;
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
          return;
        }
        if (!hadVisibleThumb) setThumbState('error');
      }
    };

    loadThumbnail();

    return () => {
      isMounted = false;
    };
  }, [allowNetworkFallback, cacheOnly, id, retryKey, thumbnailEligible]);

  const translateDisplayTag = useCallback((rawTag) => {
    if (!rawTag) return rawTag;
    if (rawTag.includes(':')) {
      const [namespace, ...rest] = rawTag.split(':');
      const value = rest.join(':').trim();
      return translateTag(namespace.toLowerCase(), value) || value;
    }
    return translateTag('general', rawTag) || rawTag;
  }, []);

  const handleTagClick = (event, tag) => {
    event.stopPropagation();
    if (!tag) return;
    if (tag.toLowerCase().startsWith('source:')) {
      let url = tag.slice(7).trim();
      if (url && !/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
      }
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    const query = `${tag.trim()}, `;
    const filter = { query, sortBy: 'date_added', order: 'desc', active: true };
    localStorage.setItem('lrr_filter', JSON.stringify(filter));
    if (parseRouteFromLocation().kind === 'home') {
      window.dispatchEvent(new CustomEvent('filter-arrival', { detail: { scrollToArchives: true } }));
    } else {
      navigateHome({ query, scrollToArchives: true });
    }
  };

  const updatePanelPosition = useCallback((pointerY = hoverPointerYRef.current) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const panelHeight = panelRef.current?.getBoundingClientRect().height;
    const nextPos = calculatePanelPosition(rect, panelHeight, pointerY);
    setPanelPos((prev) => (
      Math.abs(prev.top - nextPos.top) < 0.5 && Math.abs(prev.left - nextPos.left) < 0.5
        ? prev
        : nextPos
    ));
  }, []);

  // ===== Fix 1: 200ms 延迟消失，鼠标可从卡片滑入面板 =====
  const clearPanelTimers = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const showPanel = (event) => {
    if (cardRef.current?.closest?.('[data-scroll-block]')) return;
    clearPanelTimers();
    hoverPointerYRef.current = event?.clientY ?? null;
    updatePanelPosition(hoverPointerYRef.current);
    setClosing(false);
    setHovered(true);
  };

  const hidePanelWithDelay = () => {
    clearPanelTimers();
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      setClosing(true);
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        setHovered(false);
        setClosing(false);
      }, 100);
    }, 200);
  };

  const keepPanel = () => {
    clearPanelTimers();
    setClosing(false);
    setHovered(true);
  };

  const hidePanelImmediately = () => {
    clearPanelTimers();
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setHovered(false);
      setClosing(false);
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const isPanelVisible = hovered || (hasTouchInteraction && mobilePanelOpen);

  useLayoutEffect(() => {
    if (!isPanelVisible || categorizedTags.length === 0) return;
    updatePanelPosition();
  }, [archiveGridChildrenVersion, archiveGridLayoutVersion, categorizedTags.length, isPanelVisible, updatePanelPosition]);

  useEffect(() => {
    if (!isPanelVisible) return;
    const handleScroll = (event) => {
      if (!cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setHovered(false);
        setMobilePanelOpen(false);
        setClosing(false);
        return;
      }
      const scrollTarget = event.target;
      if (
        scrollTarget instanceof Element
        && scrollTarget.contains(cardRef.current)
        && scrollTarget.scrollWidth > scrollTarget.clientWidth + 1
        && isOutsideHorizontalViewport(rect, scrollTarget.getBoundingClientRect())
      ) {
        setHovered(false);
        setMobilePanelOpen(false);
        setClosing(false);
        return;
      }
      updatePanelPosition();
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isPanelVisible, updatePanelPosition]);

  useEffect(() => {
    if (!isPanelVisible) return;
    const el = panelRef.current;
    if (!el) return;
    const handler = (e) => {
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
        e.preventDefault();
        return;
      }
      e.stopPropagation();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [isPanelVisible]);

  useEffect(() => {
    if (!hasTouchInteraction || !mobilePanelOpen) return;
    const handler = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (cardRef.current && cardRef.current.contains(e.target)) return;
      setMobilePanelOpen(false);
      setHovered(false);
    };
    document.addEventListener('touchstart', handler, { passive: true });
    return () => document.removeEventListener('touchstart', handler);
  }, [hasTouchInteraction, mobilePanelOpen]);

  const handleCoverClick = (e) => {
    e.stopPropagation();
    if (disabled) return;
    if (selectionMode && onSelectToggle) {
      onSelectToggle(archive, e);
      return;
    }
    onClick(e);
  };

  const handleTitleClick = (e) => {
    if (!touchInteractionRef.current || disabled) return;
    e.stopPropagation();
    updatePanelPosition();
    setMobilePanelOpen((v) => !v);
  };

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerStartRef.current = null;
  }, []);

  const startLongPress = useCallback((event) => {
    if (!onLongPress && !onArchiveContextMenu) return;
    if (event.button != null && event.button !== 0) return;
    const point = 'touches' in event ? event.touches?.[0] : event;
    pointerStartRef.current = point ? { x: point.clientX, y: point.clientY } : null;
    longPressTriggeredRef.current = false;
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      const menuPoint = pointerStartRef.current || (cardRef.current ? {
        x: cardRef.current.getBoundingClientRect().left + 16,
        y: cardRef.current.getBoundingClientRect().top + 16,
      } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      if (onArchiveContextMenu) onArchiveContextMenu(archive, menuPoint, event);
      else onLongPress();
    }, 520);
  }, [archive, clearLongPress, onArchiveContextMenu, onLongPress]);

  const cancelLongPress = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const handlePointerMoveCancel = useCallback((event) => {
    const start = pointerStartRef.current;
    if (!start) {
      cancelLongPress();
      return;
    }
    const point = 'touches' in event ? event.touches?.[0] : event;
    if (!point) {
      cancelLongPress();
      return;
    }
    if (Math.abs(point.clientX - start.x) > 8 || Math.abs(point.clientY - start.y) > 8) {
      cancelLongPress();
    }
  }, [cancelLongPress]);

  const suppressClickAfterLongPress = useCallback((event) => {
    if (!longPressTriggeredRef.current) return false;
    longPressTriggeredRef.current = false;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    return true;
  }, []);

  return (
    <div
      ref={cardRef}
      data-archive-grid-key={archiveGridItemKey || undefined}
      className={['archive-card-wrap', isWide ? 'is-wide' : '', className].filter(Boolean).join(' ')}
      style={{
        position: 'relative',
        display: 'inline-block',
        transform: isPanelVisible ? 'translateY(-6px)' : undefined,
        transformOrigin: 'center top',
        transition: 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
        ...wrapStyle,
      }}
    >
      {overlay}
      {/* ===== 卡片本体 ===== */}
      <div
        className={`glass-panel archive-card-shell${selected ? ' is-selected' : ''}`}
        title={undefined}
        style={{
          minWidth: isWide ? '316px' : '150px',
          width: isWide ? '316px' : '150px',
          padding: '12px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.22s ease, border-color 0.22s ease',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: isPanelVisible ? '0 12px 40px 0 rgba(0, 0, 0, 0.5)' : undefined,
          touchAction: 'pan-x pan-y pinch-zoom',
          WebkitTouchCallout: (selectionMode || onLongPress || onArchiveContextMenu) ? 'none' : undefined,
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
        aria-disabled={disabled || undefined}
        role={selectionMode ? 'checkbox' : undefined}
        aria-checked={selectionMode ? selected : undefined}
        tabIndex={selectionMode && !disabled ? 0 : undefined}
        onKeyDown={(event) => {
          if (!selectionMode || disabled || !onSelectToggle) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelectToggle(archive, event);
          }
        }}
        onPointerDown={(event) => {
          const nextTouchInteraction = event.pointerType === 'touch' || event.pointerType === 'pen';
          touchInteractionRef.current = nextTouchInteraction;
          setHasTouchInteraction(nextTouchInteraction);
        }}
        onClick={(e) => {
          if (suppressClickAfterLongPress(e)) return;
          if (disabled) return;
          if (selectionMode && onSelectToggle) {
            onSelectToggle(archive, e);
            return;
          }
          if (touchInteractionRef.current) {
            e.stopPropagation();
            updatePanelPosition();
            setMobilePanelOpen((value) => !value);
            return;
          }
          if (!touchInteractionRef.current) onClick(e);
        }}
        onMouseEnter={!hasTouchInteraction ? showPanel : undefined}
        onMouseDown={startLongPress}
        onMouseUp={cancelLongPress}
        onMouseMove={handlePointerMoveCancel}
        onMouseLeave={(e) => {
          cancelLongPress();
          if (!hasTouchInteraction) hidePanelWithDelay(e);
        }}
        onTouchStart={startLongPress}
        onTouchEnd={cancelLongPress}
        onTouchCancel={cancelLongPress}
        onTouchMove={handlePointerMoveCancel}
        onContextMenu={(e) => {
          if (!onLongPress && !onArchiveContextMenu) return;
          e.preventDefault();
          e.stopPropagation();
          if (onArchiveContextMenu) onArchiveContextMenu(archive, { x: e.clientX, y: e.clientY }, e);
        }}
      >
        <div
          onClick={(e) => {
            if (suppressClickAfterLongPress(e)) return;
            handleCoverClick(e);
          }}
          style={{
            width: '100%',
            height: '210px',
            borderRadius: '8px',
            overflow: 'hidden',
            backgroundColor: 'var(--cover-bg)',
            position: 'relative',
          }}
          className="archive-cover-frame"
        >
          {selectionMode && (
            <span className={`archive-card-selection-checkbox${selected ? ' is-selected' : ''}`} aria-hidden="true" />
          )}
          {thumbState === 'loading' && !thumbSrc && (
            <div
              className="reader-skeleton-fade"
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                overflow: 'hidden',
                zIndex: 1,
              }}
            >
              <div className="shimmer-strip" style={{ position: 'absolute', inset: 0 }} />
            </div>
          )}

          {thumbState === 'loading' && !thumbSrc && (
            <div
              style={{
                position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                color: 'var(--text-sub)',
                fontSize: '12px',
              }}
            >
              加载封面…
            </div>
          )}

          {thumbState === 'ready' && thumbSrc && (
            <img
              ref={imgRef}
              className="archive-cover-image"
              src={thumbSrc}
              alt="cover"
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={handleImageLoad}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover',
                display: 'block',
                opacity: 1,
                WebkitTouchCallout: 'none',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
              onError={() => {
                // Blob URL may have been revoked by pagehide cleanup — re-fetch
                if (thumbObjectUrlRef.current) {
                  URL.revokeObjectURL(thumbObjectUrlRef.current);
                  thumbObjectUrlRef.current = null;
                }
                setThumbSrc(null);
                setThumbState('loading');
                setRetryKey(k => k + 1);
              }}
            />
          )}

          {thumbState === 'error' && !thumbSrc && (
            <div
              style={{
                position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                color: 'var(--text-sub)',
                fontSize: '12px',
                textAlign: 'center',
              }}
            >
              封面不可用
            </div>
          )}
        </div>
        {showProgress && (
          <div className="archive-card-progress" role="progressbar" aria-label="阅读进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progressPct}>
            <div className="archive-card-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        )}
        {/* 标题 */}
        <div
          onClick={(e) => {
            if (suppressClickAfterLongPress(e)) return;
            handleTitleClick(e);
          }}
          style={{
            marginTop: `${ARCHIVE_TITLE_GAP + (reserveEmptyProgressSpace && !(pageInfo || dateAddedStr) ? 5 : 0)}px`,
            overflow: 'hidden',
            height: `${ARCHIVE_TITLE_VERTICAL_BUDGET - ARCHIVE_TITLE_GAP}px`,
            ...(isMobile ? { cursor: 'pointer' } : {}),
          }}
          className="archive-title-slot"
        >
          <div
            lang={archiveLanguage}
            className="archive-title"
            style={{
              fontSize: `${ARCHIVE_TITLE_FONT_SIZE}px`,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: ARCHIVE_TITLE_LINE_HEIGHT,
              height: '3em',
              paddingBottom: `${ARCHIVE_TITLE_GLYPH_SAFETY_PX}px`,
              boxSizing: 'content-box',
            }}
          >
            {archive.title}
          </div>
        </div>

        {(pageInfo || dateAddedStr) && (
          <div
            style={{
              fontSize: `${baseMetaFontSize}px`,
              color: 'var(--text-sub)',
              marginTop: `${(isMobile ? 4 : 6) + (reserveEmptyProgressSpace ? 5 : 0)}px`,
              display: 'flex',
              justifyContent: 'space-between',
              gap: '6px',
              alignItems: 'center',
              lineHeight: 1.35,
              maxWidth: '100%',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {pageInfo && (
              <span
                style={{
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
                title={pageInfo}
              >
                {pageInfo}
              </span>
            )}
            {dateAddedStr && (
              <span
                style={{
                  flexShrink: 0,
                  marginLeft: pageInfo ? 'auto' : 0,
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                }}
                title={dateAddedStr}
              >
                {dateAddedStr}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 悬浮标签面板 —— Portal 至 body，彻底避开 overflow 裁剪和滚动捕获 */}
      {isPanelVisible && categorizedTags.length > 0 && ReactDOM.createPortal(
        <div
          ref={panelRef}
          className="no-scrollbar archive-tag-panel"
          onMouseEnter={keepPanel}
          onMouseLeave={hidePanelImmediately}
          style={{
            position: 'fixed',
            top: `${panelPos.top}px`,
            left: `${panelPos.left}px`,
            zIndex: 9999,
            background: 'var(--tag-panel-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(140, 160, 190, 0.25)',
            borderRadius: '14px',
            padding: '16px 18px',
            minWidth: '260px',
            maxWidth: '320px',
            maxHeight: '440px',
            overflowY: 'auto',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.6)',
            pointerEvents: 'auto',
            animation: closing ? 'fadeOut 0.1s ease-out forwards' : 'slideDown 0.15s ease-out forwards',
          }}
        >
          <div className="no-scrollbar">
            <div
              lang={archiveLanguage}
              style={{
                fontSize: '14px', fontWeight: 700, lineHeight: 1.3,
                marginBottom: '14px', color: 'var(--text-main)',
                wordBreak: 'break-word',
              }}
            >
              {archive.title}
            </div>

            {categorizedTags.map((group) => (
              <div key={group.ns} style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
                  <span
                    className="archive-tag-namespace"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      '--tag-ns-color': group.color,
                      color: 'var(--tag-ns-color)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginRight: '5px',
                      lineHeight: '20px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <NamespaceGlyph ns={group.ns} size={14} color="currentColor" />
                    {stripDecoratedLabel(group.label)}
                  </span>
                  {group.tags.map(({ raw }) => (
                    <button
                      key={raw}
                      type="button"
                      onClick={(e) => handleTagClick(e, raw)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        border: `1px solid ${group.color}44`,
                        borderRadius: '5px',
                        padding: '2px 6px',
                        background: `${group.color}15`,
                        color: 'var(--text-main)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s ease',
                        lineHeight: '1.4',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = `${group.color}35`;
                        e.currentTarget.style.borderColor = group.color;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = `${group.color}15`;
                        e.currentTarget.style.borderColor = `${group.color}44`;
                      }}
                    >
                      {translateDisplayTag(raw)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}


