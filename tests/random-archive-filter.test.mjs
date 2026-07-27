import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterRandomArchives,
  getRandomHideRead,
  setRandomHideRead,
} from '../src/lib/randomArchiveFilter.js';

test('random hide-read setting defaults off and persists', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };

  assert.equal(getRandomHideRead(storage), false);
  setRandomHideRead(true, storage);
  assert.equal(getRandomHideRead(storage), true);
  setRandomHideRead(false, storage);
  assert.equal(getRandomHideRead(storage), false);
});

test('disabled random filtering returns the original archive list', () => {
  const archives = [{ arcid: 'read', progress: 10, pagecount: 10 }];
  assert.equal(filterRandomArchives(archives, [], false), archives);
});

test('random filtering combines archive and history progress across id fields', () => {
  const archives = [
    { arcid: 'native', progress: 10, pagecount: 10 },
    { arcid: 'history', progress: 1, pagecount: 20 },
    { id: 'mixed-id', progress: 0, pagecount: 30 },
    { id: 'unknown-total', progress: 99 },
    { arcid: 'unread', progress: 4, pagecount: 10 },
  ];
  const histories = [
    { id: 'history', page: 20, total: 20 },
    { arcid: 'mixed-id', page: 30, total: 30 },
  ];

  assert.deepEqual(
    filterRandomArchives(archives, histories, true).map((item) => item.id || item.arcid),
    ['unknown-total', 'unread'],
  );
});

test('random filtering treats invalid collections as empty', () => {
  assert.deepEqual(filterRandomArchives(null, null, true), []);
});
