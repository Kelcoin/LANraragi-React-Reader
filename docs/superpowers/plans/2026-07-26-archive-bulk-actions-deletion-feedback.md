# Archive Bulk Actions and Deletion Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair archive multi-selection visuals and animation, add bulk Favorites, and give every archive deletion flow shared progress and E-Hentai failure feedback.

**Architecture:** Keep LANraragi and E-Hentai behavior in existing API helpers. Extract only the progress panel and deletion failure dialog already duplicated by the requested surfaces, then wire each page to those shared components.

**Tech Stack:** React 18, CSS, LANraragi category API wrapper, Node test runner.

## Global Constraints

- No new dependencies.
- E-Hentai removal failure never blocks the LANraragi delete attempt.
- Preserve three-attempt retry behavior for E-Hentai and LANraragi deletion.
- Bulk Favorites is non-destructive and starts without confirmation.
- Browser verification is required before any push or merge.

---

### Task 1: Archive selection indicator and action-row motion

**Files:**
- Modify: `src/components/ArchiveCard.jsx`
- Modify: `src/index.css`
- Test: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Consumes: `selectionMode`, `selected`, `onSelectToggle` props.
- Produces: `.archive-card-selection-checkbox` and `role="checkbox"` selection contract.

- [ ] **Step 1: Write the failing regression contract**

Assert `ArchiveCard` renders a selection indicator and exposes checkbox semantics. Assert `.archive-selection-actions[data-open="true"]`, not `data-mounted`, owns `grid-template-rows: 1fr`.

- [ ] **Step 2: Run the target test and verify expected failures**

Run: `node --test tests/regression-contracts.test.mjs`

Expected: selection-indicator and action-row selector assertions fail.

- [ ] **Step 3: Implement minimal card and CSS changes**

Render the indicator only in selection mode:

```jsx
{selectionMode && (
  <span className={`archive-card-selection-checkbox${selected ? ' is-selected' : ''}`} aria-hidden="true" />
)}
```

Add `role`, `aria-checked`, keyboard Space/Enter selection, fixed indicator styles, and change the open grid selector to `data-open="true"`.

- [ ] **Step 4: Run target test and verify pass**

Run: `node --test tests/regression-contracts.test.mjs`

Expected: all regression contracts pass.

### Task 2: Shared operation progress and deletion failure UI

**Files:**
- Create: `src/components/ExecutionProgressPanel.jsx`
- Create: `src/components/ArchiveDeletionFailureDialog.jsx`
- Modify: `src/pages/DeduplicatePage.jsx`
- Test: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Produces: `ExecutionProgressPanel({ progress })`.
- Produces: `ArchiveDeletionFailureDialog({ report, onClose, message })` where `report` contains `ehFailures` and `lrrFailures` arrays.

- [ ] **Step 1: Write failing shared-component contracts**

Assert both shared files exist, Dedupe imports them, and local duplicate implementations are gone.

- [ ] **Step 2: Run target test and verify expected failure**

Run: `node --test tests/regression-contracts.test.mjs`

Expected: shared component files/imports are absent.

- [ ] **Step 3: Extract existing tested markup without behavior changes**

Move percentage clamping and progress markup verbatim. Move EH URL copy state, EH link list, LANraragi failure list, and close behavior into the shared failure dialog.

- [ ] **Step 4: Run target test and verify pass**

Run: `node --test tests/regression-contracts.test.mjs`

Expected: Dedupe behavior contracts pass.

### Task 3: Home bulk Favorites and bulk deletion progress

**Files:**
- Modify: `src/pages/Home.jsx`
- Modify: `src/index.css`
- Test: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Consumes: `setArchiveFavorite(archiveId, true)`.
- Consumes: `ExecutionProgressPanel` and `ArchiveDeletionFailureDialog`.
- Produces: bulk operation progress state and reports with archive titles/messages.

- [ ] **Step 1: Write failing Home contracts**

Assert button order is select-all, `收藏所选`, delete-selected. Assert bulk deletion passes `continueOnFavoriteError: true`, collects EH URLs, updates progress per item, prevents dismissal while running, and reports failures.

- [ ] **Step 2: Run target test and verify expected failures**

Run: `node --test tests/regression-contracts.test.mjs`

Expected: bulk favorite/progress/failure assertions fail.

- [ ] **Step 3: Implement bulk Favorites**

Process `selectedArchiveList` sequentially through `setArchiveFavorite(id, true)`, update progress before and after each item, retain selection, and show a completion report with per-archive failures.

- [ ] **Step 4: Implement bulk deletion progress and failure collection**

Call `deleteArchiveWithFavoriteSync` directly with:

```js
{
  syncEnabled: workerReady && ehFavoriteDeleteSync,
  confirmationEnabled: bulkDeleteSyncConfirmed,
  continueOnFavoriteError: true,
  onFavoriteError: ({ galleryUrl, error }) => collectEhFailure(galleryUrl, error),
}
```

Keep failed LANraragi archives selected, close confirmation after completion, and open the shared report when failures exist.

- [ ] **Step 5: Run target test and verify pass**

Run: `node --test tests/regression-contracts.test.mjs`

Expected: all Home bulk contracts pass.

### Task 4: Single-delete failure reporting across every archive surface

**Files:**
- Modify: `src/pages/Home.jsx`
- Modify: `src/pages/HistoryPage.jsx`
- Modify: `src/pages/MetadataPage.jsx`
- Modify: `src/components/Recommendations.jsx`
- Test: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Consumes: `deleteArchiveWithFavoriteSync` continuation options.
- Consumes: `ArchiveDeletionFailureDialog`.

- [ ] **Step 1: Write failing caller coverage contract**

For every archive deletion surface, assert `continueOnFavoriteError: true`, `onFavoriteError`, shared report rendering, and existing confirmation switch behavior. Assert Recommendations no longer calls `lrrApi.deleteArchive` directly.

- [ ] **Step 2: Run target test and verify expected failures**

Run: `node --test tests/regression-contracts.test.mjs`

Expected: Home, History, Metadata, and Recommendations caller assertions fail.

- [ ] **Step 3: Wire each caller to shared continuation behavior**

Collect a single EH failure by URL for single deletion. Preserve each page's existing local removal and error handling. Metadata defers navigation until the failure report closes. Recommendations adds the existing E-Hentai sync switch and removes direct raw API deletion.

- [ ] **Step 4: Run target and full verification**

Run:

```powershell
node --test tests/regression-contracts.test.mjs
npm test
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0; full suite reports zero failures.

- [ ] **Step 5: Browser verification and release continuation**

Verify checkbox unselected/selected states, smooth action-row open/close, bulk Favorites progress, bulk deletion progress, and EH/LANraragi report layouts. Then review `main...dev`, bump package version, push `dev`, merge/push `main`, trigger `mobile-build.yml`, wait for success, and write release notes from previous release tag to new tag only.
