import test from 'node:test';
import assert from 'node:assert/strict';
import * as commentsState from '../src/lib/ehCommentsState.js';

test('comment refresh failures keep any already visible comments', () => {
  assert.equal(typeof commentsState.shouldKeepEhCommentsOnRefreshFailure, 'function');
  assert.equal(commentsState.shouldKeepEhCommentsOnRefreshFailure([{ id: 1 }], []), true);
  assert.equal(commentsState.shouldKeepEhCommentsOnRefreshFailure(null, [{ id: 1 }]), true);
  assert.equal(commentsState.shouldKeepEhCommentsOnRefreshFailure([], []), false);
});
