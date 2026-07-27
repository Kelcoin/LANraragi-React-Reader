import assert from 'node:assert/strict';
import test from 'node:test';
import { assertArchiveDeletionResult, retryOperation, runArchiveDeletionOperations } from '../src/lib/archiveDeletionCore.js';

test('retryOperation succeeds on the third attempt', async () => {
  let attempts = 0;
  const result = await retryOperation(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('temporary');
    return 'ok';
  }, { delayMs: 0 });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('archive deletion retries LANraragi failures three times', async () => {
  let attempts = 0;
  const result = await runArchiveDeletionOperations({
    archiveOperation: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('locked');
      return 'archive-id';
    },
    delayMs: 0,
  });
  assert.equal(result, 'archive-id');
  assert.equal(attempts, 3);
});

test('LANraragi success zero responses are retried as failures', async () => {
  let attempts = 0;
  const result = await retryOperation(async () => {
    attempts += 1;
    return assertArchiveDeletionResult({ success: attempts < 3 ? 0 : 1 });
  }, { delayMs: 0 });
  assert.equal(result.success, 1);
  assert.equal(attempts, 3);
});

test('E-Hentai exhaustion is reported and does not block LANraragi deletion when requested', async () => {
  let favoriteAttempts = 0;
  let deleteAttempts = 0;
  const failures = [];
  const result = await runArchiveDeletionOperations({
    favoriteOperation: async () => {
      favoriteAttempts += 1;
      throw new Error('temporary');
    },
    archiveOperation: async () => {
      deleteAttempts += 1;
      return 'archive-id';
    },
    continueOnFavoriteError: true,
    onFavoriteError: (error) => failures.push(error),
    delayMs: 0,
  });
  assert.equal(result, 'archive-id');
  assert.equal(favoriteAttempts, 3);
  assert.equal(deleteAttempts, 1);
  assert.equal(failures[0].message, 'temporary');
});
