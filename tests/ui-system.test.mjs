import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createCustomThemeTokens, DEFAULT_THEME_PALETTES } from '../src/lib/theme.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('archive atelier exposes layered semantic theme tokens', () => {
  const css = read('src/styles/tokens.css');
  assert.match(css, /@layer tokens/);
  assert.match(css, /--canvas:\s*#121310/i);
  assert.match(css, /--surface:\s*#1b1c18/i);
  assert.match(css, /--accent:\s*#d16a57/i);
  assert.match(css, /--positive:\s*#8e9a69/i);
  assert.match(css, /--reader-stage:\s*#050505/i);
  assert.match(css, /data-theme="light"[\s\S]*--canvas:\s*#f2efe8/i);
  assert.match(css, /--radius-xs:\s*4px/);
  assert.match(css, /--radius-sm:\s*6px/);
  assert.match(css, /--radius-md:\s*8px/);
});

test('index css imports archive atelier layers in stable order', () => {
  const css = read('src/index.css');
  assert.match(css, /^@layer reset, tokens, base, primitives, components, pages, utilities;/);
  assert.ok(css.indexOf("./styles/tokens.css") < css.indexOf("./styles/base.css"));
  assert.doesNotMatch(css, /@import\s+url\([^)]*tokens\.css[^)]*\)\s+layer\(/);
  assert.doesNotMatch(css, /@import\s+url\([^)]*base\.css[^)]*\)\s+layer\(/);
});

test('archive atelier keeps legacy tokens mapped to semantic variables', () => {
  const css = read('src/styles/tokens.css');
  assert.match(css, /--page-bg:\s*var\(--canvas\)/);
  assert.match(css, /--surface-1:\s*var\(--surface\)/);
  assert.match(css, /--text-main:\s*var\(--text-primary\)/);
  assert.match(css, /--glass-border:\s*var\(--border-subtle\)/);
  assert.match(css, /--olive:\s*var\(--positive\)/);
  assert.match(css, /--reader-stage-bg:\s*var\(--reader-stage\)/);
});

test('default and custom dark themes use warm archive atelier semantics', () => {
  assert.deepEqual(DEFAULT_THEME_PALETTES.dark, {
    accent: '#d16a57',
    secondary: '#8e9a69',
    background: '#121310',
  });

  const tokens = createCustomThemeTokens(DEFAULT_THEME_PALETTES.dark, 'dark');
  assert.equal(tokens['--canvas'], tokens['--page-bg']);
  assert.equal(tokens['--surface'], tokens['--surface-1']);
  assert.equal(tokens['--text-primary'], '#eeeae0');
  assert.equal(tokens['--text-secondary'], '#c6c0b4');
  assert.equal(tokens['--reader-stage'], '#050505');
  assert.equal(tokens['--reader-stage-bg'], '#050505');
});
