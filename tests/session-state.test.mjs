import assert from 'node:assert/strict';
import test from 'node:test';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}

globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();

const sessionState = await import(`../src/lib/sessionState.js?test=${Date.now()}`);

test('ordinary navigation never consumes a background Reader candidate', () => {
  assert.equal(typeof sessionState.shouldRestoreColdRoute, 'function');
  assert.equal(sessionState.shouldRestoreColdRoute({
    navigationType: 'navigate',
    hasResumeCandidate: true,
    hasRouteSnapshot: true,
  }), false);
  assert.equal(sessionState.shouldRestoreColdRoute({
    navigationType: 'reload',
    hasResumeCandidate: true,
    hasRouteSnapshot: true,
  }), true);
  assert.equal(sessionState.shouldRestoreColdRoute({
    navigationType: 'navigate',
    wasDiscarded: true,
    hasResumeCandidate: true,
  }), true);
});

test('home navigation stores only a marker and consumes the canonical home snapshot', () => {
  sessionState.saveHomeNavigationSnapshot({
    archives: [{ id: 'archive-1', page: 4 }],
    randoms: [{ id: 'archive-2' }],
  });

  const marker = JSON.parse(sessionStorage.getItem('lrr_home_navigation_snapshot_v1'));
  assert.equal(marker.reason, 'home-navigation');
  assert.equal(typeof marker.homeSnapshotTs, 'number');
  assert.equal('archives' in marker, false);
  assert.equal('randoms' in marker, false);

  const restored = sessionState.consumeHomeNavigationSnapshot();
  assert.deepEqual(restored.archives, [{ id: 'archive-1', page: 4 }]);
  assert.equal(restored.reason, 'home-navigation');
  assert.equal(sessionStorage.getItem('lrr_home_navigation_snapshot_v1'), null);
});

test('stale navigation marker cannot restore a different home snapshot', () => {
  sessionState.saveHomeNavigationSnapshot({ archives: [{ id: 'old' }] });
  const current = JSON.parse(localStorage.getItem('lrr_home_snapshot_v2'));
  localStorage.setItem('lrr_home_snapshot_v2', JSON.stringify({ ...current, ts: current.ts + 1, archives: [{ id: 'new' }] }));
  assert.equal(sessionState.consumeHomeNavigationSnapshot(), null);
});

test('progress patches only the canonical home snapshot', () => {
  sessionState.saveHomeNavigationSnapshot({ archives: [{ id: 'archive-1', page: 4 }] });
  const markerBefore = sessionStorage.getItem('lrr_home_navigation_snapshot_v1');
  sessionState.updateArchiveProgressInSessionSnapshots('archive-1', 8);
  assert.equal(sessionStorage.getItem('lrr_home_navigation_snapshot_v1'), markerBefore);
  assert.equal(sessionState.loadHomeSnapshot().archives[0].page, 8);
});
