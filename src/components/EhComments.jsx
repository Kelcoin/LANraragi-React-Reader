import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ToolbarGlyph } from './AppGlyphs';
import { isTerminalGalleryError, presentEhError } from '../lib/ehCommentsState';
import {
  createEhCommentsCacheKey,
  deleteEhCommentsCache,
  readEhCommentsCacheState,
  writeEhCommentsCache,
} from '../lib/ehCommentsCache';

const EMPTY_API_DATA = Object.freeze({ apiuid: null, apikey: null, gid: null, token: null, apiUrl: 'https://api.e-hentai.org/api.php' });
const EH_REQUEST_TIMEOUT_MS = 20 * 1000;
// Minimum gap between background SWR re-fetches of an EH gallery (cache TTL is 24h).
const EH_SWR_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const VoteIcon = ({ direction, active = false }) => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="currentColor"
    style={{ display: 'block' }}
  >
    {direction === 'up'
      ? <path d="M8 3L13 11H3L8 3Z" opacity={active ? 1 : 0.96} />
      : <path d="M8 11L3 3H13L8 11Z" opacity={active ? 1 : 0.96} />}
  </svg>
);

function formatTimeCN(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

function getSafeCookie(raw) {
  let c = (raw || '').trim();
  if (!c) return '';
  if (!c.endsWith(';')) c += ';';
  if (!c.includes('nw=1')) c += ' nw=1;';
  return c;
}

function extractApiData(htmlText) {
  const apiuidMatch = htmlText.match(/var\s+apiuid\s*=\s*(\d+)/);
  const apikeyMatch = htmlText.match(/var\s+apikey\s*=\s*["']([^"']+)["']/);
  const gidMatch = htmlText.match(/var\s+gid\s*=\s*(\d+)/);
  const tokenMatch = htmlText.match(/var\s+token\s*=\s*["']([^"']+)["']/);
  const apiUrlMatch = htmlText.match(/var\s+api_url\s*=\s*["']([^"']+)["']/);

  return {
    apiuid: apiuidMatch ? parseInt(apiuidMatch[1]) : null,
    apikey: apikeyMatch ? apikeyMatch[1] : null,
    gid: gidMatch ? parseInt(gidMatch[1]) : null,
    token: tokenMatch ? tokenMatch[1] : null,
    apiUrl: apiUrlMatch ? apiUrlMatch[1] : 'https://api.e-hentai.org/api.php'
  };
}

function parseEHCommentsFromDOM(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');

  const commentDivs = doc.querySelectorAll('#cdiv .c1');
  const comments = [];

  commentDivs.forEach(el => {
    try {
      let commentId = 0;
      const idAnchor = el.previousElementSibling;
      if (idAnchor && idAnchor.name && idAnchor.name.startsWith('c')) commentId = parseInt(idAnchor.name.substring(1)) || 0;
      else {
        const c6 = el.querySelector('.c6');
        if (c6 && c6.id && c6.id.startsWith('comment_')) commentId = parseInt(c6.id.substring(8)) || 0;
      }

      const editLink = el.querySelector('.c4 a[onclick*="edit_comment"]');
      const isEditable = !!editLink;

      const voteUpLink = el.querySelector('.c4 a[id^="comment_vote_up"]');
      const voteDownLink = el.querySelector('.c4 a[id^="comment_vote_down"]');
      let myVote = 0;

      const hasStyle = (link) => {
        if (!link) return false;
        const s = link.getAttribute('style');
        return s && (s.includes('color') || s.includes('font-weight'));
      };

      if (voteUpLink && hasStyle(voteUpLink)) myVote = 1;
      else if (voteDownLink && hasStyle(voteDownLink)) myVote = -1;

      const metaBlock = el.querySelector('.c3');
      const userLink = metaBlock?.querySelector('a');
      const userName = userLink ? userLink.textContent : (metaBlock?.textContent?.match(/Posted by:? (.*?) on/)?.[1] || 'Unknown');
      const rawTime = metaBlock?.textContent?.match(/Posted on (.*?) by/)?.[1] || '';
      const timestamp = Date.parse(rawTime + ' UTC') || 0;

      const scoreBlock = el.querySelector('.c5 span');
      const scoreText = scoreBlock ? scoreBlock.textContent : '0';
      const score = parseInt(scoreText.replace(/[^0-9+-]/g, '')) || 0;

      const contentBlock = el.querySelector('.c6');
      let contentHtml = '';
      if (contentBlock) {
        const safeClone = contentBlock.cloneNode(true);
        safeClone.querySelectorAll('script, style, link, iframe, form, input, button, textarea').forEach(n => n.remove());
        safeClone.querySelectorAll('*').forEach(node => {
          node.removeAttribute('style'); node.removeAttribute('class'); node.removeAttribute('id');
          Array.from(node.attributes).forEach(attr => {
            if (attr.name.toLowerCase().startsWith('on')) node.removeAttribute(attr.name);
          });
          if (node.tagName === 'A') {
            node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer');
          }
        });
        contentHtml = safeClone.innerHTML;
      }

      const isUploader = !!el.querySelector('a[name="ulcomment"]');

      comments.push({ id: commentId, user: userName, timestamp, score, content: contentHtml, isUploader, isEditable, myVote });
    } catch {}
  });

  return { comments };
}

function parseEHCommentsFromAPI(apiResp) {
  if (!apiResp || !apiResp.gmetadata) return [];
  const meta = apiResp.gmetadata[0];
  if (!meta || !meta.comments) return [];

  const isUploaderName = meta.uploader || '';
  return meta.comments.map(c => ({
    id: c.id,
    user: c.comment_poster || 'Unknown',
    timestamp: c.posted_date ? Date.parse(c.posted_date + ' UTC') || 0 : 0,
    score: c.comment_score || 0,
    content: c.comment_body || '',
    isUploader: (c.comment_poster || '').toLowerCase() === isUploaderName.toLowerCase(),
    isEditable: false,
    myVote: 0,
  }));
}

function ehUrl(rawUrl, worker) {
  if (!rawUrl) return rawUrl;
  if (worker) return worker;
  if (!import.meta.env.DEV) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.hostname === 'exhentai.org' || u.hostname === 'e-hentai.org') {
      return '/eh' + u.pathname + u.search;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function normaliseEhUrl(rawUrl) {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

async function workerApi(workerBase, path, body, token, parentSignal = null) {
  if (!token) throw new Error('Worker Token 无效或缺失。请在设定面板填入 KV tokens 中配置的 Token。');
  const url = (workerBase || '').replace(/\/$/, '') + path;
  const headers = { 'Content-Type': 'application/json', 'x-sync-token': token };
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) forwardAbort();
  else parentSignal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), EH_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', forwardAbort);
  }
}

function ehRequestError(code, detail = '') {
  const error = new Error(detail || code);
  error.ehCode = code;
  error.ehDetail = detail;
  return error;
}

export default function EhComments({ sourceUrl, ehEnabled, ehCookie, ehWorker, ehToken, ehMinScore, ehMaxComments, ehSortMethod, ehSortOrder, onCookieRefresh }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [needsCookie, setNeedsCookie] = useState(false);
  const [shouldAutoLoad, setShouldAutoLoad] = useState(false);
  const sectionRef = useRef(null);
  const hasAutoLoadedRef = useRef(false);
  const requestSeqRef = useRef(0);
  const requestAbortRef = useRef(null);

  const [apiData, setApiData] = useState(EMPTY_API_DATA);
  const [postText, setPostText] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [votingId, setVotingId] = useState(null);
  const votingRef = useRef(null);

  const cookie = getSafeCookie(ehCookie);
  const onCookieRefreshRef = useRef(onCookieRefresh);
  onCookieRefreshRef.current = onCookieRefresh;

  useEffect(() => {
    requestSeqRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setComments([]);
    setLoading(false);
    setLoaded(false);
    setError(null);
    setNeedsCookie(false);
    setApiData(EMPTY_API_DATA);
    setShouldAutoLoad(false);
    hasAutoLoadedRef.current = false;

    if (!sourceUrl || !ehEnabled) return undefined;
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShouldAutoLoad(true);
      return () => requestAbortRef.current?.abort();
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldAutoLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => {
      observer.disconnect();
      requestAbortRef.current?.abort();
    };
  }, [cookie, ehEnabled, ehToken, ehWorker, sourceUrl]);

  const fetchComments = useCallback(async (forceRefresh) => {
    if (!sourceUrl) return;

    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, EH_REQUEST_TIMEOUT_MS);
    const isCurrent = () => requestSeqRef.current === requestSeq && !controller.signal.aborted;

    const showError = (code, detail = '') => {
      if (requestSeqRef.current !== requestSeq) return;
      const presentation = { ...presentEhError(code, detail), code };
      setError(presentation);
      setNeedsCookie(presentation.needsCookie);
    };

    const cacheKey = createEhCommentsCacheKey(sourceUrl, cookie);
    let cachedComments = null;

    try {
      if (!forceRefresh) {
        const cachedState = await readEhCommentsCacheState(cacheKey);
        if (!isCurrent()) return;
        if (cachedState) {
          if (cachedState.unavailable) {
            const presentation = presentEhError(cachedState.unavailable);
            setComments([]);
            setLoading(false);
            setLoaded(true);
            setError({ ...presentation, code: cachedState.unavailable });
            setNeedsCookie(presentation.needsCookie);
            return;
          }
          cachedComments = cachedState.comments;
          setComments(cachedComments);
          setLoading(false);
          setLoaded(true);
          setError(null);
          setNeedsCookie(false);
          // Serve from cache; only re-fetch in the background after the SWR
          // window expires, so re-entering the reader does not re-download the
          // whole gallery HTML each time.
          if (!ehWorker || !cookie) return;
          if (cachedState.ts && Date.now() - cachedState.ts < EH_SWR_REFRESH_INTERVAL_MS) return;
        }
      }

      if (!cachedComments) setLoading(true);
      setError(null);
      setNeedsCookie(false);
      if (!cachedComments) setApiData(EMPTY_API_DATA);

      const realUrl = normaliseEhUrl(sourceUrl);
      const workerUrl = ehUrl(realUrl, ehWorker);

      if (!ehWorker) throw ehRequestError('EH_WORKER_NOT_CONFIGURED');
      if (!ehToken) throw ehRequestError('TOKEN_MISSING');
      const workerHeaders = { 'Content-Type': 'application/json', 'x-sync-token': ehToken };
      const galleryRes = await fetch(workerUrl, {
        method: 'POST',
        headers: workerHeaders,
        body: JSON.stringify({ url: realUrl, cookie: cookie || '' }),
        signal: controller.signal,
      });

      const refreshedIgneous = galleryRes.headers.get('Refresh-Igneous');
      if (refreshedIgneous && cookie && onCookieRefreshRef.current) {
        onCookieRefreshRef.current(cookie.replace(/\bigneous=[^;\s]*/i, `igneous=${refreshedIgneous}`));
      }

      if (!galleryRes.ok) {
        let jsonErr = null;
        try { jsonErr = await galleryRes.json(); } catch {}

        if (jsonErr?.error) {
          throw ehRequestError(jsonErr.error, jsonErr.detail);
        }
        throw ehRequestError('EH_WORKER_ERROR', `Worker 请求失败 (${galleryRes.status})`);
      }

      const rawResponse = await galleryRes.text();
      let jsonErr = null;
      try { jsonErr = JSON.parse(rawResponse); } catch {}
      if (jsonErr?.error) {
        throw ehRequestError(jsonErr.error, jsonErr.detail);
      }
      const htmlText = rawResponse;

      const parsedApi = extractApiData(htmlText);
      if (parsedApi.apiuid && isCurrent()) setApiData(parsedApi);

      const domResult = parseEHCommentsFromDOM(htmlText);
      let finalComments = domResult.comments;

      // If the DOM exposes no comments, try the authenticated API when possible.
      if (finalComments.length === 0 && parsedApi.apiuid && parsedApi.gid && parsedApi.token && ehWorker) {
        try {
          const apiRes = await workerApi(ehWorker, '/api', {
            apiUrl: parsedApi.apiUrl,
            cookie: cookie || '',
            payload: {
              method: 'gdata',
              gidlist: [[parsedApi.gid, parsedApi.token]],
              namespace: 1,
            },
          }, ehToken, controller.signal);
          const apiComments = parseEHCommentsFromAPI(apiRes);
          if (apiComments.length > 0) {
            finalComments = apiComments;
          }
        } catch {}
      }

      if (!isCurrent()) return;
      if (finalComments.length > 0 || !cachedComments) {
        setComments(finalComments);
        setLoaded(true);
        writeEhCommentsCache(cacheKey, finalComments).catch(() => {});
      } else {
        // Parsed zero comments over valid cached ones (challenge page, login
        // variant): keep the cached comments instead of blanking them.
        setLoaded(true);
      }
    } catch (e) {
      if (requestSeqRef.current !== requestSeq) return;
      if (controller.signal.aborted && !timedOut) return;
      if (e instanceof TypeError && e.message === 'Failed to fetch') {
        showError('NETWORK_ERROR');
      } else if (timedOut) {
        showError('NETWORK_ERROR', '请求超时，请检查 Worker 或网络连接。');
      } else {
        showError(e.ehCode || 'UNKNOWN_WORKER_ERROR', e.ehDetail || e.message);
      }
      if (isTerminalGalleryError(e?.ehCode)) {
        if (!cachedComments) {
          await writeEhCommentsCache(cacheKey, [], { unavailable: e.ehCode }).catch(() => {});
        }
        if (cachedComments) {
          // Background SWR refresh hit a terminal page (Worker error): keep the valid
          // cached comments instead of replacing them with an error state.
          setLoaded(true);
          return;
        }
      }
      if (cachedComments) setLoaded(true);
    } finally {
      clearTimeout(timeout);
      if (requestSeqRef.current === requestSeq) {
        requestAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [sourceUrl, cookie, ehWorker, ehToken]);

  const doVote = useCallback(async (commentId, voteValue) => {
    if (!ehWorker || !cookie || !apiData.apikey || !apiData.apiuid || !apiData.gid || !apiData.token) return;
    if (votingRef.current !== null) return;

    const id = commentId;
    votingRef.current = id;
    setVotingId(id);

    try {
      await workerApi(ehWorker, '/api', {
        apiUrl: apiData.apiUrl,
        cookie,
        payload: {
          method: 'votecomment',
          apiuid: apiData.apiuid,
          apikey: apiData.apikey,
          gid: apiData.gid,
          token: apiData.token,
          comment_id: id,
          comment_vote: voteValue,
        },
      }, ehToken);
      const cacheKey = createEhCommentsCacheKey(sourceUrl, cookie);
      await deleteEhCommentsCache(cacheKey);
      await fetchComments(true);
    } catch {} finally {
      votingRef.current = null;
      setVotingId(null);
    }
  }, [ehWorker, cookie, apiData, sourceUrl, fetchComments]);

  const doPostComment = useCallback(async () => {
    if (!postText.trim() || !ehWorker || !cookie || !sourceUrl) return;
    setPosting(true);
    try {
      const normalUrl = normaliseEhUrl(sourceUrl);
      const formBody = 'commenttext_new=' + encodeURIComponent(postText) + '&post_comment=Post+Comment';
      await workerApi(ehWorker, '/comment', { galleryUrl: normalUrl, cookie, formBody }, ehToken);
      setPostText('');
      // Invalidate cache then force refresh
      const cacheKey = createEhCommentsCacheKey(sourceUrl, cookie);
      await deleteEhCommentsCache(cacheKey);
      await fetchComments(true);
    } catch {} finally {
      setPosting(false);
    }
  }, [postText, ehWorker, cookie, sourceUrl, fetchComments]);

  const doEditComment = useCallback(async (commentId) => {
    if (!editText.trim() || !ehWorker || !cookie || !sourceUrl) return;
    try {
      const normalUrl = normaliseEhUrl(sourceUrl);
      const formBody = 'edit_comment=' + commentId + '&commenttext_edit=' + encodeURIComponent(editText) + '&edit_comment_submit=Edit+Comment';
      await workerApi(ehWorker, '/comment', { galleryUrl: normalUrl, cookie, formBody }, ehToken);
      setEditingId(null);
      setEditText('');
      const cacheKey = createEhCommentsCacheKey(sourceUrl, cookie);
      await deleteEhCommentsCache(cacheKey);
      await fetchComments(true);
    } catch {}
  }, [editText, ehWorker, cookie, sourceUrl, fetchComments]);

  const handleReload = useCallback(() => {
    fetchComments(true);
  }, [fetchComments]);

  useEffect(() => {
    if (!sourceUrl || !ehEnabled || !shouldAutoLoad || hasAutoLoadedRef.current) return;
    hasAutoLoadedRef.current = true;
    fetchComments(false);
  }, [sourceUrl, ehEnabled, fetchComments, shouldAutoLoad]);

  if (!ehEnabled) return null;
  if (!sourceUrl) return null;

  const isEHUrl = (() => {
    try {
      const u = new URL(normaliseEhUrl(sourceUrl));
      return u.hostname === 'e-hentai.org' || u.hostname === 'exhentai.org';
    } catch { return false; }
  })();
  if (!isEHUrl) return null;

  const filteredAndSorted = (() => {
    let list = comments.filter(c => c.isUploader || c.score >= (ehMinScore || 0));
    const orderFactor = ehSortOrder === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (a.isUploader !== b.isUploader) return a.isUploader ? -1 : 1;
      if (ehSortMethod === 'time') return (b.timestamp - a.timestamp) * orderFactor;
      return (b.score - a.score) * orderFactor;
    });
    return list.slice(0, ehMaxComments || 45);
  })();

  const jumpUrl = normaliseEhUrl(sourceUrl);

  return (
    <div ref={sectionRef} data-lrr-eh-comments className="eh-comments glass-panel section-reveal section-reveal-delay-3" style={{ padding: '20px', marginTop: '20px' }}>
      <div className="eh-comments-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', paddingBottom: '12px' }}>
        <h3 className="eh-comments-title" style={{ margin: 0, fontSize: 'var(--font-size-xl)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ToolbarGlyph name="comment" size={18} color="var(--accent)" /> E-Hentai 评论区
        </h3>
        {!isTerminalGalleryError(error?.code) && (
        <div className="eh-comments-actions" style={{ display: 'flex', gap: '8px' }}>
          <a
            href={jumpUrl} target="_blank" rel="noopener noreferrer"
            className="btn eh-comment-action"
            aria-label="跳转到 E-Hentai 画廊"
            title="跳转画廊"
            style={{ fontSize: 'var(--font-size-sm)', textDecoration: 'none' }}
          >
            <span className="eh-comment-action-icon"><ToolbarGlyph name="external" size={16} /></span>
            <span className="eh-comment-action-label">跳转画廊</span>
          </a>
          <button className={`btn eh-comment-action${loading ? ' is-loading' : ''}`} onClick={handleReload} disabled={loading} aria-label={loading ? '正在重新加载评论' : '重新加载评论'} title="重新加载" style={{ fontSize: 'var(--font-size-sm)' }}>
            <span className="eh-comment-action-icon"><ToolbarGlyph name="reload" size={16} /></span>
            <span className="eh-comment-action-label">{loading ? '加载中…' : '重新加载'}</span>
          </button>
        </div>
        )}
      </div>

      {!loaded && !loading && !error && (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-sub)', fontSize: 'var(--font-size-body)' }}>
          点击「重新加载」获取 E-Hentai 评论
        </div>
      )}

      {loading && !loaded && (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-sub)', fontSize: 'var(--font-size-body)' }}>
          正在获取评论…
        </div>
      )}

      {error && (
        <div className={`eh-comment-error${error.code === 'GALLERY_NOT_FOUND' || error.code === 'GALLERY_COPYRIGHT_REMOVED' || error.code === 'GALLERY_UNAVAILABLE' ? ' is-gallery-missing' : ''}`} role="alert">
          <div className="eh-comment-error-title">{error.title}</div>
          <div className="eh-comment-error-detail">{error.detail}</div>
        </div>
      )}

      {loaded && comments.length === 0 && !error && (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-sub)', fontSize: 'var(--font-size-body)' }}>
          该画廊暂无评论，或需要登录 E-Hentai 后可见。
          {!cookie && (
            <div style={{ marginTop: '6px', fontSize: 'var(--font-size-xs)', color: 'var(--text-sub)' }}>
              在设定面板填入 E-Hentai Cookie 后刷新即可加载需要登录才能看到的评论。
            </div>
          )}
        </div>
      )}

      {loaded && comments.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', fontSize: 'var(--font-size-sm)' }}>
            <span style={{ color: 'var(--text-sub)' }}>
              排序: {ehSortMethod === 'time' ? '时间' : '分数'} / {ehSortOrder === 'asc' ? '正序' : '倒序'}
              {(ehMinScore || 0) > 0 && <span style={{ marginLeft: '8px' }}>最低: {ehMinScore}分</span>}
            </span>
            <span className="eh-comment-count" style={{ color: 'var(--text-sub)', fontVariantNumeric: 'tabular-nums' }}>{comments.length} 条</span>
          </div>

          <div style={{ marginBottom: '16px' }}>
            {(() => {
              const hasUserCommented = comments.some(c => c.isEditable);
              return filteredAndSorted.map(c => {
                const scoreClass = c.score > 0 ? 'var(--comment-positive)' : c.score < 0 ? 'var(--comment-negative)' : 'var(--comment-meta)';
                const scoreSign = c.score > 0 ? '+' : '';
                const canVote = !c.isUploader && ehWorker && cookie && apiData.apikey && apiData.apiuid && apiData.gid && apiData.token;

                return (
                <div key={c.id} className={`eh-comment-card${c.isUploader ? ' is-uploader' : ''}`} style={{
                  padding: '14px 16px', borderRadius: '10px', marginBottom: '10px',
                  borderLeftColor: c.isUploader ? 'var(--comment-uploader-border)' : 'var(--comment-card-border)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid var(--comment-card-border)', fontSize: 'var(--font-size-sm)', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: '1 1 auto' }}>
                      <span style={{ color: c.isEditable ? 'var(--comment-user-self)' : 'var(--comment-user)', fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-body)' }}>
                        {c.user}{c.isEditable ? ' (你)' : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      {c.isUploader && <span className="eh-comment-uploader-badge" style={{ fontSize: 'var(--font-size-2xs)', padding: '1px 5px', borderRadius: '3px', fontWeight: 'var(--font-weight-bold)' }}>UP</span>}
                      {!c.isUploader && (
                        <span style={{ color: scoreClass, fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-sm)' }}>
                          评分 {scoreSign}{c.score}
                        </span>
                      )}
                      {canVote && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: '46px', height: '20px', flexShrink: 0,
                        }}>
                          {votingId === c.id ? (
                            <span style={{
                              display: 'inline-block', width: '12px', height: '12px',
                              border: '2px solid var(--comment-card-border)', borderTopColor: 'var(--accent)',
                              borderRadius: '50%', animation: 'spin 0.6s linear infinite',
                            }} />
                          ) : (
                            <>
                              <button className="eh-vote-button" onClick={() => doVote(c.id, 1)} style={{
                                background: 'none', border: 'none', color: c.myVote === 1 ? 'var(--comment-positive)' : 'var(--comment-meta)',
                                cursor: 'pointer', width: '20px', height: '20px', padding: 0,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                borderRadius: '3px', flexShrink: 0,
                                lineHeight: 0, verticalAlign: 'middle',
                              }}
                              onMouseEnter={e => { if (c.myVote !== 1) e.currentTarget.style.color = 'var(--comment-positive)'; }}
                              onMouseLeave={e => { if (c.myVote !== 1) e.currentTarget.style.color = 'var(--comment-meta)'; }}
                              title="赞同"
                              aria-label="赞同"
                              ><VoteIcon direction="up" active={c.myVote === 1} /></button>
                              <button className="eh-vote-button" onClick={() => doVote(c.id, -1)} style={{
                                background: 'none', border: 'none', color: c.myVote === -1 ? 'var(--comment-negative)' : 'var(--comment-meta)',
                                cursor: 'pointer', width: '20px', height: '20px', padding: 0,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                borderRadius: '3px', flexShrink: 0,
                                lineHeight: 0, verticalAlign: 'middle',
                              }}
                              onMouseEnter={e => { if (c.myVote !== -1) e.currentTarget.style.color = 'var(--comment-negative)'; }}
                              onMouseLeave={e => { if (c.myVote !== -1) e.currentTarget.style.color = 'var(--comment-meta)'; }}
                              title="反对"
                              aria-label="反对"
                              ><VoteIcon direction="down" active={c.myVote === -1} /></button>
                            </>
                          )}
                        </span>
                      )}
                      {c.isEditable && ehWorker && cookie && (
                        <button onClick={() => { setEditingId(c.id); setEditText(''); }} style={{
                          background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                          fontSize: 'var(--font-size-xs)', textDecoration: 'underline',
                        }}>编辑</button>
                      )}
                    </div>
                  </div>
                  {editingId === c.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <textarea className="eh-comment-input" value={editText} onChange={(e) => setEditText(e.target.value)}
                        placeholder={c.content.replace(/<[^>]*>/g, '').substring(0, 100)}
                        style={{
                          width: '100%', minHeight: '70px', borderRadius: '8px',
                          padding: '10px', fontSize: 'var(--font-size-body)', resize: 'vertical', boxSizing: 'border-box',
                          fontFamily: 'inherit',
                        }}
                      />
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn" onClick={() => setEditingId(null)} style={{ fontSize: 'var(--font-size-xs)', padding: '4px 10px' }}>取消</button>
                        <button className="btn" onClick={() => doEditComment(c.id)} style={{ fontSize: 'var(--font-size-xs)', padding: '4px 10px' }}>保存</button>
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-sub)', textAlign: 'right', lineHeight: 1.4 }}>
                        {formatTimeCN(c.timestamp)}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div dangerouslySetInnerHTML={{ __html: c.content }} style={{ fontSize: 'var(--font-size-md)', lineHeight: '1.7', color: 'var(--comment-text)', wordBreak: 'break-word', overflowWrap: 'break-word', maxWidth: '100%', overflow: 'hidden' }} />
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--comment-meta)', textAlign: 'right', lineHeight: 1.4 }}>
                        {formatTimeCN(c.timestamp)}
                      </div>
                    </div>
                  )}
                </div>
              );})})()}

            {!comments.some(c => c.isEditable) && ehWorker && cookie && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--comment-card-border)' }}>
                <textarea className="eh-comment-input" value={postText} onChange={(e) => setPostText(e.target.value)}
                  placeholder="发表新评论..."
                  style={{
                    width: '100%', minHeight: '80px', borderRadius: '10px',
                    padding: '12px', fontSize: 'var(--font-size-body)', resize: 'vertical', boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                />
                <div style={{ marginTop: '10px', textAlign: 'center' }}>
                  <button className="btn" onClick={doPostComment} disabled={posting || !postText.trim()}
                    style={{ padding: '8px 24px', fontSize: 'var(--font-size-body)' }}>
                    {posting ? '发送中...' : '发表评论'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
