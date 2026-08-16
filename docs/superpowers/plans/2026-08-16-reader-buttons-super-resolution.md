# Reader Buttons And Super-Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize affected button text alignment and make archive super-resolution shut down cleanly on failures and immersive exit, with confirmation for oversized pages.

**Architecture:** Keep button fixes in existing shared/local CSS. Keep super-resolution decisions in `readerUiState.js`, while `Reader.jsx` owns UI state, cancellation, toasts, and the existing shared confirmation dialog.

**Tech Stack:** React, CSS, Node test runner, Base UI `ConfirmDialog`.

## Global Constraints

- Reuse the existing 64,000,000 output-pixel safety limit; add no new threshold.
- Abort/cancellation is silent and does not disable super-resolution.
- Other processing errors disable only the current archive, not the global setting.
- Oversized pages remain original even after archive-level confirmation.
- Avoid new components and broad button-system refactors.

---

### Task 1: Button normalization

**Files:**
- Modify: `src/styles/primitives.css`
- Modify: `src/index.css`
- Test: `tests/ui-system.test.mjs`

- [ ] Add a failing CSS contract covering normalized button line layout and zero inactive E-Hentai action gap.
- [ ] Run the focused UI-system test and confirm the new assertions fail.
- [ ] Add the minimal shared font/line-height/alignment declarations and local gap correction.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Super-resolution state decisions

**Files:**
- Modify: `src/lib/readerUiState.js`
- Test: `tests/reader-ui-state.test.mjs`

- [ ] Change the failure-policy test so every notified processing error disables archive super-resolution while `AbortError` remains silent.
- [ ] Add a failing test for the existing output-pixel boundary used by oversized confirmation.
- [ ] Run the focused state tests and confirm expected failures.
- [ ] Implement the minimal failure and oversized-confirmation helpers.
- [ ] Re-run the focused tests and confirm they pass.

### Task 3: Reader lifecycle and confirmation UI

**Files:**
- Modify: `src/pages/Reader.jsx`
- Test: `tests/regression-contracts.test.mjs`

- [ ] Add failing reader contracts for a shared archive-disable callback, immersive-exit cleanup, and `ConfirmDialog` wiring.
- [ ] Run the focused contract tests and confirm expected failures.
- [ ] Route error and immersive exit through the shared callback.
- [ ] Keep the oversized-page toggle visible, open confirmation on enable, and enable only after confirmation.
- [ ] Re-run focused tests and then all project checks.
- [ ] Review the diff, commit, and push `dev` to `origin/dev`.

### Task 4: Home watchlist card entrance

**Files:**
- Modify: `src/lib/readerUiState.js`
- Modify: `src/pages/Home.jsx`
- Modify: `src/index.css`
- Test: `tests/reader-ui-state.test.mjs`
- Test: `tests/regression-contracts.test.mjs`

- [ ] Add failing tests that distinguish a newly inserted watchlist ID from refreshes and removals.
- [ ] Add failing UI contracts for the one-shot card class, entrance keyframes, and reduced-motion override.
- [ ] Run focused tests and confirm expected failures.
- [ ] Mark only the newly inserted card and clear the marker after the animation.
- [ ] Add the 280ms fade/rise/scale animation and disable it for reduced motion.
- [ ] Re-run focused and full verification.

### Task 5: Home watchlist card exit

**Files:**
- Modify: `src/lib/readerUiState.js`
- Modify: `src/pages/Home.jsx`
- Modify: `src/index.css`
- Test: `tests/reader-ui-state.test.mjs`
- Test: `tests/regression-contracts.test.mjs`

- [ ] Add failing tests for removed-ID detection and delayed card removal.
- [ ] Confirm the focused tests fail because removal state and styles are absent.
- [ ] Retain successfully removed cards for a 220ms non-interactive exit animation.
- [ ] Bypass the delay under reduced motion and leave failed removals visible.
- [ ] Run focused and full verification before commit and push.
