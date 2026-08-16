# Immersive Pinch Rubber-Band Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add restrained elastic pinch overshoot below `1.0` and above `3.0`, with release snap-back and no change to normal zoom mapping.

**Architecture:** Put the piecewise scale mapping in the existing pure reader UI state module. Keep gesture state and rendering in `Reader.jsx`; pinch calls the helper and explicitly allows temporary lower overshoot through the existing transform path.

**Tech Stack:** React, JavaScript ES modules, Node test runner, ESLint, Vite

## Global Constraints

- Direct pinch mapping stays unchanged from `1.0` through `3.0`.
- Lower overshoot approaches `0.90`; upper overshoot approaches `3.35`.
- Release snaps to `1.0` or `3.0` using existing `0.15s ease-out` animation and release focal point.
- Double-tap, wheel zoom, panning, page swiping, and Webtoon mode do not change.
- Add no dependency and no new animation system.

---

### Task 1: Pure Rubber-Band Mapping

**Files:**
- Modify: `src/lib/readerUiState.js:181`
- Test: `tests/reader-ui-state.test.mjs:191`

**Interfaces:**
- Consumes: raw pinch scale as a number.
- Produces: `resolveImmersivePinchScale(rawScale): number`.

- [ ] **Step 1: Write failing mapping tests**

Add:

```js
test('immersive pinch scale stays linear inside normal bounds', () => {
  assert.equal(readerUiState.resolveImmersivePinchScale(1), 1);
  assert.equal(readerUiState.resolveImmersivePinchScale(1.8), 1.8);
  assert.equal(readerUiState.resolveImmersivePinchScale(3), 3);
});

test('immersive pinch scale progressively resists lower and upper overshoot', () => {
  const lowerNear = readerUiState.resolveImmersivePinchScale(0.95);
  const lowerFar = readerUiState.resolveImmersivePinchScale(0.5);
  const upperNear = readerUiState.resolveImmersivePinchScale(3.1);
  const upperFar = readerUiState.resolveImmersivePinchScale(4);

  assert.ok(lowerNear < 1 && lowerNear > 0.9);
  assert.ok(lowerFar < lowerNear && lowerFar > 0.9);
  assert.ok(upperNear > 3 && upperNear < 3.35);
  assert.ok(upperFar > upperNear && upperFar < 3.35);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/reader-ui-state.test.mjs`

Expected: FAIL because `resolveImmersivePinchScale` is not defined.

- [ ] **Step 3: Add minimal mapping helper**

Add beside existing immersive zoom helpers:

```js
export function resolveImmersivePinchScale(rawScale) {
  const raw = Number(rawScale);
  if (!Number.isFinite(raw)) return 1;
  if (raw < 1) {
    const excess = 1 - raw;
    return 1 - excess / (1 + excess / 0.1);
  }
  if (raw > 3) {
    const excess = raw - 3;
    return 3 + excess / (1 + excess / 0.35);
  }
  return raw;
}
```

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/reader-ui-state.test.mjs`

Expected: all tests PASS.

---

### Task 2: Pinch Integration And Snap-Back

**Files:**
- Modify: `src/pages/Reader.jsx:40-65,1967-2000,2860-2878`
- Test: `tests/regression-contracts.test.mjs:945`

**Interfaces:**
- Consumes: `resolveImmersivePinchScale(rawScale)` from Task 1.
- Produces: elastic visual scale during pinch; existing release handler restores hard bounds.

- [ ] **Step 1: Write failing integration contract**

Add to the immersive zoom regression test:

```js
assert.match(reader, /resolveImmersivePinchScale\(rawScale\)/);
assert.match(reader, /applyZoomAtPoint\([\s\S]{0,180}false, true\)/);
assert.match(reader, /if \(s > 3\.0\) target = 3\.0/);
assert.match(reader, /if \(s < 1\.0\) target = 1\.0/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/regression-contracts.test.mjs`

Expected: FAIL because Reader does not call `resolveImmersivePinchScale`.

- [ ] **Step 3: Wire the helper into pinch handling**

Import `resolveImmersivePinchScale`. Change `applyZoomAtPoint` to accept `allowLowerOvershoot = false`; use `0.9` as its minimum only for that call, and bypass the `scale <= 1.01` snap branch while overshoot is allowed:

```js
const applyZoomAtPoint = useCallback((
  nextScale,
  focalX = window.innerWidth / 2,
  focalY = window.innerHeight / 2,
  commit = true,
  allowLowerOvershoot = false,
) => {
  const prevScale = zoomScaleRef.current || 1;
  let scale = Math.max(allowLowerOvershoot ? 0.9 : 1, Math.min(5, nextScale));

  if (!allowLowerOvershoot && scale <= 1.01) {
    scale = 1;
    panRef.current = { x: 0, y: 0, startX: 0, startY: 0, originX: 0, originY: 0 };
    zoomScaleRef.current = scale;
    if (commit) commitZoomTransform(true);
    else scheduleZoomTransform();
    return scale;
  }
```

Replace pinch hard clamps with:

```js
const rawScale = pinchStartRef.current.scale * (dist / pinchStartRef.current.dist);
const scale = resolveImmersivePinchScale(rawScale);
applyZoomAtPoint(
  scale,
  pinchStartRef.current.cx,
  pinchStartRef.current.cy,
  false,
  true,
);
```

Keep existing release snap conditions and animation path unchanged.

- [ ] **Step 4: Verify focused tests**

Run: `node --test tests/reader-ui-state.test.mjs tests/regression-contracts.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Run complete verification**

Run:

```text
npm test
npm run lint
npm run check
npm run build
git diff --check
```

Expected: every command exits `0`; test report has `0` failures.

- [ ] **Step 6: Commit implementation**

```text
git add src/lib/readerUiState.js src/pages/Reader.jsx tests/reader-ui-state.test.mjs tests/regression-contracts.test.mjs
git commit -m "feat(reader): add elastic pinch bounds"
```
