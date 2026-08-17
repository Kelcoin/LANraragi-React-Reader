import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  ARCHIVE_PROGRESS_VISIBILITY,
  clearArchiveProgressMarker,
  clearArchiveReadingProgress,
  hasArchiveReadingProgress,
  hasArchiveProgressMarker,
  markArchiveProgressCleared,
  shouldShowArchiveProgress,
  shouldPersistArchiveReadingProgress,
} from '../src/lib/archiveProgress.js';

const read = (path) => readFileSync(path, 'utf8');

test('history-only progress visibility excludes watchlist and random archives', () => {
  assert.equal(shouldShowArchiveProgress(ARCHIVE_PROGRESS_VISIBILITY.HISTORY, true), true);
  assert.equal(shouldShowArchiveProgress(ARCHIVE_PROGRESS_VISIBILITY.HISTORY, false), false);
  assert.equal(shouldShowArchiveProgress(ARCHIVE_PROGRESS_VISIBILITY.GLOBAL, false), true);
  assert.equal(shouldShowArchiveProgress(ARCHIVE_PROGRESS_VISIBILITY.DISABLED, true), false);

  const home = read('src/pages/Home.jsx');
  const watchlist = read('src/pages/WatchlistPage.jsx');
  const reader = read('src/pages/Reader.jsx');
  assert.match(home, /showWatchlistArchiveProgress = shouldShowArchiveProgress\(readerSettings\.progressBarVisibility, false\)/);
  assert.match(home, /watchlistWithProgress\.map[\s\S]*?<ArchiveCard[^\n]*showProgressBar={showWatchlistArchiveProgress}/);
  assert.match(watchlist, /showWatchlistArchiveProgress = shouldShowArchiveProgress\(progressBarVisibility, false\)/);
  assert.match(watchlist, /showProgressBar={showWatchlistArchiveProgress}/);
  assert.match(reader, /shouldShowArchiveProgress\(progressBarVisibility, type === 'history'\)/);
});

test('clear progress uses force page zero and removes local history after server success', async () => {
  const calls = [];
  const local = [];
  const result = await clearArchiveReadingProgress({ arcid: 'archive', progress: 9 }, {
    api: {
      getServerInfo: async () => ({ server_tracks_progress: true }),
      updateProgress: async (...args) => calls.push(args),
    },
    removeHistory: async (id) => local.push(['remove', id]),
    saveHistoryEntry: async () => local.push(['save']),
  });
  assert.deepEqual(calls, [['archive', 0, { force: true }]]);
  assert.deepEqual(local, [['remove', 'archive']]);
  assert.deepEqual(result, { page: 0, fallback: false });
});

test('clear progress falls back to page one and updates local history only after fallback succeeds', async () => {
  const calls = [];
  const local = [];
  const archive = { id: 'archive', title: 'Test', progress: 5 };
  const result = await clearArchiveReadingProgress(archive, {
    api: {
      getServerInfo: async () => ({ server_tracks_progress: true }),
      updateProgress: async (id, page, options) => {
        calls.push([id, page, options]);
        if (page === 0) throw new Error('force unsupported');
      },
    },
    removeHistory: async () => local.push(['remove']),
    saveHistoryEntry: async (entry, page) => local.push(['save', entry.arcid, page]),
  });
  assert.deepEqual(calls, [['archive', 0, { force: true }], ['archive', 1, undefined]]);
  assert.deepEqual(local, [['save', 'archive', 1]]);
  assert.deepEqual(result, { page: 1, fallback: true });
});

test('clear progress keeps local state when both server updates fail', async () => {
  let localMutations = 0;
  await assert.rejects(clearArchiveReadingProgress({ arcid: 'archive', progress: 2 }, {
    api: {
      getServerInfo: async () => ({ server_tracks_progress: true }),
      updateProgress: async () => { throw new Error('offline'); },
    },
    removeHistory: async () => { localMutations += 1; },
    saveHistoryEntry: async () => { localMutations += 1; },
  }), /offline/);
  assert.equal(localMutations, 0);
});

test('progress action appears for either server or local progress', () => {
  assert.equal(hasArchiveReadingProgress(null, 0), false);
  assert.equal(hasArchiveReadingProgress({ progress: 0 }, 0), false);
  assert.equal(hasArchiveReadingProgress({ progress: 3 }, 0), true);
  assert.equal(hasArchiveReadingProgress({ progress: 0 }, 2), true);
});

test('cleared progress marker survives navigation until the reader advances past page one', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  markArchiveProgressCleared('archive', storage, 'test-key');
  assert.equal(hasArchiveProgressMarker('archive', storage, 'test-key'), true);
  assert.equal(shouldPersistArchiveReadingProgress(true, 1), false);
  assert.equal(shouldPersistArchiveReadingProgress(true, 2), true);
  clearArchiveProgressMarker('archive', storage, 'test-key');
  assert.equal(hasArchiveProgressMarker('archive', storage, 'test-key'), false);
});
