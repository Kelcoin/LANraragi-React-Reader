import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { commitRemoteRemoval } from '../src/lib/remoteRemoval.js';

test('remote removal commits local state only after remote success', async () => {
  const events = [];
  await assert.rejects(commitRemoteRemoval({
    hasRemote: true,
    removeRemote: async () => {
      events.push('remote');
      throw new Error('Worker Error: 503');
    },
    commitLocal: () => events.push('local'),
  }), /Worker Error: 503/);
  assert.deepEqual(events, ['remote']);

  events.length = 0;
  await commitRemoteRemoval({
    hasRemote: true,
    removeRemote: async () => events.push('remote'),
    commitLocal: () => events.push('local'),
  });
  assert.deepEqual(events, ['remote', 'local']);
});

test('local-only removal commits without a remote request', async () => {
  const events = [];
  await commitRemoteRemoval({
    hasRemote: false,
    removeRemote: async () => events.push('remote'),
    commitLocal: () => events.push('local'),
  });
  assert.deepEqual(events, ['local']);
});

test('destructive requests use keepalive and user removal handlers surface failures', () => {
  const api = readFileSync('src/lib/api.js', 'utf8');
  const favorite = readFileSync('src/lib/ehFavoriteSync.js', 'utf8');
  const history = readFileSync('src/pages/HistoryPage.jsx', 'utf8');
  const watchlist = readFileSync('src/pages/WatchlistPage.jsx', 'utf8');
  const home = readFileSync('src/pages/Home.jsx', 'utf8');
  const reader = readFileSync('src/pages/Reader.jsx', 'utf8');

  assert.match(api, /deleteArchive:\s*\(id\)\s*=>\s*request\([^\n]+['"]DELETE['"][^\n]+keepalive:\s*true/);
  assert.match(favorite, /mode:\s*'remove'[\s\S]*keepalive:\s*true/);
  for (const source of [history, watchlist, home, reader]) {
    assert.match(source, /remove(?:History|Watchlist)(?:Item|Items)\([^;]+[\s\S]{0,500}?showToast\([^)]*失败[^)]*'error'/);
  }
});

test('automatic cleanup stays best-effort and archive deletion cleanup cannot mask LRR success', () => {
  const historyLib = readFileSync('src/lib/history.js', 'utf8');
  const watchlistLib = readFileSync('src/lib/watchlist.js', 'utf8');
  const historyPage = readFileSync('src/pages/HistoryPage.jsx', 'utf8');
  const watchlistPage = readFileSync('src/pages/WatchlistPage.jsx', 'utf8');
  const home = readFileSync('src/pages/Home.jsx', 'utf8');
  const reader = readFileSync('src/pages/Reader.jsx', 'utf8');

  assert.match(historyLib, /export const pruneHistoryItems = async/);
  assert.match(watchlistLib, /export const pruneWatchlistItems = async/);
  assert.match(watchlistLib, /export const pruneWatchlistItem = async/);
  assert.match(watchlistLib, /if \(hydrated\.missingIds\.length > 0\) await pruneWatchlistItems\(hydrated\.missingIds\)/);
  assert.match(home, /watchlistAutoRemoveIds\.length > 0\) pruneWatchlistItems\(watchlistAutoRemoveIds\)\.catch/);
  assert.match(watchlistPage, /autoRemoveIds\.length > 0\) pruneWatchlistItems\(autoRemoveIds\)\.catch/);
  assert.match(reader, /isArchiveMissingError\(error\)\) pruneHistoryItems\(\[archiveId\]\)\.catch/);
  assert.match(reader, /pruneWatchlistItem\(archiveId\)\.catch/);
  assert.match(historyPage, /Promise\.all\(\[pruneHistoryItems\(\[archiveId\]\), pruneWatchlistItem\(archiveId\)\]\)/);
  assert.doesNotMatch(historyPage, /Promise\.all\(\[removeHistoryItems\(\[archiveId\]\), removeWatchlistItem\(archiveId\)\]\)/);
});
