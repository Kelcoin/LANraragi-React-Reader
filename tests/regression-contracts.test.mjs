import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

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
  assert.match(css, /body\s*\{[^}]*user-select:\s*none;[^}]*-webkit-user-select:\s*none;/s);
  assert.match(css, /input,[\s\S]*textarea,[\s\S]*\[contenteditable="true"\][^{]*\{[^}]*user-select:\s*text;/s);
  assert.match(metadata, /className="metadata-field-label">标签</);
  assert.match(css, /\.metadata-field-label\s*\{[^}]*font-weight:\s*650;/s);
  assert.match(home, /style=\{\{ flex:\s*'1\.35 1 0'/);
  assert.doesNotMatch(home, /全部归档|待看归档|上传归档|重复归档检测/);
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

test('dedupe results use compact persistence, interlocked selection, and wide-card layout', () => {
  const page = read('src/pages/DeduplicatePage.jsx');
  const deduplicate = read('src/lib/deduplicate.js');
  const css = read('src/index.css');
  assert.match(deduplicate, /version:\s*2/);
  assert.match(deduplicate, /compactDedupeArchives\(visibleGroups\)/);
  assert.match(page, /normalizeDuplicateSelection/);
  assert.match(page, /getDuplicateSelectionDisabledIds/);
  assert.match(page, /className="dedupe-groups-grid"/);
  assert.match(css, /\.dedupe-groups-grid\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*center;/s);
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
  const css = read('src/index.css');
  assert.match(page, /groupDuplicatePairsByChain/);
  assert.match(page, /className="dedupe-chain"/);
  assert.match(page, />\s*执行\s*</);
  assert.doesNotMatch(page, />\s*删除选中\s*</);
  assert.doesNotMatch(page, />\s*标记分组不重复\s*</);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /navigator\.clipboard\.writeText/);
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
  assert.match(picker, /width: '126px', minWidth: '126px'/);
  assert.match(picker, /width: '100px', minWidth: '100px'/);
  assert.match(picker, /event\?\.target\?\.closest\?\.\('\[data-select-dropdown="true"\]'\)/);
  assert.match(picker, /data-select-dropdown/);
  assert.match(css, /\.date-picker-trigger/);
  assert.match(css, /\.date-picker-popover/);
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
  assert.match(menu, /const width = 150/);
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
  assert.match(reader, /\[isMobile, layoutKey, mode\]/);
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
  assert.match(css, /background:\s*rgba\(18,\s*21,\s*28,\s*0\.[45]\d*\)/);
  assert.match(css, /\.reader-immersive-trigger\s*\{[^}]*width:\s*max\(32px,\s*7vw\);/s);
  assert.match(reader, /\{\['left', 'right'\]\.map\(\(side\) => \(/);
  assert.match(reader, /data-visible=\{immersiveControlsSide === side \? 'true' : 'false'\}/);
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
  assert.match(app, /<Suspense fallback=\{<AppRouteFallback \/>\}>/);
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
  const css = read('src/index.css');
  assert.match(app, /className="login-stack-notice"/);
  assert.match(app, /setTimeout\(\(\) => setLoginNotice\(null\), 3000\)/);
  assert.match(css, /\.login-stack-notice\s*\{[^}]*width:\s*100%/s);
});

test('archive grids use native flex wrapping with shared card sizing', () => {
  const css = read('src/index.css');
  const home = read('src/pages/Home.jsx');
  const history = read('src/pages/HistoryPage.jsx');
  const watchlist = read('src/pages/WatchlistPage.jsx');
  const grid = read('src/components/ArchiveGrid.jsx');
  const pagination = read('src/lib/archivePagination.js');
  assert.match(css, /\.archive-grid\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*center;/s);
  assert.match(css, /\.archive-grid\s*>\s*\.archive-card-wrap\.is-wide\s*\{[^}]*flex:\s*0\s+1\s+316px;[^}]*width:\s*min\(316px,\s*100%\);[^}]*max-width:\s*100%;/s);
  assert.match(css, /\.archive-grid\s*>\s*\.archive-card-wrap\.is-wide\s*>\s*\.archive-card-shell\s*\{[^}]*width:\s*100%\s*!important;/s);
  assert.doesNotMatch(css, /grid-auto-flow/);
  assert.doesNotMatch(css, /grid-column:\s*span 2/);
  assert.doesNotMatch(grid, /observeArchiveGridLayout/);
  assert.doesNotMatch(pagination, /observeArchiveGridLayout/);
  assert.match(home, /<ArchiveGrid/);
  assert.match(history, /<ArchiveGrid/);
  assert.match(watchlist, /<ArchiveGrid/);
});

test('history page header has ordered narrow-screen layout hooks', () => {
  const css = read('src/index.css');
  const history = read('src/pages/HistoryPage.jsx');
  const watchlist = read('src/pages/WatchlistPage.jsx');

  assert.match(history, /className="history-page"/);
  assert.match(history, /className="history-page-header"/);
  assert.match(history, /className="history-page-title-block"/);
  assert.match(history, /className="history-page-title-row"/);
  assert.match(history, /className="history-section-header"/);
  assert.match(history, /className="history-section-actions"/);
  assert.match(history, /className="history-section-toolbar"/);
  assert.doesNotMatch(history, /className="history-hide-read-toggle"/);
  assert.doesNotMatch(history, /handleToggleHideRead|setHideRead\(/);
  assert.match(history, /className="history-summary-part"/);
  assert.match(history, /className="history-page-actions"/);
  assert.ok(history.indexOf('className="history-page-title"') < history.indexOf('className="history-page-summary"'));
  assert.ok(history.indexOf('className="history-section-actions"') < history.indexOf('className="history-section-toolbar"'));
  assert.ok(history.indexOf('className="history-section-toolbar"') < history.indexOf('<ArchiveSearchBox'));
  assert.match(watchlist, /className="history-page watchlist-page"/);
  assert.match(watchlist, /className="history-page-title-row"/);
  assert.match(watchlist, /className="history-page-actions"/);
  assert.match(watchlist, /className="history-section-header"/);
  assert.match(watchlist, /className="history-section-actions"/);
  assert.match(css, /\.history-page-header\s*\{/);
  assert.match(css, /\.history-page-actions\s*\{/);
  assert.match(css, /\.history-page-title-row\s*\{/);
  assert.match(css, /\.history-section-header\s*\{/);
  assert.match(css, /\.history-section-actions\s*\{/);
  assert.match(css, /\.history-section-toolbar\s*\{/);
  assert.match(css, /\.history-summary-part\s*\{/);
  assert.doesNotMatch(css, /\.history-hide-read-toggle/);
  assert.match(css, /\.history-page-summary\s*\{[\s\S]*font-family:\s*'Noto Sans SC Variable', system-ui, sans-serif;[\s\S]*font-size:\s*12px;[\s\S]*font-synthesis:\s*none;[\s\S]*font-variant-numeric:\s*tabular-nums;[\s\S]*font-weight:\s*520;[\s\S]*line-height:\s*1\.35;[\s\S]*background:\s*var\(--surface-2\);[\s\S]*border:\s*1px solid var\(--glass-border\);[\s\S]*border-radius:\s*999px;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-page-header\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*stretch;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-page-title-row\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*auto\)\s+minmax\(0,\s*1fr\);[\s\S]*align-items:\s*center;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-page-summary\s*\{[\s\S]*justify-self:\s*end;[\s\S]*text-align:\s*right;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-summary-part\s*\{[\s\S]*display:\s*block;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-page-actions\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*nowrap;[\s\S]*justify-content:\s*center;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-section-header\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/s);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.history-page-actions \.btn\s*\{[\s\S]*width:\s*auto;[\s\S]*flex:\s*0 1 auto;[\s\S]*font-size:\s*13px;/s);
});

test('home archive toolbar count is styled and empty cold restore fetches archives', () => {
  const home = read('src/pages/Home.jsx');
  const css = read('src/index.css');

  assert.match(home, /className="archive-count-badge"/);
  assert.match(home, /className="archive-toolbar-actions"/);
  assert.match(home, /className="archive-toolbar-summary"[\s\S]*alignItems:\s*'center'/);
  assert.match(home, /const hasHydratedArchives = homeSnapshot && Array\.isArray\(homeSnapshot\.archives\) && homeSnapshot\.archives\.length > 0;/);
  assert.match(home, /if \(coldRestoreRef\.current && hasHydratedArchives\) return;/);
  assert.match(home, /if \(navigationRestoreRef\.current && hasHydratedArchives\)/);
  assert.match(css, /\.archive-count-badge\s*\{[\s\S]*font-family:\s*'Noto Sans SC Variable', system-ui, sans-serif;[\s\S]*font-size:\s*12px;[\s\S]*font-synthesis:\s*none;[\s\S]*font-variant-numeric:\s*tabular-nums;[\s\S]*font-weight:\s*520;[\s\S]*line-height:\s*1\.35;[\s\S]*background:\s*var\(--surface-2\);[\s\S]*border:\s*1px solid var\(--glass-border\);[\s\S]*border-radius:\s*999px;/s);
  assert.match(css, /\.archive-toolbar-summary h2,[\s\S]*\.archive-toolbar-summary h2 > span\s*\{[\s\S]*white-space:\s*nowrap;/s);
});

test('archive title uses one cross-platform two-line geometry contract', () => {
  const card = read('src/components/ArchiveCard.jsx');
  const workflow = read('.github/workflows/mobile-build.yml');
  assert.match(card, /const ARCHIVE_TITLE_GAP = 8;/);
  assert.match(card, /const ARCHIVE_TITLE_FONT_SIZE = 13;/);
  assert.match(card, /const ARCHIVE_TITLE_LINE_HEIGHT = 1\.5;/);
  assert.match(card, /const ARCHIVE_TITLE_GLYPH_SAFETY_PX = 3;/);
  assert.match(card, /const ARCHIVE_TITLE_VERTICAL_BUDGET = 51\.7;/);
  assert.match(card, /height:\s*`\$\{ARCHIVE_TITLE_VERTICAL_BUDGET - ARCHIVE_TITLE_GAP\}px`/);
  assert.match(card, /WebkitLineClamp:\s*2/);
  assert.match(card, /height:\s*'3em'/);
  assert.match(card, /paddingBottom:\s*`\$\{ARCHIVE_TITLE_GLYPH_SAFETY_PX\}px`/);
  assert.match(card, /boxSizing:\s*'content-box'/);
  assert.doesNotMatch(card, /document\.createRange\(\)/);
  assert.doesNotMatch(card, /titleLayoutIndex|titleMeasurementKeyRef|fontRevision/);
  assert.match(workflow, /getWebView\(\)\.getSettings\(\)\.setTextZoom\(100\)/);
});

test('mobile settings respect safe areas and reveal animations release compositor layers', () => {
  const home = read('src/pages/Home.jsx');
  const css = read('src/index.css');
  const customSelect = read('src/components/CustomSelect.jsx');

  assert.match(home, /className="settings-overlay"/);
  assert.match(home, /className="glass-panel settings-panel"/);
  assert.match(css, /\.settings-panel\s*\{[^}]*max-height:\s*100%;/s);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.settings-overlay\s*\{[\s\S]*padding-top:\s*max\(24px,\s*calc\(var\(--app-safe-area-top\) \+ 16px\)\);/s);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.settings-overlay\s*\{[\s\S]*padding-bottom:\s*max\(24px,\s*calc\(var\(--app-safe-area-bottom\) \+ 16px\)\);/s);
  assert.match(css, /\.settings-control\s*\{[^}]*flex:\s*0 0 148px;[^}]*width:\s*148px;/s);
  assert.match(customSelect, /display:\s*'flex'[^}]*gap:\s*'8px'/s);
  assert.match(customSelect, /<span style=\{\{[^}]*flex:\s*1[^}]*minWidth:\s*0[^}]*textOverflow:\s*'ellipsis'/s);
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
  assert.match(css, /--app-safe-area-top:\s*var\(--lrr-android-safe-top,\s*env\(safe-area-inset-top,\s*0px\)\);/);
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
  assert.doesNotMatch(reader, /data-panel="settings"[\s\S]{0,500}bottom:\s*'max\(12px, calc\(var\(--app-safe-area-bottom\) \+ 8px\)\)'/s);
  assert.match(reader, /READER_OVERLAY_SCROLL_SELECTOR\s*=\s*'\[data-reader-overlay-scroll\], \[data-select-dropdown="true"\]'/);
  assert.match(reader, /document\.addEventListener\('wheel', containReaderOverlayScroll, \{ capture: true, passive: false \}\)/);
  assert.match(reader, /document\.addEventListener\('touchmove', containReaderOverlayScroll, \{ capture: true, passive: false \}\)/);
  assert.ok((reader.match(/data-reader-overlay-scroll/g) || []).length >= 4);
  assert.match(select, /data-select-dropdown="true"[\s\S]*overscrollBehavior:\s*'contain'[\s\S]*touchAction:\s*'pan-y'/s);
});

test('configuration transfer warning and settings layers stay concise and isolated', () => {
  const dialog = read('src/components/ConfigTransferDialog.jsx');
  const home = read('src/pages/Home.jsx');
  const css = read('src/index.css');
  assert.match(dialog, /警告：请勿分享或导入他人配置！/);
  assert.doesNotMatch(dialog, /Base64 编码，不是加密/);
  assert.doesNotMatch(dialog, /message=\{isExport/);
  assert.match(dialog, /className="config-transfer-warning"/);
  assert.match(css, /\.confirm-dialog:has\(\.config-transfer-field\)\s+\.confirm-dialog-title\s*\{[^}]*text-align:\s*center;/s);
  assert.match(css, /\.config-transfer-warning\s*\{[^}]*background:[^}]*text-align:\s*center;/s);
  assert.match(home, /className="settings-panel-footer"/);
  assert.match(css, /\.settings-panel-footer\s*\{[^}]*flex:\s*0 0 auto;[^}]*background:/s);
});

test('progress regression is configured only from the general settings section', () => {
  const home = read('src/pages/Home.jsx');
  const reader = read('src/pages/Reader.jsx');
  const cacheSettings = read('src/components/CacheSettings.jsx');
  const css = read('src/index.css');

  for (const label of ['通用设置', '缓存', '档案显示', '浏览与记录']) {
    assert.match(home, new RegExp(`>${label}<`));
  }
  assert.doesNotMatch(cacheSettings, /允许阅读进度回溯|通用设置/);
  assert.match(home, /allowProgressRegression: checked/);
  assert.match(home, /className="settings-control"/);
  assert.match(home, /className="settings-control settings-toggle-control"/);
  assert.match(css, /\.settings-control\s*\{[^}]*width:\s*148px/s);
  assert.match(css, /\.settings-toggle-control\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.doesNotMatch(reader, />允许阅读进度回溯</);
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
  assert.match(metadataPage, /await lrrApi\.updateArchiveMetadata[\s\S]{0,500}rememberArchiveInCatalog\(/);
  assert.match(uploadPage, /const uploadResults = await runUploadTasks[\s\S]{0,300}uploadResults\.some[\s\S]{0,200}invalidateArchiveCatalog\(\)/);
  assert.match(progressActions, /rememberArchiveProgressInCatalog\(id, result\.page/);
  assert.match(reader, /await lrrApi\.updateProgress\(id, targetPage[\s\S]{0,300}rememberArchiveProgressInCatalog\(id, targetPage/);
  assert.doesNotMatch(progressActions, /clearArchiveSearchResponseCache|clearSearchCache/);
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
  const glowStart = css.indexOf('.watchlist-card:not(.watchlist-card-plain) .archive-card-shell::before');
  const glowEnd = css.indexOf('.archive-cover-image', glowStart);
  const glowCss = css.slice(glowStart, glowEnd);

  assert.match(glowCss, /0 0 6px[\s\S]*0 0 10px/);
  assert.match(glowCss, /:hover[\s\S]*0 0 8px[\s\S]*0 0 12px/);
  assert.doesNotMatch(glowCss, /0 0 (?:14|16|18|20|30|34|38|42)px/);
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
  assert.match(card, /if \(!touchInteractionRef\.current\) onClick\(e\)/);
});

test('Reader sizes panels by viewport and opens the thumbnail drawer from its trigger side', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /const \[drawerSide, setDrawerSide\] = useState\('right'\)/);
  assert.match(reader, /const openThumbnailDrawer = useCallback/);
  assert.match(reader, /setShowDrawer\(false\);[\s\S]*setTimeout\([\s\S]*DRAWER_TRANSITION_MS/s);
  assert.match(reader, /setDrawerSide\(side\);[\s\S]*requestAnimationFrame\(\(\) => setShowDrawer\(true\)\)/s);
  assert.doesNotMatch(reader, /onClick=\{\(\) => \{[^}]*setDrawerSide\(/);
  assert.equal((reader.match(/openThumbnailDrawer\(/g) || []).length >= 2, true);
  assert.match(reader, /width:\s*'min\(380px, calc\(100vw - 40px\)\)'/);
  assert.match(reader, /justifyContent:\s*drawerSide === 'left' \? 'flex-start' : 'flex-end'/);
  assert.match(reader, /translateX\(\$\{drawerSide === 'left' \? '-100%' : '100%'\}\)/);
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

test('touch surfaces suppress native WebKit tap highlight globally', () => {
  const css = read('src/index.css');
  assert.match(css, /\*\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent;/s);
});

test('home uses automatic archive loading or the manual fallback, never both', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /const supportsAutomaticArchiveLoading = typeof IntersectionObserver !== 'undefined';/);
  assert.match(home, /if \(!supportsAutomaticArchiveLoading\) return undefined;/);
  assert.match(home, /supportsAutomaticArchiveLoading\s*\?\s*\(/);
  assert.match(home, /:\s*\(\s*<button[^>]*onClick=\{\(\) => doFetch\(false\)\}/s);
});
