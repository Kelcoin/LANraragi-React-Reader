addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Content-Encoding, x-sync-token, x-lrr-server-scope',
  'Access-Control-Max-Age': '86400',
};

const DEDUPE_KEY_PREFIX = 'dedupe:';
const SYNC_SCHEMA_VERSION = 3;
const PROJECT_NAME = 'Readoshi';
const PROJECT_URL = 'https://github.com/Kelcoin/Readoshi';
const WORKER_VERSION = '1.1.2';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
  });
}

async function readJsonBody(request) {
  const encoding = (request.headers.get('content-encoding') || '').trim().toLowerCase();
  if (!encoding || encoding === 'identity') return request.json();
  if (encoding !== 'gzip') throw new Error('Unsupported Content-Encoding: ' + encoding);
  if (!request.body || typeof DecompressionStream === 'undefined') {
    throw new Error('Gzip request decoding is unavailable');
  }
  const stream = request.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream, { headers: { 'Content-Type': 'application/json' } }).json();
}

function text(data, status = 200, extraHeaders = {}) {
  return new Response(data, {
    status,
    headers: Object.assign({}, CORS, { 'Content-Type': 'text/html; charset=utf-8' }, extraHeaders),
  });
}

// ── Memory-Cached State (loaded once at first request) ──────────
let tokenLoadPromise = null;      // Promise that resolves once KV tokens are loaded
let cachedTokens = new Set();     // Set<string>; empty set means no token can pass
let authEnabled = true;           // Worker auth is mandatory for sync and EH proxy routes
let requestCount = 0;             // in-memory counter, seeded from KV on first load
let statusSummaryCache = null;
let statusSummaryLoadedAt = 0;
let statusSummaryPromise = null;
const STATUS_SUMMARY_TTL_MS = 5 * 60 * 1000;
const mutationLocks = new Map();

async function withMutationLock(key, operation) {
  const previous = mutationLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  mutationLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (mutationLocks.get(key) === current) mutationLocks.delete(key);
  }
}

async function readKvJson(key, fallback) {
  const raw = await HISTORY_KV.get(key);
  return raw ? JSON.parse(raw) : fallback;
}

async function readScopedKvJson(key, legacyKey, fallback) {
  const raw = await HISTORY_KV.get(key);
  if (raw) return JSON.parse(raw);
  if (!legacyKey) return fallback;
  const legacyRaw = await HISTORY_KV.get(legacyKey);
  if (!legacyRaw) return fallback;
  await HISTORY_KV.put(key, legacyRaw);
  await HISTORY_KV.delete(legacyKey);
  return JSON.parse(legacyRaw);
}

// ── IP Rate Limiter ────────────────────────────────────────────
// In-memory only (resets on cold start).  Tracks failed auths per IP.
const ipFailures = new Map();      // IP → { count, firstSeen }
const ipBans = new Map();          // IP → banExpiry (timestamp)
const MAX_FAILURES = 5;            // failures before temporary ban
const FAILURE_WINDOW_MS = 60000;   // 1 minute rolling window
const BAN_DURATION_MS = 300000;    // 5 minute ban

function getClientIP(request) {
  return request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0';
}

function isIPBanned(ip) {
  const banExpiry = ipBans.get(ip);
  if (!banExpiry) return false;
  if (Date.now() > banExpiry) {
    ipBans.delete(ip);
    ipFailures.delete(ip);
    return false;
  }
  return true;
}

function recordAuthFailure(ip) {
  const now = Date.now();
  const entry = ipFailures.get(ip);
  if (!entry || now - entry.firstSeen > FAILURE_WINDOW_MS) {
    ipFailures.set(ip, { count: 1, firstSeen: now });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    ipBans.set(ip, now + BAN_DURATION_MS);
    ipFailures.delete(ip);
  }
}

function recordAuthSuccess(ip) {
  ipFailures.delete(ip);
  ipBans.delete(ip);
}

// ── Token Auth ─────────────────────────────────────────────────
function parseTokens(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map(t => String(t).trim()).filter(Boolean);
    }
  } catch {}

  return trimmed.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
}

// Load tokens from KV exactly once.  All concurrent callers share
// the same Promise so the KV is only read a single time.
// Returns true if tokens were successfully loaded from KV.
async function loadTokens() {
  if (tokenLoadPromise) return tokenLoadPromise;
  tokenLoadPromise = (async () => {
    if (typeof HISTORY_KV === 'undefined') {
      authEnabled = true;
      cachedTokens = new Set();
      return false;
    }
    try {
      const raw = await HISTORY_KV.get('tokens');
      const tokens = parseTokens(raw);
      authEnabled = true;
      cachedTokens = new Set(tokens);
      // Seed in-memory counter from KV
      try {
        const rawCount = await HISTORY_KV.get('stats:requests');
        requestCount = rawCount ? parseInt(rawCount) || 0 : 0;
      } catch {}
      return true;
    } catch (e) {
      // KV read error → fail CLOSED (reject all tokens)
      // This prevents the scenario where KV is temporarily unavailable
      // and unauthorized requests slip through.
      authEnabled = true;
      cachedTokens = new Set(); // empty set → NO token matches
      return false;
    }
  })();
  return tokenLoadPromise;
}

// Force reload tokens from KV (called from status page admin action)
async function reloadTokens() {
  tokenLoadPromise = null;
  return loadTokens();
}

function isValidToken(token) {
  // Empty or missing KV tokens fail closed: no token can match.
  if (!token) return false;
  return cachedTokens.has(token);
}

async function ensureTokensLoaded() {
  await loadTokens();
}

// Increment request counter (in-memory; periodically flushed to KV)
function incrementCounter() {
  requestCount += 1;
}

// ── Auth Guard ─────────────────────────────────────────────────
async function requireAuth(request) {
  await ensureTokensLoaded();

  const ip = getClientIP(request);

  if (isIPBanned(ip)) {
    const expiry = ipBans.get(ip);
    const remainingSec = Math.ceil((expiry - Date.now()) / 1000);
    return json({
      error: 'Too many unauthorized requests. Try again later.',
      retryAfter: remainingSec,
    }, 429);
  }

  const token = request.headers.get('x-sync-token') || '';

  if (!isValidToken(token)) {
    recordAuthFailure(ip);
    return json({ error: 'Unauthorized', detail: 'Invalid or missing token' }, 401);
  }

  recordAuthSuccess(ip);
  return null;
}

// ── Shared EH fetch helper ─────────────────────────────────────
function buildEHHeaders(hostname, cookie) {
  const h = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://' + hostname,
    'Referer': 'https://' + hostname + '/',
  };
  if (cookie) h['Cookie'] = cookie;
  return h;
}

const EH_HOSTS = new Set(['e-hentai.org', 'exhentai.org', 'api.e-hentai.org']);

function parseAllowedEhUrl(value, { galleryOnly = false } = {}) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') return null;
  if (url.port && url.port !== '443') return null;
  if (galleryOnly ? !['e-hentai.org', 'exhentai.org'].includes(hostname) : !EH_HOSTS.has(hostname)) return null;
  if (url.username || url.password) return null;
  return url;
}

async function safeEhFetch(input, init = {}, { galleryOnly = false, maxRedirects = 5 } = {}) {
  let url = parseAllowedEhUrl(input, { galleryOnly });
  if (!url) throw new Error('Invalid EH target');
  let options = { ...init, redirect: 'manual' };
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetch(url.toString(), options);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirects === maxRedirects) throw new Error('Too many EH redirects');
    const location = response.headers.get('location');
    const nextUrl = location ? parseAllowedEhUrl(new URL(location, url).toString(), { galleryOnly }) : null;
    if (!nextUrl) throw new Error('Blocked EH redirect');
    if (nextUrl.origin !== url.origin) throw new Error('Blocked cross-origin EH redirect');
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && options.method === 'POST')) {
      const headers = new Headers(options.headers || {});
      headers.delete('Content-Type');
      options = { ...options, method: 'GET', body: undefined, headers };
    }
    url = nextUrl;
  }
  throw new Error('Too many EH redirects');
}

// ── EH Gallery Proxy (POST /) ──────────────────────────────────
function detectNonGallery(html) {
  const lower = html.toLowerCase();
  if (lower.includes('cf-browser-verification') ||
      lower.includes('_cf_chl_opt') ||
      lower.includes('cf-challenge') ||
      lower.includes('just a moment') ||
      lower.includes('checking your browser')) {
    return 'cloudflare-block';
  }
  if (lower.includes('<title>login</title>') ||
      lower.includes('please login') ||
      lower.includes('you must be logged in') ||
      lower.includes('your ip address has been temporarily banned')) {
    return 'login-or-banned';
  }
  if (lower.includes('gallery not found')) {
    return 'gallery-not-found';
  }
  if (lower.includes('copyright claim')) {
    return 'copyright-removed';
  }
  if (lower.includes('you are seeing this page because') ||
      /<h1\b[^>]*>[\s\S]*content warning[\s\S]*<\/h1>/i.test(html)) {
    return 'content-warning';
  }
  if (html.length < 500 && !html.includes('gallery')) {
    return 'empty-or-redirect';
  }
  return null;
}

function readCookieValue(cookie, name) {
  const match = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, 'i'));
  return match?.[1] || '';
}

function writeCookieValue(cookie, name, value) {
  const parts = String(cookie || '').split(';').map((part) => part.trim()).filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase().startsWith(`${name.toLowerCase()}=`));
  const next = `${name}=${value}`;
  if (index >= 0) parts[index] = next;
  else parts.push(next);
  return parts.join('; ');
}

function readSetCookieValue(response, name) {
  const header = response.headers.get('set-cookie') || '';
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;,\\s]+)`, 'i'));
  return match?.[1] || '';
}

async function probeEhSite(hostname, cookie) {
  try {
    const response = await safeEhFetch(`https://${hostname}/`, {
      headers: buildEHHeaders(hostname, cookie),
      cf: { cacheEverything: false },
    }, { galleryOnly: true });
    const html = await response.text();
    const blocked = detectNonGallery(html) || (/sad panda/i.test(html) ? 'sad-panda' : null);
    const ok = response.ok && !blocked && html.length >= 500;
    return {
      ok,
      status: response.status,
      detail: ok ? '访问正常' : (blocked || `HTTP ${response.status}`),
      response,
    };
  } catch (error) {
    return { ok: false, status: 0, detail: error?.message || '访问失败', response: null };
  }
}

async function ehCheckProxy(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();

  let body;
  try { body = await request.json(); } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const originalCookie = String(body?.cookie || '').trim();
  const memberId = readCookieValue(originalCookie, 'ipb_member_id');
  const passHash = readCookieValue(originalCookie, 'ipb_pass_hash');
  if (!memberId || !passHash) return json({ error: 'Missing EH login cookies' }, 400);

  let cookie = writeCookieValue(originalCookie, 'nw', '1');
  const eHentai = await probeEhSite('e-hentai.org', cookie);
  let exHentai = await probeEhSite('exhentai.org', cookie);
  let refreshed = false;

  if (!exHentai.ok) {
    const igneous = readSetCookieValue(exHentai.response, 'igneous');
    if (igneous && igneous !== 'mystery') {
      cookie = writeCookieValue(cookie, 'igneous', igneous);
      refreshed = igneous !== readCookieValue(originalCookie, 'igneous');
    }
    exHentai = await probeEhSite('exhentai.org', cookie);
    const retryIgneous = readSetCookieValue(exHentai.response, 'igneous');
    if (retryIgneous && retryIgneous !== 'mystery') {
      cookie = writeCookieValue(cookie, 'igneous', retryIgneous);
      refreshed = retryIgneous !== readCookieValue(originalCookie, 'igneous') || refreshed;
    }
  }

  const clean = ({ response, ...result }) => result;
  return json({ eHentai: clean(eHentai), exHentai: clean(exHentai), cookie, refreshed });
}

async function ehProxy(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();

  let body;
  try { body = await request.json(); } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { url, cookie } = body || {};
  if (!url) return json({ error: 'Missing url' }, 400);

  let targetUrl = url;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
  const u = parseAllowedEhUrl(targetUrl, { galleryOnly: true });
  if (!u) {
    return json({ error: 'Invalid host' }, 403);
  }

  try {
    const res = await safeEhFetch(targetUrl, {
      headers: buildEHHeaders(u.hostname, cookie),
      cf: { cacheEverything: false },
    }, { galleryOnly: true });

    const htmlText = await res.text();

    if (!res.ok) {
      const blockType = detectNonGallery(htmlText);
      if (blockType === 'login-or-banned') {
        return json({ error: 'EH_REQUIRES_LOGIN', status: res.status, detail: '画廊需要有效 Cookie 或 IP 被临时封禁' }, res.status);
      }
      if (blockType === 'content-warning') {
        return json({ error: 'CONTENT_WARNING', status: res.status, detail: 'EH 返回了内容警告页面' }, 403);
      }
      if (blockType === 'cloudflare-block') {
        return json({ error: 'EH_CLOUDFLARE_BLOCK', status: res.status, detail: 'EH/EX 返回了 Cloudflare 验证页面' }, res.status);
      }
      if (blockType === 'gallery-not-found') {
        return json({ error: 'GALLERY_NOT_FOUND', status: res.status, detail: 'EH 返回了画廊不存在页面' }, 404);
      }
      if (blockType === 'copyright-removed') {
        return json({ error: 'GALLERY_COPYRIGHT_REMOVED', status: res.status, detail: 'EH 返回了版权移除页面' }, 410);
      }
      return json({
        error: 'EH_UPSTREAM_ERROR',
        status: res.status,
        detail: `EH 返回了 HTTP ${res.status} 响应`,
      }, 502);
    }

    const blockType = detectNonGallery(htmlText);
    if (blockType === 'login-or-banned') {
      return json({ error: 'EH_REQUIRES_LOGIN', status: 200, detail: 'EH 返回了登录页或封禁页，请检查 Cookie' }, 403);
    }
    if (blockType === 'content-warning') {
      return json({ error: 'CONTENT_WARNING', status: 200, detail: 'EH 返回了内容警告页面' }, 403);
    }
    if (blockType === 'cloudflare-block') {
      return json({ error: 'EH_CLOUDFLARE_BLOCK', status: 200, detail: 'Worker 节点被 EH/EX 的 Cloudflare 防护拦截' }, 403);
    }
    if (blockType === 'gallery-not-found') {
      return json({ error: 'GALLERY_NOT_FOUND', status: 200, detail: 'EH 返回了画廊不存在页面' }, 404);
    }
    if (blockType === 'copyright-removed') {
      return json({ error: 'GALLERY_COPYRIGHT_REMOVED', status: 200, detail: 'EH 返回了版权移除页面' }, 410);
    }
    if (blockType === 'empty-or-redirect') {
      return json({ error: 'EH_EMPTY_RESPONSE', status: 200, detail: 'EH 返回了空白或极短页面' }, 403);
    }

    const hasGalleryStructure = (
      /id=["']cdiv["']/i.test(htmlText) ||
      /class=["'][^"']*\bc1\b/i.test(htmlText) ||
      /var\s+gid\s*=\s*\d+/i.test(htmlText) ||
      /var\s+token\s*=\s*["'][^"']+["']/i.test(htmlText)
    );
    if (!hasGalleryStructure) {
      return json({
        error: 'EH_UNEXPECTED_PAGE',
        status: 200,
        detail: 'EH 返回了非预期页面，可能需要登录或 Cookie 已过期',
      }, 403);
    }

    return text(htmlText, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    return json({ error: 'EH_FETCH_FAILED' }, 502);
  }
}

// ── EH API Proxy (POST /api) ───────────────────────────────────
async function ehApiProxy(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();

  let body;
  try { body = await request.json(); } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { apiUrl, cookie, payload } = body || {};
  if (!apiUrl || !payload) return json({ error: 'Missing apiUrl or payload' }, 400);

  const u = parseAllowedEhUrl(apiUrl);
  if (!u) {
    return json({ error: 'Invalid API host' }, 403);
  }

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Origin': 'https://' + u.hostname,
  };
  if (cookie) headers['Cookie'] = cookie;

  try {
    const res = await safeEhFetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return json(data, res.status);
  } catch (err) {
    return json({ error: 'EH_API_REQUEST_FAILED' }, 502);
  }
}

// ── EH Comment Post Proxy (POST /comment) ──────────────────────
async function ehCommentProxy(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();

  let body;
  try { body = await request.json(); } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { galleryUrl, cookie, formBody, referer } = body || {};
  if (!galleryUrl || !formBody) return json({ error: 'Missing galleryUrl or formBody' }, 400);

  const u = parseAllowedEhUrl(galleryUrl, { galleryOnly: true });
  if (!u) {
    return json({ error: 'Invalid host' }, 403);
  }

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Origin': 'https://' + u.hostname,
    'Referer': referer || galleryUrl,
  };
  if (cookie) headers['Cookie'] = cookie;

  try {
    const res = await safeEhFetch(galleryUrl, {
      method: 'POST',
      headers,
      body: formBody,
    }, { galleryOnly: true });
    return text(await res.text(), res.status, { 'Cache-Control': 'no-store' });
  } catch (err) {
    return json({ error: 'EH_COMMENT_FAILED' }, 502);
  }
}


function parseEhGalleryUrl(rawUrl) {
  let targetUrl = (rawUrl || '').replace(/^source:\s*/i, '').trim();
  if (!targetUrl) return null;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
  const u = parseAllowedEhUrl(targetUrl, { galleryOnly: true });
  if (!u) return null;
  const match = u.pathname.match(/^\/g\/(\d+)\/([0-9a-f]+)\/?/i);
  if (!match) return null;
  return {
    hostname: u.hostname,
    baseUrl: `${u.protocol}//${u.hostname}`,
    gid: match[1],
    token: match[2],
    galleryUrl: `${u.protocol}//${u.hostname}/g/${match[1]}/${match[2]}/`,
  };
}

function parseGalpopInputs(htmlText) {
  const payload = {};
  const inputRe = /<(input|textarea)\b[^>]*\bname=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = inputRe.exec(htmlText))) {
    const tag = match[0];
    const name = decodeHtml(match[2]);
    const valueMatch = tag.match(/\bvalue=["']([^"']*)["']/i);
    payload[name] = valueMatch ? decodeHtml(valueMatch[1]) : '';
  }
  return payload;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function findGalpopAction(htmlText, fallbackUrl) {
  const formMatch = htmlText.match(/<form\b[^>]*(?:id=["']galpop["'][^>]*)?>/i) || htmlText.match(/<form\b[^>]*>/i);
  if (!formMatch) return fallbackUrl;
  const actionMatch = formMatch[0].match(/\baction=["']([^"']+)["']/i);
  if (!actionMatch) return fallbackUrl;
  try {
    return new URL(decodeHtml(actionMatch[1]), fallbackUrl).toString();
  } catch {
    return fallbackUrl;
  }
}

// ── EH Favorite Proxy (POST /favorite) ─────────────────────────
async function ehFavoriteProxy(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();

  let body;
  try { body = await request.json(); } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { url, cookie, mode = 'remove' } = body || {};
  if (mode !== 'remove') return json({ error: 'Unsupported favorite mode' }, 400);
  if (!url) return json({ error: 'Missing url' }, 400);
  if (!cookie) return json({ error: 'Missing cookie' }, 400);

  let parsed;
  try { parsed = parseEhGalleryUrl(url); } catch {}
  if (!parsed) return json({ error: 'Invalid EH gallery url' }, 400);

  const popupUrl = `${parsed.baseUrl}/gallerypopups.php?gid=${parsed.gid}&t=${parsed.token}&act=addfav`;
  const headers = buildEHHeaders(parsed.hostname, cookie);
  headers.Referer = parsed.galleryUrl;

  try {
    const popupRes = await safeEhFetch(popupUrl, {
      headers,
      cf: { cacheEverything: false },
    }, { galleryOnly: true });
    const popupHtml = await popupRes.text();
    if (!popupRes.ok) return json({ error: 'EH_POPUP_FAILED', detail: `获取收藏表单失败 (HTTP ${popupRes.status})` }, popupRes.status);

    const blockType = detectNonGallery(popupHtml);
    if (blockType === 'login-or-banned') return json({ error: 'EH_REQUIRES_LOGIN', detail: 'EH 返回了登录页或封禁页，请检查 Cookie' }, 403);
    if (blockType === 'cloudflare-block') return json({ error: 'EH_CLOUDFLARE_BLOCK', detail: 'Worker 被 EH/EX 的 Cloudflare 防护拦截' }, 403);
    if (!/<form\b[^>]*id=["']galpop["']/i.test(popupHtml) && !/name=["']favcat["']/i.test(popupHtml)) {
      return json({ error: 'EH_FAVORITE_FORM_MISSING', detail: '无法获取 E 站收藏夹表单，可能 Cookie 过期或画廊不可访问' }, 502);
    }

    const payload = parseGalpopInputs(popupHtml);
    payload.favcat = 'favdel';
    payload.favnote = '';
    payload.apply = 'Apply Changes';
    payload.update = '1';

    const formBody = new URLSearchParams(payload).toString();
    const actionUrl = findGalpopAction(popupHtml, popupUrl);
    if (!parseAllowedEhUrl(actionUrl, { galleryOnly: true })) {
      return json({ error: 'EH_FAVORITE_ACTION_BLOCKED' }, 502);
    }
    const postHeaders = buildEHHeaders(parsed.hostname, cookie);
    postHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    postHeaders.Referer = popupUrl;

    const postRes = await safeEhFetch(actionUrl, {
      method: 'POST',
      headers: postHeaders,
      body: formBody,
      cf: { cacheEverything: false },
    }, { galleryOnly: true });
    const postText = await postRes.text();
    if (!postRes.ok) return json({ error: 'EH_FAVORITE_REMOVE_FAILED', detail: `提交收藏夹移除失败 (HTTP ${postRes.status})` }, postRes.status);

    const postBlockType = detectNonGallery(postText);
    if (postBlockType === 'login-or-banned') return json({ error: 'EH_REQUIRES_LOGIN', detail: 'EH 返回了登录页或封禁页，请检查 Cookie' }, 403);
    if (postBlockType === 'cloudflare-block') return json({ error: 'EH_CLOUDFLARE_BLOCK', detail: 'Worker 被 EH/EX 的 Cloudflare 防护拦截' }, 403);

    return json({ ok: true, gid: parsed.gid, action: 'removed' });
  } catch (err) {
    return json({ error: 'EH_FAVORITE_REQUEST_FAILED' }, 502);
  }
}

// ── History Sync (GET/PUT /history) ────────────────────────────
function getToken(request) {
  return request.headers.get('x-sync-token') || '';
}

function normalizePairKey(value) {
  const parts = String(value || '').split('|').map(part => part.trim()).filter(Boolean);
  if (parts.length !== 2 || parts[0] === parts[1]) return '';
  return parts.sort().join('|');
}

function normalizePairKeys(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(normalizePairKey)
    .filter(Boolean)))
    .sort();
}

function getDedupeKey(request) {
  const scope = getServerScope(request);
  if (!scope) return '';
  return `${DEDUPE_KEY_PREFIX}${getToken(request)}:${scope}:non-duplicates`;
}

function getServerScope(request) {
  const scope = (request.headers.get('x-lrr-server-scope') || '').trim().toLowerCase();
  return /^[a-f0-9]{32}$/.test(scope) ? scope : '';
}

function getSyncKey(kind, request) {
  const scope = getServerScope(request);
  return scope ? `${kind}:${getToken(request)}:${scope}` : '';
}

const DEFAULT_HISTORY_RETENTION_DAYS = 90;
let cachedHistoryRetentionDays = null;
let historyRetentionLoadedAt = 0;
const HISTORY_RETENTION_CACHE_MS = 60 * 1000;

async function getHistoryRetentionDays() {
  const now = Date.now();
  if (cachedHistoryRetentionDays != null && now - historyRetentionLoadedAt < HISTORY_RETENTION_CACHE_MS) return cachedHistoryRetentionDays;
  try {
    const raw = await HISTORY_KV.get('history_retention_days');
    const days = Number(raw);
    cachedHistoryRetentionDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_HISTORY_RETENTION_DAYS;
  } catch {
    cachedHistoryRetentionDays = DEFAULT_HISTORY_RETENTION_DAYS;
  }
  historyRetentionLoadedAt = now;
  return cachedHistoryRetentionDays;
}

function historyTimestamp(item) {
  const value = Number(item?.time || item?.updatedAt || item?.date || 0);
  return value > 0 && value < 1e12 ? value * 1000 : value;
}

function normalizeHistoryItems(values) {
  const merged = new Map();
  for (const item of Array.isArray(values) ? values : []) {
    const id = String(item?.id || item?.arcid || '').trim();
    if (!id) continue;
    const normalized = {
      id,
      page: Math.max(0, Number(item.page) || 0),
      time: historyTimestamp(item),
    };
    const old = merged.get(id);
    if (!old || normalized.time >= old.time) merged.set(id, normalized);
  }
  return Array.from(merged.values());
}

function normalizeDeletedItems(values, retentionDays = DEFAULT_HISTORY_RETENTION_DAYS, now = Date.now()) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const merged = new Map();
  for (const item of Array.isArray(values) ? values : []) {
    const id = String(item?.id || item?.arcid || '').trim();
    if (!id) continue;
    const deletedAt = Number(item.deletedAt) || 0;
    if (deletedAt >= cutoff && deletedAt >= (merged.get(id) || 0)) merged.set(id, deletedAt);
  }
  return Array.from(merged.entries())
    .map(([id, deletedAt]) => ({ id, deletedAt }))
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

function pruneHistoriesByRetention(histories, retentionDays, now = Date.now()) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return normalizeHistoryItems(histories)
    .filter((item) => item?.id && historyTimestamp(item) >= cutoff)
    .sort((a, b) => historyTimestamp(b) - historyTimestamp(a));
}

function compactHistoryState(state, retentionDays) {
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    histories: pruneHistoriesByRetention(state?.histories, retentionDays),
    hideRead: !!state?.hideRead,
    deleted: normalizeDeletedItems(state?.deleted, retentionDays),
    lastSync: Number(state?.lastSync) || 0,
  };
}

async function getHistory(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();

  const historyKey = getSyncKey('history', request);
  if (!historyKey) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);
  try {
    const state = await readScopedKvJson(historyKey, 'history:' + getToken(request), null);
    if (!state) return json({ schemaVersion: SYNC_SCHEMA_VERSION, histories: [], hideRead: false, deleted: [], lastSync: 0 });
    const retentionDays = await getHistoryRetentionDays();
    const compacted = compactHistoryState(state, retentionDays);
    return json({ ...compacted, retentionDays });
  } catch (err) {
    return json({ error: 'KV read failed: ' + err.message }, 500);
  }
}

async function putHistory(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();

  let payload;
  try { payload = await readJsonBody(request); } catch (err) {
    return json({ error: 'Invalid JSON', detail: err.message }, 400);
  }

  const { histories, history, hideRead, deleted } = payload || {};
  if (histories !== undefined && !Array.isArray(histories)) return json({ error: 'Invalid histories array' }, 400);
  if (history !== undefined && (!history || typeof history !== 'object')) return json({ error: 'Invalid history item' }, 400);
  if (deleted !== undefined && !Array.isArray(deleted)) return json({ error: 'Invalid deleted array' }, 400);
  const incomingHistories = Array.isArray(histories) ? histories : (history ? [history] : []);

  const historyKey = getSyncKey('history', request);
  if (!historyKey) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);
  try {
    return await withMutationLock(historyKey, async () => {
      const existing = await readScopedKvJson(historyKey, 'history:' + getToken(request), { histories: [], hideRead: false, deleted: [] });

  const deletedMap = new Map();
  for (const item of Array.isArray(existing.deleted) ? existing.deleted : []) {
    if (!item || !item.id) continue;
    deletedMap.set(item.id, item.deletedAt || 0);
  }
  for (const item of Array.isArray(deleted) ? deleted : []) {
    if (!item || !item.id) continue;
    const oldDeletedAt = deletedMap.get(item.id) || 0;
    if ((item.deletedAt || 0) >= oldDeletedAt) {
      deletedMap.set(item.id, item.deletedAt || Date.now());
    }
  }

  const merged = new Map();
  for (const h of existing.histories) {
    if (!h?.id) continue;
    const deletedAt = deletedMap.get(h.id) || 0;
    if ((h.time || 0) > deletedAt) merged.set(h.id, h);
  }
  for (const h of incomingHistories) {
    if (!h?.id) continue;
    const deletedAt = deletedMap.get(h.id) || 0;
    if ((h.time || 0) <= deletedAt) continue;
    const old = merged.get(h.id);
    if (!old || (h.time && h.time > (old.time || 0)) || (h.time === old.time && h.page !== old.page)) {
      merged.set(h.id, h);
    }
  }

  // Keep tombstones even when a newer write revives the entry: deleteHistory
  // relies on the recorded deletedAt to recognize a stale retried DELETE and
  // must not wipe the revived progress. Older writes stay tombstoned above.

      const retentionDays = await getHistoryRetentionDays();
      const result = {
        schemaVersion: SYNC_SCHEMA_VERSION,
        histories: pruneHistoriesByRetention(Array.from(merged.values()), retentionDays),
        hideRead: hideRead !== undefined ? hideRead : existing.hideRead !== undefined ? existing.hideRead : false,
        deleted: normalizeDeletedItems(Array.from(deletedMap.entries()).map(([id, deletedAt]) => ({ id, deletedAt })), retentionDays),
        lastSync: Date.now(),
      };

      await HISTORY_KV.put(historyKey, JSON.stringify(result));
      return json({ ok: true, count: result.histories.length });
    });
  } catch (err) {
    return json({ error: 'KV mutation failed' }, 500);
  }
}


async function deleteHistory(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();

  let payload;
  try { payload = await readJsonBody(request); } catch (err) {
    return json({ error: 'Invalid JSON', detail: err.message }, 400);
  }

  const ids = Array.isArray(payload?.ids) ? payload.ids.map(id => String(id).trim()).filter(Boolean) : [];
  if (ids.length === 0) return json({ error: 'Missing ids array' }, 400);
  const historyKey = getSyncKey('history', request);
  if (!historyKey) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);
  try {
    return await withMutationLock(historyKey, async () => {
      const existing = await readScopedKvJson(historyKey, 'history:' + getToken(request), { histories: [], hideRead: false, deleted: [] });
      const now = Date.now();
      const deletedMap = new Map();
      for (const item of Array.isArray(existing.deleted) ? existing.deleted : []) {
        if (!item || !item.id) continue;
        deletedMap.set(item.id, item.deletedAt || 0);
      }
      // Retried DELETE must not wipe an entry that was re-written after the
      // original delete: if a newer history entry exists (time > recorded
      // deletedAt), the delete intent is stale — skip it.
      const staleDeleteIds = new Set();
      ids.forEach((id) => {
        const prevDeletedAt = deletedMap.get(id) || 0;
        const existingItem = Array.isArray(existing.histories)
          ? existing.histories.find((item) => item?.id === id)
          : null;
        if (prevDeletedAt > 0 && existingItem && (existingItem.time || 0) > prevDeletedAt) {
          staleDeleteIds.add(id);
          return;
        }
        deletedMap.set(id, now);
      });
      const removeSet = new Set(ids.filter((id) => !staleDeleteIds.has(id)));

      const retentionDays = await getHistoryRetentionDays();
      const result = {
        schemaVersion: SYNC_SCHEMA_VERSION,
        histories: pruneHistoriesByRetention(
          (Array.isArray(existing.histories) ? existing.histories : []).filter((item) => item?.id && !removeSet.has(item.id)),
          retentionDays,
          now,
        ),
        hideRead: existing.hideRead !== undefined ? existing.hideRead : false,
        deleted: normalizeDeletedItems(Array.from(deletedMap.entries()).map(([id, deletedAt]) => ({ id, deletedAt })), retentionDays, now),
        lastSync: now,
      };
      await HISTORY_KV.put(historyKey, JSON.stringify(result));
      return json({ ok: true, removed: removeSet.size, count: result.histories.length });
    });
  } catch (err) {
    return json({ error: 'KV mutation failed' }, 500);
  }
}

function normalizeWatchlistItems(values) {
  const merged = new Map();
  for (const item of Array.isArray(values) ? values : []) {
    const id = item?.id || item?.arcid;
    if (!id) continue;
    const normalized = { id: String(id), addedAt: Number(item.addedAt) || 0 };
    const old = merged.get(normalized.id);
    if (!old || (normalized.addedAt || 0) >= (old.addedAt || 0)) merged.set(normalized.id, normalized);
  }
  return Array.from(merged.values())
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
    .slice(0, 500);
}

async function readWatchlistState(key, request) {
  return readScopedKvJson(key, 'watchlist:' + getToken(request), { items: [], deleted: [], lastSync: 0 });
}

function compactWatchlistState(state, now = Date.now()) {
  const deleted = normalizeDeletedItems(state?.deleted, DEFAULT_HISTORY_RETENTION_DAYS, now);
  const deletedMap = new Map(deleted.map((item) => [item.id, item.deletedAt]));
  const items = normalizeWatchlistItems(state?.items)
    .filter((item) => (item.addedAt || 0) > (deletedMap.get(item.id) || 0));
  return { schemaVersion: SYNC_SCHEMA_VERSION, items, deleted, lastSync: Number(state?.lastSync) || 0 };
}

async function getWatchlist(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();

  const watchlistKey = getSyncKey('watchlist', request);
  if (!watchlistKey) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);
  try {
    const state = await readWatchlistState(watchlistKey, request);
    const compacted = compactWatchlistState(state);
    return json(compacted);
  } catch (err) {
    return json({ error: 'KV read failed: ' + err.message }, 500);
  }
}

async function putWatchlist(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();

  let payload;
  try { payload = await readJsonBody(request); } catch (err) {
    return json({ error: 'Invalid JSON', detail: err.message }, 400);
  }

  const incoming = Array.isArray(payload?.items) ? payload.items : (payload?.item ? [payload.item] : []);
  if (incoming.length === 0) return json({ error: 'Missing item or items' }, 400);

  const watchlistKey = getSyncKey('watchlist', request);
  if (!watchlistKey) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);
  try {
    return await withMutationLock(watchlistKey, async () => {
      const existing = compactWatchlistState(await readWatchlistState(watchlistKey, request));
      const deletedMap = new Map(existing.deleted.map((item) => [item.id, item.deletedAt]));
      const accepted = normalizeWatchlistItems(incoming)
        .filter((item) => (item.addedAt || 0) > (deletedMap.get(item.id) || 0));
      for (const item of accepted) deletedMap.delete(item.id);
      const result = compactWatchlistState({
        items: [...existing.items, ...accepted],
        deleted: Array.from(deletedMap, ([id, deletedAt]) => ({ id, deletedAt })),
        lastSync: Date.now(),
      });
      await HISTORY_KV.put(watchlistKey, JSON.stringify(result));
      return json({ ok: true, count: result.items.length });
    });
  } catch (err) {
    return json({ error: 'KV mutation failed' }, 500);
  }
}

async function deleteWatchlist(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();

  let payload;
  try { payload = await readJsonBody(request); } catch (err) {
    return json({ error: 'Invalid JSON', detail: err.message }, 400);
  }

  const ids = Array.isArray(payload?.ids) ? payload.ids.map(id => String(id).trim()).filter(Boolean) : [];
  if (ids.length === 0) return json({ error: 'Missing ids array' }, 400);
  const removeSet = new Set(ids);

  const watchlistKey = getSyncKey('watchlist', request);
  if (!watchlistKey) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);
  try {
    return await withMutationLock(watchlistKey, async () => {
      const existing = compactWatchlistState(await readWatchlistState(watchlistKey, request));
      const now = Date.now();
      const deletedMap = new Map(existing.deleted.map((item) => [item.id, item.deletedAt]));
      ids.forEach((id) => deletedMap.set(id, now));
      const result = compactWatchlistState({
        items: existing.items.filter((item) => !removeSet.has(item.id)),
        deleted: Array.from(deletedMap, ([id, deletedAt]) => ({ id, deletedAt })),
        lastSync: now,
      }, now);
      await HISTORY_KV.put(watchlistKey, JSON.stringify(result));
      return json({ ok: true, removed: ids.length, count: result.items.length });
    });
  } catch (err) {
    return json({ error: 'KV mutation failed' }, 500);
  }
}

async function getNonDuplicatePairs(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();
  if (typeof HISTORY_KV === 'undefined') return json({ error: 'KV is not bound' }, 500);

  const dedupeKey = getDedupeKey(request);
  if (!dedupeKey) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);
  try {
    let raw = await HISTORY_KV.get(dedupeKey);
    if (!raw) {
      raw = await HISTORY_KV.get('dedupe:non-duplicates');
      if (raw) {
        await HISTORY_KV.put(dedupeKey, raw);
        await HISTORY_KV.delete('dedupe:non-duplicates');
      }
    }
    return json({ pairs: normalizePairKeys(raw ? JSON.parse(raw) : []) });
  } catch (err) {
    return json({ error: 'KV read failed: ' + err.message }, 500);
  }
}

async function putNonDuplicatePairs(request) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();
  if (typeof HISTORY_KV === 'undefined') return json({ error: 'KV is not bound' }, 500);

  let payload;
  try { payload = await request.json(); } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const incoming = normalizePairKeys(payload?.pairs);
  if (incoming.length === 0) return json({ error: 'Missing pairs array' }, 400);
  const dedupeKey = getDedupeKey(request);
  if (!dedupeKey) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);

  try {
    return await withMutationLock(dedupeKey, async () => {
      let raw = await HISTORY_KV.get(dedupeKey);
      if (!raw) {
        raw = await HISTORY_KV.get('dedupe:non-duplicates');
        if (raw) await HISTORY_KV.delete('dedupe:non-duplicates');
      }
      const existing = normalizePairKeys(raw ? JSON.parse(raw) : []);
      const next = normalizePairKeys([...existing, ...incoming]);
      await HISTORY_KV.put(dedupeKey, JSON.stringify(next));
      return json({ ok: true, count: next.length, added: incoming.length });
    });
  } catch (err) {
    return json({ error: 'KV write failed: ' + err.message }, 500);
  }
}

async function listKVKeys(prefix) {
  const names = [];
  let cursor;
  do {
    const page = await HISTORY_KV.list({ prefix, cursor });
    for (const key of page.keys || []) names.push(key.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names;
}

function firstObjectValue(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  const values = Object.values(obj);
  return values.length ? values[0] : undefined;
}

async function exportKV(request) {
  let payload;
  try { payload = await request.json(); } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();
  if (typeof HISTORY_KV === 'undefined') return json({ error: 'KV is not bound' }, 500);

  const selected = payload?.sections || {};
  const includeHistory = selected.history !== false;
  const includeWatchlist = selected.watchlist !== false;
  const includeDedupe = selected.dedupe !== false;
  const historyKey = getSyncKey('history', request);
  const watchlistKey = getSyncKey('watchlist', request);
  if ((includeHistory || includeWatchlist) && (!historyKey || !watchlistKey)) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);
  const dedupeKey = getDedupeKey(request);
  if (includeDedupe && !dedupeKey) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);
  const data = {
    version: 3,
    scope: 'token-and-server-md5',
    serverScope: getServerScope(request),
    exportedAt: new Date().toISOString(),
    sections: {},
  };

  try {
    if (includeHistory) {
      const raw = await HISTORY_KV.get(historyKey);
      data.sections.history = { [historyKey]: raw || '' };
    }
    if (includeWatchlist) {
      const raw = await HISTORY_KV.get(watchlistKey);
      data.sections.watchlist = { [watchlistKey]: raw || '' };
    }
    if (includeDedupe) {
      const raw = await HISTORY_KV.get(dedupeKey);
      data.sections.dedupe = { [dedupeKey]: raw || '[]' };
    }
    return json({ ok: true, data });
  } catch (err) {
    return json({ error: 'KV export failed: ' + err.message }, 500);
  }
}

async function importKV(request) {
  let payload;
  try { payload = await request.json(); } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const authErr = await requireAuth(request);
  if (authErr) return authErr;
  incrementCounter();
  if (typeof HISTORY_KV === 'undefined') return json({ error: 'KV is not bound' }, 500);

  const selected = payload?.sections || {};
  const input = payload?.data?.sections ? payload.data.sections : payload?.data;
  if (!input || typeof input !== 'object') return json({ error: 'Invalid import data' }, 400);
  const dedupeKey = getDedupeKey(request);
  if (selected.dedupe !== false && input.dedupe && !dedupeKey) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);

  let imported = 0;
  try {
    if (selected.history !== false && input.history && typeof input.history === 'object') {
      const historyKey = getSyncKey('history', request);
      if (!historyKey) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);
      const value = input.history[historyKey] ?? firstObjectValue(input.history);
      if (value !== undefined && value !== null && value !== '') {
        await HISTORY_KV.put(historyKey, typeof value === 'string' ? value : JSON.stringify(value));
        imported += 1;
      }
    }
    if (selected.watchlist !== false && input.watchlist && typeof input.watchlist === 'object') {
      const watchlistKey = getSyncKey('watchlist', request);
      if (!watchlistKey) return json({ error: 'Missing or invalid x-lrr-server-scope' }, 400);
      const value = input.watchlist[watchlistKey] ?? firstObjectValue(input.watchlist);
      if (value !== undefined && value !== null && value !== '') {
        await HISTORY_KV.put(watchlistKey, typeof value === 'string' ? value : JSON.stringify(value));
        imported += 1;
      }
    }
    if (selected.dedupe !== false && input.dedupe && typeof input.dedupe === 'object') {
      const raw = input.dedupe[dedupeKey] || input.dedupe.pairs || firstObjectValue(input.dedupe) || [];
      const incoming = normalizePairKeys(typeof raw === 'string' ? JSON.parse(raw || '[]') : raw);
      await withMutationLock(dedupeKey, async () => {
        const existingRaw = await HISTORY_KV.get(dedupeKey);
        const existing = normalizePairKeys(existingRaw ? JSON.parse(existingRaw) : []);
        const next = normalizePairKeys([...existing, ...incoming]);
        await HISTORY_KV.put(dedupeKey, JSON.stringify(next));
      });
      imported += incoming.length;
    }
    return json({ ok: true, imported });
  } catch (err) {
    return json({ error: 'KV import failed: ' + err.message }, 500);
  }
}

async function getStatusSummary({ force = false } = {}) {
  if (!force && statusSummaryCache && Date.now() - statusSummaryLoadedAt < STATUS_SUMMARY_TTL_MS) return statusSummaryCache;
  if (statusSummaryPromise) return statusSummaryPromise;
  statusSummaryPromise = (async () => {
    if (typeof HISTORY_KV === 'undefined') {
      return { totalArchives: 'N/A', userCount: 'N/A', watchlistCount: 'N/A', dedupeCount: 'N/A' };
    }
    try {
      const [historyKeys, watchlistKeys, dedupeKeys] = await Promise.all([
        listKVKeys('history:'),
        listKVKeys('watchlist:'),
        listKVKeys(DEDUPE_KEY_PREFIX),
      ]);
      const allIds = new Set();
      const historyValues = await Promise.all(historyKeys.map((key) => HISTORY_KV.get(key).catch(() => null)));
      historyValues.forEach((raw) => {
        try {
          const data = raw ? JSON.parse(raw) : null;
          for (const item of Array.isArray(data?.histories) ? data.histories : []) if (item?.id) allIds.add(item.id);
        } catch {}
      });
      const watchlistValues = await Promise.all(watchlistKeys.map((key) => HISTORY_KV.get(key).catch(() => null)));
      let watchlistCount = 0;
      watchlistValues.forEach((raw) => {
        try {
          const data = raw ? JSON.parse(raw) : null;
          watchlistCount += Array.isArray(data?.items) ? data.items.length : 0;
        } catch {}
      });
      const dedupeValues = await Promise.all(dedupeKeys.map((key) => HISTORY_KV.get(key).catch(() => null)));
      const dedupeCount = dedupeValues.reduce((sum, raw) => {
        try { return sum + normalizePairKeys(raw ? JSON.parse(raw) : []).length; } catch { return sum; }
      }, 0);
      return {
        totalArchives: allIds.size,
        userCount: historyKeys.length,
        watchlistCount,
        dedupeCount,
      };
    } catch {
      return { totalArchives: '错误', userCount: '错误', watchlistCount: '错误', dedupeCount: '错误' };
    }
  })();
  try {
    statusSummaryCache = await statusSummaryPromise;
    statusSummaryLoadedAt = Date.now();
    return statusSummaryCache;
  } finally {
    statusSummaryPromise = null;
  }
}

// ── Status Page (GET /) ───────────────────────────────────────
async function statusPage(request) {
  const reloadParam = new URL(request.url).searchParams.get('reload');
  if (reloadParam === '1') {
    // Forcing a full KV rescan must be authenticated; the public status page
    // must not be able to trigger unbounded KV reads from the outside.
    const authErr = await requireAuth(request);
    if (authErr) return authErr;
    await reloadTokens();
    statusSummaryCache = null;
    const nextUrl = new URL(request.url);
    nextUrl.searchParams.delete('reload');
    return Response.redirect(nextUrl.toString(), 302);
  }

  await ensureTokensLoaded();
  const kvOk = tokenLoadPromise ? (await tokenLoadPromise) : false;
  const reqCount = requestCount;
  const { totalArchives, userCount, watchlistCount, dedupeCount } = await getStatusSummary();
  const hasKV = typeof HISTORY_KV !== 'undefined';
  const tokenCount = cachedTokens ? cachedTokens.size : 0;

  const tokenStatusHtml = authEnabled
    ? (tokenCount > 0
      ? `<div class="stat"><span class="label">Token 认证</span><span class="ok">已启用 (${tokenCount} 个)</span></div>`
      : `<div class="stat"><span class="label">⚠ Token 认证</span><span class="err">已启用但 KV tokens 为空，所有受保护接口都会拒绝</span></div>`)
    : `<div class="stat"><span class="label">Token 认证</span><span class="err">强制启用</span></div>`;
  const workerVersion = `v${WORKER_VERSION}`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Readoshi Sync Worker</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0f1115; color:#d1d5db; font-family:system-ui,-apple-system,sans-serif;
         display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }
  .card { background:#1a1d24; border:1px solid rgba(255,255,255,0.07); border-radius:16px;
          padding:36px 32px; max-width:460px; width:100%; }
  .brand { display:flex; align-items:center; justify-content:center; gap:14px; margin-bottom:28px; text-align:center; }
  .brand-logo { width:52px; height:52px; object-fit:contain; flex:0 0 auto; }
  h1 { font-size:22px; color:#fff; margin:0; }
  .stat { display:flex; justify-content:space-between; align-items:center; padding:12px 0;
          border-bottom:1px solid rgba(255,255,255,0.04); font-size:14px; }
  .stat:last-of-type { border:none; }
  .label { color:#9ca3af; }
  .value { font-weight:600; color:#e5e7eb; }
  .ok { color:#6ee7b7; font-size:13px; }
  .err { color:#f87171; font-size:13px; }
  .warn { color:#fbbf24; font-size:13px; }
  .divider { border-top:1px solid rgba(255,255,255,0.06); margin:24px 0 20px; }
  .section-title { color:#9ca3af; font-size:12px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; }
  .footer { display:flex; align-items:center; justify-content:center; gap:9px; flex-wrap:wrap;
            font-size:11px; color:#6b7280; text-align:center; margin-top:22px; }
  .footer a { color:#60a5fa; text-decoration:none; }
  .footer a:hover { color:#93c5fd; text-decoration:underline; }
  .card { max-width:560px; }
  .tool { display:grid; gap:10px; margin-top:10px; }
  .collapsible { display:grid; grid-template-rows:0fr; opacity:0; transform:translateY(-6px);
                 visibility:hidden; pointer-events:none;
                 transition:grid-template-rows .28s ease, opacity .2s ease, transform .28s ease, visibility 0s linear .28s; }
  .collapsible.is-open { grid-template-rows:1fr; opacity:1; transform:none; visibility:visible;
                         pointer-events:auto; transition-delay:0s; }
  .collapsible-inner { overflow:hidden; }
  .hint { color:#9ca3af; font-size:12px; line-height:1.5; }
  .tool-actions { display:flex; justify-content:center; gap:10px; align-items:center; flex-wrap:wrap; }
  .checks { display:flex; gap:14px; flex-wrap:wrap; color:#cbd5e1; font-size:13px; }
  input, textarea { width:100%; background:#111827; border:1px solid rgba(255,255,255,.09); color:#e5e7eb;
                    border-radius:8px; padding:9px 10px; font:inherit;
                    outline:none;
                    transition:border-color .15s ease, background-color .15s ease, box-shadow .15s ease; }
  input:hover, textarea:hover { border-color:rgba(255,255,255,.24); background:#141b26; }
  input:focus, textarea:focus { border-color:#3b82f6; background:#141b26; box-shadow:0 0 0 3px rgba(59,130,246,.16); }
  input::placeholder, textarea::placeholder { color:#6b7280; }
  input:disabled, textarea:disabled { opacity:.55; cursor:not-allowed; }
  textarea { min-height:110px; resize:vertical; }
  button { background:#2563eb; border:0; border-radius:8px; color:white; padding:9px 12px; cursor:pointer; font-weight:650; }
  button.secondary { background:#374151; }
  button.subtle { background:#1f2937; color:#cbd5e1; }
  #kvResult { color:#9ca3af; font-size:12px; white-space:pre-wrap; line-height:1.5; }
  @media (prefers-reduced-motion: reduce) {
    .collapsible { transition:none; transform:none; }
  }
</style>
</head>
<body>
<div class="card">
  <div class="brand">
    <img class="brand-logo" src="https://raw.githubusercontent.com/Kelcoin/Readoshi/main/public/logo-white.png" alt="" aria-hidden="true">
    <h1>Readoshi Sync Worker</h1>
  </div>

  <div class="section-title">服务概览</div>
  <div class="stat"><span class="label">服务状态</span><span class="ok">● 运行中</span></div>
  <div class="stat"><span class="label">请求计数</span><span class="value">${reqCount}</span></div>
  <div class="stat"><span class="label">同步用户数</span><span class="value">${userCount}</span></div>
  <div class="stat"><span class="label">阅读记录数</span><span class="value">${totalArchives}</span></div>
  <div class="stat"><span class="label">待看记录数</span><span class="value">${watchlistCount}</span></div>
  <div class="stat"><span class="label">KV 存储</span><span class="${hasKV ? 'ok' : 'warn'}">${hasKV ? '已绑定' : '未绑定'}</span></div>
  <div class="stat"><span class="label">KV 读取</span><span class="${kvOk ? 'ok' : 'err'}">${kvOk ? '正常' : '失败'}</span></div>
  <div class="stat"><span class="label">非重复档案记录</span><span class="value">${dedupeCount}</span></div>

  <div class="divider"></div>
  <div class="section-title">认证状态</div>
  ${tokenStatusHtml}
  <div class="stat"><span class="label">部署时间</span><span class="value">${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC</span></div>

  <div class="divider"></div>
  <div class="section-title">KV 导入 / 导出</div>
  <div id="kvClosed" class="collapsible is-open" aria-hidden="false">
    <div class="collapsible-inner"><div class="tool">
      <div class="tool-actions"><button id="openKvTool" type="button">打开导入 / 导出菜单</button></div>
    </div></div>
  </div>
  <div id="kvAuth" class="collapsible" aria-hidden="true">
    <div class="collapsible-inner"><div class="tool">
      <div class="hint">请输入合法 Token，仅能导入 / 导出该 Token 对应的阅读历史与非重复记录。</div>
      <input id="syncTokenInput" type="password" placeholder="访问 Token">
      <div class="tool-actions">
        <button id="validateTokenBtn" type="button">验证 Token</button>
        <button id="cancelKvBtn" class="subtle" type="button">取消</button>
      </div>
    </div></div>
  </div>
  <div id="kvPanel" class="collapsible" aria-hidden="true">
    <div class="collapsible-inner"><div class="tool">
      <div class="hint">已通过 Token 验证。请输入 LANraragi 服务器地址的 32 位 MD5 作用域；数据按 Token 与服务器共同隔离。</div>
      <input id="serverScopeInput" type="text" inputmode="text" maxlength="32" placeholder="服务器地址 MD5（32 位小写十六进制）">
      <div class="checks">
        <label><input id="sectionHistory" type="checkbox" checked style="width:auto"> 阅读历史</label>
        <label><input id="sectionWatchlist" type="checkbox" checked style="width:auto"> 待看档案</label>
        <label><input id="sectionDedupe" type="checkbox" checked style="width:auto"> 非重复 arcid</label>
      </div>
      <div class="tool-actions"><button id="exportBtn" type="button">导出选中数据</button></div>
      <textarea id="importData" placeholder="粘贴导出的 JSON 后点击导入"></textarea>
      <div class="tool-actions">
        <button id="importBtn" class="secondary" type="button">导入选中数据</button>
        <button id="switchTokenBtn" class="subtle" type="button">更换 Token</button>
      </div>
    </div></div>
  </div>
  <div id="kvResult"></div>

  <div class="footer">
    <span>${PROJECT_NAME} · Cloudflare Worker</span>
    <span>${workerVersion}</span>
    <a href="${PROJECT_URL}" target="_blank" rel="noreferrer">GitHub</a>
  </div>
</div>
<script>
const result = document.getElementById('kvResult');
const kvClosed = document.getElementById('kvClosed');
const kvAuth = document.getElementById('kvAuth');
const kvPanel = document.getElementById('kvPanel');
const syncTokenInput = document.getElementById('syncTokenInput');
const serverScopeInput = document.getElementById('serverScopeInput');
const kvPanels = [kvClosed, kvAuth, kvPanel];
let syncToken = '';
function showPanel(panel) {
  kvPanels.forEach((item) => {
    const isOpen = item === panel;
    item.classList.toggle('is-open', isOpen);
    item.setAttribute('aria-hidden', String(!isOpen));
  });
}
function serverScope() {
  const value = serverScopeInput.value.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(value)) throw new Error('请输入有效的 32 位服务器 MD5 作用域');
  return value;
}
function sections() {
  return {
    history: document.getElementById('sectionHistory').checked,
    watchlist: document.getElementById('sectionWatchlist').checked,
    dedupe: document.getElementById('sectionDedupe').checked,
  };
}
async function call(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-token': syncToken, 'x-lrr-server-scope': serverScope() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.detail || data.error)) || 'HTTP ' + res.status);
  return data;
}
function showClosed() {
  syncToken = '';
  syncTokenInput.value = '';
  showPanel(kvClosed);
}
document.getElementById('openKvTool').onclick = () => {
  result.textContent = '';
  showPanel(kvAuth);
  syncTokenInput.focus();
};
document.getElementById('cancelKvBtn').onclick = showClosed;
document.getElementById('switchTokenBtn').onclick = () => {
  result.textContent = '';
  syncToken = '';
  showPanel(kvAuth);
  syncTokenInput.focus();
};
document.getElementById('validateTokenBtn').onclick = async () => {
  try {
    const token = syncTokenInput.value.trim();
    if (!token) throw new Error('请输入 Token');
    result.textContent = '正在验证 Token...';
    const res = await fetch('/health', { headers: { 'x-sync-token': token } });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && (data.detail || data.error)) || 'Token 无效');
    syncToken = token;
    showPanel(kvPanel);
    result.textContent = 'Token 验证通过。';
  } catch (e) { result.textContent = e.message; }
};
document.getElementById('exportBtn').onclick = async () => {
  try {
    result.textContent = '正在导出...';
    const data = await call('/kv/export', { sections: sections() });
    document.getElementById('importData').value = JSON.stringify(data.data, null, 2);
    result.textContent = '导出完成，JSON 已填入文本框。';
  } catch (e) { result.textContent = e.message; }
};
document.getElementById('importBtn').onclick = async () => {
  try {
    const raw = document.getElementById('importData').value.trim();
    if (!raw) throw new Error('请先粘贴导入 JSON');
    result.textContent = '正在导入...';
    const data = await call('/kv/import', { sections: sections(), data: JSON.parse(raw) });
    result.textContent = '导入完成：' + data.imported + ' 项。';
  } catch (e) { result.textContent = e.message; }
};
</script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ── Router ─────────────────────────────────────────────────────
async function handleRequest(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);

  // GET / → status page (browser visits)
  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
    return statusPage(request);
  }

  // GET /health → JSON diagnostic endpoint
  if (request.method === 'GET' && url.pathname === '/health') {
    const authErr = await requireAuth(request);
    if (authErr) return authErr;
    return json({
      status: 'running',
      authEnabled,
      tokenCount: cachedTokens ? cachedTokens.size : 0,
      hasKV: typeof HISTORY_KV !== 'undefined',
      kvReadOk: tokenLoadPromise ? await tokenLoadPromise : false,
      requestCount,
      bannedIPs: ipBans.size,
      trackedIPs: ipFailures.size,
    });
  }

  const ip = getClientIP(request);

  // Reject banned IPs before routing
  if (isIPBanned(ip)) {
    const expiry = ipBans.get(ip);
    const remainingSec = Math.ceil((expiry - Date.now()) / 1000);
    return json({
      error: 'Too many unauthorized requests.',
      retryAfter: remainingSec,
    }, 429);
  }

  if (url.pathname === '/history') {
    if (request.method === 'GET') return getHistory(request);
    if (request.method === 'PUT') return putHistory(request);
    if (request.method === 'DELETE') return deleteHistory(request);
    return json({ error: 'Method not allowed' }, 405);
  }

  if (url.pathname === '/watchlist') {
    if (request.method === 'GET') return getWatchlist(request);
    if (request.method === 'PUT') return putWatchlist(request);
    if (request.method === 'DELETE') return deleteWatchlist(request);
    return json({ error: 'Method not allowed' }, 405);
  }

  if (url.pathname === '/dedupe/non-duplicates') {
    if (request.method === 'GET') return getNonDuplicatePairs(request);
    if (request.method === 'PUT') return putNonDuplicatePairs(request);
    return json({ error: 'Method not allowed' }, 405);
  }

  if (url.pathname === '/kv/export' && request.method === 'POST') {
    return exportKV(request);
  }

  if (url.pathname === '/kv/import' && request.method === 'POST') {
    return importKV(request);
  }

  if (url.pathname === '/api' && request.method === 'POST') {
    return ehApiProxy(request);
  }

  if (url.pathname === '/eh/check' && request.method === 'POST') {
    return ehCheckProxy(request);
  }

  if (url.pathname === '/comment' && request.method === 'POST') {
    return ehCommentProxy(request);
  }

  if (url.pathname === '/favorite' && request.method === 'POST') {
    return ehFavoriteProxy(request);
  }

  // POST / → EH gallery proxy
  if (request.method === 'POST') return ehProxy(request);

  return json({ error: 'Not found' }, 404);
}
