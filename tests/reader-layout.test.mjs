import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReaderSpreads,
  classifyMangaPageSizes,
  getContainedHalfFrame,
  getAdjacentSpreadLocation,
  getSpreadProgressPage,
  getImmersiveSpreadGeometry,
  getPendingSpreadRenderState,
  hasWebtoonTag,
  isWidePageSize,
  resolveAutoReadingLayout,
} from '../src/lib/readerLayout.js';

test('pending spread keeps previous slot geometry while target pages decode', () => {
  const cover = [{ pageIndex: 0, splitPart: 0, cropSide: null }];
  const spread = [
    { pageIndex: 1, splitPart: 0, cropSide: null },
    { pageIndex: 2, splitPart: 0, cropSide: null },
  ];
  assert.deepEqual(getPendingSpreadRenderState(spread, cover, true), {
    units: spread,
    visibleSlotCount: 1,
  });
  assert.deepEqual(getPendingSpreadRenderState(cover, spread, true), {
    units: [cover[0], spread[1]],
    visibleSlotCount: 2,
  });
  assert.deepEqual(getPendingSpreadRenderState(spread, cover, false), {
    units: spread,
    visibleSlotCount: 2,
  });
});

test('Webtoon metadata tag matching is exact and case insensitive', () => {
  assert.equal(hasWebtoonTag('artist:a, other:webtoon, language:english'), true);
  assert.equal(hasWebtoonTag('OTHER:WebToon'), true);
  assert.equal(hasWebtoonTag('other:webtoon parody'), false);
  assert.equal(hasWebtoonTag(null), false);
});

test('manga page classifier requires enough conventional portrait samples', () => {
  const matching = (ratio) => ({ width: ratio * 1000, height: 1000 });
  assert.equal(classifyMangaPageSizes([matching(0.5), matching(0.65), matching(0.58)]).isManga, true);
  assert.equal(classifyMangaPageSizes([matching(0.58), matching(0.58)]).isManga, false);
  assert.equal(classifyMangaPageSizes([
    ...Array.from({ length: 7 }, () => matching(0.58)),
    ...Array.from({ length: 3 }, () => matching(0.8)),
  ]).isManga, true);
  assert.equal(classifyMangaPageSizes([
    ...Array.from({ length: 6 }, () => matching(0.58)),
    ...Array.from({ length: 4 }, () => matching(0.8)),
  ]).isManga, false);
});

test('auto layout prioritizes scrolling comics and gates double page by manga proportions', () => {
  assert.equal(resolveAutoReadingLayout({ isWebtoon: true, isManga: false, containerWidth: 1600 }), 'webtoon');
  assert.equal(resolveAutoReadingLayout({ isWebtoon: false, isManga: false, containerWidth: 1600 }), 'single');
  assert.equal(resolveAutoReadingLayout({ isWebtoon: false, isManga: true, containerWidth: 1299, doublePageMinWidth: 1300 }), 'single');
  assert.equal(resolveAutoReadingLayout({ isWebtoon: false, isManga: true, containerWidth: 1300, doublePageMinWidth: 1300 }), 'double');
});

test('immersive spread geometry keeps portrait pages adjacent instead of centering them in half screens', () => {
  const geometry = getImmersiveSpreadGeometry({
    viewportWidth: 1600,
    viewportHeight: 900,
    gap: 4,
    ratios: [0.7, 0.7],
  });
  assert.deepEqual(geometry, {
    width: 1264,
    height: 900,
    gap: 4,
    pageWidths: [630, 630],
  });
});

test('single immersive page geometry stays centered and bounded', () => {
  assert.deepEqual(getImmersiveSpreadGeometry({
    viewportWidth: 800,
    viewportHeight: 1000,
    gap: 6,
    ratios: [0.5],
  }), {
    width: 500,
    height: 1000,
    gap: 0,
    pageWidths: [500],
  });
});

test('fits and centers the selected bitmap half without letterbox drift', () => {
  const left = getContainedHalfFrame(
    { width: 1500, height: 1000 },
    { width: 850, height: 680 },
    'left',
  );
  const right = getContainedHalfFrame(
    { width: 1500, height: 1000 },
    { width: 850, height: 680 },
    'right',
  );
  const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001);
  closeTo(left.width, 1020);
  closeTo(left.height, 680);
  closeTo(left.left, 170);
  closeTo(left.top, 0);
  closeTo(right.width, 1020);
  closeTo(right.height, 680);
  closeTo(right.left, -340);
  closeTo(right.top, 0);
});

test('splits and centers the detected content rectangle instead of the bordered bitmap', () => {
  const cropInsets = { top: 0.1, right: 0.05, bottom: 0.05, left: 0.1 };
  const left = getContainedHalfFrame(
    { width: 2000, height: 1000 },
    { width: 900, height: 700 },
    'left',
    cropInsets,
  );
  const right = getContainedHalfFrame(
    { width: 2000, height: 1000 },
    { width: 900, height: 700 },
    'right',
    cropInsets,
  );
  const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001);

  closeTo(left.width, 1647.058824);
  closeTo(left.height, 823.529412);
  closeTo(left.left, -64.705882);
  closeTo(left.top, -82.352941);
  assert.deepEqual(left.clipInsets, { top: 0.1, right: 0.475, bottom: 0.05, left: 0.1 });

  closeTo(right.width, 1647.058824);
  closeTo(right.height, 823.529412);
  closeTo(right.left, -764.705882);
  closeTo(right.top, -82.352941);
  assert.deepEqual(right.clipInsets, { top: 0.1, right: 0.05, bottom: 0.05, left: 0.525 });
});

test('detects only pages wider than the configured landscape threshold', () => {
  assert.equal(isWidePageSize({ width: 1200, height: 1000 }), false);
  assert.equal(isWidePageSize({ width: 1201, height: 1000 }), true);
  assert.equal(isWidePageSize({ width: 0, height: 0 }), false);
});

test('double-page spreads keep the cover single and pair subsequent pages', () => {
  const spreads = buildReaderSpreads({ pageCount: 6, doublePage: true, direction: 'ltr' });
  assert.deepEqual(spreads.map((spread) => spread.map(({ pageIndex }) => pageIndex)), [
    [0], [1, 2], [3, 4], [5],
  ]);
});

test('rtl reverses visual placement without reversing reading progression', () => {
  const spreads = buildReaderSpreads({ pageCount: 5, doublePage: true, direction: 'rtl' });
  assert.deepEqual(spreads.map((spread) => spread.map(({ pageIndex }) => pageIndex)), [
    [0], [2, 1], [4, 3],
  ]);
  assert.deepEqual(getAdjacentSpreadLocation(spreads, { pageIndex: 0, splitPart: 0 }, 1), { pageIndex: 1, splitPart: 0 });
});

test('split wide pages become sequential halves and are never paired back together', () => {
  const spreads = buildReaderSpreads({
    pageCount: 5,
    doublePage: true,
    splitWidePages: new Set([2]),
    direction: 'rtl',
  });
  assert.deepEqual(spreads, [
    [{ pageIndex: 0, splitPart: 0, cropSide: null }],
    [{ pageIndex: 1, splitPart: 0, cropSide: null }],
    [{ pageIndex: 2, splitPart: 0, cropSide: 'right' }],
    [{ pageIndex: 2, splitPart: 1, cropSide: 'left' }],
    [{ pageIndex: 4, splitPart: 0, cropSide: null }, { pageIndex: 3, splitPart: 0, cropSide: null }],
  ]);
});

test('split page progress advances only after its second half is reached', () => {
  const spreads = buildReaderSpreads({ pageCount: 3, splitWidePages: new Set([1]), direction: 'ltr' });
  assert.equal(getSpreadProgressPage(spreads[1]), 1);
  assert.equal(getSpreadProgressPage(spreads[2]), 2);
  assert.deepEqual(getAdjacentSpreadLocation(spreads, { pageIndex: 1, splitPart: 0 }, 1), { pageIndex: 1, splitPart: 1 });
  assert.deepEqual(getAdjacentSpreadLocation(spreads, { pageIndex: 1, splitPart: 1 }, 1), { pageIndex: 2, splitPart: 0 });
  assert.deepEqual(getAdjacentSpreadLocation(spreads, { pageIndex: 1, splitPart: 0 }, -1), { pageIndex: 0, splitPart: 0 });
});
