import { ARCHIVE_PROGRESS_VISIBILITY, normalizeArchiveProgressVisibility } from './archiveProgress.js';

export const READER_SETTINGS_KEY = 'lrr_reader_settings';

export const DEFAULT_READER_SETTINGS = Object.freeze({
  direction: 'ltr', preloadCount: 3, autoTurnInterval: 5, autoTurnActive: false,
  ehEnabled: false, ehCookie: '', ehMinScore: 0, ehMaxComments: 45,
  ehSortMethod: 'score', ehSortOrder: 'desc',
  readingLayout: 'single', doublePageEnabled: false,
  scaleMode: 'fit-screen', cropBordersEnabled: false,
  splitWidePagesEnabled: false, rotateWidePagesEnabled: false,
  webtoonGap: 0, doublePageGap: 8,
  pageIndicatorVisibilityMode: 'auto',
  optimizedImageDecodeEnabled: true,
  maxConcurrentDecodes: 3,
  allowProgressRegression: true,
  progressBarVisibility: ARCHIVE_PROGRESS_VISIBILITY.HISTORY,
  // 超分
  srEnabled: false,
  srModel: 'waifu2x',
  srAuto: false,
  srAutoThreshold: 500, // 每页平均体积阈值（KB）；0 表示不限制体积
});

const allowed = {
  direction: ['ltr', 'rtl'], readingLayout: ['single', 'double', 'webtoon', 'auto'],
  scaleMode: ['fit-screen', 'fit-width', 'fit-height', 'original'],
  pageIndicatorVisibilityMode: ['pinned', 'hidden', 'auto'],
};

export function normalizeReaderSettings(value = {}) {
  const next = { ...DEFAULT_READER_SETTINGS, ...(value && typeof value === 'object' ? value : {}) };
  if (value?.doublePageEnabled && (!value.readingLayout || value.readingLayout === 'single')) next.readingLayout = 'double';
  if (next.ehSortMethod === 'posted') next.ehSortMethod = 'time';
  if (!['score', 'time'].includes(next.ehSortMethod)) next.ehSortMethod = DEFAULT_READER_SETTINGS.ehSortMethod;
  if (!['asc', 'desc'].includes(next.ehSortOrder)) next.ehSortOrder = DEFAULT_READER_SETTINGS.ehSortOrder;
  for (const [key, choices] of Object.entries(allowed)) {
    if (!choices.includes(next[key])) next[key] = DEFAULT_READER_SETTINGS[key];
  }
  for (const key of ['doublePageEnabled', 'cropBordersEnabled', 'splitWidePagesEnabled', 'rotateWidePagesEnabled', 'optimizedImageDecodeEnabled', 'allowProgressRegression']) {
    next[key] = Boolean(next[key]);
  }
  next.preloadCount = Math.max(0, Math.min(10, Number(next.preloadCount) || 0));
  const maxConcurrentDecodes = Number(next.maxConcurrentDecodes);
  next.maxConcurrentDecodes = Math.max(
    1,
    Math.min(6, Number.isFinite(maxConcurrentDecodes)
      ? Math.floor(maxConcurrentDecodes)
      : DEFAULT_READER_SETTINGS.maxConcurrentDecodes),
  );
  const autoTurnInterval = Number(next.autoTurnInterval);
  next.autoTurnInterval = Number.isFinite(autoTurnInterval) && autoTurnInterval > 0
    ? Math.min(3600, autoTurnInterval)
    : DEFAULT_READER_SETTINGS.autoTurnInterval;
  next.webtoonGap = Math.max(0, Math.min(64, Number(next.webtoonGap) || 0));
  next.doublePageGap = Math.max(0, Math.min(64, Number(next.doublePageGap) || 0));
  next.doublePageEnabled = next.readingLayout === 'double';
  next.progressBarVisibility = normalizeArchiveProgressVisibility(next.progressBarVisibility);
  if (next.splitWidePagesEnabled) next.rotateWidePagesEnabled = false;
  // 超分字段
  if (next.srModel === 'onnx-subpixel-x3' || next.srModel === 'anime4k' || !['waifu2x', 'waifu2x-upconv7', 'realcugan'].includes(next.srModel)) {
    next.srModel = DEFAULT_READER_SETTINGS.srModel;
  }
  next.srEnabled = Boolean(next.srEnabled);
  next.srAuto = Boolean(next.srAuto);
  delete next.srPreloadCount;
  const srThreshold = Number(next.srAutoThreshold);
  next.srAutoThreshold = Number.isFinite(srThreshold) && srThreshold >= 0
    ? srThreshold
    : DEFAULT_READER_SETTINGS.srAutoThreshold;
  return next;
}

export function sanitizeUnsignedIntegerInput(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function prepareReaderSettingsForArchiveChange(value = {}) {
  return normalizeReaderSettings({ ...(value && typeof value === 'object' ? value : {}), autoTurnActive: false });
}

export function getAllowProgressRegression(storage = globalThis.localStorage) {
  try {
    return normalizeReaderSettings(JSON.parse(storage?.getItem(READER_SETTINGS_KEY) || '{}')).allowProgressRegression;
  } catch {
    return DEFAULT_READER_SETTINGS.allowProgressRegression;
  }
}
