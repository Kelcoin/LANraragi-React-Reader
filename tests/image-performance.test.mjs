import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as cachePolicy from '../src/lib/cachePolicy.js';
import * as imageLoadQueue from '../src/lib/imageLoadQueue.js';
import * as readerLayout from '../src/lib/readerLayout.js';
import * as readerImageTransform from '../src/lib/readerImageTransform.js';
import * as readerPreviewDecode from '../src/lib/readerPreviewDecode.js';
import * as readerSettings from '../src/lib/readerSettings.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('border crop translation recenters asymmetric content within each page slot', () => {
  const asymmetric = readerImageTransform.getBorderCropCenterTranslation({
    top: 0.03,
    right: 0.02,
    bottom: 0.11,
    left: 0.1,
  });
  assert.ok(Math.abs(asymmetric.xPercent + 4) < 1e-9);
  assert.ok(Math.abs(asymmetric.yPercent - 4) < 1e-9);
  assert.deepEqual(readerImageTransform.getBorderCropCenterTranslation({
    top: 0.05,
    right: 0.05,
    bottom: 0.05,
    left: 0.05,
  }), { xPercent: 0, yPercent: 0 });
});

test('border crop clip paths preserve asymmetric content and split boundaries', () => {
  assert.equal(readerImageTransform.getBorderCropClipPath({
    top: 0.1,
    right: 0.475,
    bottom: 0.05,
    left: 0.1,
  }), 'inset(10% 47.5% 5% 10%)');
});

test('super-resolution display budget preserves aspect ratio', () => {
  const size = cachePolicy.resolveBoundedImageSize(5000, 4000);
  assert.ok(size.width * size.height <= cachePolicy.READER_OPTIMIZED_DECODE_PIXELS);
  assert.ok(Math.abs(size.width / size.height - 1.25) < 0.001);
  assert.equal(cachePolicy.READER_OPTIMIZED_DECODE_PIXELS, 16_000_000);
  assert.equal(cachePolicy.READER_SUPER_RESOLUTION_DISPLAY_PIXELS, 32_000_000);
  assert.equal(cachePolicy.SUPER_RESOLUTION_MAX_INFERENCE_PIXELS, 64_000_000);
});

test('Waifu2x RGB tile stitching uses a dedicated allocation-free copy path', () => {
  const worker = read('src/lib/superResolution.worker.js');
  assert.match(worker, /function copyRgbTensorTileToOutput\s*\(/);
  assert.match(worker, /copyRgbTensorTileToOutput\(\s*outputTensor,/);
  const copyHelper = worker.match(/function copyRgbTensorTileToOutput\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(copyHelper, 'missing Waifu2x RGB copy helper');
  assert.doesNotMatch(copyHelper[1], /readTensorRgb\(/);
  assert.doesNotMatch(copyHelper[1], /\[[^\]]*red[^\]]*green[^\]]*blue[^\]]*\]/i);
});

test('reader preloads remote pages as blobs without decoding throwaway images', () => {
  const source = read('src/pages/Reader.jsx');
  assert.match(source, /import \{[^}]*primeImage[^}]*\} from '\.\.\/lib\/imageCache';/s);
  assert.doesNotMatch(source, /function primePageImage|new Image\(\)[\s\S]{0,300}\.decode\(\)/);
  assert.match(source, /primeImage\(normalized/);
});

test('decode window includes current spread and one spread on each side', () => {
  assert.equal(typeof readerLayout.getReaderDecodeWindow, 'function');
  const spreads = readerLayout.buildReaderSpreads({ pageCount: 8, doublePage: true });
  assert.deepEqual(
    readerLayout.getReaderDecodeWindow(spreads, 2).map((spread) => spread.map((unit) => unit.pageIndex)),
    [[1, 2], [3, 4], [5, 6]],
  );
});

test('normal paged reader keeps adjacent decode-window images mounted offscreen', () => {
  const source = read('src/pages/Reader.jsx');
  assert.match(source, /const adjacentDecodePageIndices =/);
  assert.match(source, /const decodeWindowUnits =/);
  assert.match(source, /reader-page:\$\{unit\.pageIndex\}:\$\{unit\.splitPart\}/);
  assert.match(source, /aria-hidden=\{visible \? undefined : 'true'\}/);
  assert.match(source, /onReady=\{handleNormalPageDecoded\}/);
  assert.match(source, /normalTargetReady[\s\S]*normalReadyPageIndicesRef\.current\.has/);
  assert.match(source, /if \(preserveReadySource\) \{\s*setShowLoadingStatus\(false\);[\s\S]*onReady\?\.\(pageIndex\)/);
});

test('image decode queue reserves one of two slots for critical work', async () => {
  assert.equal(typeof imageLoadQueue.createImageDecodeQueue, 'function');
  const queue = imageLoadQueue.createImageDecodeQueue({ maxConcurrent: 2 });
  const events = [];
  let releaseBackground;
  const first = queue.schedule('background-1', async () => {
    events.push('background-1:start');
    await new Promise((resolve) => { releaseBackground = resolve; });
    events.push('background-1:end');
  }, imageLoadQueue.IMAGE_LOAD_PRIORITY.ADJACENT);
  const second = queue.schedule('background-2', async () => {
    events.push('background-2:start');
  }, imageLoadQueue.IMAGE_LOAD_PRIORITY.ADJACENT);
  const critical = queue.schedule('critical', async () => {
    events.push('critical:start');
  }, imageLoadQueue.IMAGE_LOAD_PRIORITY.CRITICAL);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['background-1:start', 'critical:start']);
  releaseBackground();
  await Promise.all([first.promise, second.promise, critical.promise]);
  assert.deepEqual(events, [
    'background-1:start',
    'critical:start',
    'background-1:end',
    'background-2:start',
  ]);
});

test('image decode queue can start one adjacent decode beside active critical work', async () => {
  const queue = imageLoadQueue.createImageDecodeQueue({ maxConcurrent: 2 });
  const events = [];
  let releaseCritical;
  let releaseAdjacent;
  const critical = queue.schedule('critical-first', async () => {
    events.push('critical:start');
    await new Promise((resolve) => { releaseCritical = resolve; });
  }, imageLoadQueue.IMAGE_LOAD_PRIORITY.CRITICAL);
  const adjacent = queue.schedule('adjacent', async () => {
    events.push('adjacent:start');
    await new Promise((resolve) => { releaseAdjacent = resolve; });
  }, imageLoadQueue.IMAGE_LOAD_PRIORITY.ADJACENT);
  const preload = queue.schedule('preload', async () => {
    events.push('preload:start');
  }, imageLoadQueue.IMAGE_LOAD_PRIORITY.PRELOAD);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['critical:start', 'adjacent:start']);
  releaseCritical();
  releaseAdjacent();
  await Promise.all([critical.promise, adjacent.promise, preload.promise]);
  assert.deepEqual(events, ['critical:start', 'adjacent:start', 'preload:start']);
});

test('image decode queue cancels stale queued and active work', async () => {
  const queue = imageLoadQueue.createImageDecodeQueue({ maxConcurrent: 1 });
  let activeSignal;
  let staleStarted = false;
  const active = queue.schedule('active', async (signal) => {
    activeSignal = signal;
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  });
  const stale = queue.schedule('stale', async () => { staleStarted = true; });
  await new Promise((resolve) => setImmediate(resolve));
  stale.cancel();
  active.cancel();
  await Promise.allSettled([active.promise, stale.promise]);
  assert.equal(activeSignal.aborted, true);
  assert.equal(staleStarted, false);
});

test('image decode queue can cancel only background super-resolution work', async () => {
  const queue = imageLoadQueue.createImageDecodeQueue({ maxConcurrent: 2 });
  let backgroundSignal;
  let foregroundStarted = false;
  const background = queue.schedule('super-resolution:adjacent', async (signal) => {
    backgroundSignal = signal;
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  }, imageLoadQueue.IMAGE_LOAD_PRIORITY.PRELOAD);
  const foreground = queue.schedule('immersive-super-resolution:current', async () => {
    foregroundStarted = true;
  }, imageLoadQueue.IMAGE_LOAD_PRIORITY.CRITICAL);
  await new Promise((resolve) => setImmediate(resolve));
  queue.cancelWhere((key) => String(key).startsWith('super-resolution:'));
  await Promise.allSettled([background.promise, foreground.promise]);
  assert.equal(backgroundSignal?.aborted, true);
  assert.equal(foregroundStarted, true);
});

test('image decode queue supports one slot and applies runtime limit changes', async () => {
  const queue = imageLoadQueue.createImageDecodeQueue({ maxConcurrent: 1 });
  assert.equal(typeof queue.setMaxConcurrent, 'function');
  const events = [];
  let releaseFirst;
  const first = queue.schedule('first', async () => {
    events.push('first');
    await new Promise((resolve) => { releaseFirst = resolve; });
  });
  const second = queue.schedule('second', async () => { events.push('second'); });
  const third = queue.schedule('third', async () => { events.push('third'); });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ['first']);
    queue.setMaxConcurrent(6);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ['first', 'second', 'third']);
  } finally {
    releaseFirst?.();
    await Promise.allSettled([first.promise, second.promise, third.promise]);
  }
});

test('image load queue times out a stalled job and releases the next slot', async () => {
  const queue = imageLoadQueue.createImageLoadQueue({ maxConcurrent: 2, timeoutMs: 20 });
  let stalledSignal;
  let nextStarted = false;
  const stalled = queue.schedule('stalled', async (signal) => {
    stalledSignal = signal;
    await new Promise(() => {});
  });
  const stalledResult = stalled.catch((error) => error);
  const next = queue.schedule('next', async () => {
    nextStarted = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(stalledSignal?.aborted, true);
  assert.equal(nextStarted, true);
  assert.equal((await stalledResult)?.name, 'TimeoutError');
  await next;
});

test('paged Reader covers stale bitmaps while the target spread decodes', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /targetPending\s*&&\s*!webtoonActive[\s\S]{0,1200}正在切换到第/);
  assert.match(reader, /background:\s*'(?:#000|var\(--reader-(?:stage|immersive)-bg\))'/);
});

test('memory image cache policy uses byte budget and oldest-first eviction', () => {
  assert.equal(typeof cachePolicy.resolveMemoryImageCacheBudget, 'function');
  assert.equal(typeof cachePolicy.selectMemoryImageCacheEvictions, 'function');
  assert.equal(cachePolicy.resolveMemoryImageCacheBudget(2), 64 * 1024 ** 2);
  assert.equal(cachePolicy.resolveMemoryImageCacheBudget(8), 192 * 1024 ** 2);
  assert.deepEqual(cachePolicy.selectMemoryImageCacheEvictions([
    { key: 'old', size: 40, lastAccessedAt: 1 },
    { key: 'new', size: 40, lastAccessedAt: 2 },
  ], 50, 100), ['old']);
});

test('reader preview decode only downsamples genuinely oversized images', () => {
  assert.equal(typeof cachePolicy.resolveReaderPreviewDecodeSize, 'function');
  assert.deepEqual(cachePolicy.resolveReaderPreviewDecodeSize({
    width: 8000,
    height: 12000,
    viewportWidth: 1200,
    viewportHeight: 800,
    devicePixelRatio: 2,
  }), { width: 2160, height: 3240 });
  assert.equal(cachePolicy.resolveReaderPreviewDecodeSize({
    width: 4000,
    height: 5000,
    viewportWidth: 1200,
    viewportHeight: 800,
    devicePixelRatio: 2,
  }), null);
  assert.equal(cachePolicy.resolveReaderPreviewDecodeSize({
    width: 3000,
    height: 5000,
    viewportWidth: 390,
    viewportHeight: 844,
    devicePixelRatio: 3,
  }), null);
});

test('reader preview decode is wired to zoom fallback and reader settings', () => {
  const reader = read('src/pages/Reader.jsx');
  const settings = read('src/lib/readerSettings.js');
  assert.match(settings, /optimizedImageDecodeEnabled:\s*true/);
  assert.match(reader, /settings\.optimizedImageDecodeEnabled/);
  assert.match(reader, /zoomScale\s*>\s*1\.0/);
  assert.match(reader, /getReaderPreviewSource/);
  assert.equal(readerSettings.normalizeReaderSettings({}).optimizedImageDecodeEnabled, true);
  assert.equal(readerSettings.normalizeReaderSettings({ optimizedImageDecodeEnabled: false }).optimizedImageDecodeEnabled, false);
});

test('reader preview decoder reads source geometry and falls back when resize decode is unavailable', async () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 8000);
  view.setUint32(20, 12000);
  assert.deepEqual(readerPreviewDecode.readImageDimensions(png.buffer), { width: 8000, height: 12000 });
  assert.deepEqual(await readerPreviewDecode.getReaderPreviewSource('blob:source', {
    sourceSize: { width: 8000, height: 12000 },
  }), { src: 'blob:source', width: 8000, height: 12000, isPreview: false });
});

test('animated GIF, WebP, and APNG bypass preview canvas conversion', async () => {
  const gifFrame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0, 0];
  const animatedGif = new Uint8Array([
    ...Buffer.from('GIF89a'), 1, 0, 1, 0, 0, 0, 0,
    ...gifFrame, ...gifFrame, 0x3b,
  ]);
  const staticGif = new Uint8Array([
    ...Buffer.from('GIF89a'), 1, 0, 1, 0, 0, 0, 0,
    ...gifFrame, 0x3b,
  ]);

  const animatedWebp = new Uint8Array(30);
  animatedWebp.set(Buffer.from('RIFF'), 0);
  animatedWebp.set(Buffer.from('WEBPVP8X'), 8);
  animatedWebp[16] = 10;
  animatedWebp[20] = 0x02;

  const pngChunk = (type, payloadLength = 0) => {
    const chunk = new Uint8Array(12 + payloadLength);
    new DataView(chunk.buffer).setUint32(0, payloadLength);
    chunk.set(Buffer.from(type), 4);
    return chunk;
  };
  const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const animatedPng = new Blob([pngSignature, pngChunk('acTL', 8), pngChunk('IDAT')], { type: 'image/png' });
  const staticPng = new Blob([pngSignature, pngChunk('IHDR', 13), pngChunk('IDAT')], { type: 'image/png' });

  assert.equal(await readerPreviewDecode.isAnimatedImageBlob(new Blob([animatedGif])), true);
  assert.equal(await readerPreviewDecode.isAnimatedImageBlob(new Blob([staticGif])), false);
  assert.equal(await readerPreviewDecode.isAnimatedImageBlob(new Blob([animatedWebp])), true);
  assert.equal(await readerPreviewDecode.isAnimatedImageBlob(animatedPng), true);
  assert.equal(await readerPreviewDecode.isAnimatedImageBlob(staticPng), false);

  const source = read('src/lib/readerPreviewDecode.js');
  assert.match(source, /if \(await isAnimatedImageBlob\(blob, signal\)\) return \{ src: sourceUrl, \.\.\.dimensions, isPreview: false \};/);
});

test('decoded previews become visible atomically and immersive promotion keeps decode identity', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /className=\{isReady && !serializedDecode \? 'reader-content-fade-in' : undefined\}/);
  assert.match(reader, /target\.dataset\.readerUnit = source\.dataset\.readerUnit/);
  assert.match(reader, /target\.dataset\.decodePrecision = source\.dataset\.decodePrecision/);
  assert.match(reader, /target\.dataset\.sourceWidth = source\.dataset\.sourceWidth/);
  assert.match(reader, /target\.dataset\.sourceHeight = source\.dataset\.sourceHeight/);
  assert.match(reader, /target\.style\.cssText = source\.style\.cssText/);
});

test('immersive click and automatic page turns promote an already decoded adjacent spread', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /const promoteImmersiveTarget = useCallback/);
  assert.match(reader, /const promoted = promoteImmersiveTarget\(bounded, targetSplitPart\)/);
  assert.match(reader, /status: visibleImmediately \|\| bounded === prev\.visibleIndex \? 'ready' : 'loading'/);
});

test('image sources decode offscreen before replacing a visible bitmap', async () => {
  assert.equal(typeof readerPreviewDecode.decodeImageSource, 'function');
  const events = [];
  const image = {
    complete: false,
    naturalWidth: 0,
    naturalHeight: 0,
    set src(value) { events.push(`src:${value}`); },
    async decode() {
      events.push('decode:start');
      this.complete = true;
      this.naturalWidth = 1600;
      this.naturalHeight = 2400;
      events.push('decode:end');
    },
  };
  const result = await readerPreviewDecode.decodeImageSource('blob:ready', {
    imageFactory: () => image,
  });
  assert.deepEqual(events, ['src:blob:ready', 'decode:start', 'decode:end']);
  assert.equal(result.width, 1600);
  assert.equal(result.height, 2400);
  assert.equal(result.image, image);
});

test('paged readers retain the visible frame until the replacement spread is decoded', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /getPendingSpreadRenderState\(currentSpread, displayedSpread, targetPending\)/);
  assert.match(reader, /normalSpreadRenderState\.units\.forEach\(\(unit, slotIndex\) =>/);
  assert.match(reader, /key=\{`reader-page:\$\{unit\.pageIndex\}:\$\{unit\.splitPart\}`\}/);
  assert.match(reader, /const decoded = await decodeImageSource\(resolved\.src/);
  assert.match(reader, /loadSpread\([\s\S]{0,120}activeSpread,[\s\S]{0,120}IMAGE_LOAD_PRIORITY\.CRITICAL,[\s\S]{0,40}true,[\s\S]{0,140}foregroundSuperResolutionPageIndices\.has\(pageIndex\)/);
  assert.match(reader, /const commits = await Promise\.all/);
  assert.match(reader, /commits\.forEach\(\(commit\) =>[\s\S]{0,80}commit\(\)/);
});

test('immersive readers keep the decoded spread visible until the target commits atomically', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /const immersiveRenderSpread = targetPending && !webtoonActive \? displayedSpread : currentSpread/);
  assert.match(reader, /getImmersiveSpreadGroupStyle\(immersiveRenderSpread\)/);
  assert.match(reader, /const immersiveHasDisplayedBitmap = \[imgCurrRef\.current, imgCurrSecondRef\.current\]/);
  assert.match(reader, /normalPagePending && !immersiveHasDisplayedBitmap/);
  assert.match(reader, /imgRef\.current\.removeAttribute\('src'\)/);
});

test('reader preview transcodes are shared by preload and foreground decode', () => {
  const preview = read('src/lib/readerPreviewDecode.js');
  assert.match(preview, /const previewJobs = new Map\(\)/);
  assert.match(preview, /let previewJob = previewJobs\.get\(cacheKey\)/);
  assert.match(preview, /previewJobs\.set\(cacheKey, previewJob\)/);
  assert.match(preview, /previewJobs\.delete\(cacheKey\)/);
  assert.match(preview, /abortIfNeeded\(signal\);[\s\S]{0,100}return previewUrl/);
});

test('reader image shells hide native broken-image chrome during decode transitions', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /display:\s*isReady && !cropFrame \? 'block' : 'none'/);
  assert.match(reader, /background:\s*isImmersive[\s\S]{0,120}\? 'var\(--immersive-bg\)'[\s\S]{0,120}: \(!isReady \? 'var\(--reader-stage\)' : 'transparent'\)/);
  assert.match(reader, /!serializedDecode && loadState === 'error'/);
  assert.match(reader, /if \(serializedDecode\) \{\s*event\.currentTarget\.style\.display = 'none';/s);
  assert.match(reader, /normalPagePending[\s\S]{0,700}background:\s*'var\(--reader-stage\)'/);
});

test('swipe completion never clears the visible bitmap before its replacement is ready', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.doesNotMatch(
    reader,
    /const previewImg = deltaX[\s\S]*?currImg\.src = ''[\s\S]*?commitPageTargetRef\.current/,
  );
});

test('webtoon pages always use offscreen decode even when preview downsampling is disabled', () => {
  const reader = read('src/pages/Reader.jsx');
  const webtoonRenderers = [...reader.matchAll(/<PageImage[\s\S]{0,700}?className="reader-webtoon-page-image"|className="reader-webtoon-page"[\s\S]{0,700}?<PageImage/g)];
  assert.ok(webtoonRenderers.length >= 1);
  assert.doesNotMatch(reader, /serializedDecode=\{settings\.optimizedImageDecodeEnabled\}/);
});

test('border crop is measured from the decoded replacement before it is displayed', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /detectImageBorderInsets\(decoded\.image\)/);
  assert.match(reader, /if \(decodedImage === image && image\.dataset\.cropInsets\) return;/);
});

test('archive covers wait for one shared near-viewport observer', () => {
  const card = read('src/components/ArchiveCard.jsx');
  assert.match(card, /let nearViewportObserver/);
  assert.match(card, /rootMargin:\s*'1200px 800px'/);
  assert.match(card, /const \[thumbState, setThumbState\] = useState\(\(\) => \(/);
  assert.match(card, /typeof IntersectionObserver === 'undefined' \? 'loading' : 'idle'/);
  assert.match(card, /if \(!thumbnailEligible\) return undefined;/);
});

test('eager carousel cards skip the near-viewport gate so covers are ready before scroll-in', () => {
  const card = read('src/components/ArchiveCard.jsx');
  assert.match(card, /eagerThumbnail = false/);
  assert.match(card, /eagerThumbnail \|\| typeof IntersectionObserver === 'undefined'/);
  // Home top carousels are eager (history/watchlist/random); the in-reader
  // recommendations stay lazy so covers never compete with the main image.
  const home = read('src/pages/Home.jsx');
  const recommendations = read('src/components/Recommendations.jsx');
  const eagerUses = home.match(/eagerThumbnail/g) || [];
  assert.equal(eagerUses.length, 3);
  assert.doesNotMatch(recommendations, /eagerThumbnail/);
});

test('archive covers use the displayed image as their only decoder', () => {
  const card = read('src/components/ArchiveCard.jsx');
  assert.match(card, /loading="lazy"/);
  assert.match(card, /decoding="async"/);
  assert.doesNotMatch(card, /function readImageAspectRatio|new Image\(\)/);
});

test('image cache allows four normal covers beside the reserved critical slot', () => {
  const cache = read('src/lib/imageCache.js');
  assert.match(cache, /createImageLoadQueue\(\{ maxConcurrent: 5 \}\)/);
});

test('adjacent page previews pre-generate at the lowest decode priority while idle', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /async function primePagePreview\(pageUrl,/);
  assert.match(reader, /readerImageDecodeQueue\.schedule\(`preview:\$\{pageUrl\}`,/);
  assert.match(reader, /getReaderPreviewSource\(src, \{\s*enabled,\s*fullPrecision: false,\s*sourceSize,\s*signal,\s*\}\)/);
  assert.match(reader, /indices\.slice\(0, 2\)\.forEach/);
  assert.match(reader, /primePagePreview\(pageUrl, \{\s*enabled: settings\.optimizedImageDecodeEnabled,\s*sourceSize: pageSizesRef\.current\[idx\],\s*\}\)/);
});

test('reader progress sync collapses rapid page flips into one remote write', () => {
  const history = read('src/lib/history.js');
  assert.match(history, /const URGENT_FLUSH_DELAY_MS = 1500/);
  assert.match(history, /scheduleHistoryFlush\(immediateRemote \? URGENT_FLUSH_DELAY_MS : HISTORY_SYNC_INTERVAL_MS\)/);
});

test('random roaming fires freshness attempts in parallel and fetches the next scroll batch early', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /const attemptCount = preferFresh \? RANDOMS_FETCH_ATTEMPTS : 1;/);
  assert.match(home, /const results = await Promise\.all\(Array\.from\(\{ length: attemptCount \}/);
  assert.match(home, /rootMargin: '800px'/);
});

test('EH comments serve cached comments within the SWR window instead of re-downloading the gallery', () => {
  const comments = read('src/components/EhComments.jsx');
  const cache = read('src/lib/ehCommentsCache.js');
  assert.match(comments, /const EH_SWR_REFRESH_INTERVAL_MS = 30 \* 60 \* 1000/);
  assert.match(comments, /cachedState\.ts && Date\.now\(\) - cachedState\.ts < EH_SWR_REFRESH_INTERVAL_MS/);
  assert.match(cache, /ts: Number\(accessed\.ts \|\| 0\),/);
});

test('EH comments animate measured content height changes', () => {
  const comments = read('src/components/EhComments.jsx');
  const css = read('src/index.css');
  assert.match(comments, /const commentsBodyRef = useRef\(null\)/);
  assert.match(comments, /new ResizeObserver\(updateHeight\)/);
  assert.match(comments, /className="eh-comments-content-shell"/);
  assert.match(css, /\.eh-comments-content-shell\s*\{[^}]*transition:\s*height/);
});

test('failed image decodes throw instead of hanging the decode queue', () => {
  const preview = read('src/lib/readerPreviewDecode.js');
  assert.match(preview, /catch \(error\) \{\s*if \(error\?\.name === 'AbortError'\) throw error;\s*\/\/ decode\(\) rejects on load failure[\s\S]*throw new Error\('Image decode failed'\);/);
  assert.match(preview, /if \(image\.complete && !image\.naturalWidth\) throw new Error\('Image decode failed'\);/);
  assert.match(preview, /if \(!image\.complete\) \{\s*await waitWithAbort/);
});

test('preview cache revokes the replaced object URL when the same key is written twice', () => {
  const preview = read('src/lib/readerPreviewDecode.js');
  assert.match(preview, /const previous = previewCache\.get\(key\);/);
  assert.match(preview, /URL\.revokeObjectURL\(previous\.objectUrl\);/);
  assert.match(preview, /previewCacheBytes = Math\.max\(0, previewCacheBytes - \(previous\.size \|\| 0\)\);/);
});

test('random roaming only fails when every parallel attempt failed', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /const allAttemptsFailed = results\.every\(\(batch\) => !batch\);/);
  assert.match(home, /if \(allAttemptsFailed && lastError\) throw lastError;/);
});

test('scroll mode ignores resize-driven page size changes so the list is never reset', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /if \(archiveBrowseMode === ARCHIVE_BROWSE_MODES\.scroll\) return;/);
  assert.match(home, /\}, \[archiveBrowseMode, cropCover\]\);/);
});

test('EH comments keep valid cached comments when a background refresh returns nothing', () => {
  const comments = read('src/components/EhComments.jsx');
  assert.match(comments, /shouldKeepEhCommentsOnRefreshFailure\(\s*cachedComments,\s*commentsRef\.current,\s*\)/);
  assert.match(comments, /if \(keepVisibleComments\) \{\s*setLoaded\(true\);\s*setError\(null\);/);
  assert.match(comments, /finalComments\.length > 0 \|\| !cachedComments/);
  assert.match(comments, /if \(isTerminalGalleryError\(e\?\.ehCode\)\) \{\s*if \(!keepVisibleComments\)/);
});

test('history page merges writes made during hydration instead of overwriting them', () => {
  const historyPage = read('src/pages/HistoryPage.jsx');
  const watchlistPage = read('src/pages/WatchlistPage.jsx');
  assert.match(historyPage, /const localHistory = getHistory\(\)/);
  assert.match(historyPage, /const mergedHistory = mergeLatestHistoryItems\(localHistory, state\.histories\)/);
  assert.match(historyPage, /setHistoryState\(mergedHistory\.map\(\(item\) => \(\{/);
  assert.match(historyPage, /page:\s*item\.page,\s*time:\s*item\.time/);
  assert.match(watchlistPage, /enhanced && enhanced\.addedAt === item\.addedAt \? \{ \.\.\.item, \.\.\.enhanced \} : item/);
});

test('drawer thumbnails recover from cache when their object URL is revoked', () => {
  const thumbnail = read('src/components/ArchivePageThumbnail.jsx');
  assert.match(thumbnail, /getCachedImage\(`thumb:drawer:v3:\$\{archiveId\}:\$\{pageIndex \+ 1\}`\)\.then/);
});
