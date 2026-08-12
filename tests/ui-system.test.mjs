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

test('shared primitives expose complete compact control and surface states', () => {
  const css = read('src/styles/primitives.css');
  for (const variant of ['primary', 'secondary', 'quiet', 'danger', 'icon']) {
    assert.match(css, new RegExp(`\\.btn-${variant}\\s*\\{`));
  }
  assert.match(css, /\.btn\s*\{[^}]*min-height:\s*38px;[^}]*border-radius:\s*var\(--radius-sm\)/s);
  assert.match(css, /\.btn-icon\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/s);
  assert.match(css, /\.field\.is-error[^}]*border-color:\s*var\(--danger\)/s);
  assert.match(css, /\.surface\s*\{[^}]*background:\s*var\(--surface\);[^}]*box-shadow:\s*none/s);
  assert.match(css, /cubic-bezier\(\.32,\s*\.72,\s*0,\s*1\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation-duration:\s*0\.01ms/s);
});

test('shared component visuals use state classes and project close glyphs', () => {
  const toggle = read('src/components/ToggleSwitch.jsx');
  const toast = read('src/components/Toast.jsx');
  const metadataTag = read('src/components/MetadataTagChip.jsx');
  assert.match(toggle, /is-disabled/);
  assert.doesNotMatch(toggle, /style=\{\{/);
  assert.match(toast, /ToolbarGlyph[^\n]*name="close"/);
  assert.doesNotMatch(toast, />×<\/button>/);
  assert.match(metadataTag, /ToolbarGlyph[^\n]*name="close"/);
  assert.doesNotMatch(metadataTag, />×<\/button>/);
});
