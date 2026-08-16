# Mobile Super-resolution Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Reader interaction and original-image decode responsive while mobile WebGPU super-resolution runs.

**Architecture:** Existing Reader cancellation and decode queues remain authoritative. Enhanced upgrades become background jobs, Reader suppresses/restarts them around active interaction, and both inference engines yield between tiles through one injected Worker callback.

**Tech Stack:** React, Web Workers, WebGPU, ONNX Runtime Web, TensorFlow.js, Node test runner.

## Global Constraints

- No new dependency, user setting, cache version, model manifest field, or Worker capability requirement.
- Original images remain visible during processing and every cancellation/failure.
- An active GPU call is not interrupted; cancellation takes effect at the next tile boundary.

---

### Task 1: Cooperative Tile Yield

**Files:**
- Modify: `src/lib/superResolution.worker.js`
- Modify: `src/lib/realCugan.js`
- Test: `tests/super-resolution.test.mjs`

**Interfaces:**
- Consumes: optional `dependencies.yieldControl(): Promise<void>` in `createSuperResolutionWorkerHandler()`.
- Produces: ONNX and Real-CUGAN tile loops await `yieldControl()` after each tile, then re-check cancellation.

- [ ] **Step 1: Write failing tests**

Add an injected deferred `yieldControl` test for a two-tile ONNX request. Assert only one inference runs before release, cancel during yield, release, then expect `AbortError` and one run. Add a direct Real-CUGAN processor test with injected `yieldControl` and the same cancellation assertion.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/super-resolution.test.mjs`

Expected: yield callback is never called or second tile starts before deferred release.

- [ ] **Step 3: Implement minimal yield**

Use one production callback in Worker:

```js
const yieldControl = dependencies.yieldControl
  ?? (() => new Promise((resolve) => setTimeout(resolve, 0)));
```

Pass it to both process paths. Await it after tensor disposal for each completed tile, then throw `AbortError` if cancelled. Extend `createRealCuganProcessor({ tf, model, yieldControl })` without changing callers that omit it.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/super-resolution.test.mjs`

Expected: all super-resolution tests pass.

### Task 2: Background Enhanced-image Jobs

**Files:**
- Modify: `src/pages/Reader.jsx`
- Test: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Consumes: `readerImageDecodeQueue.schedule()` and `IMAGE_LOAD_PRIORITY.PRELOAD`.
- Produces: original decode remains at current priority; enhanced decode/inference uses a separately cancellable background ticket.

- [ ] **Step 1: Write failing contract**

Require both standard and immersive enhanced jobs to use `IMAGE_LOAD_PRIORITY.PRELOAD`; require standard original decode to remain scheduled with `priority`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/regression-contracts.test.mjs`

Expected: standard path has no separate background enhanced job and immersive path inherits foreground priority.

- [ ] **Step 3: Split standard job minimally**

Keep original preview/decode/commit inside the existing ticket. After commit, schedule `processSuperResolutionImageSource()`, enhanced preview decode, and replacement as `superResolutionTicket` with `IMAGE_LOAD_PRIORITY.PRELOAD`. Cancel both tickets during effect cleanup. Change immersive `startSuperResolutionUpgrade()` to the same background priority.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/regression-contracts.test.mjs`

Expected: regression contracts pass.

### Task 3: Interaction Pause and Quiet Retry

**Files:**
- Modify: `src/pages/Reader.jsx`
- Modify: `src/lib/readerUiState.js`
- Test: `tests/reader-ui-state.test.mjs`
- Test: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Produces: `scheduleSuperResolutionResume({ currentTimer, resume, delay, setTimer, clearTimer })` returns the replacement timer.
- Reader calls one `pauseSuperResolutionForInteraction()` from immersive pointer handling and Webtoon scroll handling.

- [ ] **Step 1: Write failing helper and wiring tests**

Test that repeated scheduling clears the previous timer and only the latest callback resumes. Contract-test Reader cancellation at interaction start and `getSuperResolutionForPage()` returning `null` while paused.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/reader-ui-state.test.mjs tests/regression-contracts.test.mjs`

Expected: helper export and Reader wiring are absent.

- [ ] **Step 3: Implement quiet-period gate**

Add a `300ms` timer helper in `readerUiState.js`. Reader stores `srInteractionPaused`, cancels visible jobs on interaction, refreshes the quiet timer, resumes by clearing paused state, and disposes the timer on unmount. Call from immersive pointer down/move and Webtoon scroll. Suppress `getSuperResolutionForPage()` while paused.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/reader-ui-state.test.mjs tests/regression-contracts.test.mjs`

Expected: both files pass.

### Task 4: Full Verification

**Files:**
- Modify only if verification exposes a regression in task-owned code.

- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run check`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and review `git diff`.
- [ ] Commit implementation after all commands pass.
