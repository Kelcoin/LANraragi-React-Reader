import assert from 'node:assert/strict';
import test from 'node:test';
import * as readerUiState from '../src/lib/readerUiState.js';
import { resolveReaderToolbarMode } from '../src/lib/readerUiState.js';

test('reader compact layout follows viewport width rather than touch capability', () => {
  assert.equal(readerUiState.isReaderMobileViewport(767, false), true);
  assert.equal(readerUiState.isReaderMobileViewport(1024, true), false);
});

test('super-resolution resumes only after the latest interaction quiet period', () => {
  const callbacks = new Map();
  const delays = [];
  const cleared = [];
  let nextTimer = 0;
  let resumeCount = 0;
  const timers = {
    setTimer(callback, delay) {
      nextTimer += 1;
      callbacks.set(nextTimer, callback);
      delays.push(delay);
      return nextTimer;
    },
    clearTimer(timer) {
      cleared.push(timer);
      callbacks.delete(timer);
    },
  };

  const first = readerUiState.scheduleSuperResolutionResume({
    currentTimer: null,
    resume: () => { resumeCount += 1; },
    ...timers,
  });
  const second = readerUiState.scheduleSuperResolutionResume({
    currentTimer: first,
    resume: () => { resumeCount += 1; },
    ...timers,
  });

  assert.deepEqual(delays, [300, 300]);
  assert.deepEqual(cleared, [first]);
  assert.equal(callbacks.has(first), false);
  callbacks.get(second)();
  assert.equal(resumeCount, 1);
});

test('super-resolution interaction subscription covers UI pointer input and cleans up', () => {
  const target = new EventTarget();
  let pauseCount = 0;
  const unsubscribe = readerUiState.subscribeSuperResolutionInteraction(
    target,
    () => { pauseCount += 1; },
  );

  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(pauseCount, 1);
  unsubscribe();
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(pauseCount, 1);
});

test('page indicator placement uses hysteresis at overlap boundaries', () => {
  const image = { left: 0, right: 100, top: 0, bottom: 100 };
  const clear = { left: 20, right: 80, top: 108, bottom: 128 };
  const borderline = { left: 20, right: 80, top: 102, bottom: 122 };
  assert.equal(readerUiState.resolvePageIndicatorPlacement('hidden', image, borderline, 8), 'hidden');
  assert.equal(readerUiState.resolvePageIndicatorPlacement('hidden', image, clear, 8), 'pinned');
});

test('reader toolbar title uses the symmetric space left between control groups', () => {
  assert.equal(typeof readerUiState.getCenteredToolbarTitleWidth, 'function');
  assert.equal(readerUiState.getCenteredToolbarTitleWidth({
    toolbar: { left: 0, right: 2000 },
    leftGroup: { right: 150 },
    rightGroup: { left: 1700 },
    gap: 16,
  }), 1368);
  assert.equal(readerUiState.getCenteredToolbarTitleWidth({
    toolbar: { left: 0, right: 600 },
    leftGroup: { right: 310 },
    rightGroup: { left: 450 },
    gap: 16,
  }), 0);
});

test('reader toolbar degrades from text to icons before hiding its title', () => {
  const widths = { isMobile: false, fullRequiredWidth: 1100, iconRequiredWidth: 760 };
  assert.equal(resolveReaderToolbarMode({ ...widths, availableWidth: 1200 }), 'full');
  assert.equal(resolveReaderToolbarMode({ ...widths, availableWidth: 900 }), 'icons');
  assert.equal(resolveReaderToolbarMode({ ...widths, availableWidth: 700 }), 'mobile');
});

test('reader toolbar restores richer modes when space returns and mobile stays icon-only', () => {
  const widths = { isMobile: false, fullRequiredWidth: 1000, iconRequiredWidth: 700 };
  assert.equal(resolveReaderToolbarMode({ ...widths, availableWidth: 680 }), 'mobile');
  assert.equal(resolveReaderToolbarMode({ ...widths, availableWidth: 760 }), 'icons');
  assert.equal(resolveReaderToolbarMode({ ...widths, availableWidth: 1080 }), 'full');
  assert.equal(resolveReaderToolbarMode({ ...widths, isMobile: true, availableWidth: 1400 }), 'mobile');
});

test('reader toolbar switches to icons before text reaches the title', () => {
  assert.equal(resolveReaderToolbarMode({
    isMobile: false,
    availableWidth: 1020,
    fullRequiredWidth: 1000,
    iconRequiredWidth: 700,
  }), 'icons');
});

test('reader toolbar retains its full-mode width after labels are hidden', () => {
  assert.equal(typeof readerUiState.rememberReaderToolbarFullWidth, 'function');
  assert.equal(readerUiState.rememberReaderToolbarFullWidth({
    previousWidth: 1100,
    measuredWidth: 900,
    mode: 'icons',
  }), 1100);
  assert.equal(readerUiState.rememberReaderToolbarFullWidth({
    previousWidth: 1100,
    measuredWidth: 1120,
    mode: 'full',
  }), 1120);
});

test('reader skeleton toolbar matches the real toolbar (no super-resolution slot)', () => {
  const desktop = readerUiState.getReaderToolbarGroups(false).right;
  const mobile = readerUiState.getReaderToolbarGroups(true).right;
  assert.ok(!desktop.includes('超分'), 'desktop skeleton toolbar must not include 超分 (topbar button removed)');
  assert.equal(desktop.length, 4, 'desktop right group keeps 沉浸/封面/设定/缩略');
  assert.equal(mobile.length, 4, 'mobile right group keeps 4 icon slots');
});

test('settings natural height adds stacked tabs but uses the tallest desktop column', () => {
  assert.equal(typeof readerUiState.getSettingsPaneNaturalHeight, 'function');
  assert.equal(readerUiState.getSettingsPaneNaturalHeight({
    tabsHeight: 48, contentHeight: 320, gap: 16, inset: 24, stacked: true,
  }), 408);
  assert.equal(readerUiState.getSettingsPaneNaturalHeight({
    tabsHeight: 180, contentHeight: 320, gap: 16, inset: 24, stacked: false,
  }), 344);
});

test('archive super-resolution state never carries across archive ids', () => {
  assert.equal(typeof readerUiState.resolveArchiveSuperResolutionState, 'function');
  const autoSettings = { enabled: true, auto: true, thresholdKb: 500, runtimeReady: true };
  assert.deepEqual(readerUiState.resolveArchiveSuperResolutionState({
    archive: { arcid: 'large', pagecount: 10, size: 8 * 1024 * 1024 },
    ...autoSettings,
    manualOverride: { archiveId: 'small', enabled: true },
  }), { enabled: false, manual: false });
  assert.deepEqual(readerUiState.resolveArchiveSuperResolutionState({
    archive: { arcid: 'small', pagecount: 10, size: 2 * 1024 * 1024 },
    ...autoSettings,
    manualOverride: { archiveId: 'small', enabled: false },
  }), { enabled: false, manual: true });
});

test('foreground super-resolution contains only pages visible in the current reading surface', () => {
  assert.deepEqual([...readerUiState.getForegroundSuperResolutionPageIndices({
    webtoonActive: true,
    currentIndex: 7,
    currentSpread: [{ pageIndex: 6 }, { pageIndex: 7 }],
  })], [7]);
  assert.deepEqual([...readerUiState.getForegroundSuperResolutionPageIndices({
    webtoonActive: false,
    currentIndex: 7,
    currentSpread: [{ pageIndex: 7 }, { pageIndex: 8 }, { pageIndex: 8 }],
  })], [7, 8]);
});

test('immersive tap timing wins over tap location for double-tap zoom', () => {
  assert.equal(typeof readerUiState.resolveImmersiveTapAction, 'function');
  assert.equal(readerUiState.resolveImmersiveTapAction({
    timestamp: 1200,
    x: 20,
    y: 20,
    lastTimestamp: 1000,
    lastX: 100,
    lastY: 100,
  }), 'double-tap');
  assert.equal(readerUiState.resolveImmersiveTapAction({
    timestamp: 1600,
    x: 20,
    y: 20,
    lastTimestamp: 1000,
    lastX: 100,
    lastY: 100,
  }), 'single-tap');
});

test('immersive double tap toggles between normal and zoomed scale', () => {
  assert.equal(typeof readerUiState.resolveImmersiveDoubleTapScale, 'function');
  assert.equal(readerUiState.resolveImmersiveDoubleTapScale(1), 1.75);
  assert.equal(readerUiState.resolveImmersiveDoubleTapScale(1.75), 1);
  assert.equal(readerUiState.resolveImmersiveDoubleTapScale(2.4), 1);
});

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

test('immersive single tap still navigates by click zone', () => {
  assert.equal(typeof readerUiState.resolveImmersiveClickZone, 'function');
  assert.equal(readerUiState.resolveImmersiveClickZone({ x: 100, width: 1000 }), 'previous');
  assert.equal(readerUiState.resolveImmersiveClickZone({ x: 500, width: 1000 }), 'none');
  assert.equal(readerUiState.resolveImmersiveClickZone({ x: 900, width: 1000 }), 'next');
});

test('immersive zoom keeps the requested focal point stable while panned', () => {
  assert.equal(typeof readerUiState.resolveImmersiveZoomPan, 'function');
  assert.deepEqual(readerUiState.resolveImmersiveZoomPan({
    previousScale: 2,
    nextScale: 3,
    panX: -100,
    panY: 50,
    focalX: 250,
    focalY: 150,
    viewportWidth: 1000,
    viewportHeight: 600,
  }), { x: 150, y: 200 });
});

test('super-resolution failures disable the archive except for cancellation', () => {
  assert.deepEqual(readerUiState.resolveSuperResolutionFailure({ name: 'AbortError' }), {
    disable: false, notify: false,
  });
  assert.deepEqual(readerUiState.resolveSuperResolutionFailure(new Error('inference failed')), {
    disable: true, notify: true,
  });
  assert.deepEqual(readerUiState.resolveSuperResolutionFailure({ name: 'NotSupportedError' }), {
    disable: true, notify: true,
  });
});

test('super-resolution oversized confirmation uses the inference output limit', () => {
  assert.equal(readerUiState.isSuperResolutionPageTooLarge({ width: 4000, height: 4000 }, 2), false);
  assert.equal(readerUiState.isSuperResolutionPageTooLarge({ width: 4001, height: 4000 }, 2), true);
  assert.equal(readerUiState.isSuperResolutionPageTooLarge({ width: 0, height: 4000 }, 2), false);
});

test('watchlist insertion detection returns only a newly added archive', () => {
  assert.equal(readerUiState.getNewlyAddedArchiveId(
    [{ id: 'existing', title: 'Old title' }],
    [{ id: 'new' }, { id: 'existing', title: 'New title' }],
  ), 'new');
  assert.equal(readerUiState.getNewlyAddedArchiveId(
    [{ id: 'existing', title: 'Old title' }],
    [{ id: 'existing', title: 'New title' }],
  ), '');
  assert.equal(readerUiState.getNewlyAddedArchiveId([{ id: 'existing' }], []), '');
});

test('archive insertion detection returns every newly visible archive', () => {
  assert.deepEqual(readerUiState.getNewlyAddedArchiveIds(
    [{ id: 'existing' }],
    [{ id: 'first' }, { id: 'existing' }, { id: 'second' }],
  ), ['first', 'second']);
});

test('watchlist removal detection returns only archives missing from the next list', () => {
  assert.deepEqual(readerUiState.getRemovedArchiveIds(
    [{ id: 'removed' }, { id: 'kept', title: 'Old title' }],
    [{ id: 'kept', title: 'New title' }, { id: 'added' }],
  ), ['removed']);
  assert.deepEqual(readerUiState.getRemovedArchiveIds(
    [{ id: 'kept', title: 'Old title' }],
    [{ id: 'kept', title: 'New title' }],
  ), []);
  assert.deepEqual(readerUiState.getRemovedArchiveIds([], [{ id: 'added' }]), []);
});

test('continue-reading visibility excludes completed archives only when hide-read is enabled', () => {
  const items = [
    { id: 'reading', page: 4, total: 10 },
    { id: 'finished', page: 10, total: 10 },
  ];
  assert.deepEqual(readerUiState.getVisibleContinueReadingItems(items, true), [items[0]]);
  assert.deepEqual(readerUiState.getVisibleContinueReadingItems(items, false), items);
});

test('WebGPU shader compile failures disable super resolution for the archive', () => {
  const ortRunError = new Error(
    'failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: Non-zero status code returned while running Conv node.'
      + ' Status Message: Failed to create a WebGPU compute pipeline:'
      + ' [Invalid ShaderModule "Conv2dMM"] is invalid due to a previous error.',
  );
  assert.deepEqual(readerUiState.resolveSuperResolutionFailure(ortRunError), {
    disable: true, notify: true, webgpuShader: true,
  });
});
