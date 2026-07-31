export function parseHexColor(value) {
  const raw = String(value ?? '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(raw)) return null;
  const expanded = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw;
  return `#${expanded.toLowerCase()}`;
}

export function hexToRgb(value) {
  const hex = parseHexColor(value);
  if (!hex) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

export function rgbToHsl({ r, g, b }) {
  const red = Math.max(0, Math.min(255, Number(r))) / 255;
  const green = Math.max(0, Math.min(255, Number(g))) / 255;
  const blue = Math.max(0, Math.min(255, Number(b))) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs((2 * l) - 1));

  if (delta !== 0) {
    if (max === red) h = 60 * (((green - blue) / delta) % 6);
    else if (max === green) h = 60 * (((blue - red) / delta) + 2);
    else h = 60 * (((red - green) / delta) + 4);
  }

  return {
    h: Math.round((h + 360) % 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToRgb({ h, s, l }) {
  const hue = ((Number(h) % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(100, Number(s))) / 100;
  const lightness = Math.max(0, Math.min(100, Number(l))) / 100;
  const chroma = (1 - Math.abs((2 * lightness) - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - (chroma / 2);
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) [red, green, blue] = [chroma, x, 0];
  else if (hue < 120) [red, green, blue] = [x, chroma, 0];
  else if (hue < 180) [red, green, blue] = [0, chroma, x];
  else if (hue < 240) [red, green, blue] = [0, x, chroma];
  else if (hue < 300) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];

  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  };
}

export function hslToHex(hsl) {
  const { r, g, b } = hslToRgb(hsl);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToHsl(value) {
  const rgb = hexToRgb(value);
  return rgb ? rgbToHsl(rgb) : null;
}
