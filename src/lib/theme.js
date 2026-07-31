export const THEME_STORAGE_KEY = 'lrr_theme_mode';
export const CUSTOM_THEME_STORAGE_KEY = 'lrr_custom_theme';
export const THEME_MODES = ['auto', 'dark', 'light'];
export const DEFAULT_THEME_PALETTE = Object.freeze({
  accent: '#b74632',
  secondary: '#70784f',
  background: '#f4f0e8',
});
export const DEFAULT_THEME_PALETTES = Object.freeze({
  light: DEFAULT_THEME_PALETTE,
  dark: Object.freeze({
    accent: '#4a9ff0',
    secondary: '#79b8ff',
    background: '#0f1115',
  }),
});
const THEME_COLORS = {
  dark: '#0f1115',
  light: '#f4f0e8',
};

const CUSTOM_THEME_PROPERTIES = [
  '--bg-color', '--page-bg', '--surface-1', '--surface-2', '--surface-3', '--surface-inset', '--glass-bg',
  '--glass-border', '--glass-border-hover', '--accent', '--accent-strong', '--accent-soft', '--accent-contrast', '--olive',
  '--olive-strong', '--olive-soft', '--good', '--good-text', '--good-surface', '--good-border', '--button-hover-bg', '--danger-contrast',
  '--input-bg', '--input-focus-bg', '--placeholder', '--card-bg', '--cover-bg', '--toolbar-bg', '--dropdown-bg',
  '--tag-panel-bg', '--scrollbar-thumb', '--scrollbar-thumb-hover', '--reader-control-bg', '--reader-control-hover-bg',
  '--reader-control-border', '--reader-panel-bg', '--reader-skeleton-base', '--reader-skeleton-highlight',
  '--comment-card-bg', '--comment-card-border', '--comment-input-bg', '--comment-positive', '--comment-negative',
  '--comment-uploader-bg', '--comment-uploader-border', '--text-main', '--text-sub', '--text-muted', '--reader-control-text',
  '--tag-artist', '--tag-parody', '--tag-category', '--tag-character', '--tag-female', '--tag-male', '--tag-mixed',
  '--tag-other', '--tag-group', '--tag-series', '--tag-language', '--tag-uploader', '--tag-date-added', '--tag-timestamp',
  '--tag-source', '--tag-general',
];

function normalizeHex(value, fallback) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate;
  if (/^#[0-9a-f]{3}$/i.test(candidate)) {
    return `#${candidate.slice(1).split('').map((part) => part + part).join('')}`;
  }
  return fallback;
}

function hexToRgb(hex) {
  const value = normalizeHex(hex, '#000000').slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('')}`;
}

function mixHex(first, second, amount) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const linear = (channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return (0.2126 * linear(r)) + (0.7152 * linear(g)) + (0.0722 * linear(b));
}

function ensureReadable(hex, background, target = 4.5) {
  let value = normalizeHex(hex, '#4a9ff0');
  const backgroundLuminance = luminance(background);
  const brighten = backgroundLuminance < 0.22;
  for (let i = 0; i < 8 && (Math.abs(luminance(value) - backgroundLuminance) < 0.18 || contrastRatio(value, background) < target); i += 1) {
    value = mixHex(value, brighten ? '#ffffff' : '#000000', brighten ? 0.12 : 0.12);
  }
  return value;
}

function contrastRatio(first, second) {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  const light = Math.max(firstLuminance, secondLuminance);
  const dark = Math.min(firstLuminance, secondLuminance);
  return (light + 0.05) / (dark + 0.05);
}

export function normalizeThemePalette(palette) {
  if (!palette || typeof palette !== 'object') return null;
  const normalized = {
    accent: normalizeHex(palette.accent, ''),
    secondary: normalizeHex(palette.secondary, ''),
    background: normalizeHex(palette.background, ''),
  };
  return Object.values(normalized).every(Boolean) ? normalized : null;
}

export function normalizeThemePalettes(palettes) {
  if (!palettes || typeof palettes !== 'object') return null;
  const legacy = normalizeThemePalette(palettes);
  if (legacy) return { light: legacy, dark: legacy };
  const light = normalizeThemePalette(palettes.light);
  const dark = normalizeThemePalette(palettes.dark);
  if (!light && !dark) return null;
  return { light: light || null, dark: dark || null };
}

export function readStoredThemePalettes(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(CUSTOM_THEME_STORAGE_KEY);
    return raw ? normalizeThemePalettes(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeStoredThemePalettes(palettes, storage = globalThis.localStorage) {
  const normalized = normalizeThemePalettes(palettes);
  try {
    if (normalized) storage?.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(normalized));
    else storage?.removeItem(CUSTOM_THEME_STORAGE_KEY);
  } catch {}
  return normalized;
}

export function readStoredThemePalette(storage = globalThis.localStorage) {
  return readStoredThemePalettes(storage)?.light || null;
}

export function writeStoredThemePalette(palette, storage = globalThis.localStorage) {
  return writeStoredThemePalettes(palette ? { light: palette, dark: palette } : null, storage)?.light || null;
}

export function createCustomThemeTokens(palette, resolvedTheme = 'light') {
  const normalized = normalizeThemePalette(palette);
  if (!normalized) return null;

  const dark = resolvedTheme === 'dark';
  const canvas = dark ? mixHex(normalized.background, '#080d16', 0.82) : mixHex(normalized.background, '#ffffff', 0.86);
  const surface1 = dark ? mixHex(canvas, '#ffffff', 0.075) : mixHex(canvas, '#ffffff', 0.68);
  const surface2 = dark ? mixHex(canvas, '#ffffff', 0.15) : mixHex(canvas, '#ffffff', 0.36);
  const surface3 = dark ? mixHex(canvas, '#ffffff', 0.23) : mixHex(canvas, '#000000', 0.08);
  const accent = ensureReadable(normalized.accent, surface1, dark ? 3.2 : 4.5);
  const secondary = ensureReadable(normalized.secondary, surface1, dark ? 3.2 : 4.5);
  const accentStrong = ensureReadable(dark ? mixHex(accent, '#ffffff', 0.2) : mixHex(accent, '#000000', 0.2), surface1, dark ? 3.2 : 4.5);
  const secondaryStrong = ensureReadable(dark ? mixHex(secondary, '#ffffff', 0.2) : mixHex(secondary, '#000000', 0.2), surface1, dark ? 3.2 : 4.5);
  const textMain = dark ? '#e8eef7' : '#282522';
  const textSub = dark ? '#a7b1c2' : '#625c54';
  const border = dark ? mixHex(canvas, '#8ba6c7', 0.28) : mixHex(canvas, '#6d6254', 0.25);
  const borderHover = dark ? mixHex(border, accent, 0.45) : mixHex(border, accent, 0.45);
  const accentSoft = dark ? mixHex(surface1, accent, 0.25) : mixHex(surface1, accent, 0.16);
  const secondarySoft = dark ? mixHex(surface1, secondary, 0.24) : mixHex(surface1, secondary, 0.15);
  const good = dark ? '#7bd2a0' : '#4f7042';
  const danger = dark ? '#f08b8b' : '#a83b31';
  const accentContrast = luminance(accent) > 0.42 ? '#171a20' : '#fffdf8';
  const dangerContrast = luminance(danger) > 0.42 ? '#171a20' : '#fffdf8';

  return {
    '--bg-color': canvas,
    '--page-bg': canvas,
    '--surface-1': surface1,
    '--surface-2': surface2,
    '--surface-3': surface3,
    '--surface-inset': mixHex(surface1, surface2, 0.52),
    '--glass-bg': surface1,
    '--glass-border': border,
    '--glass-border-hover': borderHover,
    '--accent': accent,
    '--accent-strong': accentStrong,
    '--accent-soft': accentSoft,
    '--accent-contrast': accentContrast,
    '--olive': secondary,
    '--olive-strong': secondaryStrong,
    '--olive-soft': secondarySoft,
    '--good': good,
    '--good-text': good,
    '--good-surface': mixHex(surface1, good, dark ? 0.22 : 0.12),
    '--good-border': mixHex(surface1, good, dark ? 0.5 : 0.36),
    '--button-hover-bg': accentStrong,
    '--danger-contrast': dangerContrast,
    '--input-bg': surface1,
    '--input-focus-bg': surface2,
    '--placeholder': dark ? '#8190a6' : '#968e84',
    '--card-bg': surface1,
    '--cover-bg': surface3,
    '--toolbar-bg': surface1,
    '--dropdown-bg': surface1,
    '--tag-panel-bg': surface1,
    '--scrollbar-thumb': borderHover,
    '--scrollbar-thumb-hover': accent,
    '--reader-control-bg': surface1,
    '--reader-control-hover-bg': surface2,
    '--reader-control-border': border,
    '--reader-panel-bg': surface1,
    '--reader-skeleton-base': surface2,
    '--reader-skeleton-highlight': surface3,
    '--comment-card-bg': surface2,
    '--comment-card-border': border,
    '--comment-input-bg': surface1,
    '--comment-positive': good,
    '--comment-negative': danger,
    '--comment-uploader-bg': secondarySoft,
    '--comment-uploader-border': secondary,
    '--tag-artist': accent,
    '--tag-parody': accentStrong,
    '--tag-category': secondary,
    '--tag-character': good,
    '--tag-female': danger,
    '--tag-male': accent,
    '--tag-mixed': secondaryStrong,
    '--tag-other': textSub,
    '--tag-group': secondaryStrong,
    '--tag-series': accentStrong,
    '--tag-language': good,
    '--tag-uploader': secondary,
    '--tag-date-added': textSub,
    '--tag-timestamp': textSub,
    '--tag-source': secondary,
    '--tag-general': textSub,
    '--text-main': textMain,
    '--text-sub': textSub,
    '--text-muted': dark ? '#8190a6' : '#8a8278',
    '--reader-control-text': textMain,
  };
}

export function applyThemePalette(palette, options = {}) {
  const root = options.root || globalThis.document?.documentElement;
  if (!root?.style) return null;
  CUSTOM_THEME_PROPERTIES.forEach((property) => root.style.removeProperty(property));
  const resolvedTheme = options.resolvedTheme || root.dataset?.theme || 'light';
  const tokens = createCustomThemeTokens(palette, resolvedTheme);
  Object.entries(tokens || {}).forEach(([property, value]) => root.style.setProperty(property, value));
  return tokens;
}

export function normalizeThemeMode(mode) {
  return THEME_MODES.includes(mode) ? mode : 'auto';
}

export function getSystemPrefersDark() {
  return !!globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
}

export function resolveThemeMode(mode, systemPrefersDark = getSystemPrefersDark()) {
  const normalized = normalizeThemeMode(mode);
  if (normalized !== 'auto') return normalized;
  return systemPrefersDark ? 'dark' : 'light';
}

export function getNextThemeMode(mode) {
  const index = THEME_MODES.indexOf(mode);
  if (index < 0) return 'auto';
  return THEME_MODES[(index + 1) % THEME_MODES.length];
}

export function readStoredThemeMode(storage = globalThis.localStorage) {
  try {
    return normalizeThemeMode(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

export function writeStoredThemeMode(mode, storage = globalThis.localStorage) {
  const normalized = normalizeThemeMode(mode);
  try {
    storage?.setItem(THEME_STORAGE_KEY, normalized);
  } catch {}
  return normalized;
}

export function applyThemeMode(mode, options = {}) {
  const root = options.root || globalThis.document?.documentElement;
  const normalized = normalizeThemeMode(mode);
  const resolved = resolveThemeMode(normalized, options.systemPrefersDark);
  if (root?.dataset) {
    root.dataset.themeMode = normalized;
    root.dataset.theme = resolved;
  }
  if (root?.style) root.style.colorScheme = resolved;
  const palette = options.palettes ? options.palettes?.[resolved] : options.palette;
  const customTokens = applyThemePalette(palette, { root, resolvedTheme: resolved });
  const document = root?.ownerDocument || globalThis.document;
  const themeColor = document?.querySelector?.('[data-theme-color]');
  themeColor?.setAttribute('content', customTokens?.['--page-bg'] || THEME_COLORS[resolved] || THEME_COLORS.dark);
  return resolved;
}

export function watchSystemTheme(onChange) {
  const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  if (!media) return () => {};
  const listener = () => onChange?.(media.matches);
  if (media.addEventListener) {
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }
  media.addListener?.(listener);
  return () => media.removeListener?.(listener);
}
