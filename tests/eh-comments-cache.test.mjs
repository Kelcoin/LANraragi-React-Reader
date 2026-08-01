import assert from 'node:assert/strict';
import test from 'node:test';

const cache = await import(`../src/lib/ehCommentsCache.js?test=${Date.now()}`);

test('EH comment cache key normalizes gallery URL and never exposes Cookie', () => {
  const cookie = 'igneous=secret; ipb_member_id=123; ipb_pass_hash=hidden;';
  const first = cache.createEhCommentsCacheKey('https://E-HENTAI.org/g/123/token/', cookie);
  const second = cache.createEhCommentsCacheKey('https://e-hentai.org/g/123/token', cookie);
  assert.equal(first, second);
  assert.equal(first.includes('secret'), false);
  assert.equal(first.includes('ipb_member_id'), false);
  assert.match(first, /^eh-comments:[a-f0-9]{32}:[a-f0-9]{32}$/);
});

test('EH comment cache rejects expired memory entries without IndexedDB', async () => {
  const key = cache.createEhCommentsCacheKey('https://e-hentai.org/g/1/a', 'cookie');
  await cache.writeEhCommentsCache(key, [{ id: 1, content: 'cached' }], { now: 1000 });
  assert.deepEqual(await cache.readEhCommentsCache(key, { now: 1001 }), [{ id: 1, content: 'cached' }]);
  assert.equal(await cache.readEhCommentsCache(key, { now: 1000 + cache.EH_COMMENTS_CACHE_TTL + 1 }), null);
});

test('EH comment cache pruning removes expired records then oldest overflow', () => {
  const records = [
    { key: 'expired', ts: 1, lastAccess: 90 },
    { key: 'old', ts: 90, lastAccess: 91 },
    { key: 'middle', ts: 90, lastAccess: 92 },
    { key: 'new', ts: 90, lastAccess: 93 },
  ];
  assert.deepEqual(cache.selectEhCommentRecordsToDelete(records, {
    now: 100,
    ttl: 20,
    maxEntries: 2,
  }).sort(), ['expired', 'old']);
});

test('EH comment cache persists terminal gallery unavailable states', async () => {
  const key = cache.createEhCommentsCacheKey('https://e-hentai.org/g/2/b', 'cookie');
  await cache.writeEhCommentsCache(key, [], { now: 1000, unavailable: 'GALLERY_NOT_FOUND' });
  assert.deepEqual(await cache.readEhCommentsCacheState(key, { now: 1001 }), { comments: [], unavailable: 'GALLERY_NOT_FOUND' });
});
