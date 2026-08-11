# Web Super-Resolution Implementation Plan

> **For agentic workers:** Implement only the task assigned to you. Do not revert unrelated working-tree edits.

**Goal:** Connect the reader's existing super-resolution controls to one real, manifest-driven ONNX model with manifest-selected execution, WebGL/WASM support, cancellation, and original-image fallback.

**Architecture:** A small main-thread runtime owns model manifests and backend selection. A Worker owns ORT sessions and request cancellation; compatible manifests default to WebGL then WASM, while the official x3 model selects WASM because ORT WebGL 1.27 rejects its anonymous batch dimension. Reader calls the runtime inside the existing decode queue and keeps the original Blob/Object URL as the fallback. Tiling and pixel layout are isolated pure functions.

**Tech Stack:** React/Vite, `onnxruntime-web`, Web Worker, OffscreenCanvas/ImageBitmap, Cache API, existing reader image/decode queues, Node assertion tests.

## Global Constraints

- Do not distribute a model weight until its license and checksum are recorded.
- WebGL is preferred; WASM/CPU must remain a usable fallback.
- Reuse the existing Reader decode queue and image cache; do not add a second general-purpose queue.
- Every new branch/loop has a focused failing test before implementation.
- Cancelled or stale requests must never replace the current page image.
- Large/unsupported/animated images must retain the original-image path.

---

### Task 1: Model Manifest And Tiling Contract

**Files:**
- Modify: `src/lib/superResolution.js`
- Create: `src/lib/superResolutionTiling.js`
- Test: `tests/super-resolution.test.mjs`

**Produces:** `getSuperResolutionModel(value)`, `validateSuperResolutionManifest(manifest)`, `createTilePlan(width, height, options)`, and `getOutputTileRect(tile, scale)`.

- [x] Write failing tests for manifest validation and edge tile plans.
- [x] Run `npm test` and confirm the new assertions fail for missing exports.
- [x] Implement only validation and deterministic tile geometry; no DOM, model loading, or image decoding.
- [x] Run the focused test and then the full test suite.

### Task 2: Runtime And WASM Worker

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src/lib/superResolution.js`
- Create: `src/lib/superResolutionRuntime.js`
- Create: `src/lib/superResolution.worker.js`
- Test: `tests/super-resolution.test.mjs`

**Consumes:** Task 1 manifest and tile contracts.

**Produces:** `createSuperResolutionRuntime({ workerFactory, sessionFactory, fetcher })` with `init`, `processBlob`, `cancel`, and `dispose`.

- [x] Add failing protocol tests for init/process/cancel/dispose and WebGL-to-WASM fallback.
- [x] Run the focused test and confirm the failure is caused by the missing runtime contract.
- [x] Add the smallest `onnxruntime-web` integration; load it lazily and keep model/session state per manifest/backend.
- [x] Keep worker messages structured as `{ type, requestId, ... }`; transfer pixel buffers and return Blob metadata.
- [x] Use Cache API for model bytes and reject checksum/license metadata that is absent from a production manifest.
- [x] Run focused and full tests; record browser-only limitations separately.

### Task 3: Reader Current-Page Integration

**Files:**
- Modify: `src/pages/Reader.jsx`
- Test: `tests/regression-contracts.test.mjs`

**Consumes:** Task 2 `processBlob` contract.

- [x] Add failing source-contract assertions showing that the current-page decode path passes the archive SR state and preserves original fallback.
- [x] Integrate SR between source Blob acquisition and `getReaderPreviewSource` in `PageImage` and the immersive current-page loader.
- [x] Cancel the request in the existing decode-ticket cleanup and ignore stale results.
- [x] Reuse existing loading/error feedback and `showToast` only for a user-triggered failure.
- [x] Run focused tests and lint.

### Task 4: Preload And Cache Integration

**Files:**
- Modify: `src/pages/Reader.jsx`, `src/lib/imageCache.js`
- Test: `tests/image-performance.test.mjs`, `tests/regression-contracts.test.mjs`

**Consumes:** Task 2 runtime and Task 3 current-page behavior.

- [x] Add failing assertions for SR cache keys, bounded preload count, and cancellation on archive change.
- [x] Cache derived results under a stable page/model/manifest key through the existing image cache API.
- [x] Schedule at most `settings.preloadCount` adjacent SR jobs at preload priority; never block the critical current page.
- [x] Ensure derived Object URLs follow existing retirement/clear behavior.
- [x] Run focused tests, full tests, lint, and build.

### Task 5: Browser Verification And Release Notes

**Files:**
- Modify: `findings.md`, `progress.md`, `task_plan.md`
- Test: existing test suite plus a real browser run with an authorized manifest

- [x] Verify model fetch/cache, WebGL initialization limits, WASM execution, current-page cancellation contracts, output dimensions, and no super-resolution console errors in dev and production builds.
- [x] Run `npm test`, `npm run lint`, `npm run check`, `npm run build`, and `git diff --check`.
- [x] Record model URL, checksum, license evidence, browser limitations, and deferred model options.

Live Reader visual and peak-memory testing with real archive pages remains in the root project plan because this environment has no reachable LANraragi backend.
