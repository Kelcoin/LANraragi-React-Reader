import assert from 'node:assert/strict';
import test from 'node:test';
import * as deduplicate from '../src/lib/deduplicate.js';
import {
  createDedupeSavedResultPayload,
  compactDedupeArchives,
  getDuplicateSelectionDisabledIds,
  groupDuplicatePairsByChain,
  normalizeDuplicateSelection,
  selectDuplicateDeletionIds,
} from '../src/lib/deduplicate.js';

const groups = [['A', 'B'], ['A', 'C'], ['B', 'C']];

test('duplicate selection keeps one archive in every connected component', () => {
  assert.deepEqual(normalizeDuplicateSelection(groups, ['A', 'B', 'C']), ['A', 'B']);
  assert.deepEqual(normalizeDuplicateSelection([['A', 'B'], ['A', 'C']], ['B', 'C']), ['B', 'C']);
});

test('duplicate selection allows direct pair members while retaining one archive in the chain', () => {
  assert.deepEqual(normalizeDuplicateSelection([['A', 'B'], ['A', 'C']], ['A', 'B']), ['A', 'B']);
  assert.deepEqual(normalizeDuplicateSelection([['A', 'B'], ['A', 'C']], ['A', 'C']), ['A', 'C']);
  assert.deepEqual(normalizeDuplicateSelection([['A', 'B'], ['A', 'C']], ['A', 'A']), ['A']);
});

test('duplicate selection exposes candidates that would violate interlocks', () => {
  assert.deepEqual(
    Array.from(getDuplicateSelectionDisabledIds(groups, new Set(['A', 'B']))).sort(),
    ['C'],
  );
  assert.deepEqual(
    Array.from(getDuplicateSelectionDisabledIds([['A', 'B'], ['A', 'C']], new Set(['B', 'C']))).sort(),
    ['A'],
  );
});

test('smart selection deletes rough translations before every keep-quality rule', () => {
  assert.deepEqual(selectDuplicateDeletionIds([
    { arcid: 'rough', tags: 'other:uncensored, other:rough translation', size: 9999 },
    { arcid: 'clean', tags: 'other:extraneous ads', size: 1 },
  ]), ['rough']);
});

test('smart selection preserves manually touched groups while selecting untouched groups', () => {
  assert.equal(typeof deduplicate.mergeSmartDuplicateSelection, 'function');
  const groups = [
    [
      { arcid: 'manual-rough', tags: 'other:rough translation', size: 10 },
      { arcid: 'manual-clean', tags: '', size: 20 },
    ],
    [
      { arcid: 'auto-rough', tags: 'other:rough translation', size: 10 },
      { arcid: 'auto-clean', tags: '', size: 20 },
    ],
  ];
  const manualKey = 'manual-clean|manual-rough';
  const result = deduplicate.mergeSmartDuplicateSelection(
    groups,
    new Set([manualKey]),
    ['manual-rough'],
    [],
  );
  assert.deepEqual(result.archiveIds, ['manual-rough', 'auto-rough']);
  assert.deepEqual(result.groupKeys, []);
});

test('smart selection preserves manually selected whole groups', () => {
  const groups = [
    [
      { arcid: 'manual-a', tags: '', size: 10 },
      { arcid: 'manual-b', tags: '', size: 20 },
    ],
    [
      { arcid: 'auto-rough', tags: 'other:rough translation', size: 10 },
      { arcid: 'auto-clean', tags: '', size: 20 },
    ],
  ];
  const manualKey = 'manual-a|manual-b';
  const result = deduplicate.mergeSmartDuplicateSelection(
    groups,
    new Set([manualKey]),
    [],
    [manualKey],
  );
  assert.deepEqual(result.archiveIds, ['auto-rough']);
  assert.deepEqual(result.groupKeys, [manualKey]);
});

test('smart selection signals normalize the three visible priority tags', () => {
  assert.equal(typeof deduplicate.getDedupeSmartSelectionSignals, 'function');
  assert.deepEqual(deduplicate.getDedupeSmartSelectionSignals({
    tags: ' OTHER:Rough Translation , other:EXTRANEOUS ADS, Other:Uncensored ',
  }), {
    roughTranslation: true,
    extraneousAds: true,
    uncensored: true,
  });
  assert.deepEqual(deduplicate.getDedupeSmartSelectionSignals({ tags: 'artist:test' }), {
    roughTranslation: false,
    extraneousAds: false,
    uncensored: false,
  });
});

test('duplicate pairs remain pairs while connected chains are displayed together', () => {
  assert.deepEqual(groupDuplicatePairsByChain([
    ['D', 'E'],
    ['A', 'B'],
    ['X', 'Y'],
    ['A', 'C'],
    ['E', 'F'],
  ]), [
    [['D', 'E'], ['E', 'F']],
    [['A', 'B'], ['A', 'C']],
    [['X', 'Y']],
  ]);
});

test('dedupe persistence keeps only visible archives and whitelisted fields', () => {
  const archiveA = { arcid: 'A', title: 'A', tags: 'artist:a', size: 10, pagecount: 2, progress: 1, date_added: 123, unrelated: 'drop-me' };
  const archiveB = { id: 'B', title: 'B', filesize: 20, total: 3, page: 2, extra: { large: true } };
  const compact = compactDedupeArchives([[archiveA, archiveB], [archiveA]]);
  assert.deepEqual(compact, [
    { arcid: 'A', title: 'A', tags: 'artist:a', size: 10, pagecount: 2, progress: 1, date_added: 123 },
    { id: 'B', title: 'B', filesize: 20, total: 3, page: 2 },
  ]);
});

test('dedupe persistence rebuilds the snapshot from remaining groups and removes empty results', () => {
  const archiveA = { arcid: 'A', title: 'A', unrelated: 'drop-me' };
  const archiveB = { arcid: 'B', title: 'B' };
  const archiveC = { arcid: 'C', title: 'C' };
  const payload = createDedupeSavedResultPayload({
    groups: [[archiveA, archiveB]],
    dateRange: { start: '2026-01-01', end: '2026-07-19' },
    status: '已删除 1 个档案',
    lastScanStats: { pairCount: 2 },
    workerWarning: '',
    selectedArchiveIds: new Set(['A', 'C']),
    selectedGroupKeys: new Set(['A|B', 'B|C']),
    savedAt: '2026-07-19T00:00:00.000Z',
  });

  assert.deepEqual(payload.groups, [['A', 'B']]);
  assert.deepEqual(payload.archives, [
    { arcid: 'A', title: 'A' },
    { arcid: 'B', title: 'B' },
  ]);
  assert.deepEqual(payload.selectedArchiveIds, ['A']);
  assert.deepEqual(payload.selectedGroupKeys, ['A|B']);
  assert.equal(createDedupeSavedResultPayload({ groups: [] }), null);
  assert.equal(createDedupeSavedResultPayload({ groups: [[archiveC]] }), null);
});
