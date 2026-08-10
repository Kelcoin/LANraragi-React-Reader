import assert from 'node:assert/strict';
import test from 'node:test';
import * as readerUiState from '../src/lib/readerUiState.js';
import { resolveReaderToolbarMode } from '../src/lib/readerUiState.js';

test('reader compact layout follows viewport width rather than touch capability', () => {
  assert.equal(readerUiState.isReaderMobileViewport(767, false), true);
  assert.equal(readerUiState.isReaderMobileViewport(1024, true), false);
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

test('reader skeleton toolbar includes the super-resolution button on desktop and mobile', () => {
  const desktop = readerUiState.getReaderToolbarGroups(false).right;
  const mobile = readerUiState.getReaderToolbarGroups(true).right;
  assert.ok(desktop.includes('超分'), 'desktop skeleton toolbar must include 超分');
  assert.equal(desktop.length, 5, 'desktop right group keeps 沉浸/封面/设定/超分/缩略');
  assert.equal(mobile.length, 5, 'mobile right group keeps 5 icon slots (incl. super-resolution)');
});
