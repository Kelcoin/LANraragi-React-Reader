# Reader Border Crop Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move automatic border cropping into the Reading settings category and make it compose correctly with split-wide and rotate-wide rendering.

**Architecture:** Extend the existing pure split-frame geometry with optional normalized crop insets. Reuse the resulting frame and clip region in normal and immersive rendering, while preserving the existing non-split crop translation and zero-inset behavior.

**Tech Stack:** React 18, browser image/canvas APIs, Node test runner, Vite, ESLint.

## Global Constraints

- Preserve behavior when automatic border cropping is disabled.
- Split-wide continues to take precedence over rotate-wide.
- Double-page slots center their content independently.
- Add no dependencies and avoid unrelated refactors.

---

### Task 1: Cropped Split Geometry

**Files:**
- Modify: `tests/reader-layout.test.mjs`
- Modify: `src/lib/readerLayout.js`

**Interfaces:**
- Consumes: `getContainedHalfFrame(size, container, cropSide)`
- Produces: `getContainedHalfFrame(size, container, cropSide, cropInsets)` returning `{ width, height, left, top, clipInsets }`

- [ ] **Step 1: Write the failing geometry test**

Add literal assertions for left and right halves of a `2000x1000` image in a `900x700` slot with `{ top: 0.1, right: 0.05, bottom: 0.05, left: 0.1 }`. Assert the selected content halves are centered and clip at the content midpoint.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/reader-layout.test.mjs`

Expected: FAIL because the helper ignores crop insets and does not return `clipInsets`.

- [ ] **Step 3: Implement the minimal generalized geometry**

Normalize the content bounds, split their horizontal interval at its midpoint, contain the selected interval in the slot, and return full-image coordinates plus normalized clip insets. Default insets must reproduce the existing frame.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/reader-layout.test.mjs`

Expected: all reader-layout tests pass.

### Task 2: Reader Rendering And Setting Placement

**Files:**
- Modify: `tests/image-performance.test.mjs`
- Modify: `tests/regression-contracts.test.mjs`
- Modify: `src/pages/Reader.jsx`

**Interfaces:**
- Consumes: crop-aware `getContainedHalfFrame` and `getBorderCropCenterTranslation`
- Produces: matching crop behavior in normal and immersive page renderers

- [ ] **Step 1: Write failing rendering contracts**

Assert that the crop setting belongs to the Reading panel, normal split rendering uses returned clip insets, and immersive decoding records/draws detected insets before applying split or rotation styles.

- [ ] **Step 2: Run focused contracts and verify RED**

Run: `node --test tests/image-performance.test.mjs tests/regression-contracts.test.mjs`

Expected: FAIL because split and immersive render paths do not consume border insets and the setting remains under General.

- [ ] **Step 3: Implement minimal rendering changes**

Move the settings row. Pass detected insets into split geometry, format its clip path, detect/store immersive insets from decoded images, and compose immersive crop translation after optional rotation. Clear stored crop data on unload and include the setting in effect dependencies.

- [ ] **Step 4: Run focused contracts and verify GREEN**

Run: `node --test tests/image-performance.test.mjs tests/regression-contracts.test.mjs`

Expected: both files pass.

### Task 3: Full Verification

**Files:**
- Review: all changed files

**Interfaces:**
- Consumes: completed implementation
- Produces: verified local `dev` changes

- [ ] **Step 1: Run full verification**

Run `npm test`, `npm run lint`, `npm run check`, `npm run build`, and `git diff --check`.

- [ ] **Step 2: Review diff against confirmed behavior**

Confirm setting placement, zero-inset compatibility, split priority, normal/immersive parity, double-page slot independence, and absence of debug code.

- [ ] **Step 3: Commit locally**

Stage only the task files and create a conventional commit. Do not push unless requested.
