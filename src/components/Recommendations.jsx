import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { lrrApi } from '../lib/api';
import { getCropCover, getHistory } from '../lib/history';
import { useHorizontalScroller } from '../lib/horizontalScroller';
import { navigateToArchive, navigateToMetadata } from '../lib/navigation';
import ArchiveCard from './ArchiveCard';
import ArchiveContextMenu from './ArchiveContextMenu';
import ConfirmDialog from './ConfirmDialog';
import EhFavoriteDeleteSwitch from './EhFavoriteDeleteSwitch';
import ArchiveDeletionFailureDialog from './ArchiveDeletionFailureDialog';
import { useViewportWidth } from '../lib/viewport';
import { ARCHIVE_PROGRESS_VISIBILITY, readArchiveProgressVisibility, shouldShowArchiveProgress } from '../lib/archiveProgress';
import { clearConfiguredArchiveReadingProgress } from '../lib/archiveProgressActions';
import { subscribeReadingProgressChanged } from '../lib/readingProgress';
import { scopedStorageKey } from '../lib/configScope';
import { deleteArchiveWithFavoriteSync } from '../lib/archiveDeletion';
import { getEhFavoriteDeleteSync } from '../lib/ehFavoriteSync';
import { hasValidWorkerConfig } from '../lib/worker-config';
import { useToast } from './Toast';

const CUSTOM_WEIGHT_TAGS = {
  'female:ahegao': 1.5, 'female:anal intercourse': 2, 'female:anal': 2,
  'female:bbw': 4, 'female:beauty mark': 1.5, 'female:big ass': 1.5,
  'female:big breast': 2, 'female:bikini': 1.5, 'female:blowjob': 1.5,
  'female:bondage': 2, 'female:cheating': 2, 'female:corruption': 2,
  'female:dark skin': 2, 'female:defloration': 2, 'female:dickgirl on female': 3,
  'female:double penetration': 2, 'female:exhibitionism': 1.5, 'female:femdom': 3,
  'female:fingering': 1.5, 'female:futanari': 5, 'female:glasses': 1.5,
  'female:gloves': 1.5, 'female:gyaru': 3, 'female:hairy': 2, 'female:handjob': 1.5,
  'female:harem': 3, 'female:huge breasts': 2, 'female:impregnation': 2,
  'female:kemonomimi': 2, 'female:kissing': 1.5, 'female:lactation': 2,
  'female:lingerie': 2, 'female:lolicon': 5, 'female:masturbation': 1.5,
  'female:milf': 3, 'female:mind control': 3, 'female:mother': 3,
  'female:nakadashi': 2, 'female:netorare': 3, 'female:paizuri': 1.5,
  'female:pantyhose': 2, 'female:ponytail': 1.5, 'female:public use': 3,
  'female:rape': 3, 'female:schoolgirl uniform': 1.5, 'female:sex toys': 1.5,
  'female:shemale': 4, 'female:sister': 2, 'female:squirting': 1.5,
  'female:stockings': 2, 'female:sweating': 1.5, 'female:swimsuit': 1.5,
  'female:tomboy': 4, 'female:yuri': 3,
  'male:anal': 3, 'male:bbm': 3, 'male:big penis': 1.5, 'male:condom': 1.5,
  'male:crossdressing': 3, 'male:dark skin': 3, 'male:dilf': 3,
  'male:gender change': 4, 'male:harem': 3, 'male:netorare': 3,
  'male:shotacon': 3, 'male:tomgirl': 5, 'male:virginity': 3, 'male:yaoi': 4,
  'mixed:ffm threesome': 2, 'mixed:group': 2, 'mixed:incest': 3,
  'mixed:mmf threesome': 2,
  'other:3d': 3, 'parody:': 2, 'character:': 2, 'cosplayer:': 3,
  'group:': 0.1, 'artist:': 0.1, 'category:': 0.1,
  'other:ai 超分': 0, 'other:mosaic censorship': 0, 'other:uncensored': 0,
  'language:': 0, 'uploader:': 0, 'timestamp:': 0, 'source:': 0, 'dateadded:': 0,
};

function stripRecommendationProgress(items = []) {
  return items.map((item) => {
    const sanitized = { ...item };
    delete sanitized.page;
    delete sanitized.progress;
    return sanitized;
  });
}

function applyCanonicalHistoryProgress(items = []) {
  const progressById = new Map(getHistory().map((item) => [String(item.id || item.arcid), Number(item.page) || 0]));
  return stripRecommendationProgress(items).map((item) => {
    const page = progressById.get(String(item.arcid || item.id));
    return page === undefined ? item : { ...item, page, progress: page };
  });
}

const LIKE_NAMESPACES = ['female', 'male', 'others'];
const LIKE_FALLBACK_NS = ['character', 'parody'];
const PER_VIEW_LIMIT = 15;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function calculateSimilarity(sourceTagsLower, archive) {
  const tagsStr = archive.tags;
  if (!tagsStr) return 0;

  const candidateTags = tagsStr.split(',');
  let totalScore = 0;

  for (const rawTag of candidateTags) {
    const tag = rawTag.trim().toLowerCase();
    if (!tag) continue;
    if (!sourceTagsLower.has(tag)) continue;

    let pts = CUSTOM_WEIGHT_TAGS[tag];
    if (pts === undefined) {
      const ci = tag.indexOf(':');
      if (ci > 0) pts = CUSTOM_WEIGHT_TAGS[tag.slice(0, ci + 1)];
    }
    if (pts === undefined || pts === 0) continue;

    totalScore += pts * (0.8 + Math.random() * 0.4);
  }

  if (totalScore === 0) return 0;

  const pagecount = +archive.pagecount;
  const progress = +archive.progress;
  if (pagecount > 0 && progress >= pagecount) {
    totalScore *= 0.5;
  }

  return totalScore;
}

export default function Recommendations({ currentArchive }) {
  const { showToast } = useToast();
  const workerReady = hasValidWorkerConfig();
  const [progressBarVisibility] = useState(readArchiveProgressVisibility);
  const showGlobalArchiveProgress = shouldShowArchiveProgress(progressBarVisibility, false);
  const reserveGlobalProgressSpace = progressBarVisibility === ARCHIVE_PROGRESS_VISIBILITY.GLOBAL;
  const [tab, setTab] = useState('sim');
  const [collapsed, setCollapsed] = useState(false);
  const [simData, setSimData] = useState([]);
  const [artistData, setArtistData] = useState([]);
  const [loading, setLoading] = useState(true);
  const isNarrow = useViewportWidth() < 600;
  const [retryTick, setRetryTick] = useState(0);
  const [archiveMenu, setArchiveMenu] = useState(null);
  const [archiveDeleteTarget, setArchiveDeleteTarget] = useState(null);
  const [archiveDeleting, setArchiveDeleting] = useState(false);
  const [archiveDeleteSyncConfirmed, setArchiveDeleteSyncConfirmed] = useState(true);
  const [archiveFailureReport, setArchiveFailureReport] = useState(null);
  const sectionRef = useRef(null);
  const [nearViewport, setNearViewport] = useState(false);
  const retryTimerRef = useRef(null);
  const retryCountRef = useRef(0);
  const recommendationRequestSeqRef = useRef(0);
  const scroller = useHorizontalScroller();
  const sourceTagsLower = useMemo(() => {
    if (!currentArchive?.tags) return new Set();
    return new Set(currentArchive.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean));
  }, [currentArchive?.tags]);

  const noCrop = useMemo(() => !getCropCover(), [currentArchive?.arcid]);

  useEffect(() => subscribeReadingProgressChanged(({ archiveId, page }) => {
    const update = (items) => items.map((item) => (
      String(item?.arcid || item?.id || '') === archiveId ? { ...item, progress: page, page } : item
    ));
    setSimData(update);
    setArtistData(update);
  }), []);

  const archiveTags = useMemo(() => {
    if (!currentArchive?.tags) return [];
    return currentArchive.tags.split(',').map(t => t.trim()).filter(Boolean);
  }, [currentArchive?.tags]);

  const isCosplayWithCosplayer = useMemo(() => {
    const hasCosplay = archiveTags.some((tag) => tag.toLowerCase() === 'category:cosplay');
    const hasCosplayer = archiveTags.some((tag) => /^cosplayer:\s*\S/i.test(tag));
    return hasCosplay && hasCosplayer;
  }, [archiveTags]);

  const sameCreatorTags = useMemo(() => {
    return archiveTags.filter(t => {
      const p = t.split(':')[0].toLowerCase();
      return isCosplayWithCosplayer ? p === 'cosplayer' : p === 'artist' || p === 'group';
    });
  }, [archiveTags, isCosplayWithCosplayer]);
  const sameCreatorType = isCosplayWithCosplayer ? 'cosplayer' : 'artist';
  const sameCreatorLabel = isCosplayWithCosplayer ? '同Coser' : '同作者';

  const sourceCategoryLower = useMemo(() => {
    if (!currentArchive?.tags) return new Set();
    return new Set(currentArchive.tags.split(',').map(t => t.trim()).filter(Boolean).filter(t => t.split(':')[0].toLowerCase() === 'category').map(t => t.toLowerCase()));
  }, [currentArchive?.tags]);

  useEffect(() => {
    if (nearViewport || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return undefined;
    }
    if (!sectionRef.current) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '400px 0px' });
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, [nearViewport]);

  useEffect(() => {
    if (!currentArchive?.arcid || !currentArchive?.tags) return;
    if (!nearViewport) return;
    const cacheKey = scopedStorageKey(`lrr_rec_cache_v3_${sameCreatorType}_${currentArchive.arcid}`);
    let cancelled = false;
    const requestSeq = ++recommendationRequestSeqRef.current;

    const fetchAll = async () => {
      setLoading(true);
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.t < 86400000) {
              if (cancelled || requestSeq !== recommendationRequestSeqRef.current) return;
              setSimData(applyCanonicalHistoryProgress(parsed.sim || []));
              setArtistData(applyCanonicalHistoryProgress(parsed.artist || []));
              if (requestSeq === recommendationRequestSeqRef.current) setLoading(false);
              return;
            }
          } catch {}
        }

        const [sim, artist] = await Promise.all([
          buildYouMayLike(),
          buildSameCreator(),
        ]);

        if (cancelled || requestSeq !== recommendationRequestSeqRef.current) return;
        setSimData(applyCanonicalHistoryProgress(sim));
        setArtistData(applyCanonicalHistoryProgress(artist));
        if (sim.length || artist.length) {
          try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), sim: stripRecommendationProgress(sim), artist: stripRecommendationProgress(artist) })); } catch {}
        }
      } catch {}
      if (!cancelled && requestSeq === recommendationRequestSeqRef.current) setLoading(false);
    };
    fetchAll();
    return () => {
      cancelled = true;
      if (requestSeq === recommendationRequestSeqRef.current) recommendationRequestSeqRef.current += 1;
    };
  }, [currentArchive?.arcid, nearViewport, retryTick, sameCreatorType]);

  const buildYouMayLike = async () => {
    const tags = currentArchive.tags.split(',').map(t => t.trim()).filter(Boolean);

    const primary = [], fallback = [];
    tags.forEach(raw => {
      const parts = raw.split(':');
      if (parts.length <= 1) return;
      const ns = parts[0].toLowerCase();
      if (LIKE_NAMESPACES.includes(ns)) primary.push(raw);
      else if (LIKE_FALLBACK_NS.includes(ns)) fallback.push(raw);
    });

    let base = primary.length > 0 ? primary : fallback;
    if (base.length === 0) return [];

    let maxSearch = 3;
    if (tags.length > 40) maxSearch = 7;
    else if (tags.length > 20) maxSearch = 5;

    const queryTags = shuffle(base).slice(0, Math.min(maxSearch, base.length));
    const map = new Map();

    for (const tag of queryTags) {
      try {
        const res = await lrrApi.search(`${tag}$`);
        (res.data || []).forEach(arc => {
          if (arc.arcid !== currentArchive.arcid && !map.has(arc.arcid)) {
            map.set(arc.arcid, arc);
          }
        });
      } catch {}
    }

    let all = Array.from(map.values());
    if (all.length === 0) return [];

    all.forEach(arc => { arc._score = calculateSimilarity(sourceTagsLower, arc); });

    const sameCat = [], otherCat = [];
    all.forEach(arc => {
      const hasCat = (arc.tags || '').split(',').some(t => sourceCategoryLower.has(t.trim().toLowerCase()));
      if (hasCat) sameCat.push(arc);
      else otherCat.push(arc);
    });

    const sortDesc = (a, b) => b._score - a._score;
    let picked;
    if (sameCat.length >= PER_VIEW_LIMIT) {
      picked = sameCat.sort(sortDesc).slice(0, PER_VIEW_LIMIT);
    } else {
      picked = sameCat.sort(sortDesc);
      const need = PER_VIEW_LIMIT - picked.length;
      if (need > 0) picked = picked.concat(otherCat.sort(sortDesc).slice(0, need));
    }
    return picked;
  };

  const buildSameCreator = async () => {
    if (sameCreatorTags.length === 0) return [];
    const map = new Map();

    for (const tag of shuffle(sameCreatorTags)) {
      if (map.size >= PER_VIEW_LIMIT * 2) break;
      try {
        const res = await lrrApi.search(`${tag}$`);
        (res.data || []).forEach(arc => {
          if (arc.arcid !== currentArchive.arcid && !map.has(arc.arcid)) {
            map.set(arc.arcid, arc);
          }
        });
      } catch {}
      if (map.size >= PER_VIEW_LIMIT) break;
    }

    const all = Array.from(map.values());
    all.sort((a, b) => {
      const ra = (parseInt(a.pagecount) > 0 && parseInt(a.progress) >= parseInt(a.pagecount));
      const rb = (parseInt(b.pagecount) > 0 && parseInt(b.progress) >= parseInt(b.pagecount));
      if (ra !== rb) return ra ? 1 : -1;
      return (a.title || '').localeCompare(b.title || '');
    });
    return all.slice(0, PER_VIEW_LIMIT);
  };

  const refreshCache = useCallback(async () => {
    const cacheKey = scopedStorageKey(`lrr_rec_cache_v3_${sameCreatorType}_${currentArchive.arcid}`);
    const requestSeq = ++recommendationRequestSeqRef.current;
    try { localStorage.removeItem(cacheKey); } catch {}
    retryCountRef.current = 0;
    setLoading(true);
    try {
      const [sim, artist] = await Promise.all([buildYouMayLike(), buildSameCreator()]);
      if (requestSeq !== recommendationRequestSeqRef.current) return;
      setSimData(applyCanonicalHistoryProgress(sim));
      setArtistData(applyCanonicalHistoryProgress(artist));
      if (sim.length || artist.length) {
        try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), sim: stripRecommendationProgress(sim), artist: stripRecommendationProgress(artist) })); } catch {}
      }
    } catch {}
    if (requestSeq === recommendationRequestSeqRef.current) setLoading(false);
  }, [currentArchive, sameCreatorType]);

  useEffect(() => {
    if (!currentArchive?.arcid) return undefined;
    if (loading) return undefined;
    if (simData.length > 0 || artistData.length > 0 || sameCreatorTags.length === 0) {
      retryCountRef.current = 0;
      return undefined;
    }
    if (retryCountRef.current >= 2) return undefined;
    retryTimerRef.current = setTimeout(() => {
      retryCountRef.current += 1;
      setRetryTick((v) => v + 1);
    }, 1200);
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [artistData.length, currentArchive?.arcid, loading, sameCreatorTags.length, simData.length]);

  const toggleCollapse = () => setCollapsed(v => !v);
  const data = tab === 'sim' ? simData : artistData;
  const hasArtist = artistData.length > 0;
  const skeletonCount = isNarrow ? 6 : 8;
  const contentKey = loading
    ? `loading-${currentArchive?.arcid || ''}`
    : `${tab}-${data.map((arc) => arc.arcid || arc.id).join('-')}`;

  const handleCardClick = (arc, options) => {
    navigateToArchive(arc.arcid || arc.id, options);
  };

  const handleOpenArchiveMenu = useCallback((archive, point) => {
    setArchiveMenu({ archive, x: point.x, y: point.y });
  }, []);

  const handleArchiveDownload = useCallback(async (archive) => {
    const archiveId = archive?.arcid || archive?.id;
    if (!archiveId) return;
    try {
      const { blob, filename } = await lrrApi.downloadArchive(archiveId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || `${archiveId}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      showToast(err.message || '下载失败', 'error');
    }
  }, [showToast]);

  const handleArchiveCopyLink = useCallback(async (archive) => {
    const archiveId = archive?.arcid || archive?.id;
    if (!archiveId) return;
    const url = `${window.location.origin}/?id=${encodeURIComponent(archiveId)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      prompt('复制档案链接:', url);
    }
  }, []);

  const handleClearArchiveProgress = useCallback(async (archive) => {
    const result = await clearConfiguredArchiveReadingProgress(archive);
    const archiveId = archive.arcid || archive.id;
    const update = (items) => items.map((item) => (
      (item.arcid || item.id) === archiveId ? { ...item, progress: result.page, page: result.page } : item
    ));
    setSimData(update);
    setArtistData(update);
    return result;
  }, []);

  const handleArchiveDelete = useCallback(async () => {
    const archiveId = archiveDeleteTarget?.arcid || archiveDeleteTarget?.id;
    if (!archiveId) return;
    const title = archiveDeleteTarget?.title || archiveId;
    const ehFailures = [];
    setArchiveDeleting(true);
    try {
      await deleteArchiveWithFavoriteSync(archiveDeleteTarget, {
        syncEnabled: workerReady && getEhFavoriteDeleteSync(),
        confirmationEnabled: archiveDeleteSyncConfirmed,
        continueOnFavoriteError: true,
        onFavoriteError: ({ galleryUrl, error }) => {
          ehFailures.push({ url: galleryUrl, message: error?.message || 'E-Hentai 收藏夹删除失败' });
        },
      });
      setSimData((prev) => prev.filter((arc) => (arc.arcid || arc.id) !== archiveId));
      setArtistData((prev) => prev.filter((arc) => (arc.arcid || arc.id) !== archiveId));
      setArchiveDeleteTarget(null);
      if (ehFailures.length > 0) {
        setArchiveFailureReport({ ehFailures, lrrFailures: [], message: 'LANraragi 档案已删除，但 E-Hentai 收藏夹移除失败。' });
      }
    } catch (err) {
      setArchiveDeleteTarget(null);
      setArchiveFailureReport({
        ehFailures,
        lrrFailures: [{ id: archiveId, title, message: err?.message || '删除失败' }],
        message: '档案删除未全部完成，可稍后重试。',
      });
    } finally {
      setArchiveDeleting(false);
    }
  }, [archiveDeleteSyncConfirmed, archiveDeleteTarget, workerReady]);

  if ((!currentArchive || (!loading && simData.length === 0 && artistData.length === 0 && sameCreatorTags.length === 0)) && !archiveDeleteTarget && !archiveFailureReport) return null;

  return (
    <>
    <div ref={sectionRef} data-lrr-recommendations className="section-reveal section-reveal-delay-2 recommendation-section">
      <div className={`surface recommendation-panel${collapsed ? ' is-collapsed' : ''}`}>
        <div className={`recommendation-header${collapsed ? ' is-collapsed' : ''}`}>
          <div className="recommendation-tabs">
            <button
              onClick={() => { if (collapsed) toggleCollapse(); setTab('sim'); }}
              className={`btn btn-secondary recommendation-tab${tab === 'sim' ? ' is-active' : ''}`}
            >猜你喜欢</button>
            {hasArtist && (
              <button
                onClick={() => { if (collapsed) toggleCollapse(); setTab('artist'); }}
                className={`btn btn-secondary recommendation-tab${tab === 'artist' ? ' is-active' : ''}`}
              >{sameCreatorLabel}</button>
            )}
          </div>

          <div className="recommendation-actions">
            <button
              className={`btn btn-secondary recommendation-refresh${loading ? ' is-loading' : ''}`}
              onClick={refreshCache}
              disabled={loading}
              title="清理缓存并刷新"
            >
              {loading ? '刷新中' : '刷新'}
            </button>
            <button aria-label={collapsed ? '展开推荐' : '收起推荐'} onClick={toggleCollapse} className={`btn btn-icon btn-quiet recommendation-collapse-button${collapsed ? ' is-collapsed' : ''}`}>
              <svg className="recommendation-collapse-icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M6 15l6-6 6 6z"/></svg>
            </button>
          </div>
        </div>

        <div
          ref={scroller.ref}
          onWheelCapture={scroller.onWheelCapture}
          onScroll={scroller.onScroll}
          onMouseDown={scroller.onMouseDown}
          onClickCapture={scroller.onClickCapture}
          onDragStart={scroller.onDragStart}
          className="no-scrollbar recommendation-scroller"
        >
          <div key={contentKey} className={`component-content-fade recommendation-content${loading ? ' is-loading' : ''}`}>
            {loading ? (
              <>
              {Array.from({ length: skeletonCount }).map((_, i) => (
                <div key={`rsk-${i}`} className="recommendation-loading-card">
                  <div className="recommendation-loading-cover shimmer-strip" />
                  <div className="recommendation-loading-body">
                    <div className="recommendation-loading-line shimmer-strip" />
                    <div className="recommendation-loading-line recommendation-loading-line-short shimmer-strip" />
                    <div className="recommendation-loading-meta">
                      <span className="recommendation-loading-chip shimmer-strip" />
                      <span className="recommendation-loading-chip recommendation-loading-chip-short shimmer-strip" />
                    </div>
                  </div>
                </div>
              ))}
              </>
            ) : data.length === 0 ? (
              <div className="recommendation-empty">暂无推荐结果。</div>
            ) : (
              data.map(arc => (
                <ArchiveCard key={arc.arcid || arc.id} archive={arc} onClick={() => handleCardClick(arc)} onArchiveContextMenu={handleOpenArchiveMenu} showProgressBar={showGlobalArchiveProgress} reserveProgressSpace={reserveGlobalProgressSpace} noCrop={noCrop} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
    <ArchiveContextMenu
      menu={archiveMenu}
      onClose={() => setArchiveMenu(null)}
      onRead={(archive, options) => handleCardClick(archive, options)}
      onReadIncognito={(archive, options) => navigateToArchive(archive.arcid || archive.id, { ...options, incognito: true })}
      onClearProgress={handleClearArchiveProgress}
      onEditMetadata={(archive, options) => navigateToMetadata(archive.arcid || archive.id, options)}
      onDownload={handleArchiveDownload}
      onCopyLink={handleArchiveCopyLink}
      onDelete={(archive) => { setArchiveDeleteSyncConfirmed(true); setArchiveDeleteTarget(archive); }}
    />
    <ConfirmDialog
      open={!!archiveDeleteTarget}
      title="确认删除档案"
      message={archiveDeleteTarget ? `将从 LANraragi 中删除“${archiveDeleteTarget.title || archiveDeleteTarget.arcid || archiveDeleteTarget.id}”。此操作不可撤销。` : ''}
      confirmLabel={archiveDeleting ? '删除中…' : '确认删除'}
      cancelLabel="取消"
      onConfirm={handleArchiveDelete}
      onCancel={() => { if (!archiveDeleting) setArchiveDeleteTarget(null); }}
      confirmDisabled={archiveDeleting}
      dismissOnBackdrop={!archiveDeleting}
    >
      {workerReady && getEhFavoriteDeleteSync() && (
        <EhFavoriteDeleteSwitch checked={archiveDeleteSyncConfirmed} onChange={setArchiveDeleteSyncConfirmed} disabled={archiveDeleting} />
      )}
    </ConfirmDialog>
    <ArchiveDeletionFailureDialog
      report={archiveFailureReport}
      message={archiveFailureReport?.message}
      onClose={() => setArchiveFailureReport(null)}
    />
    </>
  );
}

