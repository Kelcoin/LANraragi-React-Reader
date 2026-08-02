import React, { useEffect, useRef, useState } from 'react';
import { lrrApi, waitForMinionJob } from '../lib/api';
import { getCachedImage, getImage, IMAGE_LOAD_PRIORITY } from '../lib/imageCache';

const minionWaits = new Map();

function waitForThumbnailJob(job) {
  const jobId = Number(job?.job ?? job);
  if (!Number.isFinite(jobId) || jobId <= 0) return Promise.resolve(null);
  if (!minionWaits.has(jobId)) {
    const task = waitForMinionJob(jobId, { timeoutMs: 2 * 60 * 1000 })
      .finally(() => minionWaits.delete(jobId));
    minionWaits.set(jobId, task);
  }
  return minionWaits.get(jobId);
}

export default function ArchivePageThumbnail({ archiveId, pageIndex, active, cacheOnly = false, eager = false }) {
  const [src, setSrc] = useState(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [allowNetworkFallback, setAllowNetworkFallback] = useState(() => !cacheOnly);
  const [thumbState, setThumbState] = useState('idle');
  const [retryTick, setRetryTick] = useState(0);
  const wrapRef = useRef(null);
  const retryTimerRef = useRef(null);

  useEffect(() => {
    if (!cacheOnly) setAllowNetworkFallback(true);
  }, [cacheOnly]);

  useEffect(() => {
    if (!active) { setShouldLoad(false); return undefined; }
    if (eager) { setShouldLoad(true); return undefined; }
    const element = wrapRef.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: '140px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, eager]);

  useEffect(() => {
    let mounted = true;
    if (!shouldLoad || !archiveId || typeof pageIndex !== 'number') return undefined;

    const clearRetry = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
    const scheduleRetry = () => {
      clearRetry();
      retryTimerRef.current = setTimeout(() => {
        if (mounted) setRetryTick((tick) => tick + 1);
      }, 900);
    };

    void (async () => {
      const page = pageIndex + 1;
      const thumbKey = `thumb:drawer:v3:${archiveId}:${page}`;
      try {
        setThumbState((state) => state === 'queued' ? state : 'loading');
        let blobUrl = await getCachedImage(thumbKey);
        if (!blobUrl && !(cacheOnly && !allowNetworkFallback)) {
          blobUrl = await getImage(thumbKey, async (signal) => {
            let result = await lrrApi.getArchiveThumbnail(archiveId, { page, noFallback: true, signal });
            if (result.status === 202 && result.job) {
              await waitForThumbnailJob(result.job);
              result = await lrrApi.getArchiveThumbnail(archiveId, { page, noFallback: true, signal });
            }
            return result.status !== 202 ? result.blob : null;
          }, { priority: IMAGE_LOAD_PRIORITY.NORMAL });
        }
        if (!mounted) return;
        if (blobUrl) {
          setSrc(blobUrl);
          setThumbState('ready');
          clearRetry();
        } else if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
        } else {
          setSrc(null);
          setThumbState('queued');
          scheduleRetry();
        }
      } catch {
        if (!mounted) return;
        if (cacheOnly && !allowNetworkFallback) {
          setAllowNetworkFallback(true);
        } else {
          setSrc(null);
          setThumbState('error');
          clearRetry();
        }
      }
    })();

    return () => {
      mounted = false;
      clearRetry();
    };
  }, [allowNetworkFallback, archiveId, cacheOnly, pageIndex, retryTick, shouldLoad]);

  if (!src) {
    return (
      <div
        ref={wrapRef}
        className={`archive-page-thumbnail-placeholder is-${thumbState}`}
      >
        {thumbState === 'error' ? '缩略图失败' : thumbState === 'queued' ? '生成中' : ''}
      </div>
    );
  }

  return (
    <img
      ref={wrapRef}
      src={src}
      alt=""
      width="100"
      height="130"
      className="archive-page-thumbnail-image"
      onLoad={() => setThumbState('ready')}
      onError={() => {
        // Blob URL may have been revoked by cache eviction — recover from
        // the memory/disk cache first instead of showing a permanent error.
        getCachedImage(`thumb:drawer:v3:${archiveId}:${pageIndex + 1}`).then((recovered) => {
          if (recovered) {
            setSrc(recovered);
          } else {
            setSrc(null);
            setThumbState('error');
          }
        }).catch(() => {
          setSrc(null);
          setThumbState('error');
        });
      }}
      loading="eager"
    />
  );
}
