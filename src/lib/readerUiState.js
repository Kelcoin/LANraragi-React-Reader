const DESKTOP_TOOLBAR = Object.freeze({
  left: Object.freeze(['← 返回', '快速跳转']),
  right: Object.freeze(['沉浸模式', '设为封面', '阅读设定', '缩略面板']),
});

const MOBILE_TOOLBAR = Object.freeze({
  left: Object.freeze(['', '']),
  right: Object.freeze(['', '', '', '']),
});

export function getReaderToolbarGroups(isMobile) {
  return isMobile ? MOBILE_TOOLBAR : DESKTOP_TOOLBAR;
}

export function isReaderMobileViewport(width) {
  return width < 768;
}

function overlapWithMargin(first, second, margin = 0) {
  return !(
    first.right + margin <= second.left
    || first.left - margin >= second.right
    || first.bottom + margin <= second.top
    || first.top - margin >= second.bottom
  );
}

export function resolvePageIndicatorPlacement(previousMode, imageRect, baseRect, loweredShift, hysteresis = 6) {
  if (!imageRect || !baseRect) return 'pinned';
  if (previousMode === 'hidden' && overlapWithMargin(imageRect, baseRect, hysteresis)) return 'hidden';
  const margin = previousMode === 'lowered' ? hysteresis : 0;
  if (!overlapWithMargin(imageRect, baseRect, margin)) return 'pinned';
  const loweredRect = {
    ...baseRect,
    top: baseRect.top + loweredShift,
    bottom: baseRect.bottom + loweredShift,
  };
  return overlapWithMargin(imageRect, loweredRect, margin) ? 'hidden' : 'lowered';
}

export function shouldUseCompactReaderToolbar({
  isMobile,
  availableWidth,
  requiredWidth,
  tolerance = 8,
}) {
  if (isMobile) return true;
  if (!Number.isFinite(availableWidth) || !Number.isFinite(requiredWidth)) return false;
  return availableWidth < requiredWidth + tolerance;
}

export function resolveReaderToolbarMode({
  isMobile,
  availableWidth,
  fullRequiredWidth,
  iconRequiredWidth,
  fullReserve = 48,
  iconReserve = 8,
}) {
  if (isMobile) return 'mobile';
  if (![availableWidth, fullRequiredWidth, iconRequiredWidth].every(Number.isFinite)) return 'full';
  if (availableWidth >= fullRequiredWidth + fullReserve) return 'full';
  if (availableWidth >= iconRequiredWidth + iconReserve) return 'icons';
  return 'mobile';
}

export function getCenteredToolbarTitleWidth({ toolbar, leftGroup, rightGroup, gap = 16 }) {
  const toolbarLeft = Number(toolbar?.left);
  const toolbarRight = Number(toolbar?.right);
  if (!Number.isFinite(toolbarLeft) || !Number.isFinite(toolbarRight) || toolbarRight <= toolbarLeft) return 0;
  const center = toolbarLeft + ((toolbarRight - toolbarLeft) / 2);
  const leftBoundary = Number.isFinite(Number(leftGroup?.right)) ? Number(leftGroup.right) : toolbarLeft;
  const rightBoundary = Number.isFinite(Number(rightGroup?.left)) ? Number(rightGroup.left) : toolbarRight;
  const safeHalfWidth = Math.min(center - leftBoundary, rightBoundary - center) - Math.max(0, Number(gap) || 0);
  return Math.max(0, Math.floor(safeHalfWidth * 2));
}

export function isIosWebKitPlatform(userAgent = '', platform = '', maxTouchPoints = 0) {
  if (/iPad|iPhone|iPod/i.test(userAgent) || /iPad|iPhone|iPod/i.test(platform)) return true;
  return platform === 'MacIntel' && Number(maxTouchPoints) > 1;
}

export function getContentLanguage(value) {
  return /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9d]/u.test(String(value || '')) ? 'ja' : 'zh-CN';
}

export function getDrawerRowStride(gridWidth) {
  const gap = 12;
  const itemWidth = gridWidth > 0 ? Math.max(72, (gridWidth - (2 * gap)) / 3) : 110;
  return (itemWidth * 1.3) + gap;
}

export function getReaderArchivePanelModel(type, sources) {
  if (type === 'random') {
    return {
      type,
      title: '随机漫游',
      items: sources.randomItems,
      emptyMessage: sources.randomEmptyMessage,
      onDelete: null,
    };
  }
  if (type === 'watchlist') {
    return {
      type,
      title: '待看档案',
      items: sources.watchlistItems,
      emptyMessage: sources.watchlistEmptyMessage,
      onDelete: sources.removeWatchlist,
    };
  }
  return {
    type: 'history',
    title: '阅读历史',
    items: sources.historyItems,
    emptyMessage: sources.historyEmptyMessage,
    onDelete: sources.removeHistory,
  };
}

export function getReaderArchivePanelWindow(type, items, limit = 25) {
  const source = Array.isArray(items) ? items : [];
  const shouldLimit = type === 'history' || type === 'watchlist';
  return {
    items: shouldLimit ? source.slice(0, limit) : source,
    hasMore: shouldLimit && source.length > limit,
    total: source.length,
  };
}
