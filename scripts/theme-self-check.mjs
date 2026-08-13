import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCustomThemeTokens, DEFAULT_THEME_PALETTES } from '../src/lib/theme.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const tokens = read('src/styles/tokens.css');
const theme = read('src/lib/theme.js');
const html = read('index.html');

const expectedTokens = [
  ['dark canvas', /--canvas:\s*#121310/i],
  ['dark surface', /--surface:\s*#1b1c18/i],
  ['dark accent', /--accent:\s*#d16a57/i],
  ['dark positive', /--positive:\s*#8e9a69/i],
  ['light canvas', /data-theme="light"[\s\S]*--canvas:\s*#f2efe8/i],
  ['light surface', /data-theme="light"[\s\S]*--surface:\s*#fcfaf5/i],
  ['light accent', /data-theme="light"[\s\S]*--accent:\s*#b84a38/i],
  ['light positive', /data-theme="light"[\s\S]*--positive:\s*#66734a/i],
  ['reader stage', /--reader-stage:\s*#050505/i],
];

const customThemeTokens = [
  '--canvas', '--surface', '--surface-subtle', '--surface-raised', '--surface-hover', '--surface-inset',
  '--text-primary', '--text-secondary', '--text-muted', '--border-subtle', '--border-strong',
  '--accent', '--accent-strong', '--accent-soft', '--accent-contrast',
  '--positive', '--positive-strong', '--positive-soft', '--warning', '--warning-soft',
  '--danger', '--danger-soft', '--focus-ring', '--overlay', '--reader-stage',
];

for (const [label, pattern] of expectedTokens) {
  assert.match(tokens, pattern, `${label} token is not the approved Archive Atelier value`);
}

for (const mode of ['dark', 'light']) {
  const custom = createCustomThemeTokens(DEFAULT_THEME_PALETTES[mode], mode);
  for (const property of customThemeTokens) assert.ok(custom?.[property], `${mode} custom theme is missing ${property}`);
  for (const legacy of ['--page-bg', '--surface-1', '--text-main', '--text-sub', '--glass-border', '--olive', '--reader-stage-bg']) {
    assert.ok(!(legacy in custom), `${mode} custom theme contains legacy alias ${legacy}`);
  }
}

assert.match(theme, /const THEME_COLORS\s*=\s*\{[\s\S]*dark:\s*'#121310'[\s\S]*light:\s*'#f2efe8'/);
assert.match(theme, /querySelector\?\.\('\[data-theme-color\]'\)/);
assert.match(theme, /themeColor\?\.setAttribute\('content',/);
assert.match(html, /<meta[^>]+name="theme-color"[^>]+data-theme-color[^>]+content="#121310"/i);

console.log('theme self-check: PASS');
