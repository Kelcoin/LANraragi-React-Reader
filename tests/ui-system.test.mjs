import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createCustomThemeTokens, DEFAULT_THEME_PALETTES } from '../src/lib/theme.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const REQUIRED_SEMANTIC_TOKENS = [
  '--canvas', '--surface', '--surface-subtle', '--surface-raised', '--surface-hover', '--surface-inset',
  '--text-primary', '--text-secondary', '--text-muted', '--border-subtle', '--border-strong',
  '--accent', '--accent-strong', '--accent-soft', '--accent-contrast',
  '--positive', '--positive-strong', '--positive-soft', '--warning', '--warning-soft',
  '--danger', '--danger-soft', '--focus-ring', '--overlay', '--reader-stage',
  '--radius-xs', '--radius-sm', '--radius-md', '--shadow-control', '--shadow-lg',
  '--motion-fast', '--motion-base', '--motion-slow', '--motion-curve',
];

const LEGACY_THEME_TOKENS = [
  '--page-bg', '--surface-1', '--text-main', '--text-sub', '--glass-border', '--olive', '--reader-stage-bg',
];

function declaredProperties(block) {
  return new Set([...block.matchAll(/(^|[;{]\s*)(--[\w-]+)\s*:/gm)].map((match) => match[2]));
}

function themeBlock(css, selector) {
  const match = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
  assert.ok(match, `missing ${selector} token block`);
  return match[1];
}

test('archive atelier exposes layered semantic theme tokens', () => {
  const css = read('src/styles/tokens.css');
  assert.match(css, /@layer tokens/);
  assert.match(css, /--canvas:\s*#121310/i);
  assert.match(css, /--surface:\s*#1b1c18/i);
  assert.match(css, /--accent:\s*#d16a57/i);
  assert.match(css, /--positive:\s*#8e9a69/i);
  assert.match(css, /--reader-stage:\s*#050505/i);
  assert.match(css, /--surface-hover:/);
  assert.match(css, /--shadow-lg:/);
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

test('semantic tokens are the only visual token authority', () => {
  const index = read('src/index.css');
  const primitives = read('src/styles/primitives.css');
  const productionJsx = fs.readdirSync(new URL('../src', import.meta.url), { recursive: true })
    .filter((name) => name.endsWith('.jsx'))
    .map((name) => read(`src/${name.replaceAll('\\', '/')}`))
    .join('\n');

  assert.doesNotMatch(index, /:root(?:\[data-theme[^\]]+\])?\s*\{/);
  assert.doesNotMatch(primitives, /Compatibility rules remain unlayered/);
  assert.doesNotMatch(index, /Archive Atelier compatibility/i);
  assert.match(productionJsx, /className=/);
});

test('built-in and custom themes expose the complete semantic token contract', () => {
  const css = read('src/styles/tokens.css');
  for (const [label, block] of [
    ['dark', themeBlock(css, ':root,\\s*:root\\[data-theme="dark"\\]')],
    ['light', themeBlock(css, ':root\\[data-theme="light"\\]')],
  ]) {
    const declarations = declaredProperties(block);
    for (const property of REQUIRED_SEMANTIC_TOKENS) {
      assert.ok(declarations.has(property), `${label} theme is missing ${property}`);
    }
  }

  assert.deepEqual(DEFAULT_THEME_PALETTES.dark, {
    accent: '#d16a57',
    secondary: '#8e9a69',
    background: '#121310',
  });

  const tokens = createCustomThemeTokens(DEFAULT_THEME_PALETTES.dark, 'dark');
  for (const property of REQUIRED_SEMANTIC_TOKENS.filter((name) => !name.startsWith('--radius-') && !name.startsWith('--motion-') && !name.startsWith('--shadow-'))) {
    assert.ok(tokens[property], `custom theme is missing ${property}`);
  }
  for (const property of LEGACY_THEME_TOKENS) {
    assert.ok(!(property in tokens), `custom theme must not generate legacy alias ${property}`);
  }
});

test('reader migration retains runtime geometry and incognito contracts', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /incognito/);
  assert.match(reader, /resolvePageImageSource/);
  assert.match(reader, /visibleSourceRef/);
  assert.match(reader, /transform:/);
  assert.match(reader, /width:/);
  assert.match(reader, /height:/);
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
  assert.match(css, /var\(--motion-curve\)/);
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

test('overlay components delegate focus and dismissal behavior to Base UI', () => {
  const components = {
    ConfirmDialog: read('src/components/ConfirmDialog.jsx'),
    CustomSelect: read('src/components/CustomSelect.jsx'),
    ArchiveContextMenu: read('src/components/ArchiveContextMenu.jsx'),
    DedupeArchiveContextMenu: read('src/components/DedupeArchiveContextMenu.jsx'),
    SettingHint: read('src/components/SettingHint.jsx'),
  };
  for (const [name, source] of Object.entries(components)) {
    assert.match(source, /from '@base-ui\/react\//, `${name} uses a Base UI behavior primitive`);
    assert.match(source, /export default function/, `${name} keeps its default export`);
  }
  assert.doesNotMatch(components.ConfirmDialog, /addEventListener\(['"]keydown/);
  assert.doesNotMatch(components.CustomSelect, /addEventListener\(['"]mousedown/);
  assert.doesNotMatch(components.ArchiveContextMenu, /addEventListener\(['"]keydown/);
  assert.doesNotMatch(components.DedupeArchiveContextMenu, /addEventListener\(['"]keydown/);
  assert.match(components.ConfirmDialog, /onConfirm/);
  assert.doesNotMatch(
    components.ConfirmDialog,
    /<Dialog\.Close[\s\S]*?onClick=\{onCancel\}/,
    'Dialog.Close must not duplicate the Root onOpenChange cancel callback',
  );
  assert.match(components.CustomSelect, /onChange/);
  assert.match(components.ArchiveContextMenu, /onReadIncognito/);
  assert.match(components.DedupeArchiveContextMenu, /onViewThumbnails/);
  assert.match(components.SettingHint, /className = 'settings-row-title'/);
});

test('archive browsing pages share unframed bands and bounded workspaces', () => {
  const pages = read('src/styles/pages.css');
  const index = read('src/index.css');
  const home = read('src/pages/Home.jsx');
  const history = read('src/pages/HistoryPage.jsx');
  const watchlist = read('src/pages/WatchlistPage.jsx');

  assert.match(index, /@import url\('\.\/styles\/pages\.css'\);/);
  assert.match(home, /className="content-band section-reveal/);
  assert.match(home, /className="glass-panel archive-workspace section-reveal/);
  assert.match(history, /history-page page-workspace/);
  assert.match(watchlist, /history-page watchlist-page page-workspace/);
  for (const source of [history, watchlist]) {
    assert.match(source, /page-header/);
    assert.match(source, /page-summary/);
    assert.match(source, /archive-workspace/);
    assert.match(source, /archive-toolbar/);
  }
  assert.match(pages, /\.content-band\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none/s);
  assert.match(pages, /\.archive-workspace\s*\{[^}]*background:\s*var\(--surface\);[^}]*border:\s*1px solid var\(--border-subtle\)/s);
});

test('archive cards use quiet covers and moss progress at every viewport', () => {
  const pages = read('src/styles/pages.css');
  assert.match(pages, /\.archive-card-shell\s*\{[^}]*border-radius:\s*var\(--radius-md\);[^}]*box-shadow:\s*none/s);
  assert.match(pages, /\.archive-cover-frame\s*\{[^}]*border-radius:\s*var\(--radius-md\)/s);
  assert.match(pages, /\.archive-card-progress\s*\{[^}]*height:\s*[23]px/s);
  assert.match(pages, /\.archive-card-progress-fill\s*\{[^}]*background:\s*var\(--positive\)/s);
  assert.match(pages, /\.archive-card-shell:hover\s*\{[^}]*transform:\s*translateY\(-2px\)/s);
  assert.match(pages, /\.watchlist-card[^}]*\.archive-card-shell\s*\{[^}]*background:\s*var\(--surface\);[^}]*box-shadow:\s*none/s);
  assert.match(pages, /@media \(max-width:\s*390px\)[\s\S]*min-width:\s*0;[\s\S]*flex-wrap:\s*wrap/s);
});

test('login and operational pages share one archive workbench language', () => {
  const pages = read('src/styles/pages.css');
  const app = read('src/App.jsx');
  const upload = read('src/pages/UploadPage.jsx');
  const dedupe = read('src/pages/DeduplicatePage.jsx');
  const metadata = read('src/pages/MetadataPage.jsx');

  assert.match(app, /className="btn btn-primary login-submit"/);
  assert.doesNotMatch(app, /type="submit"[^>]*style=\{\{[^}]*background:\s*'var\(--accent\)'/s);
  assert.match(upload, /className="upload-page workbench-page"/);
  assert.match(dedupe, /className="dedupe-page workbench-page"/);
  assert.match(metadata, /className="metadata-page workbench-page"/);
  for (const source of [upload, dedupe, metadata]) {
    assert.match(source, /workbench-header/);
    assert.match(source, /workbench-section/);
  }
  assert.match(pages, /\.workbench-page\s*\{[^}]*width:\s*min\(100% - 40px,\s*1180px\)/s);
  assert.match(pages, /\.workbench-section\s*\{[^}]*border-top:\s*1px solid var\(--border-subtle\);[^}]*box-shadow:\s*none/s);
});

test('workbench queues and duplicate candidates use dividers instead of nested cards', () => {
  const pages = read('src/styles/pages.css');
  const progress = read('src/components/ExecutionProgressPanel.jsx');
  assert.match(progress, /workbench-section/);
  assert.match(pages, /\.upload-task-row\s*\{[^}]*border-radius:\s*0;[^}]*border-width:\s*0 0 1px/s);
  assert.match(pages, /\.dedupe-card-item\s*\{[^}]*border-radius:\s*0;[^}]*border-bottom:\s*1px solid var\(--border-subtle\)/s);
  assert.match(pages, /@media \(max-width:\s*720px\)[\s\S]*\.workbench-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.doesNotMatch(pages, /border-radius:\s*(?:[9]|1[0-9]|[2-9][0-9])px/);
});

test('settings use desktop navigation and mobile top tabs without changing fields', () => {
  const readerCss = read('src/styles/reader.css');
  const index = read('src/index.css');
  const home = read('src/pages/Home.jsx');
  assert.match(index, /@import url\('\.\/styles\/reader\.css'\);/);
  assert.match(home, /className="settings-panel-scroll settings-layout"/);
  assert.match(readerCss, /\.settings-layout\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*180px minmax\(0,\s*1fr\)/s);
  assert.match(readerCss, /\.settings-layout\s*>\s*\.settings-category-tabs\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1 \/ span 4/s);
  assert.match(readerCss, /@media \(max-width:\s*768px\)[\s\S]*\.settings-layout\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(readerCss, /@media \(max-width:\s*768px\)[\s\S]*\.settings-layout\s*>\s*\.settings-category-tabs\s*\{[^}]*display:\s*flex/s);
  assert.match(readerCss, /\.settings-layout \.settings-row\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none/s);
});

test('reader exterior is warm, compact, and isolated from image geometry', () => {
  const readerCss = read('src/styles/reader.css');
  const tokens = read('src/styles/tokens.css');
  assert.match(readerCss, /\.reader-toolbar-button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/s);
  assert.match(readerCss, /\.reader-panel-surface\s*\{[^}]*background:\s*var\(--surface\)\s*!important/s);
  assert.match(readerCss, /\.reader-thumbnail-drawer-panel\s*\{[^}]*background:\s*var\(--surface\)\s*!important/s);
  assert.match(readerCss, /\.eh-comments\s*\{[^}]*border-radius:\s*var\(--radius-md\);[^}]*box-shadow:\s*none/s);
  assert.match(readerCss, /\.archive-thumbnail-dialog\s*\{[^}]*border-radius:\s*var\(--radius-md\)\s*!important/s);
  assert.match(tokens, /--reader-stage:\s*#050505/i);
  assert.doesNotMatch(readerCss, /\.reader-(?:stage|image|page-slot|spread|webtoon-page)/);
});

test('final archive atelier cleanup removes decorative legacy chrome', () => {
  const dedupe = read('src/pages/DeduplicatePage.jsx');
  const archiveCard = read('src/components/ArchiveCard.jsx');
  const reader = read('src/pages/Reader.jsx');

  assert.doesNotMatch(dedupe, /linear-gradient\(90deg,\s*var\(--accent\)/);
  assert.doesNotMatch(archiveCard, /borderRadius:\s*'14px'/);
  assert.doesNotMatch(archiveCard, /boxShadow:\s*'0 16px 48px/);
  assert.doesNotMatch(reader, /borderRadius:\s*'14px'/);
  assert.doesNotMatch(reader, /boxShadow:\s*'0 12px 40px/);
});

test('theme self-check validates approved semantic colors and browser chrome', () => {
  const check = read('scripts/theme-self-check.mjs');
  assert.match(check, /--canvas/);
  assert.match(check, /--reader-stage/);
  assert.match(check, /#050505/i);
  assert.match(check, /THEME_COLORS/);
  assert.match(check, /theme-color/);
  assert.match(check, /#121310/i);
});

test('settings layout uses intrinsic active content without legacy height feedback', () => {
  const home = read('src/pages/Home.jsx');
  const readerCss = read('src/styles/reader.css');
  assert.doesNotMatch(home, /--settings-pane-height/);
  assert.doesNotMatch(home, /active\.scrollHeight/);
  assert.match(readerCss, /\.settings-layout\s*>\s*\.settings-section\s*\{[^}]*display:\s*none;[^}]*max-height:\s*none/s);
  assert.match(readerCss, /\.settings-layout\s*>\s*\.settings-section\.is-active\s*\{[^}]*display:\s*block/s);
});

test('expanded EH settings do not clip real configuration fields', () => {
  const home = read('src/pages/Home.jsx');
  const readerCss = read('src/styles/reader.css');
  assert.match(home, /settings-eh-details/);
  assert.doesNotMatch(home, /maxHeight:\s*readerSettings\.ehEnabled\s*\?\s*'320px'/);
  assert.match(readerCss, /\.settings-eh-details\s*\{[^}]*grid-template-rows:\s*0fr/s);
  assert.match(readerCss, /\.settings-eh-details\.is-expanded\s*\{[^}]*grid-template-rows:\s*1fr/s);
});

test('tag suggestion namespace colors follow active theme tokens', () => {
  const suggestions = read('src/components/TagSuggest.jsx');
  for (const token of ['artist', 'parody', 'category', 'character', 'female', 'male', 'mixed', 'other']) {
    assert.match(suggestions, new RegExp(`${token}: ['"]var\\(--tag-${token}\\)['"]`));
  }
  assert.doesNotMatch(suggestions, /artist:\s*['"]#[0-9a-f]{6}/i);
});
