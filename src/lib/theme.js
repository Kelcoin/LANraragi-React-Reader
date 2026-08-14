export const THEME_STORAGE_KEY = 'lrr_theme_mode';
export const CUSTOM_THEME_STORAGE_KEY = 'lrr_custom_theme';
export const THEME_MODES = ['auto', 'dark', 'light'];
export const DEFAULT_THEME_PALETTE = Object.freeze({
  accent: '#b74632',
  secondary: '#8a715c',
  background: '#f4f0e8',
});
export const DEFAULT_THEME_PALETTES = Object.freeze({
  light: DEFAULT_THEME_PALETTE,
  dark: Object.freeze({
    accent: '#d16a57',
    secondary: '#b8a58f',
    background: '#121310',
  }),
});
const THEME_COLORS = {
  dark: '#121310',
  light: '#f2efe8',
};

const CUSTOM_THEME_PROPERTIES = [
  '--canvas', '--surface', '--surface-subtle', '--surface-raised', '--surface-hover', '--surface-inset',
  '--text-primary', '--text-secondary', '--text-muted', '--border-subtle', '--border-strong',
  '--accent', '--accent-strong', '--accent-soft', '--accent-contrast',
  '--secondary', '--secondary-strong', '--secondary-soft',
  '--positive', '--positive-strong', '--positive-soft', '--warning', '--warning-soft',
  '--danger', '--danger-soft', '--focus-ring', '--overlay', '--reader-stage',
  '--reader-toolbar-bg', '--reader-control-bg', '--reader-control-hover-bg', '--reader-control-border', '--reader-control-text',
  '--reader-overlay-text', '--reader-stage-border', '--reader-panel-bg', '--reader-skeleton-base', '--reader-skeleton-highlight',
  '--comment-header-bg', '--comment-content-bg', '--comment-card-bg', '--comment-card-border', '--comment-positive', '--comment-negative',
  '--comment-uploader-bg', '--comment-uploader-border', '--comment-user', '--comment-user-self', '--comment-text', '--comment-meta', '--comment-input-bg',
  '--tag-panel-bg', '--tag-artist', '--tag-parody', '--tag-category', '--tag-character', '--tag-female', '--tag-male', '--tag-mixed', '--tag-other',
  '--tag-group', '--tag-series', '--tag-language', '--tag-uploader', '--tag-date-added', '--tag-timestamp', '--tag-source', '--tag-general',
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

function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h;
  if (max === r / 255) h = ((g / 255 - b / 255) / delta) % 6;
  else if (max === g / 255) h = (b / 255 - r / 255) / delta + 2;
  else h = (r / 255 - g / 255) / delta + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

function hslToHex({ h, s, l }) {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));
  const chroma = (1 - Math.abs(2 * lig - 1)) * sat;
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  let rgb;
  if (section < 1) rgb = [chroma, x, 0];
  else if (section < 2) rgb = [x, chroma, 0];
  else if (section < 3) rgb = [0, chroma, x];
  else if (section < 4) rgb = [0, x, chroma];
  else if (section < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const match = lig - chroma / 2;
  return rgbToHex({ r: (rgb[0] + match) * 255, g: (rgb[1] + match) * 255, b: (rgb[2] + match) * 255 });
}

// Keep the user's background hue/saturation but constrain relative luminance
// so fixed text colors stay readable: dark themes clamp to <= 0.12, light
// themes to >= 0.55. A black background stays pure black (OLED-friendly).
function clampCanvasLuminance(hex, dark) {
  const target = dark ? 0.12 : 0.55;
  let value = normalizeHex(hex, dark ? '#0f1115' : '#f4f0e8');
  for (let i = 0; i < 14; i += 1) {
    const lum = luminance(value);
    if ((dark && lum <= target) || (!dark && lum >= target)) break;
    const { h, s, l } = hexToHsl(value);
    const nextL = l + (target - lum) * 2.4;
    const next = hslToHex({ h, s, l: nextL });
    if (next === value) break;
    value = next;
  }
  return value;
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
  const canvas = clampCanvasLuminance(normalized.background, dark);
  const surface1 = dark ? mixHex(canvas, '#ffffff', 0.075) : mixHex(canvas, '#ffffff', 0.68);
  const surface2 = dark ? mixHex(canvas, '#ffffff', 0.15) : mixHex(canvas, '#ffffff', 0.36);
  const surface3 = dark ? mixHex(canvas, '#ffffff', 0.23) : mixHex(canvas, '#000000', 0.08);
  const accent = ensureReadable(normalized.accent, surface1, dark ? 3.2 : 4.5);
  const secondary = ensureReadable(normalized.secondary, surface1, dark ? 3.2 : 4.5);
  const accentStrong = ensureReadable(dark ? mixHex(accent, '#ffffff', 0.2) : mixHex(accent, '#000000', 0.2), surface1, dark ? 3.2 : 4.5);
  const secondaryStrong = ensureReadable(dark ? mixHex(secondary, '#ffffff', 0.2) : mixHex(secondary, '#000000', 0.2), surface1, dark ? 3.2 : 4.5);
  const textMain = dark ? '#eeeae0' : '#282724';
  const textSub = dark ? '#c6c0b4' : '#756f66';
  const border = dark ? mixHex(canvas, '#a49b89', 0.24) : mixHex(canvas, '#6d6254', 0.25);
  const borderHover = dark ? mixHex(border, accent, 0.45) : mixHex(border, accent, 0.45);
  const accentSoft = dark ? mixHex(surface1, accent, 0.25) : mixHex(surface1, accent, 0.16);
  const secondarySoft = dark ? mixHex(surface1, secondary, 0.24) : mixHex(surface1, secondary, 0.15);
  const good = dark ? '#8e9a69' : '#66734a';
  const goodStrong = ensureReadable(dark ? mixHex(good, '#ffffff', 0.2) : mixHex(good, '#000000', 0.2), surface1, dark ? 3.2 : 4.5);
  const goodSoft = dark ? mixHex(surface1, good, 0.24) : mixHex(surface1, good, 0.15);
  const danger = dark ? '#d96b62' : '#a93f35';
  const accentContrast = luminance(accent) > 0.42 ? '#171815' : '#fffaf2';
  const dangerContrast = luminance(danger) > 0.42 ? '#171815' : '#fffaf2';
  return {
    '--canvas': canvas,
    '--surface': surface1,
    '--surface-subtle': surface2,
    '--surface-raised': surface3,
    '--surface-hover': dark ? mixHex(surface2, '#ffffff', 0.1) : mixHex(surface2, '#000000', 0.04),
    '--surface-inset': mixHex(surface1, surface2, 0.52),
    '--text-primary': textMain,
    '--text-secondary': textSub,
    '--text-muted': dark ? '#858176' : '#948d82',
    '--border-subtle': border,
    '--border-strong': borderHover,
    '--secondary': secondary,
    '--secondary-strong': secondaryStrong,
    '--secondary-soft': secondarySoft,
    '--positive': good,
    '--positive-strong': goodStrong,
    '--positive-soft': goodSoft,
    '--warning': dark ? '#d4a75d' : '#95631f',
    '--warning-soft': dark ? '#382e1d' : '#f4ead6',
    '--danger': danger,
    '--danger-soft': mixHex(surface1, danger, dark ? 0.2 : 0.1),
    '--focus-ring': accent,
    '--overlay': dark ? 'rgba(0, 0, 0, 0.72)' : 'rgba(28, 25, 21, 0.55)',
    '--reader-stage': 'var(--surface-inset)',
    '--accent': accent,
    '--accent-strong': accentStrong,
    '--accent-soft': accentSoft,
    '--accent-contrast': accentContrast,
    '--reader-toolbar-bg': surface1,
    '--reader-control-bg': surface3,
    '--reader-control-hover-bg': dark ? mixHex(surface3, '#ffffff', 0.1) : mixHex(surface3, '#000000', 0.04),
    '--reader-control-border': borderHover,
    '--reader-control-text': textMain,
    '--reader-overlay-text': textMain,
    '--reader-stage-border': border,
    '--reader-panel-bg': surface1,
    '--reader-skeleton-base': surface2,
    '--reader-skeleton-highlight': surface3,
    '--comment-header-bg': surface1,
    '--comment-content-bg': surface2,
    '--comment-card-bg': surface3,
    '--comment-card-border': borderHover,
    '--comment-positive': good,
    '--comment-negative': danger,
    '--comment-uploader-bg': secondarySoft,
    '--comment-uploader-border': secondaryStrong,
    '--comment-user': accentStrong,
    '--comment-user-self': secondaryStrong,
    '--comment-text': textMain,
    '--comment-meta': textSub,
    '--comment-input-bg': surface1,
    '--tag-panel-bg': surface1,
    '--tag-artist': accentStrong,
    '--tag-parody': accent,
    '--tag-category': secondary,
    '--tag-character': secondaryStrong,
    '--tag-female': danger,
    '--tag-male': accentStrong,
    '--tag-mixed': secondaryStrong,
    '--tag-other': textSub,
    '--tag-group': secondaryStrong,
    '--tag-series': accent,
    '--tag-language': secondary,
    '--tag-uploader': secondary,
    '--tag-date-added': textSub,
    '--tag-timestamp': textSub,
    '--tag-source': secondary,
    '--tag-general': textSub,
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
  themeColor?.setAttribute('content', customTokens?.['--canvas'] || THEME_COLORS[resolved] || THEME_COLORS.dark);
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
