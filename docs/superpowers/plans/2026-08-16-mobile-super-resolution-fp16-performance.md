# Mobile Super-resolution FP16 Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make warm-session, uncached Waifu2x inference for an 800x1130 page complete with a median below 4 seconds on the reference Android device while keeping reading interaction responsive, then evaluate true FP16 Real-CUGAN only after Waifu2x is stable.

**Architecture:** Preserve the existing single Worker and WebGPU-only runtime. Add rectangular tile geometry and adapter capability propagation, introduce tile-boundary pause/resume without discarding partial output, and ship a separately identified FP16 CUNet graph with a verified FP32 fallback. Device benchmarks decide whether FP16 CUNet ships, whether an explicit UpConv7 fast model is needed, and whether Real-CUGAN FP16 work proceeds.

**Tech Stack:** React 18, Web Worker, ONNX Runtime Web 1.27 WebGPU, TensorFlow.js 4.22 WebGPU, Node test runner, ADB/CDP Android profiling.

## Global Constraints

- Reference device: Android `24091RPADC`, 128 MiB `maxStorageBufferBindingSize`, `shader-f16` supported.
- Performance gate: five warm-session, uncached 800x1130 runs have median below 4 seconds; model download and first session compilation are reported separately.
- Interaction gate: no multi-second Android compositor queue during three scripted swipes; a throughput improvement cannot regress visible interaction.
- FP32 Waifu2x 224x224 input and 152x152 core remain the universal fallback.
- Precision/model changes receive distinct IDs, checksums, and derived-cache identities.
- No parallel Workers, parallel tile inference, unsafe FP32 tile growth, INT8 conversion, or native ncnn bridge in this plan.
- RED tests precede each production change. No production profile ships from synthetic timing alone.

---

### Task 1: Rectangular Tile Geometry and Adapter Capabilities

**Files:**
- Modify: `src/lib/superResolutionTiling.js`
- Modify: `src/lib/superResolution.js`
- Modify: `src/lib/superResolution.worker.js`
- Test: `tests/super-resolution.test.mjs`

**Interfaces:**
- Produces: `createTilePlan(width, height, { tileCore, tileCoreWidth, tileCoreHeight, padding })` returning `tileCoreWidth` and `tileCoreHeight` while retaining `tileCore` for scalar callers.
- Produces: `verifySuperResolutionSupport()` result with optional `adapterInfo: { maxStorageBufferBindingSize, shaderF16 }` on success.
- Consumes: existing manifest fields `inputWidth`, `inputHeight`, `padding`, and scalar `tileCore`.

- [ ] **Step 1: Write failing rectangular geometry and capability tests**

Add focused assertions equivalent to:

```js
const plan = createTilePlan(800, 1130, {
  tileCoreWidth: 152,
  tileCoreHeight: 312,
  padding: 36,
});
assert.equal(plan.columns, 6);
assert.equal(plan.rows, 4);
assert.equal(plan.tiles.length, 24);
assert.deepEqual(plan.tiles.at(-1).core, { x: 760, y: 936, width: 40, height: 194 });

const support = await verifySuperResolutionSupport({ requestAdapter });
assert.deepEqual(support.adapterInfo, {
  maxStorageBufferBindingSize: 134217728,
  shaderF16: true,
});
```

Also assert that scalar callers still return their existing tile plan and that manifest validation rejects a core axis larger than its padded fixed input.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/super-resolution.test.mjs`

Expected: failures show missing independent core axes and missing adapter information; existing tests remain otherwise green.

- [ ] **Step 3: Implement the smallest compatible geometry change**

Normalize independent axes with scalar fallback:

```js
const tileCoreWidth = normalizeTileCore(config.tileCoreWidth ?? config.tileCore);
const tileCoreHeight = normalizeTileCore(config.tileCoreHeight ?? config.tileCore);
```

Use the respective axis for columns, rows, origins, and clipped core sizes. Pass both fields from the Worker manifest. Return adapter limits and `adapter.features.has('shader-f16')` without retaining the adapter object itself.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --test tests/super-resolution.test.mjs`

Expected: all super-resolution tests pass.

- [ ] **Step 5: Commit Task 1**

```text
perf(sr): support adaptive tile geometry
```

### Task 2: Tile-boundary Pause and Resume

**Files:**
- Modify: `src/lib/superResolutionRuntime.js`
- Modify: `src/lib/superResolution.worker.js`
- Modify: `src/lib/realCugan.js`
- Test: `tests/super-resolution.test.mjs`

**Interfaces:**
- Produces: runtime methods `pause(): void` and `resume(): void`.
- Produces: Worker protocol messages `{ type: 'pause' }` and `{ type: 'resume' }`.
- Produces: Worker-local `waitUntilRunnable()` used between tiles; cancellation always wins over pause.

- [ ] **Step 1: Write failing runtime and Worker pause/resume tests**

Cover these contracts:

```js
runtime.pause();
assert.deepEqual(worker.messages.at(-1), { type: 'pause' });
runtime.resume();
assert.deepEqual(worker.messages.at(-1), { type: 'resume' });
```

Start a three-tile request, pause after tile one, release the current tile, and assert `runCount === 1` until resume. After resume, assert the request completes with `runCount === 3`, tile one is not recomputed, and encoding occurs once. While paused, send `cancel`; assert `AbortError`, no further tile, and no encoding.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/super-resolution.test.mjs`

Expected: runtime methods and Worker protocol are absent.

- [ ] **Step 3: Implement protocol and retained partial output**

Keep pause state inside the Worker handler, not the page cache. `pause` sets a boolean; `resume` resolves current waiters. ONNX checks `waitUntilRunnable()` before the first tile and after each yielded tile. Real-CUGAN receives the same gate callback and awaits it at its existing tile boundary. `cancel`, `init`, and `dispose` release waiters so no promise remains stranded.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --test tests/super-resolution.test.mjs`

Expected: all super-resolution tests pass, including existing cancellation and stale-result contracts.

- [ ] **Step 5: Commit Task 2**

```text
fix(sr): resume inference between tiles
```

### Task 3: Complete Reader Interaction Gate

**Files:**
- Modify: `src/lib/readerUiState.js`
- Modify: `src/pages/Reader.jsx`
- Test: `tests/reader-ui-state.test.mjs`
- Test: `tests/regression-contracts.test.mjs`

**Interfaces:**
- Consumes: runtime `pause()` and `resume()` from Task 2.
- Produces: `subscribeSuperResolutionInteraction(target, pause)` covering `pointerdown`, `pointermove`, `wheel`, `scroll`, and navigation `keydown`.
- Produces: quiet resume delay of 650 ms.

- [ ] **Step 1: Write failing interaction coverage tests**

Dispatch each subscribed event and assert pause runs. Verify unrelated key presses do not pause, while `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `PageUp`, `PageDown`, `Home`, `End`, and space do. Verify cleanup removes every listener and the latest event replaces the previous 650 ms timer.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/reader-ui-state.test.mjs tests/regression-contracts.test.mjs`

Expected: event coverage and 650 ms assertions fail against pointerdown-only cancellation.

- [ ] **Step 3: Replace interaction cancellation with pause/resume**

`pauseSuperResolutionForInteraction()` calls `srRuntimeContext.runtime.pause()` once per active interaction window and schedules `runtime.resume()` after 650 ms. Page changes and context teardown keep calling `cancelVisibleSuperResolutionJobs()` and must not resume a disposed or replaced runtime.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --test tests/reader-ui-state.test.mjs tests/regression-contracts.test.mjs`

Expected: both files pass.

- [ ] **Step 5: Commit Task 3**

```text
fix(reader): pause SR during interaction
```

### Task 4: FP16 CUNet Asset, Selection, and FP32 Fallback

**Files:**
- Create: `public/models/waifu2x-cunet-art-scale2x/scale2x-fp16.onnx`
- Modify: `public/models/waifu2x-cunet-art-scale2x/NOTICE.md`
- Modify: `src/lib/superResolution.js`
- Modify: `tests/super-resolution.test.mjs`

**Interfaces:**
- Produces: separately identified FP16 manifest with its own URL, SHA-256 checksum, precision marker, and candidate rectangular tile axes.
- Produces: `selectWaifu2xManifest(adapterInfo, failedProfileIds = new Set())` returning FP16 only when `shaderF16` is true and binding limits satisfy the tested profile, otherwise the FP32-safe manifest.
- Consumes: `adapterInfo` from Task 1 and existing runtime initialization/error handling.

- [ ] **Step 1: Generate and inspect the FP16 graph outside application runtime**

Use a temporary Python environment with `onnx==1.17.0` and `onnxconverter-common==1.14.0`. Call `convert_float_to_float16(model, keep_io_types=True, disable_shape_infer=False)` so browser input/output tensors remain FP32 while eligible internal weights and operators become FP16. Run ONNX checker and shape inference, calculate SHA-256, and record the exact source commit and conversion versions in `NOTICE.md`. Do not add Python packages to application dependencies.

- [ ] **Step 2: Write failing manifest selection and cache identity tests**

Assert FP16 selection requires `shaderF16`, rejects insufficient binding limits, falls back after a recorded FP16 profile failure, validates independent core axes, and produces a cache key distinct from FP32.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `node --test tests/super-resolution.test.mjs`

Expected: no FP16 manifest or selection helper exists.

- [ ] **Step 4: Implement manifest selection and one-time fallback**

Keep candidates as immutable manifests. Runtime initialization tries only the selected manifest; on an FP16 session/shader/binding/output failure, mark that profile failed for the current runtime and initialize the FP32-safe manifest once. Do not retry repeatedly or change model identity after a successful cached result.

- [ ] **Step 5: Run focused tests and static model checks**

Run: `node --test tests/super-resolution.test.mjs`

Run the temporary Python checker against both ONNX files and verify their committed SHA-256 values match the manifests.

Expected: focused tests and both model checks pass.

- [ ] **Step 6: Commit Task 4**

```text
perf(sr): add FP16 Waifu2x profile
```

### Task 5: USB Benchmark, Profile Decision, and Full Verification

**Files:**
- Delete: `scripts/tmp-cdp-action.mjs`
- Delete: `scripts/tmp-cdp-diagnostics.mjs`
- Delete: `scripts/tmp-cdp-frame-sample.mjs`
- Delete: `scripts/tmp-cdp-inference-sample.mjs`
- Delete: `scripts/tmp-device-swipe-sample.mjs`
- Update: `Handoff.md`

**Interfaces:**
- Consumes: all Tasks 1-4.
- Produces: one accepted Waifu2x production profile or a recorded failed CUNet gate that triggers Task 6.

- [ ] **Step 1: Build and deploy the debug candidate**

Build the existing Android debug package flow without changing package data, connect over USB, and confirm CDP reports WebGPU, `shader-f16`, 128 MiB binding limit, and thermal status 0.

- [ ] **Step 2: Benchmark correctness and throughput**

Evict only the current derived SR cache. Run five warm-session 800x1130 inferences, report every sample and median, then repeat the 1058x1500 page. Confirm output dimensions, no seams/corruption, and no shader, binding, pipeline-cache, or device-loss errors.

- [ ] **Step 3: Benchmark interaction and scheduling**

Run three scripted swipes during inference and collect Activity/GPU frame percentiles. Verify pause retains completed tiles, resumes from the next tile after 650 ms, sustained interaction commits no stale output, and a page change truly cancels partial work.

- [ ] **Step 4: Apply the delivery gate**

Accept FP16 CUNet only if the 800x1130 median is below 4 seconds and interaction/quality gates pass. If profile geometry needs adjustment, return to Task 4, add a failing selection/geometry test, and rerun Tasks 4-5. If the graph fails, restore the FP32-safe production default and continue to Task 6; do not tune around a binding or compositor failure.

- [ ] **Step 5: Run complete repository verification**

Run: `npm test`

Run: `npm run lint`

Run: `npm run check`

Run: `npm run build`

Run: `git diff --check`

Expected: every command exits 0.

- [ ] **Step 6: Remove diagnostics, update handoff, and commit**

Record accepted profiles, timing samples, interaction percentiles, fallback behavior, and any deferred branch in `Handoff.md`. Remove all five untracked temporary diagnostics before staging.

```text
docs: record mobile SR performance results
```

### Task 6: Conditional UpConv7 Fast Profile

**Condition:** Execute only if Task 5 proves FP16 CUNet misses the 4-second gate while remaining otherwise stable.

**Files:**
- Create: `public/models/waifu2x-upconv7-art-scale2x/scale2x.onnx`
- Create: `public/models/waifu2x-upconv7-art-scale2x/NOTICE.md`
- Modify: `src/lib/superResolution.js`
- Modify: `src/lib/readerSettings.js`
- Modify: `src/pages/Reader.jsx`
- Test: `tests/super-resolution.test.mjs`
- Test: `tests/api-and-input.test.mjs`

- [ ] **Step 1: Pin a licensed UpConv7 ONNX asset and verify graph/checksum**

Use the same upstream family referenced by Mihon and pin an immutable revision. Record license, source path, checksum, tensor names, layouts, scale, padding, and output crop.

- [ ] **Step 2: Write RED tests for an explicit fast model option**

Assert the selector contains a separately labeled `Waifu2x Fast`, settings normalize it without altering `waifu2x`, and cache keys differ from CUNet.

- [ ] **Step 3: Implement and verify the model**

Add only the manifest and existing selector wiring; reuse the same Worker, scheduling, cache, fallback, and error paths. Run focused tests and the same USB performance, quality, and interaction gates from Task 5.

- [ ] **Step 4: Commit only if gates pass**

```text
perf(sr): add Waifu2x fast profile
```

If the profile fails, remove its uncommitted asset and manifest changes and document the measured reason in `Handoff.md`.

### Task 7: Conditional Real-CUGAN FP16 Evaluation

**Condition:** Execute only after an accepted Waifu2x production profile and scheduling implementation pass all Task 5 gates.

**Files:**
- Create: `public/models/realcugan-2x-conservative/model-fp16.json`
- Create: `public/models/realcugan-2x-conservative/weights-fp16.json`
- Modify: `src/lib/realCugan.js`
- Modify: `src/lib/superResolution.js`
- Test: `tests/super-resolution.test.mjs`

- [ ] **Step 1: Prove whether TensorFlow.js uses FP16 compute/storage**

Create a temporary FP16 candidate and inspect WebGPU tensors/pipelines on the reference device. Reject weight-only compression if TensorFlow.js expands weights or activations to FP32 before inference.

- [ ] **Step 2: Write RED tests for separate FP16 identity and fallback**

Require distinct graph/weight checksums, cache identity, `shader-f16` gating, and one-time FP32 fallback.

- [ ] **Step 3: Benchmark before production selection**

Run five warm-session uncached pages, interaction swipes, output dimension checks, and side-by-side color/line/screentone review. Require a material median speed improvement and no interaction regression.

- [ ] **Step 4: Ship or discard the candidate**

If true GPU inference improves and all gates pass, select FP16 with FP32 fallback and commit:

```text
perf(sr): add FP16 Real-CUGAN profile
```

If it only reduces asset size or fails quality/compatibility, do not ship it; record the result in `Handoff.md`.
