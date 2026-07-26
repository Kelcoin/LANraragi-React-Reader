# Favorites, Filter Count, and Worker Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add toggleable LANraragi Favorites actions, fix restored filter totals, and hide Worker-only controls without valid Worker configuration.

**Architecture:** Extend existing API/category modules instead of adding a service layer. Put pure normalization and validation helpers in existing library files so Node tests can exercise them directly; shared menus consume one Favorites helper and existing pages consume one Worker readiness helper.

**Tech Stack:** React 18, browser Fetch API, LANraragi HTTP API, Node test runner, ESLint, Vite.

## Global Constraints

- Server category name remains `🔖 Favorites`; UI label is `⭐收藏夹`.
- Worker readiness requires a valid HTTP(S) URL and a non-empty Token.
- No new dependencies or speculative configuration.
- Protected LANraragi calls retain existing Base64 Bearer authentication.
- All behavior changes follow failing-test-first TDD.

---

### Task 1: Search Total Normalization

**Files:**
- Modify: `src/lib/archiveSearch.js`
- Modify: `src/pages/Home.jsx`
- Test: `tests/archive-catalog.test.mjs`

**Interfaces:**
- Produces: `getArchiveSearchTotal(response, dataLength, previousTotal = null): number | null`
- Consumes: LANraragi search responses and existing `archiveTotal` state.

- [ ] **Step 1: Write failing tests** covering `null` and empty response totals preserving `previousTotal`, explicit numeric zero remaining zero, and an empty result without prior total returning zero.
- [ ] **Step 2: Run `node --test tests/archive-catalog.test.mjs`** and confirm failure because `getArchiveSearchTotal` is not exported.
- [ ] **Step 3: Implement `getArchiveSearchTotal`** by rejecting `null`, `undefined`, and blank strings before numeric conversion; use it from `Home.jsx` and prevent snapshot `null` from becoming zero.
- [ ] **Step 4: Run `node --test tests/archive-catalog.test.mjs`** and confirm pass.

### Task 2: Worker Readiness and Hidden Controls

**Files:**
- Modify: `src/lib/worker-config.js`
- Modify: `src/pages/Home.jsx`
- Modify: `src/pages/HistoryPage.jsx`
- Modify: `src/pages/WatchlistPage.jsx`
- Modify: `src/pages/DeduplicatePage.jsx`
- Test: `tests/api-and-input.test.mjs`
- Test: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Produces: `hasValidWorkerConfig(url = getWorkerUrl(), token = getSyncToken()): boolean`
- Consumes: persisted or temporary Worker URL and Token values.

- [ ] **Step 1: Write failing tests** for valid HTTPS/HTTP configurations, malformed URLs, unsupported protocols, and blank tokens; add UI source contracts requiring conditional rendering instead of disabled Worker controls.
- [ ] **Step 2: Run the two focused test files** and confirm failures for missing helper and conditions.
- [ ] **Step 3: Implement URL validation** with native `URL`, accepting only `http:` and `https:` and trimmed non-empty Token.
- [ ] **Step 4: Conditionally render Worker refresh and E-Hentai sync controls; in dedupe mode skip ignored-pair calls and hide whole-group marking when invalid.** Ensure restored group selections are cleared when Worker is unusable.
- [ ] **Step 5: Run the focused tests** and confirm pass.

### Task 3: LANraragi Favorites Toggle

**Files:**
- Modify: `src/lib/api.js`
- Modify: `src/lib/categories.js`
- Modify: `src/components/ArchiveContextMenu.jsx`
- Modify: `src/components/DedupeArchiveContextMenu.jsx`
- Modify: `src/pages/Home.jsx`
- Test: `tests/api-and-input.test.mjs`
- Test: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Produces: category mutation API methods using form encoding and path parameters.
- Produces: `FAVORITES_CATEGORY_NAME`, `getCategoryDisplayName(category)`, `getFavoriteState(archiveId)`, and `setArchiveFavorite(archiveId, favorite)` in `categories.js`.
- Consumes: category cache, LANraragi API methods, archive IDs from both context menus.

- [ ] **Step 1: Write failing tests** for fixed display mapping, existing membership, missing-category creation, add/remove calls, cache mutation, menu labels, and `aria-live` status.
- [ ] **Step 2: Run focused tests** and confirm failures for missing Favorites behavior.
- [ ] **Step 3: Extend API request handling** to send `URLSearchParams` as `application/x-www-form-urlencoded`; add create/add/remove category methods with encoded path segments.
- [ ] **Step 4: Implement category helpers** using existing cache, one fresh category load before mutation, exact-name lookup, and cache notification after success.
- [ ] **Step 5: Add async toggle buttons** to shared and deduplicate context menus; keep menu open on failure and expose polite status text.
- [ ] **Step 6: Apply `getCategoryDisplayName`** to Home category chips and refresh Home category state after mutations.
- [ ] **Step 7: Run focused tests** and confirm pass.

### Task 4: Full Verification

**Files:**
- Review: all modified source and test files.

**Interfaces:**
- Consumes: completed behavior from Tasks 1-3.
- Produces: verified implementation.

- [ ] **Step 1: Run `npm test`** and require zero failures.
- [ ] **Step 2: Run `npm run lint`** and require zero errors or warnings.
- [ ] **Step 3: Run `npm run build`** and require exit code zero.
- [ ] **Step 4: Run `git diff --check`** and require no whitespace errors.
- [ ] **Step 5: Start Vite and inspect desktop/mobile context menus, category label, filter count restoration, and hidden Worker controls in browser.**
- [ ] **Step 6: Review changed UI files against current Web Interface Guidelines** and resolve every introduced issue.

