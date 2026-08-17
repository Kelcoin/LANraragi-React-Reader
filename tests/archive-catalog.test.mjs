import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getArchiveAddedAt,
  mergeArchiveProgress,
  sliceArchiveCatalog,
  sortArchiveCatalog,
} from '../src/lib/archiveCatalog.js';
import * as archiveSearch from '../src/lib/archiveSearch.js';

test('archive catalog sorts stably by added date and title without mutating input', () => {
  const items = [
    { arcid: 'b', title: 'Beta', tags: 'date_added:10' },
    { arcid: 'a', title: 'Alpha', tags: 'date_added:20' },
    { arcid: 'c', title: 'alpha', tags: 'date_added:20' },
  ];

  assert.equal(getArchiveAddedAt({ date_added: 7 }), 7);
  assert.deepEqual(sortArchiveCatalog(items, 'date_added', 'desc').map((item) => item.arcid), ['a', 'c', 'b']);
  assert.deepEqual(sortArchiveCatalog(items, 'title', 'asc').map((item) => item.arcid), ['a', 'c', 'b']);
  assert.deepEqual(items.map((item) => item.arcid), ['b', 'a', 'c']);
});

test('archive catalog slices safely', () => {
  const items = [{ arcid: 'a' }, { arcid: 'b' }, { arcid: 'c' }];
  assert.deepEqual(sliceArchiveCatalog(items, 1, 1).map((item) => item.arcid), ['b']);
  assert.deepEqual(sliceArchiveCatalog(items, -5, 2).map((item) => item.arcid), ['a', 'b']);
});

test('archive catalog progress updates preserve metadata', () => {
  const archive = {
    arcid: 'progress-archive',
    title: 'Progress title',
    tags: 'artist:test',
    isnew: true,
    progress: 1,
    lastreadtime: 10,
  };

  const updated = mergeArchiveProgress(archive, 'progress-archive', 5, 123);

  assert.equal(updated.title, 'Progress title');
  assert.equal(updated.tags, 'artist:test');
  assert.equal(updated.progress, 5);
  assert.equal(updated.lastreadtime, 123);
  assert.equal(updated.isnew, false);
});

test('archive search total ignores empty API values and preserves a known total', () => {
  assert.equal(typeof archiveSearch.getArchiveSearchTotal, 'function');
  assert.equal(archiveSearch.getArchiveSearchTotal({ recordsFiltered: null }, 20, 48), 48);
  assert.equal(archiveSearch.getArchiveSearchTotal({ recordsFiltered: '' }, 20, 48), 48);
  assert.equal(archiveSearch.getArchiveSearchTotal({ recordsFiltered: 0 }, 0, 48), 0);
  assert.equal(archiveSearch.getArchiveSearchTotal({}, 0), 0);
  assert.equal(archiveSearch.getArchiveSearchTotal({}, 20), null);
});

test('archive filtering ignores empty and whitespace-only queries', () => {
  assert.equal(archiveSearch.hasArchiveSearchQuery(''), false);
  assert.equal(archiveSearch.hasArchiveSearchQuery('   '), false);
  assert.equal(archiveSearch.hasArchiveSearchQuery('artist:test'), true);
});
