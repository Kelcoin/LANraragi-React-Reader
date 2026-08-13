import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseRouteSearch } from '../src/lib/navigation.js';
import { applyThemePalette, createCustomThemeTokens, normalizeThemePalette, normalizeThemePalettes, readStoredThemePalette, readStoredThemePalettes, writeStoredThemePalette, writeStoredThemePalettes } from '../src/lib/theme.js';
import { hslToHex, parseHexColor, rgbToHsl } from '../src/lib/color.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('EH comment client delegates page error classification to Worker', () => {
  const client = read('src/components/EhComments.jsx');
  assert.doesNotMatch(client, /classifyEhGalleryPage/);
  assert.doesNotMatch(client, /isContentWarningOrLogin/);
});

test('incognito reader routes are explicit and do not change normal archive links', () => {
  const navigation = read('src/lib/navigation.js');
  const app = read('src/App.jsx');

  assert.deepEqual(parseRouteSearch('?id=abc123'), { kind: 'reader', archiveId: 'abc123', incognito: false });
  assert.deepEqual(parseRouteSearch('?id=abc123&incognito=1'), { kind: 'reader', archiveId: 'abc123', incognito: true });
  assert.match(navigation, /navigateToArchive\(archiveId, \{ replace = false, incognito = false, newTab = false \} = \{\}\)/);
  assert.match(navigation, /if \(newTab\) \{[\s\S]{0,80}openRouteInNewTab\(url\);/);
  assert.match(navigation, /incognito=1/);
  assert.match(navigation, /dispatchRouteChange\(\{ kind: 'reader', archiveId: String\(archiveId\), incognito \}\)/);
  assert.match(app, /incognito=\{route\.incognito === true\}/);
  assert.match(app, /route\.incognito \? 'incognito' : 'normal'/);
  assert.match(app, /<HistoryPage onSelectArchive=\{\(id, options\) => navigateToArchive\(id, options\)\}/);
  assert.match(app, /<WatchlistPage onSelectArchive=\{\(id, options\) => navigateToArchive\(id, options\)\}/);
  assert.match(app, /<Home onSelectArchive=\{\(id, options\) => \{/);
});

test('archive context menus expose incognito reading everywhere normal reading is offered', () => {
  const menu = read('src/components/ArchiveContextMenu.jsx');
  const home = read('src/pages/Home.jsx');
  const history = read('src/pages/HistoryPage.jsx');
  const watchlist = read('src/pages/WatchlistPage.jsx');
  const recommendations = read('src/components/Recommendations.jsx');

  assert.match(menu, /onReadIncognito/);
  assert.match(menu, /action\?\.\(menu\.archive, \{ newTab: event\.ctrlKey \}\)/);
  assert.match(menu, /<MenuButton onClick=\{run\(onRead\)\}>阅读<\/MenuButton>\s*<MenuButton onClick=\{run\(onReadIncognito\)\}>无痕阅读<\/MenuButton>/);
  assert.match(home, /onRead=\{\(archive, options\) => handleSelectArchive\(archive\.arcid \|\| archive\.id, options\)\}/);
  assert.match(home, /onReadIncognito=\{\(archive, options\) => handleSelectArchive\(archive\.arcid \|\| archive\.id, \{ \.\.\.options, incognito: true \}\)\}/);
  assert.match(history, /onReadIncognito=\{\(archive, options\) => onSelectArchive\(archive\.arcid \|\| archive\.id, \{ \.\.\.options, incognito: true \}\)\}/);
  assert.match(watchlist, /onReadIncognito=\{\(archive, options\) => onSelectArchive\(archive\.arcid \|\| archive\.id, \{ \.\.\.options, incognito: true \}\)\}/);
  assert.match(recommendations, /onReadIncognito=\{\(archive, options\) => navigateToArchive\(archive\.arcid \|\| archive\.id, \{ \.\.\.options, incognito: true \}\)\}/);
});

test('reader incognito mode skips reading progress, history, and cold-restore snapshots', () => {
  const reader = read('src/pages/Reader.jsx');

  assert.match(reader, /export default function Reader\(\{ archiveId, onBack, coldRestoreBoot = false, incognito = false \}\)/);
  assert.match(reader, /const persistReadingProgress = !incognito;/);
  assert.match(reader, /if \(!persistReadingProgress \|\| !archiveRef\.current \|\| pagesRef\.current\.length === 0\) return;/);
  assert.match(reader, /if \(!persistReadingProgress \|\| !id \|\| targetPage <= 0\) return Promise\.resolve\(\);/);
  assert.match(reader, /if \(!persistReadingProgress \|\| !serverTracksProgress \|\| !archiveId\) return;/);
  assert.match(reader, /if \(persistReadingProgress && archiveHasNewMarker\(restoredArchive\) && !progressWasCleared\)/);
  assert.match(reader, /if \(persistReadingProgress && archiveHasNewMarker\(meta\) && !hasArchiveProgressMarker\(archiveId\)\)/);
  assert.match(reader, /if \(archive && pages\.length > 0 && persistReadingProgress\)/);
  assert.match(reader, /if \(persistReadingProgress && shouldPersistArchiveReadingProgress\(hasArchiveProgressMarker\(archiveId\), highestPage\)\)/);
});

test('random roam skeletons fill the carousel and match archive card geometry', () => {
  const home = read('src/pages/Home.jsx');
  const card = read('src/components/ArchiveCard.jsx');
  assert.match(home, /import \{[^}]*ARCHIVE_CARD_WIDTH[^}]*\} from '..\/lib\/archiveGridLayout';/);
  assert.match(home, /function getRandomSkeletonCount\(viewportWidth, isNarrow\) \{/);
  assert.match(home, /Math\.ceil\(\(availableWidth \+ gap\) \/ \(ARCHIVE_CARD_WIDTH \+ gap\)\)/);
  assert.match(home, /const randomSkeletonCount = getRandomSkeletonCount\(window\.innerWidth, isNarrow\);/);
  assert.match(home, /function SkeletonCard\(\{ showProgress = false \}\)/);
  assert.match(home, /flex: `0 0 \$\{ARCHIVE_CARD_WIDTH\}px`/);
  assert.match(home, /width: `\$\{ARCHIVE_CARD_WIDTH\}px`/);
  assert.match(home, /minWidth: `\$\{ARCHIVE_CARD_WIDTH\}px`/);
  assert.match(home, /boxSizing: 'border-box'/);
  assert.match(home, /height: `\$\{ARCHIVE_CARD_COVER_HEIGHT\}px`/);
  assert.match(home, /marginTop: `\$\{ARCHIVE_CARD_TITLE_GAP\}px`, height: `\$\{ARCHIVE_CARD_TITLE_SLOT_HEIGHT\}px`/);
  assert.match(home, /height: `\$\{ARCHIVE_CARD_META_ROW_HEIGHT\}px`, marginTop: `\$\{ARCHIVE_CARD_META_GAP\}px`/);
  assert.equal((home.match(/Array\.from\(\{ length: randomSkeletonCount \}\)/g) || []).length, 2);
  assert.doesNotMatch(home, /fillWidth/);
  assert.doesNotMatch(home, /Array\.from\(\{ length: 5 \}\)/);
  assert.doesNotMatch(home, /Math\.max\(5, Math\.min\(8, randoms\.length \|\| 5\)\)/);
  assert.match(card, /height: `\$\{ARCHIVE_CARD_COVER_HEIGHT\}px`/);
  assert.match(card, /height: `\$\{ARCHIVE_CARD_TITLE_SLOT_HEIGHT\}px`/);
  assert.match(card, /minWidth: isWide \? `\$\{wideCardWidth\}px` : `\$\{ARCHIVE_CARD_WIDTH\}px`/);
  assert.match(card, /width: isWide \? `\$\{wideCardWidth\}px` : `\$\{ARCHIVE_CARD_WIDTH\}px`/);
});

test('archive pagination stops by total or empty pages, not a fixed server batch size', () => {
  const home = read('src/pages/Home.jsx');
  const dedupe = read('src/pages/DeduplicatePage.jsx');
  assert.doesNotMatch(home, /nextData\.length < ARCHIVE_PAGE_SIZE/);
  assert.doesNotMatch(dedupe, /BATCH_SIZE\s*=\s*50|data\.length < BATCH_SIZE/);
  assert.match(dedupe, /data\.length === 0/);
  assert.match(dedupe, /all\.length >= total/);
});

test('dedupe scan is scoped and does not rebuild every thumbnail first', () => {
  const source = read('src/pages/DeduplicatePage.jsx');
  assert.match(source, /scopedStorageKey\(DEDUPE_SAVED_RESULT_KEY\)/);
  assert.doesNotMatch(source, /regenerateThumbnails/);
  assert.match(source, /waitForMinionJob/);
});

test('dedupe mutations synchronize an existing saved result and clear it when complete', () => {
  const page = read('src/pages/DeduplicatePage.jsx');
  assert.match(page, /syncSavedResult\(nextGroups/);
  assert.match(page, /createDedupeSavedResultPayload/);
  assert.match(page, /localStorage\.removeItem\(scopedStorageKey\(DEDUPE_SAVED_RESULT_KEY\)\)/);
});

test('global UI copy and selection styles use the archive terminology consistently', () => {
  const css = read('src/index.css');
  const metadata = read('src/pages/MetadataPage.jsx');
  const home = read('src/pages/Home.jsx');
  assert.match(css, /body\s*\{[^}]*overflow-x:\s*clip;/s);
  assert.match(css, /body\s*\{[^}]*user-select:\s*none;/s);
  assert.match(css, /input,[\s\S]*textarea,[\s\S]*\[contenteditable="true"\][^{]*\{[^}]*user-select:\s*text;/s);
  assert.match(metadata, /className="metadata-field-label">标签</);
  assert.match(css, /\.metadata-field-label\s*\{[^}]*font-weight:\s*650;/s);
  assert.match(home, /style=\{\{ flex:\s*'1\.35 1 0'/);
  assert.doesNotMatch(home, /全部归档|待看归档|上传归档|重复归档检测/);
});

test('calm editorial theme replaces blue-gray light surfaces with paper, graphite, olive, and vermilion tokens', () => {
  const css = read('src/styles/tokens.css');
  const lightTheme = css.match(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';

  assert.match(lightTheme, /--canvas:\s*#f2efe8/i);
  assert.match(lightTheme, /--surface:\s*#fcfaf5/i);
  assert.match(lightTheme, /--text-primary:\s*#282724/i);
  assert.match(lightTheme, /--accent:\s*#b84a38/i);
  assert.match(lightTheme, /--positive:\s*#66734a/i);
  assert.match(lightTheme, /--surface-raised:\s*#ffffff/i);
  assert.doesNotMatch(lightTheme, /linear-gradient/i);
  assert.doesNotMatch(lightTheme, /#(?:2563eb|1d4ed8|d8e1eb|f4f7fb)/i);
});

test('calm editorial surfaces are flat by default and use restrained shape hierarchy', () => {
  const css = read('src/index.css');
  const tokens = read('src/styles/tokens.css');
  const primitives = read('src/styles/primitives.css');
  const cardRule = css.match(/\.archive-card-shell\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(tokens, /--radius-md:\s*8px/);
  assert.match(tokens, /--radius-sm:\s*6px/);
  assert.match(css, /\.glass-panel\s*\{[\s\S]*?background:\s*var\(--surface\);[\s\S]*?backdrop-filter:\s*none;/);
  assert.match(primitives, /\.btn:focus-visible[^}]*outline:\s*2px solid var\(--accent\)/);
  assert.match(css, /\.input-glass:focus-visible[\s\S]*outline:\s*2px solid var\(--accent\)/);
  assert.match(cardRule, /background:\s*var\(--surface\)/);
  assert.doesNotMatch(cardRule, /background:\s*linear-gradient/);
});

test('calm editorial progress and upload states avoid decorative purple gradients', () => {
  const css = read('src/index.css');
  assert.match(css, /\.archive-card-progress-fill\s*\{[\s\S]*background:\s*var\(--accent\)/);
  assert.match(css, /\.upload-progress span\s*\{[\s\S]*background:\s*var\(--accent\)/);
  assert.match(css, /\.upload-task-row::before\s*\{[\s\S]*background:\s*var\(--accent-soft\)/);
  assert.doesNotMatch(css, /#9c7cff/);
});

test('expanded EH settings release their stacking context so tooltips cover secret inputs', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /transform:\s*readerSettings\.ehEnabled \? 'none' : 'translateY\(-6px\)'/);
});

test('metadata tags refresh async translations and animate actual-width row layout without hover feedback', () => {
  const chip = read('src/components/MetadataTagChip.jsx');
  const page = read('src/pages/MetadataPage.jsx');
  const css = read('src/index.css');
  assert.match(page, /import \{ loadTagDB, translateTag \} from '\.\.\/lib\/tags';/);
  assert.match(page, /loadTagDB\(\)\.then\(\(\) => \{[\s\S]*setTagDBRevision/);
  assert.match(chip, /const \[textWidths, setTextWidths\] = useState\(null\)/);
  assert.match(chip, /metadataTagReservedWidth\(textWidths\?\.translated, textWidths\?\.original, CHIP_CHROME_WIDTH\)/);
  assert.match(chip, /if \(reservedWidth !== null\) onMeasure\?\.\(tag, reservedWidth\)/);
  assert.match(chip, /className="metadata-tag-slot"[\s\S]*--metadata-tag-visible-width/);
  assert.doesNotMatch(chip, /onPointerEnter|onPointerLeave/);
  assert.match(page, /closest\('\.metadata-tag-slot'\)/);
  assert.match(page, /const rows = useMemo\([\s\S]*nextWidth > contentWidth[\s\S]*React\.cloneElement/);
  assert.match(page, /className="metadata-tags-row" key=\{index\}/);
  assert.match(css, /\.metadata-tags-row\s*{[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(css, /\.metadata-tags-row > \.metadata-tag-slot\s*{[\s\S]*?flex:\s*0 1 var\(--metadata-tag-visible-width\)/);
  assert.match(css, /\.metadata-tags-row > \.metadata-tag-slot\s*{[\s\S]*?transition:[^}]*flex-basis 0\.24s ease/);
  assert.match(page, /function MetadataTagsBox[\s\S]*ResizeObserver[\s\S]*metadata-tags-list/);
  assert.match(css, /\.metadata-tags-box\s*{[\s\S]*?transition:\s*height 0\.24s ease/);
});

test('metadata loading state stays centered in the viewport', () => {
  const page = read('src/pages/MetadataPage.jsx');
  const css = read('src/index.css');
  assert.match(page, /className="metadata-loading-state"/);
  assert.match(css, /\.metadata-loading-state\s*\{[^}]*min-height:\s*100dvh;[^}]*display:\s*grid;[^}]*place-items:\s*center;/s);
});

test('home lazy route keeps archive skeleton visible during chunk loading', () => {
  const app = read('src/App.jsx');
  const css = read('src/index.css');
  assert.match(app, /function HomeRouteFallback\(\)[\s\S]*className="home-route-fallback"/);
  assert.match(app, /className="home-route-fallback-grid"/);
  assert.match(app, /function getRouteFallback\(route\)[\s\S]*case 'home':[\s\S]*<HomeRouteFallback \/>/);
  assert.match(app, /case 'reader':[\s\S]*<AppRouteFallback \/>/);
  assert.match(app, /case 'metadata':[\s\S]*<MetadataRouteFallback \/>/);
  assert.match(app, /case 'history':[\s\S]*<ArchiveListRouteFallback title="阅读历史" \/>/);
  assert.match(app, /case 'watchlist':[\s\S]*<ArchiveListRouteFallback title="待看档案" \/>/);
  assert.match(app, /case 'dedupe':[\s\S]*<DedupeRouteFallback \/>/);
  assert.match(app, /case 'upload':[\s\S]*<UploadRouteFallback \/>/);
  assert.match(app, /<Suspense fallback=\{getRouteFallback\(route\)\}>/);
  assert.doesNotMatch(app, /ReaderRouteFallback|reader-route-fallback/);
  assert.doesNotMatch(css, /reader-route-fallback/);
});

test('history and watchlist keep skeletons while async local state hydrates', () => {
  const history = read('src/pages/HistoryPage.jsx');
  const watchlist = read('src/pages/WatchlistPage.jsx');
  const css = read('src/index.css');
  assert.match(history, /const \[initialLoading, setInitialLoading\] = useState\(true\)/);
  assert.match(history, /initialLoading && searchedHistory\.length === 0/);
  assert.match(history, /<ArchiveListLoadingGrid count=\{8\} displayMode=\{archiveDisplayMode\}/);
  assert.match(watchlist, /const \[initialLoading, setInitialLoading\] = useState\(true\)/);
  assert.match(watchlist, /initialLoading && filteredItems\.length === 0/);
  assert.match(watchlist, /<ArchiveListLoadingGrid count=\{8\} displayMode=\{archiveDisplayMode\}/);
  assert.match(css, /\.archive-list-loading-grid\s*\{/);
  assert.match(css, /\.archive-list-loading-card\s*\{/);
});

test('history and watchlist narrow actions fill wrapped rows and use shared summary radius', () => {
  const history = read('src/pages/HistoryPage.jsx');
  const watchlist = read('src/pages/WatchlistPage.jsx');
  const css = read('src/index.css');
  const narrowCss = css.slice(css.lastIndexOf('@media (max-width: 600px)'), css.indexOf('@media (hover: none)'));

  assert.match(history, /className="history-page page-workspace"/);
  assert.match(watchlist, /className="history-page watchlist-page page-workspace"/);
  assert.match(narrowCss, /\.history-page-actions\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
  assert.match(narrowCss, /\.history-page-actions\s*\{[\s\S]*?justify-content:\s*flex-start;/);
  assert.match(narrowCss, /\.history-page-actions \.btn\s*\{[\s\S]*?flex:\s*1 1 calc\(\(100% - 20px\) \/ 3\);/);
  assert.match(narrowCss, /\.history-page-actions \.btn\s*\{[\s\S]*?min-width:\s*max-content;/);
  assert.match(css, /\.history-page-summary\s*\{[\s\S]*?border-radius:\s*var\(--radius-xs\);/);
});

test('skeleton shimmer keeps a stable base fill and recommendation placeholders use shared classes', () => {
  const recommendations = read('src/components/Recommendations.jsx');
  const css = read('src/index.css');
  assert.match(css, /\.shimmer-strip\s*\{[^}]*background-color:\s*var\(--reader-skeleton-base\);[^}]*background-image:\s*linear-gradient/s);
  assert.match(css, /\.shimmer-strip\s*\{[^}]*background-repeat:\s*no-repeat;/s);
  assert.match(css, /html\[data-theme="light"\] \.shimmer-strip\s*\{[^}]*background-image:\s*linear-gradient/s);
  assert.match(recommendations, /className="recommendation-loading-card"/);
  assert.match(recommendations, /className="recommendation-loading-cover shimmer-strip"/);
  assert.match(css, /\.recommendation-loading-card\s*\{[^}]*flex:\s*0 0 150px;[^}]*contain:\s*layout paint style;/s);
  assert.match(css, /\.recommendation-loading-body\s*\{[^}]*min-height:\s*73px;/s);
  assert.doesNotMatch(recommendations, /linear-gradient\(90deg, var\(--reader-skeleton-base\)/);
});

test('metadata error statuses dismiss automatically', () => {
  const toast = read('src/components/Toast.jsx');
  const css = read('src/index.css');
  assert.match(toast, /TOAST_DURATION_MS = 3600/);
  assert.match(toast, /TOAST_ERROR_DURATION_MS = 7000/);
  assert.match(toast, /setToasts\(\(current\) => \[\.\.\.current, \{ id, text: message, type, closing: false, autoHide, duration: toastDuration \}\]\)/);
  assert.match(toast, /setTimeout\(\(\) => closeToast\(id\), toastDuration\)/);
  assert.match(toast, /className="toast-progress"/);
  assert.match(css, /\.toast-stack\s*\{[^}]*position:\s*fixed;[^}]*left:\s*max\(16px, calc\(var\(--app-safe-area-left\) \+ 16px\)\)/s);
  assert.match(css, /@keyframes toast-enter/);
  assert.match(css, /@keyframes toast-exit/);
  assert.match(css, /@keyframes toast-progress[\s\S]*scaleX\(0\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.toast-stack[\s\S]*?\.toast-progress[\s\S]*?animation:\s*none\s*!important/);
});

test('metadata status cards contain long plugin messages', () => {
  const css = read('src/index.css');
  assert.match(css, /\.toast-card\s*\{[^}]*box-sizing:\s*border-box;[^}]*overflow-wrap:\s*anywhere;/s);
});

test('metadata plugins merge returned title, summary, and tags into the editable form', () => {
  const editor = read('src/lib/metadataEditor.js');
  const page = read('src/pages/MetadataPage.jsx');
  assert.match(editor, /title:\s*data\.title \?\? data\.new_title \?\? result\.title \?\? result\.new_title/);
  assert.match(editor, /summary:\s*data\.summary \?\? data\.new_summary \?\? result\.summary \?\? result\.new_summary/);
  assert.match(editor, /tags:\s*data\.tags \?\? data\.new_tags \?\? result\.tags \?\? result\.new_tags/);
  assert.doesNotMatch(editor, /hasDefaultValueOne|isDefault:/);
  assert.match(editor, /description:\s*stripPluginDescription\(item\?\.description\)/);
  assert.match(page, /const \{ title, summary, tags \} = readMetadataPluginResult\(result\)/);
  assert.match(page, /const defaultPlugin = values\.find\(option => option\.value === 'ehplugin' \|\| option\.label === 'E-Hentai'\) \|\| values\[0\]/);
  assert.match(page, /setPlugins\(values\); setPlugin\(defaultPlugin\?\.value \|\| ''\)/);
  assert.match(page, /const pluginDescription = plugins\.find\(option => option\.value === plugin\)\?\.description \|\| ''/);
  assert.match(page, /className="metadata-plugin-help"/);
  assert.match(page, /className="metadata-plugin-help-icon"/);
  assert.match(page, /role="tooltip"\>\{pluginDescription\}<\/span\>/);
  assert.match(page, /const nextForm = \{ \.\.\.form \}/);
  assert.match(page, /if \(title\) \{ nextForm\.title = title; changed\.push\('标题'\); \}/);
  assert.match(page, /if \(summary\) \{ nextForm\.summary = summary; changed\.push\('摘要'\); \}/);
  assert.match(page, /nextForm\.tags = mergeTags\(form\.tags, tags\)/);
  assert.match(page, /if \(changed\.length\) setForm\(nextForm\)/);
});

test('metadata tag entry rejects an already attached tag without hiding its suggestion', () => {
  const page = read('src/pages/MetadataPage.jsx');
  const suggestions = read('src/components/TagSuggest.jsx');
  assert.doesNotMatch(page, /excludeTags/);
  assert.doesNotMatch(suggestions, /excludeTags|excludedTagKeys/);
  assert.match(page, /const incomingTags = parseTags\(value\)/);
  assert.match(page, /nextTags\.length === form\.tags\.length/);
  assert.match(page, /showToast\(`标签已存在：\$\{incomingTags\[0\]\}`, 'error'\)/);
});

test('metadata save updates visible archive state and writes metadata cache immediately', () => {
  const page = read('src/pages/MetadataPage.jsx');
  const cache = read('src/lib/archiveMetadataCache.js');
  assert.match(cache, /import \{ clearHomeNavigationSnapshot \} from '\.\/sessionState';/);
  assert.match(cache, /export function rememberArchiveInCatalog\(archive, options = \{\}\)/);
  assert.match(page, /rememberArchiveInCatalog\(updatedArchive, \{ immediate: true \}\)/);
  assert.match(page, /markArchiveCatalogDirty\(\)/);
  assert.match(page, /setArchive\(updatedArchive\)/);
  assert.match(page, /await lrrApi\.clearSearchCache\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(cache, /clearHomeNavigationSnapshot\(\);/);
});

test('upload result rows keep a stable one-line status layout', () => {
  const page = read('src/pages/UploadPage.jsx');
  const css = read('src/index.css');

  assert.match(page, /const \[pluginStatus, setPluginStatus\] = useState\(''\)/);
  assert.doesNotMatch(page, /正在载入下载插件/);
  assert.doesNotMatch(page, /function statusLabel/);
  assert.doesNotMatch(page, /responseMessage/);
  assert.doesNotMatch(page, /upload-status-text/);
  assert.doesNotMatch(page, /<small>\{item\.message\}<\/small>/);
  assert.match(page, /title=\{item\.message \? `\$\{item\.label\}：\$\{item\.message\}` : item\.label\}/);
  assert.match(page, /<div><strong>\{item\.label\}<\/strong><\/div>\s*<span className=\{`upload-status-dot is-\$\{item\.status\}`\} title=\{statusTitle\(item\.status\)\}/);
  assert.match(css, /\.upload-task-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/s);
  assert.match(css, /\.upload-task-row\s*\{[^}]*min-height:\s*40px;/s);
  assert.doesNotMatch(css, /\.upload-status-text/);
  assert.match(css, /\.upload-status-dot\.is-queued\s*\{[^}]*background:\s*var\(--text-secondary\)/s);
  assert.match(css, /\.upload-status-dot\.is-running\s*\{[^}]*background:\s*var\(--accent\)/s);
  assert.match(css, /\.upload-status-dot\.is-success\s*\{[^}]*background:\s*var\(--positive\)/s);
  assert.match(css, /\.upload-status-dot\.is-failed\s*\{[^}]*background:\s*var\(--danger\)/s);
  assert.match(css, /\.upload-title-icon\s*\{[^}]*border-color:\s*var\(--border-subtle\)/s);
  assert.doesNotMatch(css, /\.upload-title-icon\s*\{[^}]*border-color:\s*var\(--danger-border\)/s);
});

test('transient notifications use the shared toast module', () => {
  const toast = read('src/components/Toast.jsx');
  const main = read('src/main.jsx');
  const metadata = read('src/pages/MetadataPage.jsx');
  const home = read('src/pages/Home.jsx');
  const reader = read('src/pages/Reader.jsx');
  const css = read('src/index.css');
  assert.match(toast, /export function ToastProvider/);
  assert.match(toast, /export function useToast/);
  assert.match(toast, /className="toast-stack"/);
  assert.match(main, /<ToastProvider>\s*<App \/>\s*<\/ToastProvider>/s);
  assert.match(metadata, /useToast/);
  assert.match(home, /useToast/);
  assert.match(reader, /useToast/);
  assert.doesNotMatch(metadata, /const \[toasts, setToasts\] = useState\(\[\]\)/);
  assert.doesNotMatch(home, /const \[toasts, setToasts\] = useState\(\[\]\)/);
  assert.doesNotMatch(reader, /const \[srToast, setSrToast\] = useState\(''\)/);
  assert.doesNotMatch(home, /className="metadata-toast-stack"/);
  assert.doesNotMatch(metadata, /className="metadata-toast-stack"/);
  assert.doesNotMatch(reader, /className="metadata-toast-stack"/);
  assert.match(css, /\.toast-stack\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*100002/s);
  assert.match(css, /\.toast-card\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
});

test('config export selects whole groups in one flat list', () => {
  const dialog = read('src/components/ConfigExportDialog.jsx');
  const css = read('src/index.css');
  for (const title of [
    '服务器地址与 API Key',
    'Worker 端点与访问 Token',
    'E-Hentai Cookie 与评论',
    '阅读器、封面与档案显示',
    '已读状态与筛选条件',
    '主题与自定义配色',
    '图片缓存上限',
  ]) assert.match(dialog, new RegExp(`title: '${title}'`));
  assert.match(dialog, /CONFIG_GROUPS\.map\(\(group\) => group\.title\)/);
  assert.match(dialog, /CONFIG_GROUPS[\s\S]{0,80}\.filter\([\s\S]*\.flatMap\(\(group\) => group\.keys\.map\(\(\[key\]\) => key\)\)/);
  assert.match(dialog, /CONFIG_GROUPS\.map\(\(group\) => \([\s\S]*label=\{group\.title\}/);
  assert.doesNotMatch(dialog, /group\.keys\.map\(\(\[key, label\]\)/);
  assert.doesNotMatch(dialog, /<fieldset|<legend/);
  assert.match(css, /\.config-export-list\s*\{[^}]*border:/s);
  assert.match(css, /\.config-export-item\s*\{[^}]*border-bottom:/s);
  assert.doesNotMatch(css, /\.config-export-group\s*\{/);
});

test('reader setting hints escape the scroll container and size to their content', () => {
  const hint = read('src/components/SettingHint.jsx');
  const css = read('src/index.css');
  const reader = read('src/pages/Reader.jsx');
  assert.match(hint, /<Tooltip\.Portal>/);
  assert.match(hint, /settings-hint-bubble-portal/);
  assert.match(css, /\.settings-hint-bubble-portal\s*\{[^}]*position:\s*fixed;[^}]*inline-size:\s*max-content;/s);
  assert.match(css, /\.settings-hint-bubble-portal\s*\{[^}]*max-inline-size:\s*min\(320px, calc\(100vw - 48px\)\)/s);
  assert.match(reader, /width: 'min\(440px, calc\(100vw - 32px\)\)'/);
});

test('upload modes share settings tabs, animate as equal-height layers, and auto-queue URLs', () => {
  const page = read('src/pages/UploadPage.jsx');
  const css = read('src/index.css');

  assert.match(page, />从本地添加<\/button>/);
  assert.match(page, /className="upload-mode-panel-stack"/);
  assert.match(page, /className=\{`btn settings-category-tab upload-mode-tab\$\{mode === 'local' \? ' is-active' : ''\}`\}/);
  assert.match(page, /className=\{`upload-mode-panel\$\{mode === 'local' \? ' is-active' : ''\}`\}/);
  assert.match(page, /createUploadUrlTasks\(\s*parsedUrls\.valid/);
  assert.match(page, /parsedUrls\.valid\.length === 0/);
  assert.doesNotMatch(page, /添加到队列/);
  assert.match(page, /\{running \? '处理中…' : '开始处理'\}/);
  assert.match(page, /disabled=\{running \|\| clearingResults \|\| queuedTaskCount === 0\}/);
  assert.match(css, /\.upload-mode-panel-stack\s*\{[^}]*display:\s*grid;/s);
  assert.match(css, /\.upload-mode-panel\s*\{[^}]*grid-area:\s*1 \/ 1;/s);
  assert.match(css, /\.upload-mode-panel\.is-active\s*\{[^}]*opacity:\s*1;/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.upload-mode-panel[\s\S]*transition:\s*none/s);
});

test('upload task controls use global buttons and concise list labels', () => {
  const page = read('src/pages/UploadPage.jsx');

  assert.match(page, /<h2>任务列表<\/h2>/);
  assert.doesNotMatch(page, /任务状态|completedCount|upload-primary-action/);
  assert.doesNotMatch(page, /选择的文件会加入下方任务列表，点击「开始处理」统一上传。/);
  assert.match(page, /className="btn" onClick=\{runPending\} disabled=\{running \|\| clearingResults \|\| queuedTaskCount === 0\}>\s*\{running \? '处理中…' : '开始处理'\}/);
  assert.match(page, /className="btn" onClick=\{clearResults\} disabled=\{running \|\| clearingResults \|\| results\.length === 0\}>清空列表<\/button>/);
});

test('upload task rows animate on insert and before list clearing', () => {
  const page = read('src/pages/UploadPage.jsx');
  const css = read('src/index.css');

  assert.match(page, /const \[clearingResults, setClearingResults\] = useState\(false\)/);
  assert.match(page, /setClearingResults\(true\)/);
  assert.match(page, /setResults\(\[\]\)/);
  assert.match(page, /if \(mode !== 'url' \|\| running \|\| clearingResults \|\| parsedUrls\.valid\.length === 0\) return;/);
  assert.match(page, /if \(clearingResults\) return;/);
  assert.match(page, /window\.clearTimeout\(timer\)/);
  assert.match(page, /className=\{`upload-task-list\$\{clearingResults \? ' is-clearing' : ''\}`\}/);
  assert.match(css, /@keyframes uploadTaskReveal/);
  assert.match(css, /@keyframes uploadTaskDismiss/);
  assert.match(css, /\.upload-task-row\s*\{[^}]*animation:\s*uploadTaskReveal 220ms ease both;/s);
  assert.match(css, /\.upload-task-list\.is-clearing \.upload-task-row\s*\{[^}]*animation:\s*uploadTaskDismiss 180ms ease both;/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.upload-task-row[\s\S]*animation:\s*none/s);
});

test('tag suggestion panel hides scrollbars without reserving a hidden gutter', () => {
  const suggestions = read('src/components/TagSuggest.jsx');
  const css = read('src/index.css');
  assert.match(suggestions, /className="dropdown-animate no-scrollbar tag-suggest-panel"/);
  assert.match(suggestions, /scrollbarGutter:\s*'auto'/);
  assert.match(suggestions, /overflowX:\s*'clip'/);
  assert.match(suggestions, /contain:\s*'layout paint'/);
  assert.match(suggestions, /paddingRight:\s*0/);
  assert.match(css, /\.no-scrollbar\s*\{[^}]*scrollbar-gutter:\s*auto;/s);
});

test('mobile settings panel clips horizontal overflow and keeps consistent scrollbars', () => {
  const css = read('src/index.css');
  assert.match(css, /html,[\s\S]*body\s*\{[^}]*overflow-x:\s*clip;/s);
  assert.match(css, /\.settings-overlay\s*\{[^}]*max-width:\s*100vw;[^}]*overflow-x:\s*clip;/s);
  assert.match(css, /\.settings-panel\s*\{[^}]*min-width:\s*0;[^}]*overflow-x:\s*clip;/s);
  assert.match(css, /\.settings-panel-scroll\s*\{[^}]*min-width:\s*0;[^}]*overflow-x:\s*clip;[^}]*scrollbar-gutter:\s*stable both-edges;/s);
  assert.match(css, /\.settings-panel-scroll,[\s\S]*\.reader-drawer-scroll,[\s\S]*\.upload-task-list\s*\{[^}]*scrollbar-width:\s*thin;/s);
});

test('archive tag hover panels clip hidden scroll gutters and isolate scroll layout', () => {
  const card = read('src/components/ArchiveCard.jsx');
  assert.match(card, /className="no-scrollbar archive-tag-panel archive-compact-tag-panel"[\s\S]*overflowY:\s*'auto',[\s\S]*overflowX:\s*'clip',[\s\S]*scrollbarGutter:\s*'auto',[\s\S]*contain:\s*'layout paint'/);
  assert.match(card, /className="no-scrollbar archive-tag-panel"[\s\S]*overflowY:\s*'auto',[\s\S]*overflowX:\s*'clip',[\s\S]*scrollbarGutter:\s*'auto',[\s\S]*contain:\s*'layout paint'/);
});

test('archive card grid avoids re-render churn for unchanged large result sets', () => {
  const home = read('src/pages/Home.jsx');
  const card = read('src/components/ArchiveCard.jsx');
  const css = read('src/index.css');
  assert.match(card, /function ArchiveCard\(/);
  assert.match(card, /const activateArchive = useCallback\(\(event\) => \{\s*onClick\?\.\(archive, event\);\s*\}, \[archive, onClick\]\)/s);
  assert.match(card, /export default React\.memo\(ArchiveCard\)/);
  assert.match(home, /const handleArchiveCardActivate = useCallback\(\(archive\) => \{/);
  assert.match(home, /onClick=\{handleArchiveCardActivate\}/);
  assert.doesNotMatch(home, /displayArchives\.map\(\(arc\) => \(\s*<ArchiveCard[^\n]*onClick=\{\(\) => handleSelectArchive\(arc\.arcid\)\}/s);
  const cardWrapRule = css.match(/\.archive-grid\s*>\s*\.archive-card-wrap\s*\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(cardWrapRule, /contain:\s*layout paint style;/);
  assert.doesNotMatch(cardWrapRule, /content-visibility|contain-intrinsic-block-size/);
});

test('dedupe results use compact persistence, interlocked selection, and wide-card layout', () => {
  const page = read('src/pages/DeduplicatePage.jsx');
  const deduplicate = read('src/lib/deduplicate.js');
  const css = read('src/index.css');
  assert.match(deduplicate, /version:\s*2/);
  assert.match(deduplicate, /compactDedupeArchives\(visibleGroups\)/);
  assert.match(page, /normalizeDuplicateSelection/);
  assert.match(page, /getDuplicateSelectionDisabledIds/);
  assert.match(page, /className="dedupe-groups-grid"/);
  assert.match(css, /\.dedupe-groups-grid\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*center;[^}]*align-items:\s*center;/s);
  assert.match(css, /\.dedupe-group\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*100%;/s);
  assert.match(css, /\.dedupe-group-cards\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*center;/s);
  assert.match(css, /\.dedupe-card-item\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*width:\s*max-content;[^}]*max-width:\s*100%;/s);
  assert.match(page, /function DedupeArchiveItem/);
  assert.doesNotMatch(page, /onWideChange=\{setWide\}/);
  assert.doesNotMatch(page, /wide \? ' is-wide' : ''/);
  assert.match(css, /\.dedupe-card-item\s*\{[^}]*width:\s*max-content;/s);
  assert.match(css, /\.dedupe-card-size-row\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*center;/s);
  assert.doesNotMatch(css, /\.dedupe-card-item:has/);
  assert.match(page, /className="dedupe-group-selection-message"/);
  assert.match(page, /pagecount \?\? archive\.total/);
  assert.match(css, /\.dedupe-groups-grid\s*\{/);
  assert.match(css, /\.dedupe-card-item\s*>\s*\.archive-card-wrap\.is-wide/);
  assert.match(css, /\.dedupe-group-selection-message\s*\{[^}]*min-height:\s*\d+px;[^}]*opacity:\s*0;/s);
  assert.doesNotMatch(css, /\.dedupe-group-selection-message\s*\{[^}]*grid-template-rows/s);
  assert.match(css, /\.dedupe-group\.is-selected\s+\.dedupe-group-selection-message\s*\{[^}]*opacity:\s*1;/s);
});

test('dedupe execution combines actions, groups chains, reports progress, and preserves retry failures', () => {
  const page = read('src/pages/DeduplicatePage.jsx');
  const deletion = read('src/lib/archiveDeletion.js');
  const progress = read('src/components/ExecutionProgressPanel.jsx');
  const failure = read('src/components/ArchiveDeletionFailureDialog.jsx');
  const css = read('src/index.css');
  assert.match(page, /groupDuplicatePairsByChain/);
  assert.match(page, /className="dedupe-chain"/);
  assert.match(page, />\s*执行\s*</);
  assert.doesNotMatch(page, />\s*删除选中\s*</);
  assert.doesNotMatch(page, />\s*标记分组不重复\s*</);
  assert.match(progress, /aria-live="polite"/);
  assert.match(failure, /navigator\.clipboard\.writeText/);
  assert.match(page, /continueOnFavoriteError:\s*true/);
  assert.match(page, /deleteArchiveWithFavoriteSync/);
  assert.doesNotMatch(page, /\{status\}<\/div>/);
  assert.match(deletion, /runArchiveDeletionOperations/);
  assert.match(css, /\.dedupe-chain\s*\{/);
});

test('dedupe cards own a focused context menu and progress-free central thumbnail preview', () => {
  const page = read('src/pages/DeduplicatePage.jsx');
  const menu = read('src/components/DedupeArchiveContextMenu.jsx');
  const dialog = read('src/components/ArchiveThumbnailDialog.jsx');
  const css = read('src/index.css');
  assert.match(page, /onArchiveContextMenu=\{onContextMenu\}/);
  assert.match(page, /onContextMenu=\{handleOpenArchiveMenu\}/);
  assert.match(page, /<DedupeArchiveContextMenu/);
  assert.match(page, /<ArchiveThumbnailDialog/);
  assert.match(menu, />\s*打开阅读页\s*</);
  assert.doesNotMatch(menu, /新标签/);
  assert.match(menu, /查看缩略图/);
  assert.doesNotMatch(menu, /删除|下载|编辑元数据/);
  assert.match(menu, /window\.addEventListener\('scroll', close, true\)/);
  assert.match(dialog, /useState\('grid'\)/);
  assert.match(dialog, /setViewMode\('preview'\)/);
  assert.match(dialog, /返回缩略图/);
  assert.match(dialog, /lrrApi\.getArchiveFiles/);
  assert.match(dialog, /<ArchivePageThumbnail/);
  assert.match(dialog, /className="archive-thumbnail-dialog-thumb-media"/);
  assert.match(page, /rememberArchiveMetadata\(archive, \{ immediate: true \}\)/);
  assert.match(css, /\.archive-thumbnail-dialog-grid\s*\{[^}]*grid-auto-rows:\s*176px;/s);
  assert.match(css, /\.archive-thumbnail-dialog-thumb-media\s*\{[^}]*position:\s*relative;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.archive-thumbnail-dialog-thumb-media\s*>\s*\.archive-page-thumbnail-(?:image|placeholder)/s);
  assert.match(css, /\.archive-thumbnail-dialog-preview-image\s*\{[^}]*max-width:\s*100%;[^}]*max-height:\s*100%;[^}]*width:\s*auto;[^}]*height:\s*auto;/s);
  assert.doesNotMatch(dialog, /updateProgress|saveHistory|readingProgress/i);
  assert.match(css, /\.archive-thumbnail-dialog-overlay/);
  assert.match(css, /\.archive-thumbnail-dialog-grid/);
  assert.match(css, /\.archive-thumbnail-dialog-preview-image/);
});

test('dedupe groups expose broad group selection and visible smart-selection tags', () => {
  const page = read('src/pages/DeduplicatePage.jsx');
  const css = read('src/index.css');

  assert.match(page, /getDedupeSmartSelectionSignals/);
  assert.match(page, /className=\{`dedupe-group\$\{selected \? ' is-selected' : ''\}`\}[\s\S]*?onClick=\{workerReady \? \(\) => toggleGroupSelection\(group\) : undefined\}/);
  assert.match(page, /className="dedupe-group-toggle"[\s\S]*?onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*toggleGroupSelection\(group\);/);
  assert.match(page, /className=\{`dedupe-card-item[\s\S]*?onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(page, /smartSignals\.roughTranslation[\s\S]*?>渣翻</);
  assert.match(page, /smartSignals\.extraneousAds[\s\S]*?>外部广告</);
  assert.match(page, /smartSignals\.uncensored[\s\S]*?>无修正</);
  assert.match(css, /\.dedupe-card-smart-tag\.is-warning/);
  assert.match(css, /\.dedupe-card-smart-tag\.is-positive/);
});

test('dedupe date range uses an adaptive styled calendar instead of the native picker', () => {
  const page = read('src/pages/DeduplicatePage.jsx');
  const picker = read('src/components/DatePicker.jsx');
  const css = read('src/index.css');
  assert.match(page, /<DatePicker/);
  assert.doesNotMatch(page, /type="date"/);
  assert.match(picker, /createPortal/);
  assert.match(picker, /resolveCalendarPopoverPosition/);
  assert.match(picker, /aria-label="上个月"/);
  assert.match(picker, /aria-label="下个月"/);
  assert.match(picker, /ariaLabel="年份"/);
  assert.match(picker, /ariaLabel="月份"/);
  assert.match(picker, /import CustomSelect from '.\/CustomSelect'/);
  assert.match(picker, /<CustomSelect/);
  assert.doesNotMatch(picker, /<select/);
  assert.match(picker, /2000 \+ index/);
  assert.doesNotMatch(picker, /1900 \+ index/);
  assert.match(picker, /className="date-picker-year-select"/);
  assert.match(picker, /className="date-picker-month-select"/);
  assert.match(picker, /event\?\.target\?\.closest\?\.\('\[data-select-dropdown="true"\]'\)/);
  assert.match(picker, /data-select-dropdown/);
  assert.match(css, /\.date-picker-trigger/);
  assert.match(css, /\.date-picker-popover/);
  assert.match(read('src/styles/primitives.css'), /\.custom-select-root\.is-compact\.date-picker-year-select\s*\{[^}]*width:\s*126px;[^}]*min-width:\s*126px;/s);
  assert.match(read('src/styles/primitives.css'), /\.custom-select-root\.is-compact\.date-picker-month-select\s*\{[^}]*width:\s*100px;[^}]*min-width:\s*100px;/s);
});

test('dedupe bulk group toggle lives below scan stats and its context menu stays compact', () => {
  const page = read('src/pages/DeduplicatePage.jsx');
  const menu = read('src/components/DedupeArchiveContextMenu.jsx');
  const css = read('src/index.css');
  assert.match(page, /function StatsPanel\([\s\S]*aria-pressed=\{allGroupsSelected\}[\s\S]*全选分组/);
  assert.match(page, /<StatsPanel[\s\S]*allGroupsSelected=\{allGroupsSelected\}/);
  assert.match(page, /\['选中档案', selectedArchiveCount\]/);
  assert.match(page, /\['选中分组', selectedGroupCount\]/);
  assert.match(page, /function StatsPanel\([\s\S]*智能选择[\s\S]*>\s*执行\s*</);
  assert.doesNotMatch(page, />\s*删除选中\s*<|>\s*标记分组不重复\s*</);
  assert.match(page, /function DateRangePanel\([\s\S]*检测范围[\s\S]*>重置</);
  assert.match(page, /<h2 style=\{\{ margin: 0, fontWeight: 800, fontSize: '16px'[^}]*\}\}>检测范围<\/h2>/);
  assert.doesNotMatch(page, /按档案入库日期筛选，默认范围包含全部档案/);
  assert.match(page, /function DateRangePanel\([\s\S]*\{running \? '处理中…' : '开始检测'\}/);
  assert.doesNotMatch(page, /<header[\s\S]*智能选择[\s\S]*<\/header>/);
  assert.doesNotMatch(page, /<header[\s\S]*开始检测[\s\S]*<\/header>/);
  assert.doesNotMatch(page, /<header[\s\S]*选择全部分组标记为不重复[\s\S]*<\/header>/);
  assert.match(menu, /<Menu\.Popup className="archive-context-menu dedupe-archive-context-menu/);
  assert.doesNotMatch(css, /\.dedupe-archive-context-menu\s*\{[^}]*width:\s*190px/);
});

test('dedupe waiting copy describes the similarity algorithm without retired branding', () => {
  const page = read('src/pages/DeduplicatePage.jsx');
  assert.match(page, /点击“开始检测”后会读取档案封面，通过相似度算法查找疑似重复的档案。/);
  assert.doesNotMatch(page, /按 LRReader 的缩略图相似度规则查找疑似重复/);
});

test('metadata navigation, races, and operations are guarded', () => {
  const source = read('src/pages/MetadataPage.jsx');
  assert.match(source, /setNavigationGuard/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /loadSequenceRef/);
  assert.match(source, /if \(busy\) return/);
});

test('Reader recovery reacts to cache fallback and live direction/crop changes', () => {
  const source = read('src/pages/Reader.jsx');
  assert.match(source, /\[assetCacheOnly, currentIndex,[^\]]*settings\.direction,[^\]]*webtoonActive\]/);
  assert.match(source, /\[applyZoomAtPoint, scheduleZoomTransform, settings\.direction, viewMode, webtoonActive\]/);
  assert.match(source, /\[cropBorders, isReady, imgSrc\]/);
  assert.match(source, /keepalive: true/);
});

test('Reader layouts share page order while normal and immersive renderers stay separate', () => {
  const source = read('src/pages/Reader.jsx');
  assert.match(source, /buildReaderSpreads/);
  assert.match(source, /imgCurrSecondRef/);
  assert.match(source, /settings\.rotateWidePagesEnabled && wide/);
  assert.match(source, /getContainedHalfFrame\(naturalSize, shellSize, cropSide\)/);
  assert.match(source, /clipPath: cropSide === 'left' \? 'inset\(0 50% 0 0\)'/);
  assert.match(source, /maxWidth: showRotate \? `\$\{shellSize\.height\}px`/);
  assert.match(source, /resizeObserver = new ResizeObserver/);
  assert.match(source, /data-webtoon=\{webtoonActive \? 'true' : 'false'\}/);
  assert.match(source, /onMouseDown=\{webtoonActive \? undefined : handlePointerDown\}/);
  assert.match(source, /!webtoonActive && settings\.autoTurnActive/);
  assert.match(source, /settings\.autoTurnActive, currentIndex, splitPart, currentSpreadIndex/);
  assert.doesNotMatch(source, /splitWide=\{settings\.splitWidePagesEnabled\}/);
});

test('Reader toolbar has three measured states and page commits preserve transient indicators', () => {
  const reader = read('src/pages/Reader.jsx');
  const css = read('src/index.css');
  assert.match(reader, /resolveReaderToolbarMode/);
  assert.match(reader, /data-mode=\{toolbarMode\}/);
  assert.match(reader, /toolbarMode !== 'mobile'/);
  assert.match(css, /\.reader-toolbar\[data-mode="icons"\][\s\S]*\.reader-toolbar-label/);
  assert.match(css, /\.reader-toolbar\[data-mode="mobile"\][\s\S]*\.reader-toolbar-label/);
  assert.match(reader, /gridTemplateColumns: 'minmax\(0, 1fr\) auto minmax\(0, 1fr\)'/);
  assert.match(reader, /toolbarMode !== 'mobile'[\s\S]*className="reader-toolbar-title"[\s\S]*position: 'absolute',[\s\S]*left: '50%',[\s\S]*transform: 'translate\(-50%, -50%\)'/);
  assert.match(reader, /getCenteredToolbarTitleWidth/);
  assert.match(reader, /--reader-toolbar-title-width/);
  assert.match(reader, /const titleContent = title\?\.querySelector\('\.reader-toolbar-title-content'\)/);
  assert.match(reader, /Math\.ceil\(titleContent\.getBoundingClientRect\(\)\.width\)/);
  assert.match(reader, /className="reader-toolbar-title-content"/);
  assert.doesNotMatch(reader, /Math\.min\(Math\.max\(title\.scrollWidth, 80\), 240\)/);
  assert.doesNotMatch(reader, /title \? Math\.max\(title\.scrollWidth, 80\)/);
  assert.match(reader, /reader-toolbar-group-left" style=\{\{[^}]*gridColumn: '1'/);
  assert.match(reader, /reader-toolbar-group-right" style=\{\{[^}]*gridColumn: '3'/);
  assert.match(reader, /pageIndicatorTransientActiveRef\.current[\s\S]*checkIndicatorOverlap\(true\)/);
  assert.match(reader, /useReaderToolbarMode\(isMobile, viewMode\)/);
  assert.doesNotMatch(reader, /\[isMobile, layoutKey, mode\]/);
  assert.match(reader, /viewMode === 'normal' && \([\s\S]*className="reader-toolbar"[\s\S]*position: 'sticky',[\s\S]*top: 0/);
});

test('Reader auto layout prioritizes scrolling and dynamically measures the reader container', () => {
  const reader = read('src/pages/Reader.jsx');
  const css = read('src/index.css');
  assert.match(reader, /resolveAutoReadingLayout/);
  assert.match(reader, /effectiveReadingLayout/);
  assert.match(reader, /new ResizeObserver\(updateReaderContainerSize\)/);
  assert.match(reader, /doublePage: effectiveReadingLayout === 'double'/);
  assert.match(reader, /label: '滚动', value: 'webtoon'/);
  assert.doesNotMatch(reader, /label: 'Webtoon'/);
  const autoGuard = reader.indexOf("if (!secondaryContentReady || settings.readingLayout !== 'auto')");
  const tagCheck = reader.indexOf('hasWebtoonTag(archive?.tags)', autoGuard);
  const seamCheck = reader.indexOf('classifyWebtoonSeams(seams', tagCheck);
  assert.ok(autoGuard >= 0 && autoGuard < tagCheck && tagCheck < seamCheck);
  assert.match(reader, /\[archive\?\.tags, pages, secondaryContentReady, settings\.readingLayout\]/);
  assert.equal((reader.match(/className="reader-webtoon-page"/g) || []).length, 2);
  assert.match(css, /\.reader-webtoon-page\s*\{[^}]*width:\s*min\(100%,\s*80dvh,\s*960px\);[^}]*margin-inline:\s*auto;/s);
});

test('reading progress can be cleared from archive menus and the Reader drawer', () => {
  const menu = read('src/components/ArchiveContextMenu.jsx');
  const reader = read('src/pages/Reader.jsx');
  const api = read('src/lib/api.js');
  const actions = read('src/lib/archiveProgressActions.js');
  assert.match(menu, /onClearProgress/);
  assert.ok(menu.indexOf('清除阅读进度') < menu.indexOf('编辑元数据'));
  assert.match(reader, /ToolbarGlyph name="resetProgress"/);
  assert.ok(reader.indexOf('resetProgress') < reader.indexOf('ToolbarGlyph name="metadata"'));
  assert.match(api, /options\.force \? '\?force=1' : ''/);
  assert.match(reader, /await \(lrrProgressChainRef\.current\.get\(id\) \|\| Promise\.resolve\(\)\)/);
  assert.match(reader, /highestLrrQueuedPageRef\.current\.set\(id, 0\);[\s\S]*await \(lrrProgressChainRef\.current\.get\(id\)/);
  assert.match(reader, /hasArchiveProgressMarker/);
  assert.match(reader, /shouldPersistArchiveReadingProgress/);
  assert.match(actions, /clearReaderSnapshot\(id\)/);
});

test('immersive Reader replaces its top toolbar with side-aware corner controls', () => {
  const reader = read('src/pages/Reader.jsx');
  const css = read('src/index.css');
  assert.match(reader, /viewMode === 'normal' && \(\s*<div[\s\S]*data-reader-toolbar/);
  assert.match(reader, /reader-immersive-trigger-left/);
  assert.match(reader, /reader-immersive-trigger-right/);
  assert.match(reader, /reader-immersive-controls/);
  assert.match(reader, /2500/);
  assert.match(reader, /holdImmersiveControls/);
  assert.match(reader, /onPointerLeave=\{\(\) => revealImmersiveControls/);
  assert.match(reader, /onBlur=\{\(\) => revealImmersiveControls/);
  assert.match(reader, /title="退出沉浸模式" aria-label="退出沉浸模式"/);
  assert.match(reader, /ToolbarGlyph name="close"/);
  assert.match(reader, /const immersiveDoublePageGap = Math\.min\(6,/);
  assert.match(reader, /getImmersiveSpreadSlotStyle/);
  assert.match(css, /\.reader-immersive-controls\s*\{[^}]*bottom:\s*calc\(env\(safe-area-inset-bottom, 0px\) \+ 52px\);/s);
  assert.match(css, /\.reader-immersive-controls\[data-visible="true"\]/);
  assert.match(css, /cubic-bezier\(0\.34,\s*1\.56,\s*0\.64,\s*1\)/);
  assert.match(reader, /if \(showDrawer\) return;/);
  assert.match(reader, /onWheel=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(css, /\.reader-immersive-controls\[data-visible="true"\]\s+\.reader-immersive-control-button/);
  assert.match(css, /background:\s*var\(--reader-control-bg\)/);
  assert.match(css, /\.reader-immersive-trigger\s*\{[^}]*width:\s*max\(32px,\s*7vw\);/s);
  assert.match(reader, /\{\['left', 'right'\]\.map\(\(side\) => \(/);
  assert.match(reader, /data-visible=\{immersiveControlsSide === side \? 'true' : 'false'\}/);
});

test('auto turn controls report state changes through the shared toast', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /const handleToggleAutoTurn = useCallback\(\(\) => \{[\s\S]*showToast\(next \? '已开启自动翻页' : '已停止自动翻页', 'info'\)/);
  assert.match(reader, /onClick=\{handleToggleAutoTurn\}/);
  assert.match(reader, /onClick=\{\(\) => \{ handleToggleAutoTurn\(\); revealImmersiveControls\(side\); \}\}/);
});

test('super-resolution reuses preload count and uses directional state glyphs', () => {
  const reader = read('src/pages/Reader.jsx');
  const settings = read('src/lib/readerSettings.js');
  const glyphs = read('src/components/AppGlyphs.jsx');
  assert.doesNotMatch(reader, /预超分数量|srPreloadCount/);
  assert.match(settings, /delete next\.srPreloadCount/);
  assert.match(glyphs, /case 'superResolution':[\s\S]*?M5\.25 18\.75 18\.75 5\.25/);
  assert.match(glyphs, /case 'superResolutionOff':[\s\S]*?M4\.5 4\.5 19\.5 19\.5/);
  assert.doesNotMatch(glyphs, /case 'superResolution':[\s\S]*?stroke="var\(/);
  assert.doesNotMatch(glyphs, /case 'superResolutionOff':[\s\S]*?stroke="var\(/);
  assert.match(reader, /预超分页数与“预加载”数量一致/);
  assert.match(reader, /value=\{settings\.srModel\}[\s\S]{0,300}disabled=\{!settings\.srEnabled\}/);
  assert.match(reader, /label="自动启用超分"[^>]*disabled=\{!settings\.srEnabled\}/);
  assert.match(reader, /value=\{srThresholdInput\}[\s\S]{0,300}disabled=\{!settings\.srEnabled\}/);
});

test('Reader model selector explains each super-resolution option', () => {
  const reader = read('src/pages/Reader.jsx');
  const select = read('src/components/CustomSelect.jsx');

  assert.match(reader, /<span className="settings-row-title">超分模型<\/span>/);
  assert.doesNotMatch(reader, /<SettingHint text=\{srModel\?\.description/);
  assert.match(select, /option\.description/);
  assert.match(select, /SettingHint/);
});

test('Reader hides immersive super-resolution for oversized pages and explains why', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /currentPageTooLargeForSuperResolution/);
  assert.match(reader, /图片过大、不适合超分时/);
  assert.match(reader, /settings\.srEnabled && !currentPageTooLargeForSuperResolution/);
});

test('Reader super-resolution processes only visible pages and preserves original fallback', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /createSuperResolutionRuntime\(\)/);
  assert.match(reader, /runtime\.init\(srManifest\)/);
  assert.match(reader, /processSuperResolutionImageSource\(src, \{/);
  assert.match(reader, /source = src;[\s\S]{0,180}processSuperResolutionImageSource/);
  assert.match(reader, /commitPageImage\(originalResolved, originalDecoded,[\s\S]{0,800}processSuperResolutionImageSource/);
  assert.match(reader, /commitImmersiveImage\(originalDecoded,[\s\S]{0,240}startSuperResolutionUpgrade/);
  assert.match(reader, /keepAlive: true/);
  assert.match(reader, /loadSpread\(\[imgCurrRef, imgCurrSecondRef\], activeSpread,[^\n]+true, getSuperResolutionForPage\)/);
  assert.doesNotMatch(reader, /loadSpread\(\[img(?:Left|Right)Ref,[^\n]+activeSuperResolution/);
  assert.match(reader, /function getSuperResolutionForPage\(pageIndex\)/);
  assert.match(reader, /superResolution=\{getSuperResolutionForPage\(index\)\}/);
  assert.doesNotMatch(reader, /superResolution=\{index === currentIndex \? activeSuperResolution : null\}/);
  assert.match(reader, /decodeTickets\.forEach\(\(ticket\) => ticket\.cancel\(\)\)/);
});

test('Reader snapshots do not persist immersive mode or image transforms', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.doesNotMatch(reader, /viewMode: viewModeSnapshotRef\.current/);
  assert.doesNotMatch(reader, /showHeader:/);
  assert.doesNotMatch(reader, /zoomScale: zoomScaleRef\.current/);
  assert.doesNotMatch(reader, /panX: panRef\.current\.x/);
  assert.doesNotMatch(reader, /panY: panRef\.current\.y/);
  assert.match(reader, /const \[viewMode, setViewMode\] = useState\('normal'\)/);
  assert.match(reader, /const \[zoomScale, setZoomScale\] = useState\(1\.0\)/);
  assert.match(reader, /const \[panX, setPanX\] = useState\(0\)/);
  assert.match(reader, /const \[panY, setPanY\] = useState\(0\)/);
});

test('Reader reuses derived image cache entries and cancels adjacent super-resolution preloads', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /import \{[^}]*putImage[^}]*\} from '\.\.\/lib\/imageCache';/s);
  assert.match(reader, /getSuperResolutionCacheKey/);
  assert.match(reader, /cacheKey:\s*getSuperResolutionCacheKey\(/);
  assert.match(reader, /getCachedSource:\s*getCachedImage/);
  assert.match(reader, /cacheResult:\s*putImage/);
  assert.match(reader, /for \(const idx of indices\.slice\(0, settings\.preloadCount\)\)[\s\S]*ticket = scheduleSuperResolutionPreload\([\s\S]*await ticket\.promise/);
  assert.match(reader, /function scheduleSuperResolutionPreload[\s\S]*readerImageDecodeQueue\.schedule\([\s\S]*IMAGE_LOAD_PRIORITY\.PRELOAD/);
  assert.match(reader, /cancelled = true;\s*ticket\?\.cancel\(\)/);
  assert.doesNotMatch(reader, /indices\.slice\(0, settings\.preloadCount\)\.map\(/);
});

test('Reader preview decoding uses super-resolution output dimensions', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /sourceSize: pendingSuperResolutionSource \|\| sourceSize/);
  assert.match(reader, /sourceSize: superResolutionSource,/);
});

test('Reader disposes immersive super-resolution URLs after image refs detach', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /const immersiveSuperResolutionSourceRegistryRef = useRef\(new Set\(\)\)/);
  assert.match(reader, /registry\?\.add\(source\)/);
  assert.match(reader, /registry\?\.delete\(previous\)/);
  assert.match(reader, /disposeImmersiveSuperResolutionSources\(immersiveSuperResolutionSourceRegistryRef\.current\)/);
});

test('Reader silently falls back for unsupported super-resolution images', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /if \(error\?\.name === 'NotSupportedError'\) return;/);
});

test('build and proxy hardening are reproducible', () => {
  const app = read('src/App.jsx');
  const vite = read('vite.config.js');
  const workflow = read('.github/workflows/mobile-build.yml');
  assert.match(app, /import React, \{ lazy, Suspense,/);
  for (const page of ['Reader', 'Home', 'HistoryPage', 'WatchlistPage', 'DeduplicatePage', 'MetadataPage', 'UploadPage']) {
    assert.match(app, new RegExp(`const ${page} = lazy\\(\\(\\) => import\\('\\./pages/${page}'\\)\\);`));
    assert.doesNotMatch(app, new RegExp(`import ${page} from '\\./pages/${page}'`));
  }
  assert.match(app, /<Suspense fallback=\{getRouteFallback\(route\)\}>/);
  assert.doesNotMatch(vite, /secure:\s*false/);
  assert.doesNotMatch(vite, /wildcards/);
  assert.match(vite, /VITE_LRR_PROXY_TARGET/);
  assert.match(workflow, /npm ci --no-audit --no-fund/);
  assert.equal(fs.existsSync(new URL('../package-lock.json', import.meta.url)), true);
});

test('Docker publish runs only when runtime image inputs change', () => {
  const workflow = read('.github/workflows/docker-publish.yml');
  assert.match(workflow, /push:[\s\S]*paths:/);
  assert.doesNotMatch(workflow, /paths-ignore:/);
  for (const input of [
    'src/**',
    'public/**',
    'scripts/app-version.mjs',
    'index.html',
    'package.json',
    'package-lock.json',
    'vite.config.js',
    'Dockerfile',
    '.dockerignore',
    'docker-entrypoint.sh',
    'nginx.conf.template',
  ]) {
    assert.equal(workflow.includes(`- '${input}'`), true, `missing Docker input path: ${input}`);
  }
  assert.doesNotMatch(workflow, /- 'tests\/\*\*'/);
  assert.doesNotMatch(workflow, /- 'worker\.js'/);
});

test('login import feedback stays outside the height-limited form and expires', () => {
  const app = read('src/App.jsx');
  const main = read('src/main.jsx');
  assert.match(app, /showToast\(err\.message \|\| '无法连接到服务器/);
  assert.match(app, /showToast\(`已导入 \$\{count\} 项配置`, 'success'\)/);
  assert.match(main, /<ToastProvider>/);
});

test('archive grids use native flex wrapping with shared card sizing', () => {
  const css = read('src/index.css');
  const home = read('src/pages/Home.jsx');
  const history = read('src/pages/HistoryPage.jsx');
  const watchlist = read('src/pages/WatchlistPage.jsx');
  const grid = read('src/components/ArchiveGrid.jsx');
  const pagination = read('src/lib/archivePagination.js');
  assert.match(css, /\.archive-grid\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*center;/s);
  assert.match(css, /\.archive-grid\s*>\s*\.archive-card-wrap\.is-wide\s*\{[^}]*flex:\s*0\s+1\s+var\(--archive-wide-card-width,\s*316px\);[^}]*width:\s*min\(var\(--archive-wide-card-width,\s*316px\),\s*100%\);[^}]*max-width:\s*100%;/s);
  assert.match(css, /\.archive-grid\s*>\s*\.archive-card-wrap\.is-wide\s*>\s*\.archive-card-shell\s*\{[^}]*width:\s*100%\s*!important;/s);
  assert.doesNotMatch(css, /grid-auto-flow/);
  assert.doesNotMatch(css, /grid-column:\s*span 2/);
  assert.doesNotMatch(grid, /observeArchiveGridLayout/);
  assert.doesNotMatch(pagination, /observeArchiveGridLayout/);
  assert.match(home, /<ArchiveGrid/);
  assert.match(history, /<ArchiveGrid/);
  assert.match(watchlist, /<ArchiveGrid/);
});

test('home uses its 720px tablet breakpoint for archive spacing and pagination', () => {
  const home = read('src/pages/Home.jsx');

  assert.match(home, /const HOME_NARROW_MAX_WIDTH = 720;/);
  assert.equal(
    (home.match(/window\.innerWidth <= HOME_NARROW_MAX_WIDTH/g) || []).length,
    3,
  );
  assert.doesNotMatch(home, /window\.innerWidth < 600/);
});

test('history page header has ordered narrow-screen layout hooks', () => {
  const css = read('src/index.css');
  const historyTokens = read('src/styles/tokens.css');
  const history = read('src/pages/HistoryPage.jsx');
  const watchlist = read('src/pages/WatchlistPage.jsx');

  assert.match(history, /className="history-page page-workspace"/);
  assert.match(history, /className="history-page-header page-header"/);
  assert.match(history, /className="history-page-title-block"/);
  assert.match(history, /className="history-page-title-row"/);
  assert.match(history, /className="history-section-header archive-toolbar"/);
  assert.match(history, /className="history-section-actions"/);
  assert.match(history, /className="history-section-toolbar"/);
  assert.doesNotMatch(history, /className="history-hide-read-toggle"/);
  assert.doesNotMatch(history, /handleToggleHideRead|setHideRead\(/);
  assert.match(history, /className="history-summary-part"/);
  assert.match(history, /className="history-page-actions"/);
  assert.ok(history.indexOf('className="history-page-title"') < history.indexOf('className="history-page-summary page-summary"'));
  assert.ok(history.indexOf('className="history-section-actions"') < history.indexOf('className="history-section-toolbar"'));
  assert.ok(history.indexOf('className="history-section-toolbar"') < history.indexOf('<ArchiveSearchBox'));
  assert.match(watchlist, /className="history-page watchlist-page page-workspace"/);
  assert.match(watchlist, /className="history-page-title-row"/);
  assert.match(watchlist, /className="history-page-actions"/);
  assert.match(watchlist, /className="history-section-header archive-toolbar"/);
  assert.match(watchlist, /className="history-section-actions"/);
  assert.match(css, /\.history-page-header\s*\{/);
  assert.match(css, /\.history-page-actions\s*\{/);
  assert.match(css, /\.history-page-title-row\s*\{/);
  assert.match(css, /\.history-section-header\s*\{/);
  assert.match(css, /\.history-section-actions\s*\{/);
  assert.match(css, /\.history-section-toolbar\s*\{/);
  assert.match(css, /\.history-summary-part\s*\{/);
  assert.doesNotMatch(css, /\.history-hide-read-toggle/);
  assert.match(css, /\.history-page-summary\s*\{[\s\S]*font-family:\s*'Noto Sans SC Variable', system-ui, sans-serif;[\s\S]*font-size:\s*12px;[\s\S]*font-synthesis:\s*none;[\s\S]*font-variant-numeric:\s*tabular-nums;[\s\S]*font-weight:\s*520;[\s\S]*line-height:\s*1\.35;[\s\S]*background:\s*var\(--surface-subtle\);[\s\S]*border:\s*1px solid var\(--border-subtle\);[\s\S]*border-radius:\s*var\(--radius-xs\);/s);
  assert.match(historyTokens, /--surface-subtle:/);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-page-header\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*stretch;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-page-title-row\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*auto\)\s+minmax\(0,\s*1fr\);[\s\S]*align-items:\s*center;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-page-summary\s*\{[\s\S]*justify-self:\s*end;[\s\S]*text-align:\s*right;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-summary-part\s*\{[\s\S]*display:\s*block;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-page-actions\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*wrap;[\s\S]*justify-content:\s*flex-start;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-section-header\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-page-actions \.btn\s*\{[\s\S]*width:\s*auto;[\s\S]*flex:\s*1 1 calc\(\(100% - 20px\) \/ 3\);[\s\S]*font-size:\s*13px;[\s\S]*text-align:\s*center;/s);
});

test('home archive toolbar count is styled and empty cold restore fetches archives', () => {
  const home = read('src/pages/Home.jsx');
  const css = read('src/index.css');

  assert.match(home, /className="archive-count-badge"/);
  assert.match(home, /className="archive-toolbar-actions"/);
  assert.match(home, /className="archive-toolbar-summary"[\s\S]*alignItems:\s*'center'/);
  assert.match(home, /const hasHydratedArchives = homeSnapshot && Array\.isArray\(homeSnapshot\.archives\) && homeSnapshot\.archives\.length > 0;/);
  assert.match(home, /if \(coldRestoreRef\.current && hasHydratedArchives\) return;/);
  assert.match(home, /if \(!archiveCatalogDirty && navigationRestoreRef\.current && hasHydratedArchives\)/);
  assert.match(css, /\.archive-count-badge\s*\{[\s\S]*font-family:\s*'Noto Sans SC Variable', system-ui, sans-serif;[\s\S]*font-size:\s*12px;[\s\S]*font-synthesis:\s*none;[\s\S]*font-variant-numeric:\s*tabular-nums;[\s\S]*font-weight:\s*520;[\s\S]*line-height:\s*1\.35;[\s\S]*background:\s*var\(--surface-subtle\);[\s\S]*border:\s*1px solid var\(--border-subtle\);[\s\S]*border-radius:\s*999px;/s);
  assert.match(css, /\.archive-toolbar-summary h2,[\s\S]*\.archive-toolbar-summary h2 > span\s*\{[\s\S]*white-space:\s*nowrap;/s);
});

test('archive title uses one cross-platform two-line geometry contract', () => {
  const card = read('src/components/ArchiveCard.jsx');
  const layout = read('src/lib/archiveGridLayout.js');
  const workflow = read('.github/workflows/mobile-build.yml');
  assert.match(layout, /export const ARCHIVE_CARD_TITLE_GAP = 8;/);
  assert.match(layout, /export const ARCHIVE_CARD_TITLE_SLOT_HEIGHT = 43\.7;/);
  assert.match(card, /const ARCHIVE_TITLE_FONT_SIZE = 13;/);
  assert.match(card, /const ARCHIVE_TITLE_LINE_HEIGHT = 1\.5;/);
  assert.match(card, /const ARCHIVE_TITLE_GLYPH_SAFETY_PX = 3;/);
  assert.match(card, /height:\s*`\$\{ARCHIVE_CARD_TITLE_SLOT_HEIGHT\}px`/);
  assert.match(card, /WebkitLineClamp:\s*2/);
  assert.match(card, /height:\s*'3em'/);
  assert.match(card, /paddingBottom:\s*`\$\{ARCHIVE_TITLE_GLYPH_SAFETY_PX\}px`/);
  assert.match(card, /boxSizing:\s*'content-box'/);
  assert.doesNotMatch(card, /document\.createRange\(\)/);
  assert.doesNotMatch(card, /titleLayoutIndex|titleMeasurementKeyRef|fontRevision/);
  assert.match(workflow, /getWebView\(\)\.getSettings\(\)\.setTextZoom\(100\)/);
});

test('mobile wrapper sends system back through web history before exiting', () => {
  const workflow = read('.github/workflows/mobile-build.yml');

  assert.match(workflow, /import androidx\.activity\.OnBackPressedCallback;/);
  assert.match(workflow, /import android\.os\.Build;/);
  assert.match(workflow, /import android\.window\.OnBackInvokedDispatcher;/);
  assert.match(workflow, /getOnBackInvokedDispatcher\(\)\.registerOnBackInvokedCallback/);
  assert.match(workflow, /getOnBackPressedDispatcher\(\)\.addCallback\(this, new OnBackPressedCallback\(true\)/);
  assert.match(workflow, /webView\.canGoBack\(\)/);
  assert.match(workflow, /window\.history\.length > 1/);
  assert.match(workflow, /webView\.goBack\(\)/);
  assert.match(workflow, /android:enableOnBackInvokedCallback="true"/);
  assert.match(workflow, /finish\(\);/);
});

test('iOS wrapper sends the left-edge gesture through web history', () => {
  const workflow = read('.github/workflows/mobile-build.yml');

  assert.match(workflow, /ios\/App\/App\/AppDelegate\.swift/);
  assert.match(workflow, /class ViewController: CAPBridgeViewController/);
  assert.match(workflow, /appDelegatePath/);
  assert.doesNotMatch(workflow, /const viewControllerPath = 'ios\/App\/App\/ViewController\.swift'/);
  assert.match(workflow, /UIScreenEdgePanGestureRecognizer/);
  assert.match(workflow, /backGesture\.edges = \.left/);
  assert.match(workflow, /guard let webView = bridge\?\.webView else \{ return \}/);
  assert.match(workflow, /if webView\.canGoBack/);
  assert.match(workflow, /webView\.goBack\(\)/);
  assert.match(workflow, /window\.history\.length > 1/);
  assert.match(workflow, /Main\.storyboard/);
  assert.match(workflow, /customClass="ViewController"/);
});

test('mobile settings respect safe areas and reveal animations release compositor layers', () => {
  const home = read('src/pages/Home.jsx');
  const css = read('src/index.css');
  const primitives = read('src/styles/primitives.css');
  const customSelect = read('src/components/CustomSelect.jsx');

  assert.match(home, /className="settings-overlay"/);
  assert.match(home, /className="glass-panel settings-panel"/);
  assert.match(css, /\.settings-panel\s*\{[^}]*max-height:\s*100%;/s);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.settings-overlay\s*\{[\s\S]*padding-top:\s*max\(24px,\s*calc\(var\(--app-safe-area-top\) \+ 16px\)\);/s);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.settings-overlay\s*\{[\s\S]*padding-bottom:\s*max\(24px,\s*calc\(var\(--app-safe-area-bottom\) \+ 16px\)\);/s);
  assert.match(css, /\.settings-control\s*\{[^}]*flex:\s*0 0 148px;[^}]*width:\s*148px;/s);
  assert.match(customSelect, /className="field custom-select-trigger"/);
  assert.match(primitives, /\.custom-select-trigger\s*\{[^}]*display:\s*flex;[^}]*gap:\s*8px;/s);
  assert.match(primitives, /\.custom-select-value\s*\{[^}]*flex:\s*1;[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;/s);
  assert.match(css, /@keyframes sectionReveal\s*\{[\s\S]*to\s*\{[^}]*transform:\s*none;/s);
});

test('fullscreen application panels keep their controls outside system bars', () => {
  const reader = read('src/pages/Reader.jsx');
  const css = read('src/index.css');

  assert.match(reader, /createPortal/);
  assert.match(reader, /createPortal\([\s\S]*reader-thumbnail-drawer-overlay[\s\S]*document\.body\)/s);
  assert.match(reader, /className="reader-thumbnail-drawer-overlay"/);
  assert.match(reader, /className="reader-panel-surface reader-thumbnail-drawer-panel"/);
  assert.match(reader, /data-side=\{drawerSide\}/);
  assert.match(read('src/styles/tokens.css'), /--app-safe-area-top:\s*var\(--lrr-android-safe-top,\s*env\(safe-area-inset-top,\s*0px\)\);/);
  assert.match(css, /\.reader-thumbnail-drawer-panel\s*\{[^}]*padding-top:\s*calc\(24px \+ var\(--app-safe-area-top\)\);[^}]*padding-bottom:\s*calc\(24px \+ var\(--app-safe-area-bottom\)\);/s);
  assert.match(css, /\.reader-thumbnail-drawer-panel\[data-side="left"\]\s*\{[^}]*padding-left:\s*calc\(24px \+ var\(--app-safe-area-left\)\);/s);
  assert.match(css, /\.reader-thumbnail-drawer-panel\[data-side="right"\]\s*\{[^}]*padding-right:\s*calc\(24px \+ var\(--app-safe-area-right\)\);/s);
  assert.match(css, /\.settings-overlay\s*\{[^}]*padding-top:\s*max\(16px,\s*calc\(var\(--app-safe-area-top\) \+ 16px\)\);/s);
  assert.match(css, /\.confirm-dialog-overlay\s*\{[^}]*padding-top:\s*max\(20px,\s*calc\(var\(--app-safe-area-top\) \+ 20px\)\);/s);
  assert.match(css, /\.metadata-loading-state\s*\{[^}]*padding-top:\s*max\(24px,\s*calc\(var\(--app-safe-area-top\) \+ 24px\)\);/s);
});

test('immersive touch trigger consumes synthetic follow-up clicks', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /const IMMERSIVE_TOUCH_ACTIVATION_GUARD_MS\s*=\s*\d+;/);
  assert.match(reader, /immersiveTouchGuardUntilRef\.current\s*=\s*Date\.now\(\)\s*\+\s*IMMERSIVE_TOUCH_ACTIVATION_GUARD_MS/);
  assert.match(reader, /onTouchStart=\{\(event\) => \{ event\.stopPropagation\(\); armImmersiveTouchGuard\(\); revealImmersiveControls\('left'\); \}\}/);
  assert.match(reader, /onTouchStart=\{\(event\) => \{ event\.stopPropagation\(\); armImmersiveTouchGuard\(\); revealImmersiveControls\('right'\); \}\}/);
  assert.match(reader, /className="reader-immersive-trigger reader-immersive-trigger-left"[\s\S]*onTouchStart=\{\(event\) => \{[\s\S]*armImmersiveTouchGuard\(\)[\s\S]*revealImmersiveControls\('left'\)/s);
  assert.match(reader, /className="reader-immersive-trigger reader-immersive-trigger-right"[\s\S]*onTouchStart=\{\(event\) => \{[\s\S]*armImmersiveTouchGuard\(\)[\s\S]*revealImmersiveControls\('right'\)/s);
  assert.match(reader, /className="reader-immersive-controls"[\s\S]*onClickCapture=\{consumeImmersiveTouchClick\}/s);
});

test('hidden immersive controls use inert instead of hiding focused descendants', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /className="reader-immersive-controls"[\s\S]*inert=\{immersiveControlsSide === side \? undefined : ''\}/s);
  assert.doesNotMatch(reader, /aria-hidden=\{immersiveControlsSide === side \? 'false' : 'true'\}/);
});

test('immersive controls have a visible closing animation', () => {
  const css = read('src/index.css');
  assert.match(css, /\.reader-immersive-controls\s*\{[^}]*transition:\s*opacity 0\.26s ease, transform 0\.34s[^;]*, visibility 0s linear 0\.34s;/s);
  assert.match(css, /\.reader-immersive-control-button\s*\{[^}]*opacity 0\.28s ease;/s);
});

test('reader overlays do not mutate background geometry and settings use remaining viewport', () => {
  const reader = read('src/pages/Reader.jsx');
  const select = read('src/components/CustomSelect.jsx');

  assert.doesNotMatch(reader, /if \(showDrawer\)\s*\{\s*return acquireBodyScrollLock\(\);/s);
  assert.match(reader, /className="reader-thumbnail-drawer-overlay"[\s\S]*overscrollBehavior:\s*'contain'/s);
  assert.match(reader, /className="reader-thumbnail-drawer-backdrop"[\s\S]*touchAction:\s*'none'[\s\S]*onClick=\{closeThumbnailDrawer\}/s);
  assert.match(reader, /showSettingsPanel\s*&&\s*createPortal\(/s);
  assert.match(reader, /const settingsPanelTop = Math\.ceil\(toolbarRef\.current\?\.getBoundingClientRect\(\)\.bottom \|\| 0\)/);
  assert.match(reader, /data-panel="settings"[\s\S]*position:\s*'fixed'[\s\S]*top:\s*`\$\{settingsPanelTop \+ 8\}px`[\s\S]*maxHeight:\s*`calc\(100dvh - \$\{settingsPanelTop \+ 8\}px - max\(12px, calc\(var\(--app-safe-area-bottom\) \+ 8px\)\)\)`/s);
  assert.match(reader, /showArchivePanel\s*&&\s*createPortal\(/s);
  assert.match(reader, /<ReaderArchiveListPanel[\s\S]*top=\{settingsPanelTop \+ 8\}/s);
  assert.match(reader, /data-panel=\{type\}[\s\S]*position:\s*'fixed'[\s\S]*top:\s*`\$\{top\}px`[\s\S]*maxHeight:\s*`calc\(100dvh - \$\{top\}px - max\(12px, calc\(var\(--app-safe-area-bottom\) \+ 8px\)\)\)`/s);
  assert.doesNotMatch(reader, /data-panel="settings"[\s\S]{0,500}bottom:\s*'max\(12px, calc\(var\(--app-safe-area-bottom\) \+ 8px\)\)'/s);
  assert.match(reader, /READER_OVERLAY_SCROLL_SELECTOR\s*=\s*'\[data-reader-overlay-scroll\], \[data-select-dropdown="true"\]'/);
  assert.match(reader, /document\.addEventListener\('wheel', containReaderOverlayScroll, \{ capture: true, passive: false \}\)/);
  assert.match(reader, /document\.addEventListener\('touchmove', containReaderOverlayScroll, \{ capture: true, passive: false \}\)/);
  assert.ok((reader.match(/data-reader-overlay-scroll/g) || []).length >= 4);
  assert.match(select, /data-select-dropdown="true"/);
  assert.match(read('src/styles/primitives.css'), /\.custom-select-list\s*\{[^}]*overscroll-behavior:\s*contain;[^}]*touch-action:\s*pan-y;/s);
});

test('configuration transfer warning and settings layers stay concise and isolated', () => {
  const dialog = read('src/components/ConfigTransferDialog.jsx');
  const home = read('src/pages/Home.jsx');
  const css = read('src/index.css');
  assert.match(dialog, /警告：请勿分享或导入他人配置！/);
  assert.doesNotMatch(dialog, /Base64 编码，不是加密/);
  assert.doesNotMatch(dialog, /message=\{isExport/);
  assert.match(dialog, /className="config-transfer-warning"/);
  assert.match(css, /\.confirm-dialog-title\s*\{[^}]*text-align:\s*center;/s);
  assert.doesNotMatch(css, /\.confirm-dialog:has\(\.config-transfer-field\)\s+\.confirm-dialog-title/);
  assert.match(css, /\.config-transfer-warning\s*\{[^}]*background:[^}]*text-align:\s*center;/s);
  assert.match(home, /className="settings-panel-footer"/);
  assert.match(css, /\.settings-panel-footer\s*\{[^}]*flex:\s*0 0 auto;[^}]*background:/s);
});

test('progress regression is configured only from the general settings section', () => {
  const home = read('src/pages/Home.jsx');
  const reader = read('src/pages/Reader.jsx');
  const cacheSettings = read('src/components/CacheSettings.jsx');
  const css = read('src/index.css');

  assert.match(home, /\[['"]general['"], ['"]通用['"]\],\s*\[['"]worker['"], ['"]Worker['"]\],\s*\[['"]palette['"], ['"]配色['"]\],\s*\[['"]tools['"], ['"]工具['"]\]/s);
  assert.doesNotMatch(home, /\[\s*['"]transfer['"],\s*['"]导入导出['"]\]/);
  assert.doesNotMatch(home, />缓存<|>档案显示<|>浏览与记录<|>E-Hentai 评论区<|>Worker 设置<|>导入导出</);
  assert.doesNotMatch(home, /\[\s*['"]archives['"],\s*['"]档案['"]\]/);
  assert.doesNotMatch(cacheSettings, /允许阅读进度回溯|通用设置/);
  assert.match(home, /allowProgressRegression: checked/);
  assert.match(home, /className="settings-control"/);
  assert.match(home, /className="settings-control settings-toggle-control"/);
  assert.match(css, /\.settings-control\s*\{[^}]*width:\s*148px/s);
  assert.match(css, /\.settings-toggle-control\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.doesNotMatch(reader, />允许阅读进度回溯</);
});

test('random hide-read setting filters Home and Reader quick-jump through one helper', () => {
  const home = read('src/pages/Home.jsx');
  const reader = read('src/pages/Reader.jsx');
  assert.match(home, /随机漫游中隐藏已读完/);
  assert.match(home, /filterRandomArchives/);
  assert.match(reader, /filterRandomArchives/);
});

test('history list is the only persisted reading progress source', () => {
  const history = read('src/lib/history.js');
  const progressHelpers = read('src/lib/historyProgressCache.js');
  const archiveActions = read('src/lib/archiveProgressActions.js');
  const metadata = read('src/lib/archiveMetadataCache.js');
  const recommendations = read('src/components/Recommendations.jsx');
  for (const source of [history, progressHelpers, archiveActions]) {
    assert.doesNotMatch(source, /HISTORY_PROGRESS_CACHE_KEY|historyProgressCacheKey|readHistoryProgressCache|writeHistoryProgressCache|mergeCachedHistoryProgress|mergeHistoryProgressCache|purgeHistoryProgress/);
  }
  assert.match(metadata, /progress:\s*Number\(record\.page\) \|\| 0/);
  assert.match(recommendations, /delete sanitized\.page;[\s\S]*delete sanitized\.progress;/);
  assert.match(recommendations, /applyCanonicalHistoryProgress/);
});

test('archive mutations synchronize catalog and short search caches after success', () => {
  const deletion = read('src/lib/archiveDeletion.js');
  const metadataPage = read('src/pages/MetadataPage.jsx');
  const uploadPage = read('src/pages/UploadPage.jsx');
  const progressActions = read('src/lib/archiveProgressActions.js');
  const reader = read('src/pages/Reader.jsx');

  assert.match(deletion, /archiveOperation:\s*async \(\) =>\s*assertArchiveDeletionResult\(await lrrApi\.deleteArchive\(archiveId\)\)[\s\S]{0,500}removeArchivesFromCatalog\(archiveId\);[\s\S]{0,200}clearArchiveSearchResponseCache\(\);/);
  assert.match(metadataPage, /await lrrApi\.updateArchiveMetadata[\s\S]{0,500}rememberArchiveInCatalog\([\s\S]{0,200}markArchiveCatalogDirty\(\)/);
  assert.match(uploadPage, /const uploadResults = await runUploadTasks[\s\S]{0,600}uploadResults\.some[\s\S]{0,200}markArchiveCatalogDirty\(\)/);
  assert.match(progressActions, /rememberArchiveProgressInCatalog\(id, result\.page/);
  assert.match(reader, /await lrrApi\.updateProgress\(id, targetPage[\s\S]{0,300}rememberArchiveProgressInCatalog\(id, targetPage/);
  assert.doesNotMatch(progressActions, /clearArchiveSearchResponseCache|clearSearchCache/);
});

test('upload results use per-task progress and expose the archive context menu after success', () => {
  const uploadPage = read('src/pages/UploadPage.jsx');
  assert.match(uploadPage, /lrrApi\.uploadArchive\(task\.file, \{ onProgress: updateProgress \}\)/);
  assert.match(uploadPage, /archiveFromUploadResponse\(update\.value, item\.label\)/);
  assert.match(uploadPage, /onContextMenu=\{\(event\) => handleTaskContextMenu\(event, item\)\}/);
  assert.match(uploadPage, /<ArchiveContextMenu[\s\S]*onRead=\{\(archive, options\) => navigateToArchive/);
  assert.match(uploadPage, /onEditMetadata=\{\(archive, options\) => navigateToMetadata/);
  assert.match(uploadPage, /onDelete=\{\(archive\) => \{ setArchiveDeleteSyncConfirmed\(true\); setArchiveDeleteTarget\(archive\); \}\}/);
});

test('server-derived recommendation caches are scoped and the retired sync module is gone', () => {
  const home = read('src/pages/Home.jsx');
  const recommendations = read('src/components/Recommendations.jsx');
  assert.match(home, /migrateLegacyStorageKey\(RANDOMS_RECENT_KEY\)/);
  assert.match(recommendations, /scopedStorageKey\(`lrr_rec_cache_v3_/);
  assert.equal(fs.existsSync(new URL('../src/lib/sync.js', import.meta.url)), false);
});

test('home carousels use compact shared vertical padding', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /function getHomeCarouselPadding\(isNarrow\)\s*\{\s*return `12px \$\{isNarrow \? 14 : 20\}px 20px`;/s);
  assert.doesNotMatch(home, /HOME_CAROUSEL_GLOW_PADDING|44px/);
});

test('watchlist glow stays inside compact carousel padding', () => {
  const css = read('src/index.css');
  const glowStart = css.indexOf('.watchlist-card:not(.watchlist-card-plain) .archive-card-shell');
  const glowEnd = css.indexOf('.archive-cover-image', glowStart);
  const glowCss = css.slice(glowStart, glowEnd);

  assert.match(glowCss, /inset 0 0 0 1px/);
  assert.match(glowCss, /:hover[\s\S]*inset 0 0 0 2px/);
  assert.doesNotMatch(glowCss, /inset 0 0 8px|inset 0 0 10px/);
  assert.doesNotMatch(glowCss, /^ {4}(?!inset\s)[^\n]*0 0 \d+px/gm);
  assert.doesNotMatch(glowCss, /\.archive-card-shell::before/);
  assert.doesNotMatch(glowCss, /var\(--shadow\)/);
});

test('archive cards never paint shadows outside their rounded bounds', () => {
  const css = read('src/index.css');
  const card = read('src/components/ArchiveCard.jsx');
  assert.match(css, /\.archive-card-shell\s*\{[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.archive-card-shell\.is-selected\s*\{[^}]*box-shadow:\s*inset/s);
  assert.doesNotMatch(css, /\.archive-card-shell\.is-selected\s*\{[^}]*\n\s*(?!inset)0 \d+px \d+px/s);
  assert.doesNotMatch(card, /boxShadow:\s*isPanelVisible/);
});

test('image cache falls back to IndexedDB when Cache Storage is unavailable', () => {
  const cache = read('src/lib/imageCache.js');
  const index = read('src/lib/imageCacheIndex.js');
  assert.match(index, /const BLOB_STORE = 'blobs'/);
  assert.match(index, /putBlob\(key, blob\)/);
  assert.match(index, /getBlob\(key\)/);
  assert.match(cache, /imageCacheIndex\.putBlob\(key, blob\)/);
  assert.match(cache, /imageCacheIndex\.getBlob\(key\)/);
  assert.match(cache, /typeof caches === 'undefined'/);
});

test('drawer overview owns archive size and disables scroll anchoring', () => {
  const reader = read('src/pages/Reader.jsx');
  const thumbnail = read('src/components/ArchivePageThumbnail.jsx');
  assert.doesNotMatch(reader, /reader-archive-summary/);
  assert.match(reader, /页面总览 · 共\{pages\.length\}页\{archiveSizeLabel \? ` · \$\{archiveSizeLabel\}` : ''\}/);
  assert.match(reader, /overflowAnchor: 'none'/);
  assert.match(reader, /import ArchivePageThumbnail from '..\/components\/ArchivePageThumbnail'/);
  assert.match(reader, /<ArchivePageThumbnail archiveId=\{archiveId\}/);
  assert.match(thumbnail, /thumb:drawer:v3:\$\{archiveId\}:\$\{page\}/);
  assert.match(thumbnail, /waitForMinionJob\(jobId, \{ timeoutMs: 2 \* 60 \* 1000 \}\)/);
  assert.match(thumbnail, /result\.status === 202/);
});

test('archive tag panel follows cards inside horizontal scrollers and closes offscreen', () => {
  const card = read('src/components/ArchiveCard.jsx');
  assert.match(card, /panelRef\.current[\s\S]*scrollTarget instanceof Node[\s\S]*panelRef\.current\.contains\(scrollTarget\)[\s\S]*return;/);
  assert.match(card, /scrollTarget\.contains\(cardRef\.current\)/);
  assert.match(card, /isOutsideHorizontalViewport\(rect, scrollTarget\.getBoundingClientRect\(\)\)/);
  assert.match(card, /updatePanelPosition\(\)/);
});

test('touch cards open tags outside the cover while pointer devices keep click navigation', () => {
  const card = read('src/components/ArchiveCard.jsx');
  assert.match(card, /const \[hasTouchInteraction/);
  assert.match(card, /touchInteractionRef\.current = nextTouchInteraction/);
  assert.match(card, /if \(touchInteractionRef\.current\)\s*\{[\s\S]*setMobilePanelOpen/);
  assert.match(card, /handleCoverClick/);
  assert.match(card, /if \(!touchInteractionRef\.current\) activateArchive\(e\)/);
});

test('Reader sizes panels by viewport and opens the thumbnail drawer from its trigger side', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /const \[drawerSide, setDrawerSide\] = useState\('right'\)/);
  assert.match(reader, /const openThumbnailDrawer = useCallback/);
  assert.match(reader, /setShowDrawer\(false\);[\s\S]*setTimeout\([\s\S]*DRAWER_TRANSITION_MS/s);
  assert.match(reader, /setDrawerSide\(side\);[\s\S]*requestAnimationFrame\(\(\) => setShowDrawer\(true\)\)/s);
  assert.doesNotMatch(reader, /onClick=\{\(\) => \{[^}]*setDrawerSide\(/);
  assert.equal((reader.match(/openThumbnailDrawer\(/g) || []).length >= 2, true);
  assert.match(reader, /width:\s*'min\(440px, calc\(100vw - 32px\)\)'/);
  assert.match(reader, /justifyContent:\s*drawerSide === 'left' \? 'flex-start' : 'flex-end'/);
  assert.match(reader, /translate3d\(\$\{drawerSide === 'left' \? '-100%' : '100%'\},0,0\)/);
  assert.doesNotMatch(reader, /indicatorEl\.addEventListener\('transitionend'/);
  assert.doesNotMatch(reader, /ro\.observe\(indicatorEl\)/);
});

test('bundled variable CJK fonts use swap and language-aware title selection', () => {
  const pkg = JSON.parse(read('package.json'));
  const main = read('src/main.jsx');
  const css = read('src/index.css');
  const card = read('src/components/ArchiveCard.jsx');
  const reader = read('src/pages/Reader.jsx');

  assert.ok(pkg.dependencies['@fontsource-variable/noto-sans-sc']);
  assert.ok(pkg.dependencies['@fontsource-variable/noto-sans-jp']);
  assert.match(main, /@fontsource-variable\/noto-sans-sc\/wght\.css/);
  assert.match(main, /@fontsource-variable\/noto-sans-jp\/wght\.css/);
  assert.match(css, /font-family:\s*'Noto Sans SC Variable'/);
  assert.match(css, /:lang\(ja\)[\s\S]*'Noto Sans JP Variable'/);
  assert.match(card, /lang=\{archiveLanguage\}/);
  assert.match(reader, /lang=\{getContentLanguage\(archive\?\.title\)\}/);
});

test('EH comments are persistent, timeout-safe, and reject stale requests', () => {
  const comments = read('src/components/EhComments.jsx');
  assert.match(comments, /readEhCommentsCache/);
  assert.match(comments, /writeEhCommentsCache/);
  assert.match(comments, /requestSeqRef/);
  assert.match(comments, /requestAbortRef/);
  assert.match(comments, /20 \* 1000/);
  assert.match(comments, /AbortController/);
  assert.doesNotMatch(comments, /const commentsCache = new Map/);
  assert.doesNotMatch(comments, /cacheKey \+ '::api'/);
  assert.doesNotMatch(comments, /autoRetryTimerRef|autoRetryCountRef/);
});

test('Reader sticky flow owns secondary panels and keeps their requests mounted in immersive mode', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /data-reader-normal-flow/);
  assert.match(reader, /data-reader-normal-flow[\s\S]*data-reader-toolbar[\s\S]*data-reader-secondary-content[\s\S]*Thumbnail Drawer/);
  assert.doesNotMatch(reader, /viewMode === 'normal' && secondaryContentReady && archive/);
  assert.match(reader, /data-reader-secondary-content[\s\S]*display:\s*viewMode === 'normal' \? 'block' : 'none'/);
});

test('normal Reader holds old spread geometry until every target slot is decoded', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /getPendingSpreadRenderState/);
  assert.match(reader, /normalSpreadRenderState\.units\.map/);
  assert.match(reader, /slotIndex < normalSpreadRenderState\.visibleSlotCount/);
  assert.match(reader, /handleNormalSpreadUnitReady/);
});

test('Home paginates archive searches without periodic list replacement', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /lrrApi\.search\(query, start,/);
  assert.equal(/loadArchiveCatalog|getArchiveCatalog|sortArchiveCatalog|sliceArchiveCatalog/.test(home), false);
  assert.doesNotMatch(home, /ARCHIVES_AUTO_REFRESH_MS|ARCHIVES_FOCUS_REFRESH_MS/);
  assert.doesNotMatch(home, /setInterval\(refresh|handleFocusRefresh/);
});

test('Home auto-loads archives and desktop history count badges stay vertically centered', () => {
  const home = read('src/pages/Home.jsx');
  const css = read('src/index.css');

  assert.doesNotMatch(home, /if \(\(filter\.query \|\| ''\)\.trim\(\) && !filter\.active\) return;/);
  assert.match(css, /\.history-page-title-row\s*\{[^}]*align-items:\s*center;/s);
});

test('Worker-dependent controls are hidden without a valid Worker configuration', () => {
  const home = read('src/pages/Home.jsx');
  const history = read('src/pages/HistoryPage.jsx');
  const watchlist = read('src/pages/WatchlistPage.jsx');
  const dedupe = read('src/pages/DeduplicatePage.jsx');
  const reader = read('src/pages/Reader.jsx');
  const ehFavoriteSync = read('src/lib/ehFavoriteSync.js');

  for (const source of [home, history, watchlist, dedupe, reader]) {
    assert.match(source, /hasValidWorkerConfig/);
    assert.match(source, /workerReady/);
  }
  assert.match(home, /\{workerReady && \(\s*<button[\s\S]*?handleSyncHistory/);
  assert.match(history, /\{workerReady && \(\s*<button[\s\S]*?handleSyncHistory/);
  assert.match(watchlist, /\{workerReady && \(\s*<button[\s\S]*?handleSync/);
  assert.match(dedupe, /showWorkerActions=\{workerReady\}/);
  assert.match(dedupe, /if \(workerReady\) \{[\s\S]*?getNonDuplicatePairKeys\(\)/);
  assert.match(reader, /ehWorker=\{workerReady \? getWorkerUrl\(\) : ''\}/);
  assert.match(ehFavoriteSync, /import \{ hasValidWorkerConfig \} from '\.\/worker-config'/);
  assert.match(ehFavoriteSync, /hasValidWorkerConfig\(\)/);
});

test('Home random skeleton ignores stale concurrent refreshes', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /const randomFetchSeqRef = useRef\(0\)/);
  assert.match(home, /const requestSeq = \+\+randomFetchSeqRef\.current/);
  assert.match(home, /requestSeq !== randomFetchSeqRef\.current/);
  assert.match(home, /if \(requestSeq === randomFetchSeqRef\.current\) setRandomsLoading\(false\)/);
  assert.match(home, /if \(requestSeq === randomFetchSeqRef\.current\) setRandomsRefreshing\(false\)/);
});

test('recommendation skeleton ignores stale refresh results', () => {
  const recommendations = read('src/components/Recommendations.jsx');
  assert.match(recommendations, /const recommendationRequestSeqRef = useRef\(0\)/);
  assert.match(recommendations, /const requestSeq = \+\+recommendationRequestSeqRef\.current/);
  assert.match(recommendations, /requestSeq !== recommendationRequestSeqRef\.current/);
  assert.match(recommendations, /if \(requestSeq === recommendationRequestSeqRef\.current\) setLoading\(false\)/);
});

test('EH cookie settings provide a Worker-backed check action', () => {
  const home = read('src/pages/Home.jsx');
  const worker = read('worker.js');
  const css = read('src/index.css');
  assert.match(home, /handleCheckEhCookie/);
  assert.match(home, /\/eh\/check/);
  assert.match(home, /eh-cookie-check-btn/);
  assert.match(home, /data\.cookie && data\.cookie !== cookie/);
  assert.match(home, /useToast/);
  assert.match(home, /showToast\(/);
  assert.match(worker, /url\.pathname === '\/eh\/check'/);
  assert.match(worker, /removeCookieValue\(cookie, 'igneous'\)/);
  assert.match(worker, /writeCookieValue\(cookie, 'igneous', igneous\)/);
  assert.match(css, /\.eh-cookie-input-row\s*\{/);
});

test('scheduled history cleanup force-validates cached records without UI feedback', () => {
  const maintenance = read('src/lib/historyMaintenance.js');
  const watchlist = read('src/lib/watchlist.js');
  const timer = maintenance.match(/export function startHistoryExistenceCheckTimer\(\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(maintenance, /loadHistoryState\(\{ force: true \}\)/);
  assert.match(maintenance, /loadWatchlistState\(\{ force: true \}\)/);
  assert.match(watchlist, /hydrateArchiveRecords\(items, \{ force \}\)/);
  assert.equal((timer.match(/runHistoryExistenceCheck\(\)\.catch\(\(\) => \{\}\)/g) || []).length, 2);
  assert.doesNotMatch(timer, /alert|notice|dialog/i);
});

test('manual history cleanup locks page interactions and reports removed records', () => {
  const history = read('src/pages/HistoryPage.jsx');
  const handler = history.match(/const handleCheckHistory = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';

  assert.match(handler, /setMenu\(null\)/);
  assert.match(handler, /const removed = await runHistoryExistenceCheck\(\{ force: true \}\)/);
  assert.match(handler, /if \(removed > 0\) showToast\(`已清理 \$\{removed\} 条失效记录。`, 'success'\)/);
  assert.match(handler, /catch \(error\)[\s\S]*showToast\(`清理失败：\$\{error\?\.message \|\| '未知错误'\}`, 'error'\)/);
  assert.match(handler, /finally \{\s*setChecking\(false\)/);
  assert.match(history, /onClick=\{handleSyncHistory\}[\s\S]*?disabled=\{syncing \|\| checking\}/);
  assert.match(history, /<section[^>]*inert=\{checking \? '' : undefined\}[^>]*aria-busy=\{checking\}/);
  assert.match(history, /<button className="btn" onClick=\{onBack\}>返回<\/button>/);
});

test('archive multi-select exposes a checkbox indicator and keyboard semantics', () => {
  const card = read('src/components/ArchiveCard.jsx');
  const home = read('src/pages/Home.jsx');
  const css = read('src/index.css');

  assert.match(card, /className=\{`archive-card-selection-checkbox\$\{selected \? ' is-selected' : ''\}`\}/);
  assert.match(card, /className=\{`glass-panel archive-card-shell\$\{selected \? ' is-selected' : ''\}`\}/);
  assert.match(card, /role=\{selectionMode \? 'checkbox' : (?:undefined|'button')\}/);
  assert.match(card, /aria-checked=\{selectionMode \? selected : undefined\}/);
  assert.match(card, /onKeyDown=\{\(event\) => \{/);
  assert.match(card, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(css, /\.archive-card-shell\.is-selected\s*\{[^}]*box-shadow:[^}]*inset 0 0 0/s);
  assert.match(css, /\.archive-card-shell\.is-selected::after\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*border:\s*2px solid var\(--accent\);[^}]*pointer-events:\s*none;/s);
  assert.match(css, /\.archive-card-selection-checkbox\.is-selected\s*\{[^}]*background:\s*var\(--accent\);[^}]*box-shadow:\s*0 0 0 2px var\(--surface\)/s);
  assert.doesNotMatch(css, /\.archive-card-selection-checkbox\.is-selected::after\s*\{[^}]*filter:/s);
  assert.match(home, /className="archive-count-badge archive-selection-count-badge"/);
});

test('archive multi-select action row animates layout from open state', () => {
  const css = read('src/index.css');
  const home = read('src/pages/Home.jsx');

  assert.match(css, /\.archive-selection-actions\s*\{[^}]*transition:\s*grid-template-rows 0\.26s/s);
  assert.match(css, /\.archive-selection-actions\[data-open="true"\]\s*\{[^}]*grid-template-rows:\s*1fr/s);
  assert.doesNotMatch(css, /\.archive-selection-actions\[data-mounted="true"\]\s*\{[^}]*grid-template-rows:\s*1fr/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.archive-selection-actions[\s\S]*?transition:\s*none\s*!important/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.archive-card-selection-checkbox[\s\S]*?transition:\s*none\s*!important/);
  assert.doesNotMatch(home, /archiveSelectionActionsMounted|data-mounted/);
});

test('dedupe operation feedback uses shared progress and failure components', () => {
  const progressUrl = new URL('../src/components/ExecutionProgressPanel.jsx', import.meta.url);
  const failureUrl = new URL('../src/components/ArchiveDeletionFailureDialog.jsx', import.meta.url);

  assert.equal(fs.existsSync(progressUrl), true, 'shared execution progress component is missing');
  assert.equal(fs.existsSync(failureUrl), true, 'shared deletion failure dialog is missing');

  const dedupe = read('src/pages/DeduplicatePage.jsx');
  const progress = fs.readFileSync(progressUrl, 'utf8');
  const failure = fs.readFileSync(failureUrl, 'utf8');
  assert.match(dedupe, /import ExecutionProgressPanel from '\.\.\/components\/ExecutionProgressPanel'/);
  assert.match(dedupe, /import ArchiveDeletionFailureDialog from '\.\.\/components\/ArchiveDeletionFailureDialog'/);
  assert.doesNotMatch(dedupe, /function ExecutionProgressPanel/);
  assert.doesNotMatch(dedupe, /copyEhFailureUrls|copyStatus/);
  assert.match(progress, /dedupe-execution-progress-track/);
  assert.match(failure, /E-Hentai 收藏夹删除失败/);
  assert.match(failure, /LANraragi 删除失败/);
  assert.match(failure, /report\?\.lrrHeading \|\| 'LANraragi 删除失败'/);
  assert.match(failure, /navigator\.clipboard\.writeText/);
});

test('home bulk actions favorite selected archives and report deletion progress', () => {
  const home = read('src/pages/Home.jsx');
  const actions = home.match(/<div className="archive-selection-actions-inner">[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
  const favoriteHandler = home.match(/const handleBulkArchiveFavorite = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
  const deleteHandler = home.match(/const handleBulkArchiveDelete = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';

  assert.match(home, /import \{[^}]*setArchiveFavorite[^}]*\} from '\.\.\/lib\/categories'/);
  assert.match(home, /import ExecutionProgressPanel from '\.\.\/components\/ExecutionProgressPanel'/);
  assert.match(home, /import ArchiveDeletionFailureDialog from '\.\.\/components\/ArchiveDeletionFailureDialog'/);
  assert.match(actions, /全选当前[\s\S]*收藏所选[\s\S]*删除所选/);
  assert.match(favoriteHandler, /for \(const archive of selectedArchiveList\)/);
  assert.match(favoriteHandler, /await setArchiveFavorite\(archiveId, true\)/);
  assert.match(favoriteHandler, /setBulkFavoriteProgress/);
  assert.doesNotMatch(favoriteHandler, /setSelectedArchiveIds/);
  assert.match(deleteHandler, /continueOnFavoriteError:\s*true/);
  assert.match(deleteHandler, /onFavoriteError:/);
  assert.match(deleteHandler, /setBulkDeleteProgress/);
  assert.match(home, /<ExecutionProgressPanel progress=\{bulkDeleteProgress\} \/>/);
  assert.match(home, /dismissOnBackdrop=\{!archiveDeleting\}/);
  assert.match(home, /<ArchiveDeletionFailureDialog/);
});

test('every single archive deletion surface continues after EH failures and reports them', () => {
  const home = read('src/pages/Home.jsx');
  const history = read('src/pages/HistoryPage.jsx');
  const metadata = read('src/pages/MetadataPage.jsx');
  const recommendations = read('src/components/Recommendations.jsx');
  const homeHelper = home.match(/const deleteArchiveWithSync = useCallback\(async \([\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
  const historyHandler = history.match(/const handleArchiveDelete = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
  const metadataHandler = metadata.match(/const handleArchiveDelete = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
  const recommendationHandler = recommendations.match(/const handleArchiveDelete = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';

  for (const source of [homeHelper, historyHandler, metadataHandler, recommendationHandler]) {
    assert.match(source, /continueOnFavoriteError:\s*true/);
    assert.match(source, /onFavoriteError\s*[:,]/);
  }
  for (const source of [home, history, metadata, recommendations]) {
    assert.match(source, /ArchiveDeletionFailureDialog/);
  }
  assert.doesNotMatch(recommendationHandler, /lrrApi\.deleteArchive/);
  assert.match(recommendations, /EhFavoriteDeleteSwitch/);
  assert.match(recommendations, /workerReady && getEhFavoriteDeleteSync\(\)/);
  assert.match(metadata, /if \(deletedWithReport\)[\s\S]*?navigateHome\(\)/);
});

test('archive deletion reports metadata lookup failures before continuing LANraragi deletion', () => {
  const deletion = read('src/lib/archiveDeletion.js');

  assert.match(deletion, /catch \(error\) \{[\s\S]*?onFavoriteError\?\.\(\{ galleryUrl, error \}\)[\s\S]*?\}/);
  assert.doesNotMatch(deletion, /catch \{\}/);
});

test('recommendation deletion dialogs survive removal of the final recommendation', () => {
  const recommendations = read('src/components/Recommendations.jsx');
  const earlyReturn = recommendations.match(/if \([^\n]+\) return null;/)?.[0] || '';

  assert.match(earlyReturn, /archiveDeleteTarget/);
  assert.match(earlyReturn, /archiveFailureReport/);
});

test('dedupe reports EH failures even when no gallery URL can be resolved', () => {
  const dedupe = read('src/pages/DeduplicatePage.jsx');
  const handler = dedupe.match(/const executeSelected = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[/)?.[0] || '';

  assert.doesNotMatch(handler, /if \(galleryUrl\) ehFailuresByUrl\.set/);
  assert.match(handler, /ehFailures\.push\(\{ url: galleryUrl/);
});

test('archive context menus toggle LANraragi Favorites and use shared toast errors', () => {
  const home = read('src/pages/Home.jsx');
  const menu = read('src/components/ArchiveContextMenu.jsx');
  const dedupeMenu = read('src/components/DedupeArchiveContextMenu.jsx');
  const css = read('src/index.css');

  assert.match(home, /getCategoryDisplayName\(cat\)/);
  assert.match(home, /sortCategoriesForDisplay\(categories\)/);
  assert.match(home, /selectedCategoryOverride\.archives/);
  assert.match(home, /selectedCategoryOverride\?\.search/);
  assert.doesNotMatch(home, /category:\$\{cat\.name\}/);
  const categoryClick = home.match(/const handleCategoryClick = useCallback\(\(cat\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
  assert.doesNotMatch(categoryClick, /writeFilter\(cleared\)[\s\S]*?setFilter\(cleared\)/);
  assert.match(home, /syncChangedCategory[\s\S]*?setCategories\([\s\S]*?setSelectedCategory\(current => \(current\?\.id === changed\.id \? changed : current\)\)[\s\S]*?lrr:categories-changed/);
  for (const source of [menu, dedupeMenu]) {
    assert.match(source, /getFavoriteState/);
    assert.match(source, /setArchiveFavorite/);
    assert.match(source, /加入收藏夹/);
    assert.match(source, /移出收藏夹/);
    assert.match(source, /const \{ showToast \} = useToast\(\)/);
    assert.match(source, /showToast\(`读取收藏状态失败：\$\{error\?\.message \|\| '未知错误'\}`, 'error'\)/);
    assert.match(source, /showToast\(`\$\{favorite \? '移出收藏夹' : '加入收藏夹'\}失败：\$\{error\?\.message \|\| '未知错误'\}`, 'error'\)/);
    assert.doesNotMatch(source, /favoriteError|setFavoriteError|archive-context-menu-status/);
  }
  assert.match(menu, /加入待看/);
  assert.match(menu, /移出待看/);
  assert.doesNotMatch(menu, /取消待看/);
  assert.doesNotMatch(css, /\.archive-context-menu-status\s*\{[^}]*min-height/s);
});

test('dedupe, deletion reports, and random recommendations use shared toast feedback', () => {
  const dedupe = read('src/pages/DeduplicatePage.jsx');
  const failureDialog = read('src/components/ArchiveDeletionFailureDialog.jsx');
  const home = read('src/pages/Home.jsx');

  assert.match(dedupe, /catch \(err\) \{[\s\S]*?showToast\(err\.message \|\| '检测失败', 'error'\)/);
  assert.match(dedupe, /setStatus\('没有可保存的重复分组'\);\s*showToast\('没有可保存的重复分组', 'info'\)/);
  assert.match(failureDialog, /const \{ showToast \} = useToast\(\)/);
  assert.match(failureDialog, /showToast\('已复制 E-Hentai 失败链接', 'success'\)/);
  assert.match(failureDialog, /showToast\('复制失败，请手动复制链接', 'error'\)/);
  assert.doesNotMatch(failureDialog, /copyStatus|setCopyStatus|dedupe-failure-copy-status/);
  assert.match(home, /if \(!background && !silent\)\s*showToast\(`随机推荐获取失败：\$\{e\?\.message \|\| '未知错误'\}`, 'error'\)/);
  assert.doesNotMatch(home, /console\.error\('随机推荐获取失败'/);
});

test('active categories remain selected while applying and clearing text filters', () => {
  const home = read('src/pages/Home.jsx');

  assert.match(home, /const hasActiveTextFilter = effectiveFilter\.active && !!String\(effectiveFilter\.query \|\| ''\)\.trim\(\)/);
  assert.match(home, /!hasActiveTextFilter && \(isUntaggedMode \|\| isStaticCategoryMode\)/);
  assert.match(home, /category:\s*!isUntaggedMode \? selectedCategoryOverride\?\.id : ''/);
  assert.match(home, /untaggedOnly:\s*isUntaggedMode/);
  assert.match(home, /const handleSearch = \(\) => \{\s*if \(!hasArchiveSearchQuery\(filter\.query\)\) return;\s*applyFilter\(filter\.query, filter\.sortBy, filter\.order, selectedCategory\);/);
  const clearFilter = home.match(/const clearFilter = \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.doesNotMatch(clearFilter, /setSelectedCategory\(null\)/);
});

test('category clicks preserve and activate the current text filter', () => {
  const home = read('src/pages/Home.jsx');
  const categoryClick = home.match(/const handleCategoryClick = useCallback\(\(cat\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';

  assert.match(categoryClick, /const query = filter\.query \|\| ''/);
  assert.match(categoryClick, /const nextFilter = \{ \.\.\.filter, active: !!query\.trim\(\) \}/);
  assert.match(categoryClick, /writeFilter\(nextFilter\)/);
  assert.match(categoryClick, /setFilter\(nextFilter\)/);
  assert.match(categoryClick, /setSelectedCategory\(nextCategory\)/);
  assert.match(categoryClick, /navigateHome\(\{ query: query\.trim\(\), replace: true \}\)/);
  assert.doesNotMatch(categoryClick, /DEFAULT_FILTER|cleared/);
  assert.match(categoryClick, /\}, \[filter, selectedCategory\]\);/);
});

test('category switches show a loading count instead of stale archive totals', () => {
  const home = read('src/pages/Home.jsx');
  const countLabel = home.match(/const archiveCountLabel = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[/)?.[0] || '';
  const categoryClick = home.match(/const handleCategoryClick = useCallback\(\(cat\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';

  assert.match(countLabel, /if \(loading\) return '正在获取结果\.\.\.';/);
  assert.match(categoryClick, /setLoading\(true\)/);
});

test('README documents category-scoped filtering and LANraragi Favorites', () => {
  const readme = read('README.md');

  assert.match(readme, /静态和动态分类/);
  assert.match(readme, /Favorites 分类固定显示为“收藏夹”/);
  assert.match(readme, /加入或移出 LANraragi 收藏夹/);
});

test('website branding uses one adaptive SVG while install icons stay PNG', () => {
  const app = read('src/App.jsx');
  const home = read('src/pages/Home.jsx');
  const css = read('src/index.css');
  const html = read('index.html');
  const manifest = read('public/manifest.json');
  const logoUrl = new URL('../public/logo.svg', import.meta.url);
  const logoExists = fs.existsSync(logoUrl);

  assert.equal(logoExists, true);
  const logo = logoExists ? read('public/logo.svg') : '';
  assert.doesNotMatch(app, /logo-(?:black|white)\.png/);
  assert.doesNotMatch(home, /logo-(?:black|white)\.png/);
  assert.match(app, /<span className="login-brand-logo" aria-hidden="true" \/>/);
  assert.match(home, /<span className="home-brand-logo" aria-hidden="true" \/>/);
  assert.match(css, /mask:\s*url\('\/logo\.svg'\) center \/ contain no-repeat/);
  assert.match(css, /-webkit-mask:\s*url\('\/logo\.svg'\) center \/ contain no-repeat/);
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/logo\.svg" \/>/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/icon-180\.png" \/>/);
  assert.match(manifest, /"src": "\/icons\/icon-192\.png"/);
  assert.match(manifest, /"src": "\/icons\/icon-512\.png"/);
  assert.match(logo, /viewBox="0 0 1254 1254"/);
  assert.match(logo, /prefers-color-scheme:\s*dark/);
  assert.ok((logo.match(/<path\b/g) || []).length >= 4);
});

test('touch surfaces suppress native WebKit tap highlight globally', () => {
  const css = read('src/index.css');
  assert.match(css, /\*\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent;/s);
});

test('ordinary UI controls use semantic colors in both themes', () => {
  const css = read('src/index.css');
  const tokens = read('src/styles/tokens.css');
  const recommendations = read('src/components/Recommendations.jsx');
  const history = read('src/pages/HistoryPage.jsx');
  const dedupe = read('src/pages/DeduplicatePage.jsx');
  const customSelect = read('src/components/CustomSelect.jsx');
  const toggle = read('src/components/ToggleSwitch.jsx');
  const ehSwitch = read('src/components/EhFavoriteDeleteSwitch.jsx');
  const comments = read('src/components/EhComments.jsx');
  const reader = read('src/pages/Reader.jsx');
  const home = read('src/pages/Home.jsx');
  const archiveCard = read('src/components/ArchiveCard.jsx');
  const tagSuggest = read('src/components/TagSuggest.jsx');

  assert.match(tokens, /--warning-soft:/);
  assert.match(tokens, /--positive-soft:/);
  assert.doesNotMatch(css, /#ffd2d0|#fbbf24|#fca5a5|#6ee7b7|#62d48b|#80dca2|#ff8e8e|#5fcf8b/);
  assert.doesNotMatch(recommendations, /#e3e9f3|#a7b1c2|#ccc|rgba\(255,255,255/);
  assert.doesNotMatch(history, /#e8edf5|linear-gradient\(90deg, rgba\(255,255,255/);
  assert.doesNotMatch(dedupe, /#fbbf24|rgba\(251,191,36|rgba\(255,255,255,0\.025\)/);
  assert.doesNotMatch(customSelect, /rgba\(255, 255, 255, 0\.08\)/);
  assert.match(toggle, /className=\{`toggle-switch-track/);
  assert.doesNotMatch(toggle, /transition:\s*'all/);
  assert.match(css, /\.toggle-switch-track\s*\{[^}]*min-width:\s*38px;[^}]*max-width:\s*38px;[^}]*flex:\s*0 0 38px;/s);
  assert.doesNotMatch(ehSwitch, /rgba\(255,255,255/);
  assert.doesNotMatch(comments, /#69f0ae/);
  assert.doesNotMatch(reader, /rgba\(255,180,180/);
  assert.doesNotMatch(home, /rgba\(255,255,255,0\.0[34568]\)/);
  assert.doesNotMatch(dedupe, /rgba\(255,255,255,0\.035\)|rgba\(148,163,184,0\.16\)/);
  assert.doesNotMatch(archiveCard, /rgba\(255,255,255,0\.0[25]\)|transition:\s*'all/);
  assert.match(archiveCard, /color-mix\(in srgb, var\(--tag-ns-color\) 40%, var\(--text-main\)\)/);
  assert.match(tagSuggest, /color-mix\(in srgb, \$\{nsColor\} 40%, var\(--text-main\)\)/);
  assert.match(css, /\.archive-page-thumbnail-placeholder\s*\{[^}]*color:\s*var\(--text-secondary\)/s);
  assert.match(css, /\.upload-notice\s*\{[^}]*background:\s*var\(--warning-soft\)[^}]*border:\s*1px solid var\(--warning\)/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.toggle-switch-track[\s\S]*?\.archive-card-selection-checkbox/);
});

test('home uses automatic archive loading or the manual fallback, never both', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /const supportsAutomaticArchiveLoading = typeof IntersectionObserver !== 'undefined';/);
  assert.match(home, /if \(!supportsAutomaticArchiveLoading\) return undefined;/);
  assert.match(home, /supportsAutomaticArchiveLoading\s*\?\s*\(/);
  assert.match(home, /:\s*\(\s*<button[^>]*onClick=\{\(\) => doFetch\(false\)\}/s);
});

test('touch archive filtering dismisses the virtual keyboard on commit and outside pointerdown', () => {
  const home = read('src/pages/Home.jsx');
  const suggestions = read('src/components/TagSuggest.jsx');
  assert.match(home, /filterInputRef\.current\?\.blur\(\)/);
  assert.match(home, /document\.addEventListener\('pointerdown'/);
  assert.match(home, /data-filter-popover/);
  assert.match(suggestions, /data-filter-popover="true"/);
});

test('light theme uses opaque paper surfaces and synchronizes browser theme color', () => {
  const css = read('src/index.css');
  const theme = read('src/lib/theme.js');
  const html = read('index.html');
  assert.match(html, /<meta name="color-scheme" content="dark light" \/>/);
  assert.match(read('src/styles/tokens.css'), /:root\[data-theme="light"\][\s\S]*--canvas:\s*#f2efe8;/);
  assert.match(read('src/styles/tokens.css'), /:root\[data-theme="light"\][\s\S]*--surface:\s*#fcfaf5;/);
  assert.match(read('src/styles/tokens.css'), /:root\[data-theme="light"\][\s\S]*--text-muted:\s*#948d82;/);
  assert.match(theme, /querySelector\?\.\('\[data-theme-color\]'\)/);
  assert.match(theme, /setAttribute\('content',/);
  assert.doesNotMatch(html, /maximum-scale|user-scalable=no/);
});

test('archive cards, custom selects, and overlays expose complete keyboard semantics', () => {
  const card = read('src/components/ArchiveCard.jsx');
  const select = read('src/components/CustomSelect.jsx');
  const home = read('src/pages/Home.jsx');
  const reader = read('src/pages/Reader.jsx');
  const dialog = read('src/components/ConfirmDialog.jsx');
  assert.match(card, /role=\{selectionMode \? 'checkbox' : 'button'\}/);
  assert.match(card, /tabIndex=\{!disabled \? 0 : -1\}/);
  assert.match(card, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(select, /<Select\.List/);
  assert.match(select, /<Select\.Item/);
  assert.match(select, /<Select\.Trigger/);
  assert.match(home, /role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(reader, /role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(reader, /<button[\s\S]*data-reader-drawer-page/);
  assert.match(dialog, /<Dialog\.Popup/);
});

test('settings dialog keeps initial focus on first control instead of dialog fallback', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /const firstFocusable = getFocusable\(\)\[0\];/);
  assert.match(home, /:not\(\.settings-hint-wrap\)/);
  assert.match(home, /if \(firstFocusable\) firstFocusable\.focus\(\);\s*else dialog\?\.focus\(\);/);
  assert.doesNotMatch(home, /getFocusable\(\)\[0\]\?\.focus\(\)\s*\|\|\s*dialog\?\.focus\(\)/);
});

test('dark theme uses the warm archive atelier palette and an independent overlay token', () => {
  const tokens = read('src/styles/tokens.css');
  const css = read('src/index.css');
  const darkTheme = tokens.match(/:root,\s*:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';

  assert.match(darkTheme, /--canvas:\s*#121310/i);
  assert.match(darkTheme, /--surface:\s*#1b1c18/i);
  assert.match(darkTheme, /--surface-subtle:\s*#171815/i);
  assert.match(darkTheme, /--accent:\s*#d16a57/i);
  assert.match(darkTheme, /--overlay:\s*rgba\(0,\s*0,\s*0,\s*0\.72\)/i);
  assert.match(darkTheme, /--reader-stage:\s*#050505/i);
  assert.match(css, /\.settings-overlay\s*\{[\s\S]*background:\s*var\(--overlay\)/s);
  assert.doesNotMatch(css, /\.settings-overlay\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--text-main\)/s);
});

test('custom theme exposes persisted three-color semantic palette and applies/reset tokens globally', () => {
  const theme = read('src/lib/theme.js');
  const app = read('src/App.jsx');
  const home = read('src/pages/Home.jsx');

  assert.match(theme, /CUSTOM_THEME_STORAGE_KEY/);
  assert.match(theme, /readStoredThemePalette/);
  assert.match(theme, /writeStoredThemePalette/);
  assert.match(theme, /applyThemePalette/);
  assert.match(theme, /createCustomThemeTokens/);
  assert.match(theme, /removeProperty/);
  assert.match(app, /themePalette/);
  assert.match(app, /applyThemeMode\(themeMode, \{ palettes: themePalettes \}\)/);
  assert.match(home, /themePalettes/);
  assert.match(home, /ThemeColorPicker/);
  assert.doesNotMatch(home, /type="color"/);
  assert.match(home, /恢复当前模式默认配色/);
});

test('custom theme palette normalizes, persists, generates semantic tokens, and clears cleanly', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const palette = normalizeThemePalette({ accent: '#123', secondary: '#456789', background: '#abcdef' });
  assert.deepEqual(palette, { accent: '#112233', secondary: '#456789', background: '#abcdef' });
  assert.ok(createCustomThemeTokens(palette, 'dark')['--accent']);
  assert.equal(writeStoredThemePalette(palette, storage).accent, '#112233');
  assert.deepEqual(readStoredThemePalette(storage), palette);

  const properties = new Map();
  const root = { dataset: { theme: 'light' }, style: { setProperty: (key, value) => properties.set(key, value), removeProperty: (key) => properties.delete(key) } };
  applyThemePalette(palette, { root, resolvedTheme: 'light' });
  assert.equal(properties.get('--accent'), createCustomThemeTokens(palette, 'light')['--accent']);
  const commentTokens = createCustomThemeTokens({ accent: '#4a9ff0', secondary: '#79b8ff', background: '#000000' }, 'dark');
  assert.equal(commentTokens['--canvas'], '#000000', 'user black background stays pure black');
  assert.ok(commentTokens['--surface']);
  assert.ok(commentTokens['--border-strong']);
  assert.ok(commentTokens['--comment-card-bg']);
  assert.ok(commentTokens['--comment-card-border']);
  assert.ok(commentTokens['--comment-uploader-border']);
  assert.ok(commentTokens['--comment-user']);
  assert.ok(commentTokens['--comment-text']);
  // Custom backgrounds keep their hue; luminance is clamped for readability
  // instead of being washed out by a fixed blend.
  const blueTokens = createCustomThemeTokens({ accent: '#4a9ff0', secondary: '#79b8ff', background: '#3366cc' }, 'dark');
  assert.equal(blueTokens['--canvas'], '#2d59b3');
  assert.match(blueTokens['--canvas'], /^#(2|3|4|5)[0-9a-f]{5}$/i, 'dark canvas stays dark-ish');
  // Default palettes are untouched by the clamping logic.
  const defaultDark = createCustomThemeTokens({ accent: '#4a9ff0', secondary: '#79b8ff', background: '#0f1115' }, 'dark');
  assert.equal(defaultDark['--canvas'], '#0f1115');
  const defaultLight = createCustomThemeTokens({ accent: '#b74632', secondary: '#70784f', background: '#f4f0e8' }, 'light');
  assert.equal(defaultLight['--canvas'], '#f4f0e8');
  applyThemePalette(null, { root, resolvedTheme: 'light' });
  assert.equal(properties.has('--accent'), false);
  assert.equal(writeStoredThemePalette(null, storage), null);
  assert.equal(readStoredThemePalette(storage), null);
});

test('continue-reading and watchlist heading hover keeps background transparent while enlarging type', () => {
  const css = read('src/index.css');
  assert.match(css, /\.home-carousel-header \.section-heading-link:hover\s*\{[\s\S]*background:\s*transparent;[\s\S]*border-color:\s*transparent;[\s\S]*transform:\s*scale\(1\.03\)/s);
  assert.match(css, /\.home-carousel-header \.section-heading-link\s*\{[\s\S]*transition:[^}]*transform/s);
});

test('EH comments use semantic theme tokens without fixed uploader colors', () => {
  const comments = read('src/components/EhComments.jsx');
  const css = read('src/index.css');
  const tokens = read('src/styles/tokens.css');
  const state = read('src/lib/ehCommentsState.js');
  assert.doesNotMatch(comments, /#d77f12|#ff9800/);
  assert.match(css, /\.eh-comment-card\s*\{[\s\S]*background:\s*var\(--comment-card-bg\)/s);
  assert.match(css, /\.eh-comment-card\.is-uploader\s*\{[\s\S]*border-left-color:\s*var\(--comment-uploader-border\)/s);
  assert.match(css, /\.eh-comment-card\.is-uploader\s*\{[\s\S]*background:\s*var\(--comment-uploader-bg\)/s);
  assert.match(css, /\.eh-comment-input\s*\{[\s\S]*background:\s*var\(--comment-input-bg\)/s);
  assert.match(tokens, /--comment-header-bg:\s*var\(--surface\);/i);
  assert.match(tokens, /--comment-content-bg:\s*var\(--surface-subtle\);/i);
  assert.match(tokens, /--comment-card-bg:\s*var\(--surface-raised\);/);
  assert.match(tokens, /--comment-card-border:\s*var\(--border-strong\);/);
  assert.match(tokens, /--comment-positive:\s*var\(--positive\);/);
  assert.match(tokens, /--comment-uploader-border:\s*var\(--positive\);/);
  assert.match(comments, /const scoreClass = c\.score > 0 \? 'var\(--comment-positive\)'/);
  assert.match(comments, /style=\{\{ color: scoreClass, fontWeight: 'bold', fontSize: '12px' \}\}/);
  assert.match(comments, /borderLeftColor: c\.isUploader \? 'var\(--comment-uploader-border\)' : 'var\(--comment-card-border\)'/);
  assert.match(comments, /color: c\.isEditable \? 'var\(--comment-user-self\)' : 'var\(--comment-user\)'/);
  assert.match(comments, /fontSize: '14px', lineHeight: '1\.7', color: 'var\(--comment-text\)'/);
  assert.doesNotMatch(comments, /eh-comment-card-header|eh-comment-content|eh-comment-time|eh-comment-score|eh-vote-button is-up/);
  assert.match(comments, /M8 11L3 3H13L8 11Z/);
  assert.match(css, /\.eh-comment-input::-webkit-resizer[^}]*background:\s*transparent;/s);
  assert.match(state, /GALLERY_NOT_FOUND: \['画廊不存在或已删除'/);
  assert.match(state, /GALLERY_COPYRIGHT_REMOVED: \['画廊因版权要求被移除'/);
  assert.match(state, /export function isTerminalGalleryError/);
  assert.match(comments, /readEhCommentsCacheState/);
  assert.match(comments, /writeEhCommentsCache\(cacheKey, \[\], \{ unavailable/);
  assert.match(comments, /isTerminalGalleryError\(error\?\.code\)/);
  assert.match(comments, /!isTerminalGalleryError\(error\?\.code\) && \(\r?\n\s*<div className="eh-comments-actions"/);
  assert.match(comments, /is-gallery-missing/);
  assert.match(css, /\.eh-comment-error\.is-gallery-missing/);
});

test('home sections clip their own collapsed carousel edges instead of leaking borders', () => {
  const css = read('src/index.css');
  assert.match(css, /\.home-shell\s*>\s*\.glass-panel\s*\{[\s\S]*overflow:\s*hidden;/s);
  assert.match(css, /\.home-shell\s*>\s*\.glass-panel\s*\{[\s\S]*min-width:\s*0;/s);
});

test('home glass panels do not keep transform reveal layers after resize', () => {
  const css = read('src/index.css');
  assert.match(css, /\.home-shell\s*>\s*\.glass-panel\.section-reveal\s*\{[\s\S]*animation:\s*none;[\s\S]*opacity:\s*1;[\s\S]*transform:\s*none;/s);
});
test('custom themes keep independent light and dark palettes and migrate the legacy single palette', () => {
  const theme = read('src/lib/theme.js');
  assert.match(theme, /DEFAULT_THEME_PALETTES/);
  assert.match(theme, /readStoredThemePalettes/);
  assert.match(theme, /writeStoredThemePalettes/);
  assert.match(theme, /palettes\?\.\[resolved\]/);

  const storage = new Map();
  const fakeStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const palettes = {
    light: { accent: '#b74632', secondary: '#70784f', background: '#f4f0e8' },
    dark: { accent: '#4a9ff0', secondary: '#79b8ff', background: '#0f1115' },
  };
  assert.deepEqual(normalizeThemePalettes(palettes), palettes);
  writeStoredThemePalettes(palettes, fakeStorage);
  assert.deepEqual(readStoredThemePalettes(fakeStorage), palettes);
  fakeStorage.setItem('lrr_custom_theme', JSON.stringify(palettes.light));
  assert.deepEqual(readStoredThemePalettes(fakeStorage), { light: palettes.light, dark: palettes.light });
  assert.equal(readStoredThemePalette(fakeStorage).accent, palettes.light.accent);
  writeStoredThemePalette(null, fakeStorage);
  assert.equal(readStoredThemePalettes(fakeStorage), null);
});

test('custom color picker accepts canonical hex values and converts between RGB/HSL', () => {
  const picker = read('src/components/ThemeColorPicker.jsx');
  assert.doesNotMatch(picker, /type=["']color["']/);
  assert.match(picker, /inputMode=["']text["']/);
  assert.match(picker, /二维|saturation|hue/i);
  assert.equal(parseHexColor('#abc'), '#aabbcc');
  assert.equal(parseHexColor('aabbcc'), '#aabbcc');
  assert.equal(parseHexColor('#12xz45'), null);
  assert.deepEqual(rgbToHsl({ r: 255, g: 0, b: 0 }), { h: 0, s: 100, l: 50 });
  assert.equal(hslToHex({ h: 120, s: 100, l: 50 }), '#00ff00');
});

test('config transfer includes and validates the split custom theme palette', () => {
  const config = read('src/lib/worker-config.js');
  assert.match(config, /lrr_custom_theme/);
  assert.match(config, /normalizeThemePalettes/);
  assert.match(config, /JSON\.parse\(cfg\[key\]\)/);
  assert.match(config, /normalizeThemePalettes\(parsedTheme\)/);
});

test('visible emoji are replaced by project glyphs while API favorite name stays compatible', () => {
  const categories = read('src/lib/categories.js');
  const comments = read('src/components/EhComments.jsx');
  const tags = read('src/lib/tags.js');
  const home = read('src/pages/Home.jsx');
  assert.doesNotMatch(categories, /⭐/);
  assert.doesNotMatch(comments, /💬/);
  assert.doesNotMatch(tags, /🎨|📖|📂|👤|🔀|📌|🏢|📚|🌐|📤|📅|🕐|🔗|🏷/);
  assert.match(home, /ToolbarGlyph[\s\S]*favorite/);
  assert.match(comments, /ToolbarGlyph[\s\S]*comment/);
});

test('settings overlay blurs without shifting the page when scroll is locked', () => {
  const css = read('src/index.css');
  const lock = read('src/lib/bodyScrollLock.js');
  assert.match(css, /\.settings-overlay\s*\{[\s\S]*backdrop-filter:\s*blur\(/);
  assert.match(css, /-webkit-backdrop-filter:\s*blur\(/);
  assert.match(lock, /viewportWidth[\s\S]*clientWidth/);
  assert.match(lock, /previousBodyPaddingRight/);
});

test('custom palette settings stay at the bottom and explain from the section title', () => {
  const home = read('src/pages/Home.jsx');
  const paletteIndex = home.indexOf('className="theme-palette-mode-tabs"');
  const toolsIndex = home.indexOf('>上传档案</button>');
  const transferIndex = home.indexOf('>导出配置</button>');
  const footerIndex = home.indexOf('<div className="settings-panel-footer">');
  assert.ok(paletteIndex >= 0 && toolsIndex > paletteIndex && transferIndex > toolsIndex && transferIndex < footerIndex);
  assert.match(home, /theme-palette-mode-tabs/);
  assert.doesNotMatch(home, />配色说明<\/SettingHint>/);
});

test('custom palette picker opens from a color swatch and closes as a popover', () => {
  const picker = read('src/components/ThemeColorPicker.jsx');
  assert.match(picker, /useState\(false\)/);
  assert.match(picker, /theme-color-picker-trigger/);
  assert.match(picker, /theme-color-picker-popover/);
  assert.match(picker, /setIsOpen\(false\)/);
  assert.match(picker, /event\.key (?:===|!==) ['"]Escape['"]/);
  assert.match(picker, /event\.stopPropagation\(\)/);
  assert.match(picker, /data-theme-color-picker/);
});

test('settings overlay, watchlist glow, and palette swatches use reduced-motion-safe transitions', () => {
  const css = read('src/index.css');
  assert.match(css, /\.settings-overlay\s*\{[\s\S]*animation:\s*settingsOverlayReveal/);
  assert.match(css, /\.watchlist-card:not\(\.watchlist-card-plain\) \.archive-card-shell\s*\{[\s\S]*transition:[^}]*box-shadow/s);
  assert.match(css, /\.theme-color-picker-preview\s*\{[\s\S]*transition:\s*background-color/s);
  assert.match(css, /@keyframes settingsOverlayReveal/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.settings-overlay[\s\S]*animation:\s*none/s);
});

test('palette preview components keep stable keys so mode switching can animate color changes', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /<ThemeColorPicker[\s\S]*key=\{key\}/);
  assert.doesNotMatch(home, /key=\{`\$\{themePaletteMode\}-\$\{key\}`\}/);
});

test('custom palette picker escapes settings clipping, stays above the modal, and uses circular swatches', () => {
  const picker = read('src/components/ThemeColorPicker.jsx');
  const css = read('src/index.css');
  assert.match(picker, /createPortal/);
  assert.match(picker, /popoverPosition/);
  assert.match(picker, /addEventListener\('scroll',[\s\S]*true\)/);
  assert.match(css, /\.theme-color-picker-popover\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*100003;/s);
  assert.match(css, /\.theme-color-picker-trigger\s*\{[^}]*border-radius:\s*50%;/s);
  assert.match(css, /\.theme-color-picker-preview\s*\{[^}]*border-radius:\s*50%;/s);
  assert.match(css, /\.theme-color-picker-trigger:hover,[\s\S]*background:\s*var\(--surface-inset\)/s);
});

test('release version is 1.6.0 across package manifests', () => {
  const packageJson = read('package.json');
  const packageLock = read('package-lock.json');
  assert.match(packageJson, /"version":\s*"1\.6\.0"/);
  assert.match(packageLock, /"version":\s*"1\.6\.0"/);
  assert.match(packageLock, /"version":\s*"1\.6\.0"[\s\S]*?"packages":\s*\{[\s\S]*?"":\s*\{[\s\S]*?"version":\s*"1\.6\.0"/);
});

test('sync data survives scope switches and failed flushes', () => {
  const history = read('src/lib/history.js');
  const watchlist = read('src/lib/watchlist.js');
  const app = read('src/App.jsx');
  const scope = read('src/lib/configScope.js');
  // Stale deletes are dropped when the entry is active locally again.
  assert.match(history, /const activeIds = new Set\(getStoredHistory\(\)\.map\(\(item\) => item\.id\)\);/);
  assert.match(history, /const remaining = ids\.filter\(\(id\) => !activeIds\.has\(id\)\);/);
  assert.match(watchlist, /const activeIds = new Set\(getStoredWatchlist\(\)\.map\(\(item\) => item\.id\)\);/);
  // Newer local progress is backfilled to the worker on load.
  assert.match(history, /const backfill = getStoredHistory\(\)\.filter/);
  assert.match(history, /workerJson\('\/history', \{ method: 'PUT', body: \{ histories: backfill \} \}\)/);
  assert.match(watchlist, /const backfill = localItems\.filter/);
  assert.match(watchlist, /workerJson\('\/watchlist', \{ method: 'PUT', body: \{ items: backfill \} \}\)/);
  // Local watchlist merges monotonically instead of being dropped by the remote view.
  assert.match(watchlist, /const mergedById = new Map\(\);/);
  assert.match(watchlist, /\[\.\.\.remoteItems, \.\.\.localItems\]/);
  // Config switches flush first.
  assert.match(app, /await Promise\.allSettled\(\[flushHistorySync\(\), flushWatchlistSync\(\)\]\)/);
  // Cross-tab writes serialize through Web Locks.
  assert.match(history, /navigator\.locks\.request\('lrr-worker-write-v1'/);
  assert.match(watchlist, /navigator\.locks\.request\('lrr-worker-write-v1'/);
  // Legacy data migrates into the first scope only.
  assert.match(scope, /const marker = `lrr_legacy_migrated_v1:\$\{base\}`/);
  assert.match(scope, /!localStorage\.getItem\(marker\)/);
});

test('both themes keep the normal reader stage near-black for image fidelity', () => {
  const tokens = read('src/styles/tokens.css');
  assert.match(tokens, /--reader-stage:\s*#050505/i);
  assert.match(tokens, /--reader-stage:\s*#050505/i);
});

test('reader thumbnail drawer coalesces scroll work and animates backdrop blur', () => {
  const reader = read('src/pages/Reader.jsx');
  const drawer = reader.slice(reader.indexOf('/* ===== Thumbnail Drawer ===== */'));
  assert.match(reader, /drawerViewportFrameRef/);
  assert.match(reader, /requestAnimationFrame\(updateDrawerViewport/);
  assert.match(drawer, /backdropFilter: showDrawer \? 'blur\(4px\)' : 'blur\(0px\)'/);
  assert.match(drawer, /WebkitBackdropFilter: showDrawer \? 'blur\(4px\)' : 'blur\(0px\)'/);
  assert.match(drawer, /backdrop-filter 0\.25s ease/);
});

test('empty archive search is a no-op', () => {
  const home = read('src/pages/Home.jsx');
  const handler = home.match(/const handleSearch = \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(handler, /if \(!hasArchiveSearchQuery\(filter\.query\)\) return;/);
});
