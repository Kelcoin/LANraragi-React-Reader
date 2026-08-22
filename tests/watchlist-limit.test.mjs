import assert from 'node:assert/strict';
import test from 'node:test';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
  };
}

globalThis.localStorage = memoryStorage();
globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };

const { addWatchlistItem } = await import('../src/lib/watchlist.js');

// No server URL is configured, so the scoped local key is the unconfigured one.
const LOCAL_KEY = 'lrr_watchlist:unconfigured';
const REMOTE_KEY = 'lrr_watchlist_remote_cache:unconfigured';

test('local watchlist has no independent cap', async () => {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(
    Array.from({ length: 1500 }, (_, index) => ({ id: `id-${index}`, addedAt: index + 1 })),
  ));
  await assert.doesNotReject(addWatchlistItem({ arcid: 'beyond-any-frontend-cap' }));
  const stored = JSON.parse(localStorage.getItem(LOCAL_KEY));
  assert.equal(stored.length, 1501);
});

test('worker WATCHLIST_LIMIT_REACHED rejections propagate and roll back the optimistic write', async () => {
  localStorage.clear();
  const before = [{ id: 'kept', addedAt: 2 }, { id: 'other', addedAt: 1 }];
  localStorage.setItem(REMOTE_KEY, JSON.stringify(before));
  localStorage.setItem('lrr_worker_url', 'https://worker.example');
  localStorage.setItem('lrr_sync_token', 'tok');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'WATCHLIST_LIMIT_REACHED', maxWatchlist: 1000 }),
    { status: 409, headers: { 'Content-Type': 'application/json' } },
  );
  try {
    await assert.rejects(
      addWatchlistItem({ arcid: 'overflow', title: 'overflow' }),
      (error) => error.code === 'WATCHLIST_LIMIT_REACHED' && error.maxWatchlist === 1000,
    );
    // The rejected add must not survive in the local cache, or every sync
    // cycle would backfill it into another 409.
    assert.deepEqual(JSON.parse(localStorage.getItem(REMOTE_KEY)), before);
  } finally {
    globalThis.fetch = originalFetch;
    localStorage.removeItem('lrr_worker_url');
    localStorage.removeItem('lrr_sync_token');
  }
});
