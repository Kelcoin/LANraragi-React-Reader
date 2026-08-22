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
  normalizeDedupeFilename,
  getDedupeGroupFilterData,
  countDuplicateGroupsWithLargePageGap,
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
    { 'auto-clean|auto-rough': 'image' },
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
    { 'auto-clean|auto-rough': 'image' },
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
    noChinese: true,
  });
  assert.deepEqual(deduplicate.getDedupeSmartSelectionSignals({ tags: 'artist:test' }), {
    roughTranslation: false,
    extraneousAds: false,
    uncensored: false,
    noChinese: true,
  });
  assert.equal(deduplicate.getDedupeSmartSelectionSignals({ tags: 'language:chinese' }).noChinese, false);
});

test('smart selection deletes archives without Chinese tags first and skips filename-only groups', () => {
  const groups = [
    [
      { arcid: 'chinese', tags: 'language:chinese', size: 100 },
      { arcid: 'clean', tags: '', size: 1 },
    ],
    [
      { arcid: 'filename-a', tags: '', size: 100 },
      { arcid: 'filename-b', tags: '', size: 1 },
    ],
  ];
  const result = deduplicate.mergeSmartDuplicateSelection(
    groups,
    new Set(),
    [],
    [],
    { 'chinese|clean': 'image', 'filename-a|filename-b': 'filename' },
  );
  assert.deepEqual(result.archiveIds, ['clean']);
  assert.equal(result.skippedFilenameOnlyCount, 1);
});

test('smart selection can explicitly include filename-only groups', () => {
  const groups = [[
    { arcid: 'filename-a', tags: 'language:chinese', size: 10 },
    { arcid: 'filename-b', tags: '', size: 1 },
  ]];
  const result = deduplicate.mergeSmartDuplicateSelection(
    groups,
    new Set(),
    [],
    [],
    { 'filename-a|filename-b': 'filename' },
    { includeFilenameOnly: true },
  );
  assert.deepEqual(result.archiveIds, ['filename-b']);
  assert.equal(result.skippedFilenameOnlyCount, 0);
});

test('large page-gap detection counts each risky duplicate group once', () => {
  assert.equal(countDuplicateGroupsWithLargePageGap([
    [{ pagecount: 20 }, { total: 31 }],
    [{ pagecount: 12 }, { total: 18 }],
    [{ pagecount: 1 }, { total: 15 }, { total: 4 }],
  ]), 2);
});

test('smart selection conservatively skips saved groups without provenance', () => {
  const result = deduplicate.mergeSmartDuplicateSelection([
    [{ arcid: 'unknown-a', tags: '' }, { arcid: 'unknown-b', tags: 'language:chinese' }],
  ], new Set());
  assert.deepEqual(result.archiveIds, []);
  assert.equal(result.skippedFilenameOnlyCount, 1);
});

test('smart selection applies every deletion priority in order', () => {
  const selected = (left, right) => selectDuplicateDeletionIds([left, right]);
  assert.deepEqual(selected(
    { arcid: 'no-chinese', tags: '', size: 100 },
    { arcid: 'chinese-rough', tags: 'language:chinese, other:rough translation', size: 1 },
  ), ['no-chinese']);
  assert.deepEqual(selected(
    { arcid: 'rough', tags: 'language:chinese, other:rough translation, other:uncensored', size: 100 },
    { arcid: 'clean', tags: 'language:chinese, other:extraneous ads', size: 1 },
  ), ['rough']);
  assert.deepEqual(selected(
    { arcid: 'censored', tags: 'language:chinese', size: 100 },
    { arcid: 'uncensored-ads', tags: 'language:chinese, other:uncensored, other:extraneous ads', size: 1 },
  ), ['censored']);
  assert.deepEqual(selected(
    { arcid: 'ads', tags: 'language:chinese, other:uncensored, other:extraneous ads', size: 100 },
    { arcid: 'no-ads', tags: 'language:chinese, other:uncensored', size: 1 },
  ), ['ads']);
  assert.deepEqual(selected(
    { arcid: 'small', tags: 'language:chinese', size: 1 },
    { arcid: 'large', tags: 'language:chinese', size: 100 },
  ), ['small']);
  assert.deepEqual(selected(
    { arcid: 'first', tags: 'language:chinese', size: 100 },
    { arcid: 'later', tags: 'language:chinese', size: 100 },
  ), ['later']);
});

test('smart selection does not report filename-only groups already touched manually', () => {
  const groups = [
    [{ arcid: 'A' }, { arcid: 'B' }],
    [{ arcid: 'C' }, { arcid: 'D' }],
  ];
  const result = deduplicate.mergeSmartDuplicateSelection(
    groups,
    new Set(['A|B', 'C|D']),
    [],
    ['A|B', 'C|D'],
    { 'A|B': 'filename', 'C|D': 'filename' },
  );
  assert.equal(result.skippedFilenameOnlyCount, 0);
});

test('dedupe filter data separates image groups, filename groups, and chains', () => {
  const image = [{ arcid: 'A' }, { arcid: 'B' }];
  const filename = [{ arcid: 'B' }, { arcid: 'C' }];
  const standalone = [{ arcid: 'D' }, { arcid: 'E' }];
  const result = getDedupeGroupFilterData(
    [image, filename, standalone],
    { 'A|B': 'image', 'B|C': 'filename', 'D|E': 'image' },
  );
  assert.deepEqual(result.imageGroups, [image, standalone]);
  assert.deepEqual(result.filenameGroups, [filename]);
  assert.deepEqual(result.chains, [[image, filename]]);
});

test('image and filename filters retain every group in a matching duplicate chain', () => {
  const image = [{ arcid: 'A' }, { arcid: 'B' }];
  const filename = [{ arcid: 'B' }, { arcid: 'C' }];
  const standalone = [{ arcid: 'D' }, { arcid: 'E' }];
  const result = getDedupeGroupFilterData(
    [image, filename, standalone],
    { 'A|B': 'image', 'B|C': 'filename', 'D|E': 'image' },
  );
  const imageKeys = new Set(result.imageGroups.map((group) => group.map((archive) => archive.arcid).sort().join('|')));
  const filenameKeys = new Set(result.filenameGroups.map((group) => group.map((archive) => archive.arcid).sort().join('|')));
  assert.deepEqual(imageKeys, new Set(['A|B', 'D|E']));
  assert.deepEqual(filenameKeys, new Set(['B|C']));
  assert.equal(result.chains[0].length, 2);
});

test('cover matching tolerates a small spatially aligned watermark', () => {
  const makeSignature = (patch = false, inverted = false) => {
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const index = (y * 8 + x) * 4;
        let value = (x * 23 + y * 17) % 256;
        if (inverted) value = 255 - value;
        if (patch && x >= 6 && y >= 4) value = 255 - value;
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
        pixels[index + 3] = 255;
      }
    }
    return { width: 8, height: 8, ratio: 1, pixels };
  };

  assert.equal(deduplicate.areSignaturesDuplicate(makeSignature(), makeSignature(true)), true);
  assert.equal(deduplicate.areSignaturesDuplicate(makeSignature(), makeSignature(false, true)), false);
});

test('cover matching rejects a mostly blank cover against a textured cover', () => {
  const makeSignature = (textured) => {
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const index = (y * 8 + x) * 4;
        const value = textured && x < 2 && y < 4 ? 0 : 255;
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
        pixels[index + 3] = 255;
      }
    }
    return { width: 8, height: 8, ratio: 1, pixels };
  };

  assert.equal(deduplicate.areSignaturesDuplicate(makeSignature(false), makeSignature(true)), false);
});

test('cover matching rejects dominant-color covers with different content placement', () => {
  const makeSignature = (corner) => {
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const index = (y * 8 + x) * 4;
        const inBlock = corner === 'top-left'
          ? x < 2 && y < 2
          : x >= 6 && y >= 6;
        const value = inBlock ? 20 : 245;
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
        pixels[index + 3] = 255;
      }
    }
    return { width: 8, height: 8, ratio: 1, pixels };
  };

  assert.equal(
    deduplicate.areSignaturesDuplicate(makeSignature('top-left'), makeSignature('bottom-right')),
    false,
  );
});

test('cover matching rejects dominant-color covers without filename evidence', () => {
  const makeSignature = (value) => {
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const index = (y * 8 + x) * 4;
        const block = x < 2 && y < 2;
        const color = block ? value : 245;
        pixels[index] = color;
        pixels[index + 1] = color;
        pixels[index + 2] = color;
        pixels[index + 3] = 255;
      }
    }
    return { width: 8, height: 8, ratio: 1, pixels };
  };

  assert.equal(
    deduplicate.areSignaturesDuplicate(makeSignature(20), makeSignature(35)),
    false,
  );
});

test('cover matching allows dominant-color covers with similar filename evidence', () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4).fill(245);
  const make = (filename) => ({ width: 8, height: 8, ratio: 1, filename, pixels });
  assert.deepEqual(
    deduplicate.findDuplicatePairs(new Map([
      ['A', make('[Circle] Work [DL版]')],
      ['B', make('[Circle] Work [中国翻訳]')],
    ])),
    [{ left: 'A', right: 'B' }],
  );
});

test('duplicate scan rejects a shared title page when archive page counts diverge', () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const value = (x * 23 + y * 17) % 256;
      const index = (y * 8 + x) * 4;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  const signatures = new Map([
    ['A', { width: 8, height: 8, ratio: 1, pageCount: 32, fileSize: 16_700_000, pixels }],
    ['B', { width: 8, height: 8, ratio: 1, pageCount: 16, fileSize: 7_900_000, pixels }],
  ]);
  assert.deepEqual(deduplicate.findDuplicatePairs(signatures), []);
});

test('duplicate scan rejects screenshot-like 32-page and 40-page shared covers', async () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const value = (x * 23 + y * 17) % 256;
      const index = (y * 8 + x) * 4;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  const signatures = new Map([
    ['A', { width: 8, height: 8, ratio: 1, pageCount: 32, fileSize: 16_700_000, pixels }],
    ['B', { width: 8, height: 8, ratio: 1, pageCount: 40, fileSize: 16_900_000, pixels }],
  ]);
  assert.deepEqual(await deduplicate.findDuplicatePairsAsync(signatures), []);
});

test('duplicate scan rejects the screenshot 32/24 and 6/13 page-count pairs', async () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const value = (x * 23 + y * 17) % 256;
      const index = (y * 8 + x) * 4;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  for (const [left, right] of [[32, 24], [6, 13]]) {
    const signatures = new Map([
      ['A', { width: 8, height: 8, ratio: 1, pageCount: left, pixels }],
      ['B', { width: 8, height: 8, ratio: 1, pageCount: right, pixels }],
    ]);
    assert.deepEqual(await deduplicate.findDuplicatePairsAsync(signatures), []);
  }
});

test('duplicate scan keeps filename-confirmed variants despite page count differences', () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const value = (x * 23 + y * 17) % 256;
      const index = (y * 8 + x) * 4;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  const make = (filename, pageCount) => ({
    width: 8, height: 8, ratio: 1, pageCount, filename, pixels,
  });
  const signatures = new Map([
    ['A', make('[Circle] Work [DL版]', 32)],
    ['B', make('[Circle] Work [中国翻訳]', 40)],
  ]);
  assert.deepEqual(deduplicate.findDuplicatePairs(signatures), [{ left: 'A', right: 'B' }]);
});

test('cover matching rejects sparse white pages with different foreground locations', () => {
  const makeSignature = (top) => {
    const pixels = new Uint8ClampedArray(16 * 16 * 4);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const index = (y * 16 + x) * 4;
        const foreground = top ? (y >= 2 && y <= 4 && x >= 2 && x <= 13) : (y >= 11 && y <= 13 && x >= 2 && x <= 13);
        const value = foreground ? 25 : 250;
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
        pixels[index + 3] = 255;
      }
    }
    return { width: 16, height: 16, ratio: 1, pixels };
  };
  assert.equal(deduplicate.areSignaturesDuplicate(makeSignature(true), makeSignature(false)), false);
});

test('filename evidence removes release markers without dropping author text', () => {
  assert.equal(
    normalizeDedupeFilename('[Circle] Work [中国翻訳] [DL版] [無修正]'),
    'circlework',
  );
  assert.equal(
    normalizeDedupeFilename('[Circle] Work [中国翻译]_g12345'),
    'circlework',
  );
  assert.equal(normalizeDedupeFilename('Sora Aoi'), 'soraaoi');
});

test('filename evidence directly matches long names only when they are not common', () => {
  const makeSignature = (filename, value) => ({
    width: 8,
    height: 8,
    ratio: 1,
    filename,
    pixels: new Uint8ClampedArray(8 * 8 * 4).fill(value),
  });
  const signatures = new Map([
    ['A', makeSignature('[Circle] Longer Work [DL版]', 0)],
    ['B', makeSignature('[Circle] Longer Work [中国翻訳]', 255)],
  ]);
  assert.deepEqual(deduplicate.findDuplicatePairs(signatures), [{ left: 'A', right: 'B' }]);

  signatures.set('C', makeSignature('[Circle] Longer Work', 128));
  assert.deepEqual(deduplicate.findDuplicatePairs(signatures), []);
});

test('exact filename pairs are filename-only only when image matching does not confirm them', async () => {
  const makeSignature = (filename, invert = false, ratio = 1) => {
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const index = (y * 8 + x) * 4;
        const base = (x * 23 + y * 17) % 256;
        const value = invert ? 255 - base : base;
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
        pixels[index + 3] = 255;
      }
    }
    return { width: 8, height: 8, ratio, filename, pixels };
  };
  const signatures = new Map([
    ['A', makeSignature('[Circle] Same Work [DL版]')],
    ['B', makeSignature('[Circle] Same Work [中国翻訳]')],
    ['C', makeSignature('[Group] Other Work [DL版]', false, 1.2)],
    ['D', makeSignature('[Group] Other Work [中国翻訳]', true, 1.2)],
  ]);
  const expected = [
    { left: 'A', right: 'B', source: 'image' },
    { left: 'C', right: 'D', source: 'filename' },
  ];
  const syncSources = [];
  deduplicate.findDuplicatePairs(signatures, new Set(), { onPair: (pair) => syncSources.push(pair) });
  const asyncSources = [];
  await deduplicate.findDuplicatePairsAsync(signatures, new Set(), { onPair: (pair) => asyncSources.push(pair) });
  assert.deepEqual(syncSources, expected);
  assert.deepEqual(asyncSources, expected);
});

test('exact filename variants prefer image provenance when the cover differs by a larger logo patch', () => {
  const makeSignature = (filename, patched = false) => {
    const pixels = new Uint8ClampedArray(16 * 16 * 4);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const index = (y * 16 + x) * 4;
        const base = (x * 23 + y * 17) % 256;
        const value = patched && x >= 8 && y >= 8 ? 255 - base : base;
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
        pixels[index + 3] = 255;
      }
    }
    return { width: 16, height: 16, ratio: 1, filename, pixels };
  };
  const sources = [];
  deduplicate.findDuplicatePairs(new Map([
    ['A', makeSignature('[Circle] Logo Work [DL版]')],
    ['B', makeSignature('[Circle] Logo Work [中国翻訳]', true)],
  ]), new Set(), { onPair: (pair) => sources.push(pair) });
  assert.deepEqual(sources, [{ left: 'A', right: 'B', source: 'image' }]);
});

test('async duplicate scan keeps the synchronous result for textured covers', async () => {
  const makeSignature = (patch = false) => {
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const index = (y * 8 + x) * 4;
        const value = patch && x > 5 && y > 5 ? 220 : (x * 23 + y * 17) % 256;
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
        pixels[index + 3] = 255;
      }
    }
    return { width: 8, height: 8, ratio: 1, pixels };
  };
  const signatures = new Map([
    ['A', makeSignature()],
    ['B', makeSignature(true)],
    ['C', { ...makeSignature(), ratio: 2 }],
  ]);
  const sync = deduplicate.findDuplicatePairs(signatures);
  const asyncPairs = await deduplicate.findDuplicatePairsAsync(signatures, new Set(), { chunkSize: 1 });
  assert.deepEqual(asyncPairs, sync);
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
    manuallyTouchedGroupKeys: new Set(['A|B', 'B|C']),
    savedAt: '2026-07-19T00:00:00.000Z',
  });

  assert.deepEqual(payload.groups, [['A', 'B']]);
  assert.deepEqual(payload.archives, [
    { arcid: 'A', title: 'A' },
    { arcid: 'B', title: 'B' },
  ]);
  assert.deepEqual(payload.selectedArchiveIds, ['A']);
  assert.deepEqual(payload.selectedGroupKeys, ['A|B']);
  assert.deepEqual(payload.manuallyTouchedGroupKeys, ['A|B']);
  assert.equal(createDedupeSavedResultPayload({ groups: [] }), null);
  assert.equal(createDedupeSavedResultPayload({ groups: [[archiveC]] }), null);
});

test('dedupe persistence keeps duplicate detection sources', () => {
  const payload = createDedupeSavedResultPayload({
    groups: [[{ arcid: 'A' }, { arcid: 'B' }]],
    duplicateSourceByGroupKey: { 'A|B': 'filename', 'missing|group': 'image' },
  });
  assert.deepEqual(payload.duplicateSourceByGroupKey, { 'A|B': 'filename' });
});
