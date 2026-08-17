export const WIDE_PAGE_RATIO = 1.2;

export function hasWebtoonTag(tags) {
  return String(tags || '').split(',').some(tag => tag.trim().toLowerCase() === 'other:webtoon');
}

export function classifyMangaPageSizes(sizes, {
  minRatio = 0.5,
  maxRatio = 0.65,
  minSamples = 3,
  requiredShare = 0.7,
} = {}) {
  const ratios = (Array.isArray(sizes) ? sizes : [])
    .map((size) => {
      const width = Number(size?.width) || 0;
      const height = Number(size?.height) || 0;
      return width > 0 && height > 0 ? width / height : null;
    })
    .filter((ratio) => ratio !== null);
  const matchingSamples = ratios.filter((ratio) => ratio >= minRatio && ratio <= maxRatio).length;
  const share = ratios.length > 0 ? matchingSamples / ratios.length : 0;
  return {
    isManga: ratios.length >= minSamples && share >= requiredShare,
    validSamples: ratios.length,
    matchingSamples,
    share,
  };
}

export function resolveAutoReadingLayout({
  isWebtoon = false,
  isManga = false,
  containerWidth = 0,
  doublePageMinWidth = 1100,
} = {}) {
  if (isWebtoon) return 'webtoon';
  if (!isManga) return 'single';
  return Number(containerWidth) >= Number(doublePageMinWidth) ? 'double' : 'single';
}

export function isWidePageSize(size, threshold = WIDE_PAGE_RATIO) {
  const width = Number(size?.width) || 0;
  const height = Number(size?.height) || 0;
  return width > 0 && height > 0 && width / height > threshold;
}

export function getImmersiveSpreadGeometry({
  viewportWidth = 0,
  viewportHeight = 0,
  gap = 0,
  ratios = [],
} = {}) {
  const widthLimit = Math.max(0, Number(viewportWidth) || 0);
  const heightLimit = Math.max(0, Number(viewportHeight) || 0);
  const normalizedRatios = (Array.isArray(ratios) ? ratios : [])
    .map((ratio) => Math.max(0.01, Number(ratio) || 1));
  if (normalizedRatios.length === 0 || widthLimit <= 0 || heightLimit <= 0) {
    return { width: 0, height: 0, gap: 0, pageWidths: [] };
  }
  const normalizedGap = normalizedRatios.length > 1 ? Math.max(0, Number(gap) || 0) : 0;
  const ratioSum = normalizedRatios.reduce((sum, ratio) => sum + ratio, 0);
  const height = Math.min(heightLimit, Math.max(0, widthLimit - normalizedGap) / ratioSum);
  const pageWidths = normalizedRatios.map((ratio) => height * ratio);
  return {
    width: pageWidths.reduce((sum, width) => sum + width, 0) + normalizedGap,
    height,
    gap: normalizedGap,
    pageWidths,
  };
}

export function getContainedHalfFrame(size, container, cropSide, cropInsets = {}) {
  const width = Number(size?.width) || 0;
  const height = Number(size?.height) || 0;
  const containerWidth = Number(container?.width) || 0;
  const containerHeight = Number(container?.height) || 0;
  if (width <= 0 || height <= 0 || containerWidth <= 0 || containerHeight <= 0) return null;

  const clampInset = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  let cropLeft = clampInset(cropInsets.left);
  let cropRight = clampInset(cropInsets.right);
  let cropTop = clampInset(cropInsets.top);
  let cropBottom = clampInset(cropInsets.bottom);
  if (cropLeft + cropRight >= 1) [cropLeft, cropRight] = [0, 0];
  if (cropTop + cropBottom >= 1) [cropTop, cropBottom] = [0, 0];
  const contentLeft = cropLeft;
  const contentRight = 1 - cropRight;
  const contentTop = cropTop;
  const contentBottom = 1 - cropBottom;

  const contentMiddle = (contentLeft + contentRight) / 2;
  const selectedLeft = cropSide === 'right' ? contentMiddle : contentLeft;
  const selectedRight = cropSide === 'right' ? contentRight : contentMiddle;
  const selectedWidth = (selectedRight - selectedLeft) * width;
  const selectedHeight = (contentBottom - contentTop) * height;
  const scale = Math.min(containerWidth / selectedWidth, containerHeight / selectedHeight);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const centeredLeft = (containerWidth - selectedWidth * scale) / 2;
  const centeredTop = (containerHeight - selectedHeight * scale) / 2;

  return {
    width: renderedWidth,
    height: renderedHeight,
    left: centeredLeft - selectedLeft * renderedWidth,
    top: centeredTop - contentTop * renderedHeight,
    clipInsets: {
      top: cropTop,
      right: cropSide === 'right' ? cropRight : 1 - selectedRight,
      bottom: cropBottom,
      left: selectedLeft,
    },
  };
}

function normalUnit(pageIndex) {
  return { pageIndex, splitPart: 0, cropSide: null };
}

function splitUnits(pageIndex, direction) {
  const sides = direction === 'rtl' ? ['right', 'left'] : ['left', 'right'];
  return sides.map((cropSide, splitPart) => ({ pageIndex, splitPart, cropSide }));
}

export function buildReaderSpreads({
  pageCount,
  doublePage = false,
  splitWidePages = new Set(),
  direction = 'ltr',
} = {}) {
  const count = Math.max(0, Number.parseInt(pageCount, 10) || 0);
  const isSplit = (index) => splitWidePages?.has?.(index) === true;
  const spreads = [];
  let index = 0;

  while (index < count) {
    if (isSplit(index)) {
      for (const unit of splitUnits(index, direction)) spreads.push([unit]);
      index += 1;
      continue;
    }

    const isCover = index === 0;
    const canPair = doublePage && !isCover && index + 1 < count && !isSplit(index + 1);
    if (!canPair) {
      spreads.push([normalUnit(index)]);
      index += 1;
      continue;
    }

    const pair = [normalUnit(index), normalUnit(index + 1)];
    spreads.push(direction === 'rtl' ? pair.reverse() : pair);
    index += 2;
  }

  return spreads;
}

function getReadingLocation(spread) {
  if (!Array.isArray(spread) || spread.length === 0) return null;
  const splitUnit = spread.find((unit) => unit.cropSide);
  if (splitUnit) return { pageIndex: splitUnit.pageIndex, splitPart: splitUnit.splitPart };
  const pageIndex = Math.min(...spread.map((unit) => unit.pageIndex));
  return { pageIndex, splitPart: 0 };
}

export function findSpreadIndex(spreads, location) {
  if (!Array.isArray(spreads) || spreads.length === 0) return -1;
  const pageIndex = Number.parseInt(location?.pageIndex, 10) || 0;
  const splitPart = Number.parseInt(location?.splitPart, 10) || 0;
  const exact = spreads.findIndex((spread) => spread.some((unit) => (
    unit.pageIndex === pageIndex && unit.splitPart === splitPart
  )));
  if (exact >= 0) return exact;
  return spreads.findIndex((spread) => spread.some((unit) => unit.pageIndex === pageIndex));
}

export function getReaderDecodeWindow(spreads, currentSpreadIndex) {
  if (!Array.isArray(spreads) || spreads.length === 0) return [];
  const current = Math.max(0, Math.min(Number(currentSpreadIndex) || 0, spreads.length - 1));
  return spreads.slice(Math.max(0, current - 1), Math.min(spreads.length, current + 2));
}

export function getPendingSpreadRenderState(currentSpread, displayedSpread, pending = false) {
  const targetUnits = Array.isArray(currentSpread) ? currentSpread : [];
  const visibleUnits = pending && Array.isArray(displayedSpread) && displayedSpread.length > 0
    ? displayedSpread
    : targetUnits;
  const units = [...targetUnits];
  if (pending && visibleUnits.length > units.length) {
    units.push(...visibleUnits.slice(units.length));
  }
  return { units, visibleSlotCount: visibleUnits.length };
}

export function getAdjacentSpreadLocation(spreads, location, delta) {
  if (!Array.isArray(spreads) || spreads.length === 0) return null;
  const current = Math.max(0, findSpreadIndex(spreads, location));
  const target = Math.max(0, Math.min(current + Math.sign(delta || 0), spreads.length - 1));
  return getReadingLocation(spreads[target]);
}

export function getSpreadProgressPage(spread) {
  if (!Array.isArray(spread) || spread.length === 0) return 0;
  const splitUnit = spread.find((unit) => unit.cropSide);
  if (splitUnit) return splitUnit.splitPart === 0 ? splitUnit.pageIndex : splitUnit.pageIndex + 1;
  return Math.max(...spread.map((unit) => unit.pageIndex)) + 1;
}
