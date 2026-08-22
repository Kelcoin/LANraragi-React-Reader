export function toPairKey(left, right) {
  return [String(left || ''), String(right || '')].sort().join('|');
}

export const DEDUPE_DEFAULT_START_DATE = '2000-01-01';

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

export function getTodayDateString(date = new Date()) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-');
}

function dateToDayString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-');
}

function parseArchiveDateValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    return dateToDayString(new Date(ms));
  }
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) return '';
    const ms = n > 1e12 ? n : n * 1000;
    return dateToDayString(new Date(ms));
  }
  return dateToDayString(new Date(text));
}

export function getArchiveDateDay(archive) {
  const direct = parseArchiveDateValue(archive?.date_added);
  if (direct) return direct;
  const tagMatch = String(archive?.tags || '').match(/(?:^|,\s*)date_added:(\d+)/);
  if (tagMatch) {
    const fromTag = parseArchiveDateValue(tagMatch[1]);
    if (fromTag) return fromTag;
  }
  return DEDUPE_DEFAULT_START_DATE;
}

function getExplicitArchiveDateDay(archive) {
  const direct = parseArchiveDateValue(archive?.date_added);
  if (direct) return direct;
  const tagMatch = String(archive?.tags || '').match(/(?:^|,\s*)date_added:(\d+)/);
  if (!tagMatch) return '';
  return parseArchiveDateValue(tagMatch[1]);
}

export function normalizeDedupeDateRange(start, end, today = getTodayDateString()) {
  let from = /^\d{4}-\d{2}-\d{2}$/.test(String(start || '')) ? String(start) : DEDUPE_DEFAULT_START_DATE;
  let to = /^\d{4}-\d{2}-\d{2}$/.test(String(end || '')) ? String(end) : today;
  if (from > to) [from, to] = [to, from];
  return { start: from, end: to };
}

export function filterArchivesByDateRange(archives, start, end) {
  const range = normalizeDedupeDateRange(start, end);
  if (range.start <= DEDUPE_DEFAULT_START_DATE) return archives || [];
  return (archives || []).filter((archive) => {
    const day = getExplicitArchiveDateDay(archive);
    if (!day) return true;
    return day >= range.start && day <= range.end;
  });
}

export function filterDuplicateGroupsForSavedState(groups, deletedIds = new Set(), nonDuplicatePairKeys = new Set()) {
  return (groups || []).filter((group) => {
    const ids = (group || []).map((id) => String(id || '')).filter(Boolean);
    if (ids.length < 2) return false;
    if (ids.some((id) => deletedIds.has(id))) return false;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        if (nonDuplicatePairKeys.has(toPairKey(ids[i], ids[j]))) return false;
      }
    }
    return true;
  });
}

export function buildDuplicateGroups(pairs, ignoredPairKeys = new Set()) {
  const seen = new Set();
  const groups = [];
  for (const pair of pairs || []) {
    const left = pair?.left;
    const right = pair?.right;
    if (!left || !right) continue;
    const key = toPairKey(left, right);
    if (ignoredPairKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    groups.push(key.split('|'));
  }
  return groups
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function duplicateGroupIds(group) {
  return (group || [])
    .map((item) => String(item?.arcid || item?.id || item || ''))
    .filter(Boolean);
}

function buildDuplicateSelectionModel(groups) {
  const normalizedGroups = (groups || []).map(duplicateGroupIds).filter((ids) => ids.length > 1);
  const groupsById = new Map();
  const neighbors = new Map();
  normalizedGroups.forEach((ids) => {
    const uniqueIds = Array.from(new Set(ids));
    uniqueIds.forEach((id) => {
      if (!groupsById.has(id)) groupsById.set(id, []);
      groupsById.get(id).push(uniqueIds);
      if (!neighbors.has(id)) neighbors.set(id, new Set());
      uniqueIds.forEach((otherId) => {
        if (otherId !== id) neighbors.get(id).add(otherId);
      });
    });
  });

  const componentById = new Map();
  neighbors.forEach((_, startId) => {
    if (componentById.has(startId)) return;
    const component = new Set();
    const queue = [startId];
    while (queue.length > 0) {
      const id = queue.shift();
      if (component.has(id)) continue;
      component.add(id);
      neighbors.get(id)?.forEach((neighbor) => {
        if (!component.has(neighbor)) queue.push(neighbor);
      });
    }
    component.forEach((id) => componentById.set(id, component));
  });
  return { groupsById, componentById, ids: Array.from(neighbors.keys()) };
}

function canAddDuplicateSelection(model, selected, id) {
  if (!id || selected.has(id) || !model.groupsById.has(id)) return false;
  const component = model.componentById.get(id);
  const selectedInComponent = Array.from(component || []).filter((item) => selected.has(item)).length;
  return !component || selectedInComponent < component.size - 1;
}

export function groupDuplicatePairsByChain(groups) {
  const model = buildDuplicateSelectionModel(groups);
  const chains = new Map();
  (groups || []).forEach((group) => {
    const ids = duplicateGroupIds(group);
    if (ids.length < 2) return;
    const component = model.componentById.get(ids[0]);
    if (!component) return;
    if (!chains.has(component)) chains.set(component, []);
    chains.get(component).push(group);
  });
  return Array.from(chains.values());
}

export function getDedupeGroupFilterData(groups, duplicateSourceByGroupKey = {}) {
  const allGroups = groups || [];
  const getSource = (group) => (
    duplicateSourceByGroupKey[duplicateGroupIds(group).sort().join('|')] === 'image'
      ? 'image'
      : 'filename'
  );
  const imageGroups = allGroups.filter((group) => getSource(group) === 'image');
  const filenameGroups = allGroups.filter((group) => getSource(group) === 'filename');
  const allChains = groupDuplicatePairsByChain(allGroups);
  const chains = allChains.filter((chain) => chain.length > 1);
  return { allGroups, imageGroups, filenameGroups, allChains, chains };
}

export function normalizeDuplicateSelection(groups, requestedIds) {
  const model = buildDuplicateSelectionModel(groups);
  const selected = new Set();
  const accepted = [];
  Array.from(requestedIds || []).forEach((value) => {
    const id = String(value || '');
    if (!canAddDuplicateSelection(model, selected, id)) return;
    selected.add(id);
    accepted.push(id);
  });
  return accepted;
}

export function getDuplicateSelectionDisabledIds(groups, selectedIds) {
  const model = buildDuplicateSelectionModel(groups);
  const normalized = normalizeDuplicateSelection(groups, selectedIds);
  const selected = new Set(normalized);
  return new Set(model.ids.filter((id) => (
    !selected.has(id)
    && !canAddDuplicateSelection(model, selected, id)
  )));
}

const DEDUPE_ARCHIVE_FIELDS = [
  'arcid', 'id', 'title', 'tags', 'size', 'filesize', 'file_size',
  'pagecount', 'total', 'progress', 'page', 'date_added',
];

export function compactDedupeArchives(groups) {
  const seen = new Set();
  const compact = [];
  (groups || []).flat().forEach((archive) => {
    const id = String(archive?.arcid || archive?.id || '');
    if (!id || seen.has(id)) return;
    seen.add(id);
    const item = {};
    DEDUPE_ARCHIVE_FIELDS.forEach((field) => {
      if (archive[field] !== undefined) item[field] = archive[field];
    });
    compact.push(item);
  });
  return compact;
}

export function createDedupeSavedResultPayload({
  groups,
  duplicateSourceByGroupKey = {},
  dateRange,
  status = '',
  lastScanStats = null,
  workerWarning = '',
  selectedArchiveIds = [],
  selectedGroupKeys = [],
  manuallyTouchedGroupKeys = [],
  savedAt = new Date().toISOString(),
} = {}) {
  const visibleGroups = (groups || []).filter((group) => duplicateGroupIds(group).length > 1);
  if (visibleGroups.length === 0) return null;

  const idGroups = visibleGroups.map(duplicateGroupIds);
  const visibleArchiveIds = new Set(idGroups.flat());
  const visibleGroupKeys = new Set(idGroups.map((ids) => [...ids].sort().join('|')));
  const sourceEntries = Object.entries(duplicateSourceByGroupKey || {})
    .filter(([key, source]) => visibleGroupKeys.has(key) && (source === 'filename' || source === 'image'));
  return {
    version: 3,
    savedAt,
    dateRange,
    status,
    archives: compactDedupeArchives(visibleGroups),
    groups: idGroups,
    lastScanStats,
    workerWarning,
    selectedArchiveIds: Array.from(selectedArchiveIds || [], String)
      .filter((id) => visibleArchiveIds.has(id)),
    selectedGroupKeys: Array.from(selectedGroupKeys || [], String)
      .filter((key) => visibleGroupKeys.has(key)),
    manuallyTouchedGroupKeys: Array.from(manuallyTouchedGroupKeys || [], String)
      .filter((key) => visibleGroupKeys.has(key)),
    duplicateSourceByGroupKey: Object.fromEntries(sourceEntries),
  };
}

function tagSet(archive) {
  return new Set(String(archive?.tags || '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean));
}

export function getDedupeSmartSelectionSignals(archive) {
  const tags = tagSet(archive);
  return {
    roughTranslation: tags.has('other:rough translation'),
    extraneousAds: tags.has('other:extraneous ads'),
    uncensored: tags.has('other:uncensored'),
    noChinese: !tags.has('language:chinese'),
  };
}

function archiveId(archive) {
  return String(archive?.arcid || archive?.id || '');
}

function archiveSize(archive) {
  const value = archive?.size ?? archive?.filesize ?? archive?.file_size ?? 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function keepScore(archive, index) {
  const signals = getDedupeSmartSelectionSignals(archive);
  return {
    hasChinese: signals.noChinese ? 0 : 1,
    notRoughTranslation: signals.roughTranslation ? 0 : 1,
    uncensored: signals.uncensored ? 1 : 0,
    noAds: signals.extraneousAds ? 0 : 1,
    size: archiveSize(archive),
    index: -index,
  };
}

export function selectDuplicateDeletionIds(archives) {
  const items = (archives || []).filter((archive) => archiveId(archive));
  if (items.length < 2) return [];

  let keepIndex = 0;
  let best = keepScore(items[0], 0);
  for (let i = 1; i < items.length; i += 1) {
    const score = keepScore(items[i], i);
    if (
      score.hasChinese > best.hasChinese ||
      (score.hasChinese === best.hasChinese && score.notRoughTranslation > best.notRoughTranslation) ||
      (score.hasChinese === best.hasChinese && score.notRoughTranslation === best.notRoughTranslation && score.uncensored > best.uncensored) ||
      (score.hasChinese === best.hasChinese && score.notRoughTranslation === best.notRoughTranslation && score.uncensored === best.uncensored && score.noAds > best.noAds) ||
      (score.hasChinese === best.hasChinese && score.notRoughTranslation === best.notRoughTranslation && score.uncensored === best.uncensored && score.noAds === best.noAds && score.size > best.size) ||
      (score.hasChinese === best.hasChinese && score.notRoughTranslation === best.notRoughTranslation && score.uncensored === best.uncensored && score.noAds === best.noAds && score.size === best.size && score.index > best.index)
    ) {
      keepIndex = i;
      best = score;
    }
  }

  return items
    .filter((_, index) => index !== keepIndex)
    .map(archiveId);
}

export function mergeSmartDuplicateSelection(
  groups,
  protectedGroupKeys,
  selectedArchiveIds = [],
  selectedGroupKeys = [],
  duplicateSourceByGroupKey = {},
  { includeFilenameOnly = false } = {},
) {
  const protectedKeys = new Set(Array.from(protectedGroupKeys || [], String));
  const protectedGroups = (groups || []).filter((group) => protectedKeys.has(duplicateGroupIds(group).sort().join('|')));
  const protectedArchiveIds = new Set(protectedGroups.flatMap(duplicateGroupIds));
  const retainedArchiveIds = Array.from(selectedArchiveIds || [], String)
    .filter((id) => protectedArchiveIds.has(id));
  const retainedGroupKeys = Array.from(selectedGroupKeys || [], String)
    .filter((key) => protectedKeys.has(key));
  const generatedGroups = (groups || [])
    .filter((group) => !protectedKeys.has(duplicateGroupIds(group).sort().join('|')));
  const skippedFilenameOnlyCount = generatedGroups.filter((group) => (
    duplicateSourceByGroupKey[duplicateGroupIds(group).sort().join('|')] !== 'image'
    && (!includeFilenameOnly || duplicateSourceByGroupKey[duplicateGroupIds(group).sort().join('|')] !== 'filename')
  )).length;
  const generatedArchiveIds = generatedGroups
    .filter((group) => {
      const source = duplicateSourceByGroupKey[duplicateGroupIds(group).sort().join('|')];
      return source === 'image' || (includeFilenameOnly && source === 'filename');
    })
    .flatMap((group) => selectDuplicateDeletionIds(group).slice(0, 1));
  return {
    archiveIds: normalizeDuplicateSelection(groups, [...retainedArchiveIds, ...generatedArchiveIds]),
    groupKeys: retainedGroupKeys,
    skippedFilenameOnlyCount,
  };
}

export function countDuplicateGroupsWithLargePageGap(groups, threshold = 10) {
  const limit = Number(threshold);
  if (!Number.isFinite(limit) || limit < 0) return 0;
  return (groups || []).filter((group) => {
    const pageCounts = (group || [])
      .map((archive) => Number(archive?.pagecount) || Number(archive?.total))
      .filter((count) => Number.isFinite(count) && count > 0);
    if (pageCounts.length < 2) return false;
    return Math.max(...pageCounts) - Math.min(...pageCounts) > limit;
  }).length;
}

async function imageFromBlob(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // LANraragi thumbnails may arrive as octet-stream/empty MIME blobs.
      // <img> can still decode those, matching ArchiveCard's display path.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function createCoverSignature(blob, width = 8) {
  const source = await imageFromBlob(blob);
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error('封面尺寸无效');

  const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  if (typeof source.close === 'function') source.close();
  return {
    width,
    height,
    ratio: sourceHeight / sourceWidth,
    pixels: ctx.getImageData(0, 0, width, height).data,
  };
}

const FILENAME_RELEASE_MARKER = /\[(?:中国翻訳|中国翻译|中国語|chinese|中文|dl版|dl|digital|無修正|无修正|uncensored|翻訳|翻译)\]/giu;

export function normalizeDedupeFilename(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#(?:0*38|x0*26);/gi, '&')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.(?:zip|rar|7z|cbz|cbr)$/i, '')
    .replace(FILENAME_RELEASE_MARKER, '')
    .replace(/\((?:chinese|english|japanese|korean)\)/gi, '')
    .replace(/_g\d+$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function filenameSimilarity(left, right) {
  if (!left || !right || left.length < 16 || right.length < 16) return 0;
  const maxLength = Math.max(left.length, right.length);
  if (Math.abs(left.length - right.length) / maxLength > 0.2) return 0;
  if (maxLength > 180) return 0;
  const sharedPrefix = left.slice(0, 4) === right.slice(0, 4);
  const sharedSuffix = left.slice(-4) === right.slice(-4);
  if (!sharedPrefix && !sharedSuffix) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / maxLength;
}

const signatureFilenameCache = new WeakMap();

function getSignatureFilename(signature) {
  if (!signature || typeof signature !== 'object') return '';
  if (!signatureFilenameCache.has(signature)) {
    signatureFilenameCache.set(signature, normalizeDedupeFilename(signature.filename || signature.title));
  }
  return signatureFilenameCache.get(signature);
}

function getFilenameEvidence(left, right) {
  const leftName = getSignatureFilename(left);
  const rightName = getSignatureFilename(right);
  if (leftName && leftName === rightName) {
    return { leftName, rightName, exact: leftName.length >= 12, similar: false };
  }
  return { leftName, rightName, exact: false, similar: filenameSimilarity(leftName, rightName) >= 0.92 };
}

function getColorDifference(left, right) {
  const width = Math.min(left.width, right.width);
  const height = Math.min(left.height, right.height);
  const differences = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const li = (y * left.width + x) * 4;
      const ri = (y * right.width + x) * 4;
      differences.push(
        Math.abs(left.pixels[li] - right.pixels[ri])
        + Math.abs(left.pixels[li + 1] - right.pixels[ri + 1])
        + Math.abs(left.pixels[li + 2] - right.pixels[ri + 2]),
      );
    }
  }
  return differences;
}

function archiveShapeMismatch(left, right, {
  pageCountRatioLimit = 1.65,
  minimumPageCountDelta = 8,
  fileSizeRatioLimit = 2.25,
  minimumFileSizeDelta = 1_000_000,
} = {}) {
  const leftPages = Number(left?.pageCount);
  const rightPages = Number(right?.pageCount);
  if (Number.isFinite(leftPages) && Number.isFinite(rightPages) && leftPages > 0 && rightPages > 0) {
    const minPages = Math.min(leftPages, rightPages);
    const maxPages = Math.max(leftPages, rightPages);
    if (maxPages - minPages >= minimumPageCountDelta && maxPages / minPages > pageCountRatioLimit) return true;
  }
  const leftSize = Number(left?.fileSize);
  const rightSize = Number(right?.fileSize);
  if (Number.isFinite(leftSize) && Number.isFinite(rightSize) && leftSize > 0 && rightSize > 0) {
    const minSize = Math.min(leftSize, rightSize);
    const maxSize = Math.max(leftSize, rightSize);
    if (maxSize - minSize >= minimumFileSizeDelta && maxSize / minSize > fileSizeRatioLimit) return true;
  }
  return false;
}

const signatureTextureCache = new WeakMap();

function getSignatureTexture(signature) {
  if (signatureTextureCache.has(signature)) return signatureTextureCache.get(signature);

  const pixelCount = Math.min(
    Math.floor((signature?.pixels?.length || 0) / 4),
    Math.max(1, Number(signature?.width || 0) * Number(signature?.height || 0)),
  );
  if (!pixelCount) return { standardDeviation: 0 };

  let sum = 0;
  const luminance = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const value = signature.pixels[offset] * 0.299
      + signature.pixels[offset + 1] * 0.587
      + signature.pixels[offset + 2] * 0.114;
    luminance[index] = value;
    sum += value;
  }
  const mean = sum / pixelCount;
  let variance = 0;
  for (const value of luminance) variance += (value - mean) ** 2;
  const bins = new Map();
  for (const value of luminance) {
    const bin = Math.min(15, Math.floor(value / 16));
    bins.set(bin, (bins.get(bin) || 0) + 1);
  }
  const dominantCount = Math.max(...bins.values());
  const result = {
    standardDeviation: Math.sqrt(variance / pixelCount),
    mean,
    dominantFraction: dominantCount / pixelCount,
    layout: Array.from(luminance),
  };
  result.isUniform = result.dominantFraction >= 0.98 && result.standardDeviation <= 4;
  signatureTextureCache.set(signature, result);
  return result;
}

function getLayoutDistance(left, right) {
  const size = Math.min(left.layout?.length || 0, right.layout?.length || 0);
  if (!size) return 1;
  let total = 0;
  for (let index = 0; index < size; index += 1) {
    total += Math.abs(left.layout[index] - right.layout[index]);
  }
  return total / size / 255;
}

function shouldSkipLowInformationPair(left, right, {
  dominantColorFraction = 0.75,
  dominantLayoutDistance = 0.08,
  uniformColorFraction = 0.98,
  uniformLayoutDistance = 0.03,
  uniformStdDev = 4,
} = {}) {
  if (
    left.dominantFraction < dominantColorFraction
    || right.dominantFraction < dominantColorFraction
  ) return false;
  const layoutDistance = getLayoutDistance(left, right);
  if (layoutDistance > dominantLayoutDistance) return true;
  return (
    left.dominantFraction >= uniformColorFraction
    && right.dominantFraction >= uniformColorFraction
    && left.standardDeviation <= uniformStdDev
    && right.standardDeviation <= uniformStdDev
    && layoutDistance <= uniformLayoutDistance
  );
}

function shouldSkipCheapPair(left, right, evidence, options) {
  if (evidence?.exact) return false;
  const leftTexture = getSignatureTexture(left);
  const rightTexture = getSignatureTexture(right);
  if (
    !evidence?.similar
    && archiveShapeMismatch(left, right, {
      pageCountRatioLimit: options.pageCountRatioLimit ?? 1.15,
      minimumPageCountDelta: options.minimumPageCountDelta ?? 2,
    })
  ) return true;
  const meanLimit = options.meanLuminanceLimit ?? 96;
  if (!evidence?.similar && Math.abs(leftTexture.mean - rightTexture.mean) > meanLimit) return true;
  return shouldSkipLowInformationPair(leftTexture, rightTexture, options);
}

function getImageComparisonOptions(evidence, options, nameCounts) {
  if (evidence?.exact && nameCounts.get(evidence.leftName) <= 2) {
    return {
      ...options,
      allowLowInformationMatch: true,
      outlierPercent: Math.max(options.outlierPercent ?? 0.15, 0.35),
    };
  }
  if (evidence?.similar) {
    return {
      ...options,
      allowLowInformationMatch: true,
      percentDifference: Math.max(options.percentDifference ?? 0.2, 0.28),
    };
  }
  return options;
}

function addExactFilenamePairs(entries, nameCounts, ignoredPairKeys, pairs) {
  const byName = new Map();
  entries.forEach(([id, signature]) => {
    const name = getSignatureFilename(signature);
    if (name && nameCounts.get(name) <= 2) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(id);
    }
  });
  byName.forEach((ids) => {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        if (!ignoredPairKeys.has(toPairKey(ids[i], ids[j]))) {
          pairs.push({ left: ids[i], right: ids[j] });
        }
      }
    }
  });
}

export function areSignaturesDuplicate(left, right, {
  pixelThreshold = 30,
  percentDifference = 0.2,
  aspectRatioLimit = 0.1,
  outlierPercent = 0.15,
  lowTextureStdDev = 12,
  highTextureStdDev = 32,
  dominantColorFraction = 0.75,
  dominantLayoutDistance = 0.08,
  uniformColorFraction = 0.98,
  uniformLayoutDistance = 0.03,
  uniformStdDev = 4,
  pageCountRatioLimit = 1.65,
  minimumPageCountDelta = 8,
  allowLowInformationMatch = false,
} = {}) {
  if (!left || !right) return false;
  if (Math.abs(left.ratio - right.ratio) > aspectRatioLimit) return false;
  if (archiveShapeMismatch(left, right, { pageCountRatioLimit, minimumPageCountDelta })) return false;

  // A mostly solid cover can hide a small title/logo difference inside the
  // outlier allowance. Do not call it a duplicate when the other cover has
  // substantially more visual structure.
  const leftTexture = getSignatureTexture(left);
  const rightTexture = getSignatureTexture(right);
  if (
    (leftTexture.standardDeviation <= lowTextureStdDev && rightTexture.standardDeviation >= highTextureStdDev)
    || (rightTexture.standardDeviation <= lowTextureStdDev && leftTexture.standardDeviation >= highTextureStdDev)
  ) return false;

  if (
    !allowLowInformationMatch
    && leftTexture.dominantFraction >= dominantColorFraction
    && rightTexture.dominantFraction >= dominantColorFraction
  ) return false;

  if (shouldSkipLowInformationPair(leftTexture, rightTexture, {
    dominantColorFraction,
    dominantLayoutDistance,
    uniformColorFraction,
    uniformLayoutDistance,
    uniformStdDev,
  })) return false;

  const differences = getColorDifference(left, right);
  const changedRatio = differences.filter((diff) => diff > pixelThreshold).length / differences.length;
  if (changedRatio < percentDifference) return true;

  // Keep spatial correspondence; only discard a small watermark/logo region.
  if (changedRatio > 0.55 || outlierPercent <= 0) return false;
  differences.sort((a, b) => a - b);
  const retained = differences.slice(0, Math.max(1, Math.floor(differences.length * (1 - outlierPercent))));
  return retained.filter((diff) => diff > pixelThreshold).length / retained.length < percentDifference;
}

export function findDuplicatePairs(signatures, ignoredPairKeys = new Set(), options = {}) {
  const entries = Array.from(signatures || []).filter(([, signature]) => signature);
  const nameCounts = new Map();
  entries.forEach(([, signature]) => {
    const name = getSignatureFilename(signature);
    if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  });
  const pairs = [];
  addExactFilenamePairs(entries, nameCounts, ignoredPairKeys, pairs);
  const exactPairKeys = new Set(pairs.map((pair) => toPairKey(pair.left, pair.right)));
  const imageMatchedPairKeys = new Set();
  const imageEntries = entries.filter(([, signature]) => !getSignatureTexture(signature).isUniform);
  for (let i = 0; i < imageEntries.length; i += 1) {
    const [leftId, leftSignature] = imageEntries[i];
    for (let j = i + 1; j < imageEntries.length; j += 1) {
      const [rightId, rightSignature] = imageEntries[j];
      const pairKey = toPairKey(leftId, rightId);
      if (ignoredPairKeys.has(pairKey)) continue;
      const evidence = getFilenameEvidence(leftSignature, rightSignature);
      const imageOptions = getImageComparisonOptions(evidence, options, nameCounts);
      if (!shouldSkipCheapPair(leftSignature, rightSignature, evidence, imageOptions)
        && areSignaturesDuplicate(leftSignature, rightSignature, imageOptions)) {
        if (exactPairKeys.has(pairKey)) imageMatchedPairKeys.add(pairKey);
        else {
          pairs.push({ left: leftId, right: rightId });
          options.onPair?.({ left: leftId, right: rightId, source: 'image' });
        }
      }
    }
  }
  pairs.filter((pair) => exactPairKeys.has(toPairKey(pair.left, pair.right))).forEach((pair) => {
    const pairKey = toPairKey(pair.left, pair.right);
    options.onPair?.({ ...pair, source: imageMatchedPairKeys.has(pairKey) ? 'image' : 'filename' });
  });
  return pairs;
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function findDuplicatePairsAsync(signatures, ignoredPairKeys = new Set(), options = {}) {
  const aspectRatioLimit = options.aspectRatioLimit ?? 0.1;
  const entries = Array.from(signatures || [])
    .filter(([, signature]) => signature)
    .sort((a, b) => a[1].ratio - b[1].ratio);
  const chunkSize = options.chunkSize || 5000;
  const pairs = [];
  const nameCounts = new Map();
  entries.forEach(([, signature]) => {
    const name = getSignatureFilename(signature);
    if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  });
  addExactFilenamePairs(entries, nameCounts, ignoredPairKeys, pairs);
  const exactPairKeys = new Set(pairs.map((pair) => toPairKey(pair.left, pair.right)));
  const imageMatchedPairKeys = new Set();
  const imageEntries = entries
    .filter(([, signature]) => !getSignatureTexture(signature).isUniform);
  let checked = 0;
  let chunk = 0;

  for (let i = 0; i < imageEntries.length; i += 1) {
    const [leftId, leftSignature] = imageEntries[i];
    for (let j = i + 1; j < imageEntries.length; j += 1) {
      const [rightId, rightSignature] = imageEntries[j];
      const pairKey = toPairKey(leftId, rightId);
      if (rightSignature.ratio - leftSignature.ratio > aspectRatioLimit) break;
      checked += 1;
      chunk += 1;
      if (ignoredPairKeys.has(pairKey)) continue;
      // Evidence after the break/ignored gates: filenameSimilarity can run a
      // full Levenshtein, which is wasted on pairs the gates discard anyway.
      const evidence = getFilenameEvidence(leftSignature, rightSignature);
      const imageOptions = getImageComparisonOptions(evidence, options, nameCounts);
      if (!shouldSkipCheapPair(leftSignature, rightSignature, evidence, imageOptions)
        && areSignaturesDuplicate(leftSignature, rightSignature, imageOptions)) {
        if (exactPairKeys.has(pairKey)) imageMatchedPairKeys.add(pairKey);
        else {
          pairs.push({ left: leftId, right: rightId });
          options.onPair?.({ left: leftId, right: rightId, source: 'image' });
        }
      }
      if (chunk >= chunkSize) {
        chunk = 0;
        options.onProgress?.({ current: i, total: imageEntries.length, checked, pairs: pairs.length });
        await yieldToBrowser();
      }
    }
    options.onProgress?.({ current: i + 1, total: imageEntries.length, checked, pairs: pairs.length });
  }

  pairs.filter((pair) => exactPairKeys.has(toPairKey(pair.left, pair.right))).forEach((pair) => {
    const pairKey = toPairKey(pair.left, pair.right);
    options.onPair?.({ ...pair, source: imageMatchedPairKeys.has(pairKey) ? 'image' : 'filename' });
  });
  options.onProgress?.({ current: imageEntries.length, total: imageEntries.length, checked, pairs: pairs.length });
  return pairs;
}
