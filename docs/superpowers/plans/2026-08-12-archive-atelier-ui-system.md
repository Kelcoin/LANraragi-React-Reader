# Archive Atelier UI System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Readoshi Archive Atelier visual system across every existing route while preserving all current application behavior.

**Architecture:** Keep React state, routes, API calls, persistence, cache, reader and PWA behavior unchanged. Introduce a layered CSS system and semantic theme contract first, then migrate shared interaction primitives to Base UI only where behavior can be locked by existing and new tests; page work is primarily class and CSS restructuring with runtime geometry left inline.

**Tech Stack:** React 18, Vite 5, plain CSS with cascade layers, Base UI React primitives, Node `test`, existing source-contract tests, browser visual verification.

## Global Constraints

- Only UI, layout, styling, responsive presentation and behavior-equivalent component internals may change.
- Do not change LANraragi API calls, routing, persistence keys, cache keys, reader rendering, super-resolution, upload, deduplication or PWA behavior.
- Light theme uses bone paper, graphite, vermilion and moss; dark theme is the same material language in low light, not blue-black.
- Reader image stage remains `#050505` in both themes.
- Use Noto Sans SC/JP already bundled; no remote font.
- Radius scale is exactly 4 / 6 / 8px except true circles.
- Touch targets are at least 44x44px for primary touch controls and icon buttons.
- Motion uses 160-260ms `cubic-bezier(.32,.72,0,1)`, transform/opacity only for spatial motion, and respects `prefers-reduced-motion`.
- No marketing hero, decorative gradient, persistent glass blur, nested cards or page-section cards.
- Existing ARIA, Escape, outside-click, focus return, touch and context-menu behavior must remain equivalent.
- Do not modify `src/main.jsx` Service Worker behavior or `src/components/PwaStatus.jsx` update behavior.

## File Map

- `src/styles/tokens.css`: primitive, semantic and compatibility theme tokens.
- `src/styles/base.css`: reset, typography, focus, scrollbar and utility foundations.
- `src/styles/primitives.css`: buttons, fields, surfaces, toolbars, tags and feedback.
- `src/styles/pages.css`: login, home, archive-list, upload, dedupe and metadata layout.
- `src/styles/reader.css`: settings and Reader exterior only.
- `src/index.css`: legacy rules during migration plus ordered imports and final compatibility cleanup.
- `src/lib/theme.js`: approved default dark palette and custom theme semantic token output.
- `src/components/*`: only shared controls whose behavior is protected by tests.
- `src/pages/*` and `src/App.jsx`: class assignment and structural wrappers only; no data-flow changes.
- `tests/ui-system.test.mjs`: new visual-system source contracts.
- `tests/regression-contracts.test.mjs`: update obsolete visual expectations while retaining behavior contracts.
- `tests/run.mjs`: import the new UI suite.

---

### Task 1: Token and CSS Layer Foundation

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/base.css`
- Modify: `src/index.css`
- Modify: `src/lib/theme.js`
- Create: `tests/ui-system.test.mjs`
- Modify: `tests/run.mjs`
- Modify: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Produces semantic variables `--canvas`, `--surface`, `--surface-subtle`, `--surface-inset`, `--text-primary`, `--text-secondary`, `--border-subtle`, `--border-strong`, `--accent`, `--positive`, `--reader-stage` and legacy aliases.
- `createCustomThemeTokens(palette, resolvedTheme)` continues returning the existing legacy tokens and adds semantic aliases.
- No React call sites change.

- [ ] **Step 1: Write the failing token and layer tests**

Add `tests/ui-system.test.mjs` with source contracts that require:

```js
test('archive atelier exposes layered semantic theme tokens', () => {
  const css = read('src/styles/tokens.css');
  assert.match(css, /@layer tokens/);
  assert.match(css, /--canvas:\s*#121310/i);
  assert.match(css, /--surface:\s*#1b1c18/i);
  assert.match(css, /--accent:\s*#d16a57/i);
  assert.match(css, /--reader-stage:\s*#050505/i);
  assert.match(css, /data-theme="light"[\s\S]*--canvas:\s*#f2efe8/i);
  assert.match(css, /--radius-xs:\s*4px/);
  assert.match(css, /--radius-sm:\s*6px/);
  assert.match(css, /--radius-md:\s*8px/);
});

test('index css imports the archive atelier layers in order', () => {
  const css = read('src/index.css');
  assert.match(css, /^@layer reset, tokens, base, primitives, components, pages, utilities;/);
  assert.ok(css.indexOf("./styles/tokens.css") < css.indexOf("./styles/base.css"));
});
```

Update obsolete dark-blue and light-reader-stage assertions in `regression-contracts.test.mjs` to require the approved warm dark values and `#050505` reader stage.

- [ ] **Step 2: Run the new suite and confirm RED**

Run: `node --test tests/ui-system.test.mjs`

Expected: FAIL because `src/styles/tokens.css` and layered imports do not exist.

- [ ] **Step 3: Add tokens, base rules and compatibility aliases**

Implement both themes in `tokens.css`, including old names such as:

```css
--page-bg: var(--canvas);
--surface-1: var(--surface);
--text-main: var(--text-primary);
--text-sub: var(--text-secondary);
--glass-border: var(--border-subtle);
--olive: var(--positive);
--reader-stage-bg: var(--reader-stage);
```

Move only reset, body typography, focus and scrollbar foundations into `base.css`. Leave legacy selectors in `index.css` until later tasks.

Update `DEFAULT_THEME_PALETTES.dark`, `THEME_COLORS`, `CUSTOM_THEME_PROPERTIES` and `createCustomThemeTokens` so custom dark themes use warm text/borders and expose all new semantic variables while preserving old keys.

- [ ] **Step 4: Run focused and full foundation checks**

Run:

```powershell
node --test tests/ui-system.test.mjs
npm test
npm run lint
```

Expected: all pass.

- [ ] **Step 5: Commit the foundation**

```powershell
git add src/styles/tokens.css src/styles/base.css src/index.css src/lib/theme.js tests/ui-system.test.mjs tests/run.mjs tests/regression-contracts.test.mjs
git commit -m "style(ui): add archive atelier tokens"
```

---

### Task 2: Shared Visual Primitives

**Files:**
- Create: `src/styles/primitives.css`
- Modify: `src/index.css`
- Modify: `src/components/ToggleSwitch.jsx`
- Modify: `src/components/Toast.jsx`
- Modify: `src/components/MetadataTagChip.jsx`
- Modify: `tests/ui-system.test.mjs`

**Interfaces:**
- Produces class variants `.btn-primary`, `.btn-secondary`, `.btn-quiet`, `.btn-danger`, `.btn-icon`, `.field`, `.surface`, `.toolbar`, `.tag`, `.feedback-*`.
- Existing `.btn`, `.input-glass`, `.glass-panel`, `.toggle-switch-track`, `.toast-*` remain valid compatibility entry points.
- Component props and event signatures remain unchanged.

- [ ] **Step 1: Add failing primitive-state contracts**

Require the five button variants, 38px default height, 44px icon target, 6px control radius, semantic field error styling, flat surfaces, 200ms custom curve and reduced-motion coverage.

```js
assert.match(css, /\.btn-icon\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/s);
assert.match(css, /\.surface\s*\{[^}]*background:\s*var\(--surface\);[^}]*box-shadow:\s*none/s);
assert.match(css, /cubic-bezier\(\.32,\s*\.72,\s*0,\s*1\)/);
```

- [ ] **Step 2: Confirm RED**

Run: `node --test tests/ui-system.test.mjs`

Expected: FAIL on missing `primitives.css` and variants.

- [ ] **Step 3: Implement primitive CSS and remove static inline appearance**

Add compatibility selectors so existing markup receives the new system without event changes. Replace static inline colors/radii in `ToggleSwitch` with state classes; keep only checked-derived class logic. Replace text close glyphs in Toast and MetadataTagChip with existing AppGlyph components or CSS-masked existing glyphs while preserving accessible labels and click handlers.

- [ ] **Step 4: Verify focused tests and behavior contracts**

Run:

```powershell
node --test tests/ui-system.test.mjs tests/regression-contracts.test.mjs
npm run lint
```

Expected: all pass.

- [ ] **Step 5: Commit primitives**

```powershell
git add src/styles/primitives.css src/index.css src/components/ToggleSwitch.jsx src/components/Toast.jsx src/components/MetadataTagChip.jsx tests/ui-system.test.mjs
git commit -m "style(ui): unify shared primitives"
```

---

### Task 3: Base UI Overlay Behavior

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/components/ConfirmDialog.jsx`
- Modify: `src/components/CustomSelect.jsx`
- Modify: `src/components/ArchiveContextMenu.jsx`
- Modify: `src/components/DedupeArchiveContextMenu.jsx`
- Modify: `src/components/SettingHint.jsx`
- Modify: `src/styles/primitives.css`
- Modify: `tests/ui-system.test.mjs`
- Modify: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Preserve every exported component name and prop signature.
- Base UI owns focus management, Escape, outside press, listbox/menu semantics and Portal for migrated components.
- Existing callbacks fire exactly once with the same payload.

- [ ] **Step 1: Add failing behavior-equivalence source contracts**

Require `@base-ui/react` imports in migrated components, unchanged exports and props, no duplicate document-level Escape listener in migrated controls, and existing callback names.

- [ ] **Step 2: Confirm RED**

Run: `node --test tests/ui-system.test.mjs tests/regression-contracts.test.mjs`

Expected: FAIL because components are still entirely custom.

- [ ] **Step 3: Install the exact Base UI version**

Run: `npm install --save-exact @base-ui/react@1.7.0`

Expected: `package.json` and lockfile record exactly `1.7.0`.

- [ ] **Step 4: Migrate one primitive at a time**

Order: ConfirmDialog, CustomSelect, ArchiveContextMenu, DedupeArchiveContextMenu, SettingHint. After each component, run the focused contracts. Use Base UI `Root`, `Trigger`, `Portal`, `Backdrop`, `Popup`, `Positioner`, `Item` parts as applicable; map Base UI data states to Readoshi classes. Do not migrate ThemeColorPicker or TagSuggest in this task.

- [ ] **Step 5: Verify full behavior and build**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all pass; built app contains Base UI chunks without duplicate React.

- [ ] **Step 6: Commit overlay migration**

```powershell
git add package.json package-lock.json src/components/ConfirmDialog.jsx src/components/CustomSelect.jsx src/components/ArchiveContextMenu.jsx src/components/DedupeArchiveContextMenu.jsx src/components/SettingHint.jsx src/styles/primitives.css tests/ui-system.test.mjs tests/regression-contracts.test.mjs
git commit -m "refactor(ui): adopt Base UI overlays"
```

---

### Task 4: Archive Browsing Surfaces

**Files:**
- Create: `src/styles/pages.css`
- Modify: `src/index.css`
- Modify: `src/pages/Home.jsx`
- Modify: `src/pages/HistoryPage.jsx`
- Modify: `src/pages/WatchlistPage.jsx`
- Modify: `src/components/ArchiveCard.jsx`
- Modify: `src/components/ArchiveGrid.jsx`
- Modify: `src/components/ArchiveSearchBox.jsx`
- Modify: `tests/ui-system.test.mjs`
- Modify: `tests/regression-contracts.test.mjs`

**Interfaces:**
- All existing props, refs, scroll snapshots, archive actions and search handlers remain unchanged.
- Adds structural classes `content-band`, `page-header`, `page-summary`, `archive-workspace`, `archive-toolbar`.
- Runtime width, progress and Portal coordinates may remain inline.

- [ ] **Step 1: Add failing page and card visual contracts**

Require unframed Home content bands, shared History/Watchlist header and workspace classes, 8px cover radius, 2–3px moss progress, no whole-card watchlist fill, static visual inline-style reduction, and 390px `min-width:0`/wrapping rules.

- [ ] **Step 2: Confirm RED**

Run: `node --test tests/ui-system.test.mjs`

Expected: FAIL on missing layout classes and old radii/colors.

- [ ] **Step 3: Apply classes without changing handlers**

Replace only wrapper class names and static style objects. Preserve every state hook, effect, callback, data attribute, ref and conditional. Make Home carousels unframed bands; make all-archives the primary bordered workspace. Share header/action/summary structure between History and Watchlist.

- [ ] **Step 4: Normalize ArchiveCard visual states**

Keep thumbnail loading, compact mode, wide mode, selection, tag panel and progress semantics. Remove persistent card shadow and full-card status coloring; use border, marker, text and moss progress. Ensure hover transform is at most `translateY(-2px)` and disabled state remains readable.

- [ ] **Step 5: Verify focused and full contracts**

Run:

```powershell
node --test tests/ui-system.test.mjs tests/archive-layout.test.mjs tests/archive-progress.test.mjs tests/regression-contracts.test.mjs
npm test
npm run lint
```

Expected: all pass.

- [ ] **Step 6: Commit archive browsing UI**

```powershell
git add src/styles/pages.css src/index.css src/pages/Home.jsx src/pages/HistoryPage.jsx src/pages/WatchlistPage.jsx src/components/ArchiveCard.jsx src/components/ArchiveGrid.jsx src/components/ArchiveSearchBox.jsx tests/ui-system.test.mjs tests/regression-contracts.test.mjs
git commit -m "style(ui): refine archive browsing"
```

---

### Task 5: Login and Workbench Pages

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/pages/UploadPage.jsx`
- Modify: `src/pages/DeduplicatePage.jsx`
- Modify: `src/pages/MetadataPage.jsx`
- Modify: `src/components/ExecutionProgressPanel.jsx`
- Modify: `src/styles/pages.css`
- Modify: `tests/ui-system.test.mjs`
- Modify: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Login, config import, upload, dedupe and metadata callbacks remain unchanged.
- Adds `workbench-page`, `workbench-header`, `workbench-section`, `workbench-row` classes.
- Does not modify request payloads, worker readiness checks or navigation guards.

- [ ] **Step 1: Add failing workbench contracts**

Require shared workbench classes, no nested `.glass-panel` section shells, upload queue divider rows, 8px maximum non-circular radius, one primary action per group and mobile single-column layouts.

- [ ] **Step 2: Confirm RED**

Run: `node --test tests/ui-system.test.mjs`

Expected: FAIL on missing shared workbench structure.

- [ ] **Step 3: Restyle login, Upload and Metadata**

Move static App login button styles into variants. Make Upload source/queue/result areas flat workbench sections; keep drag/drop and task context menus. Make Metadata editor sections unframed with a desktop main/auxiliary grid and mobile stack; preserve dirty guard and tag animation logic.

- [ ] **Step 4: Restyle Deduplicate**

Keep group selection, chain grouping, comparison signals and execution behavior. Use a single bounded duplicate-group work unit; remove card-inside-card chrome and use dividers between candidates.

- [ ] **Step 5: Verify behavior and full suite**

Run:

```powershell
node --test tests/ui-system.test.mjs tests/deduplicate-selection.test.mjs tests/regression-contracts.test.mjs
npm test
npm run lint
```

Expected: all pass.

- [ ] **Step 6: Commit workbench pages**

```powershell
git add src/App.jsx src/pages/UploadPage.jsx src/pages/DeduplicatePage.jsx src/pages/MetadataPage.jsx src/components/ExecutionProgressPanel.jsx src/styles/pages.css tests/ui-system.test.mjs tests/regression-contracts.test.mjs
git commit -m "style(ui): unify workbench pages"
```

---

### Task 6: Settings and Reader Exterior

**Files:**
- Create: `src/styles/reader.css`
- Modify: `src/index.css`
- Modify: `src/pages/Home.jsx`
- Modify: `src/pages/Reader.jsx`
- Modify: `src/components/EhComments.jsx`
- Modify: `src/components/ArchiveThumbnailDialog.jsx`
- Modify: `tests/ui-system.test.mjs`
- Modify: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Settings state, stored keys, defaults and submit/reset behavior remain unchanged.
- Reader image, page, layout, preload, super-resolution and immersive state code remains unchanged.
- Only settings wrappers, toolbar/drawer classes and CSS change.

- [ ] **Step 1: Add failing Settings and Reader exterior contracts**

Require desktop settings navigation/content grid, mobile top tabs, flat settings rows, 44px Reader toolbar targets, `#050505` stage, warm low-light panels and no UI stylesheet changes to Reader image geometry selectors.

- [ ] **Step 2: Confirm RED**

Run: `node --test tests/ui-system.test.mjs tests/reader-layout.test.mjs tests/reader-ui-state.test.mjs`

Expected: FAIL on missing reader stylesheet/layout contract.

- [ ] **Step 3: Restructure Settings presentation only**

Add a desktop navigation wrapper around existing category tabs and content; retain active category state and all fields. CSS changes it to 180px + content above 768px and top tabs below. Remove static center alignment and card rows.

- [ ] **Step 4: Apply Reader exterior stylesheet**

Style toolbar, buttons, settings drawer, archive drawer, thumbnail dialog, comments and immersive controls. Do not change PageImage, loadSpread, loadImg, decode, cache, super-resolution or paging code. Limit JSX changes to static classes or wrapper elements.

- [ ] **Step 5: Verify Reader behavior contracts**

Run:

```powershell
node --test tests/ui-system.test.mjs tests/reader-layout.test.mjs tests/reader-ui-state.test.mjs tests/super-resolution.test.mjs tests/regression-contracts.test.mjs
npm test
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit Settings and Reader UI**

```powershell
git add src/styles/reader.css src/index.css src/pages/Home.jsx src/pages/Reader.jsx src/components/EhComments.jsx src/components/ArchiveThumbnailDialog.jsx tests/ui-system.test.mjs tests/regression-contracts.test.mjs
git commit -m "style(reader): unify low-light chrome"
```

---

### Task 7: Cleanup and Cross-Viewport Verification

**Files:**
- Modify: `src/index.css`
- Modify: `src/styles/*.css`
- Modify: affected JSX files only where static inline appearance remains
- Modify: `scripts/theme-self-check.mjs`
- Modify: `tests/ui-system.test.mjs`
- Modify: `README.md` only if the user-visible theme description is obsolete

**Interfaces:**
- No new production behavior.
- Removes obsolete duplicate and `glass-*` visual definitions only after all consumers use new primitives or compatibility aliases.

- [ ] **Step 1: Add cleanup and responsive contracts**

Require no banned blue theme values, no decorative page gradients, no static visual inline backgrounds on primary page wrappers, no non-circular radius above 8px in new styles, reduced-motion coverage, and media rules for 1440/1024/768/390 verification.

- [ ] **Step 2: Confirm RED and identify exact remaining selectors**

Run:

```powershell
node --test tests/ui-system.test.mjs
rg -n "#0f1115|#171b23|#4a9ff0|linear-gradient|backdrop-filter|border-radius:\s*(1[0-9]|[2-9][0-9])px" src
rg -n "style=\{\{[^}]*?(background|borderRadius|boxShadow|fontSize|padding)" src/App.jsx src/pages src/components
```

Expected: tests/searches identify only allowed shimmer, runtime geometry or compatibility cases; every other hit gets removed or justified in the test allowlist.

- [ ] **Step 3: Remove obsolete visual overrides and update self-check**

Delete duplicate legacy selectors after confirming computed equivalents in new layers. Update `theme-self-check.mjs` to inspect approved light/dark semantic tokens, `#050505` reader stage and browser theme color.

- [ ] **Step 4: Run complete automated gate**

Run:

```powershell
npm test
npm run lint
npm run check
node scripts/theme-self-check.mjs
npm run build
git diff --check
```

Expected: all exit 0.

- [ ] **Step 5: Run browser matrix**

Start Vite on an unused port and inspect login plus every reachable route at 1440x900, 1024x768, 768x1024 and 390x844 in light and dark themes. With a real LANraragi server, also cover content, empty, loading, error, selected and open-overlay states. Record:

- no horizontal overflow;
- no text/control overlap or clipping;
- all menus/dialogs remain in viewport;
- 44px touch controls where required;
- keyboard focus and Escape/focus return;
- Reader normal/immersive, single/spread/webtoon exterior;
- no console errors or warnings caused by the UI migration.

- [ ] **Step 6: Review functional diff boundary**

Run:

```powershell
git diff -- src/lib/api.js src/lib/navigation.js src/lib/history.js src/lib/watchlist.js src/lib/imageCache.js src/lib/readerRenderPipeline.js src/lib/superResolution.js src/main.jsx src/components/PwaStatus.jsx
```

Expected: no functional diff. Any unavoidable import-only or class-only diff must be manually justified.

- [ ] **Step 7: Commit final cleanup**

```powershell
git add src tests scripts/theme-self-check.mjs README.md
git commit -m "style(ui): finish archive atelier refresh"
```

## Final Acceptance

- Every existing route presents the approved Archive Atelier visual language.
- Light and dark themes are visibly the same product family.
- Base UI supplies behavior only; Readoshi owns all visible styling.
- Existing automated functionality and Reader pipelines pass unchanged.
- Browser matrix has no overflow, overlap, clipping, focus loss or new console errors.
- Production build succeeds and the working diff contains no unrelated changes.
