const trimDetail = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 240);

const PRESENTATIONS = {
  Unauthorized: ['Worker 验证失败', 'Token 无效或缺失，请检查同步 Token。', false],
  TOKEN_MISSING: ['Worker 验证失败', 'Token 无效或缺失，请检查同步 Token。', false],
  EH_WORKER_NOT_CONFIGURED: ['需要配置同步 Worker', '请先在设置面板填写 Worker 地址和访问 Token。', false],
  EH_REQUIRES_LOGIN: ['需要 E-Hentai 登录信息', 'Cookie 可能缺失、已过期，或未包含 nw=1。', true],
  CONTENT_WARNING: ['需要 E-Hentai 登录信息', 'Cookie 可能缺失、已过期，或未包含 nw=1。', true],
  EH_CLOUDFLARE_BLOCK: ['E-Hentai 暂时拒绝访问', 'Worker 节点可能触发 Cloudflare 验证或 IP 临时限制。', false],
  ACCESS_BLOCKED: ['E-Hentai 暂时拒绝访问', '画廊访问被拒绝，Cookie 或当前 IP 可能受限。', false],
  GALLERY_NOT_FOUND: ['画廊不存在或已删除', '链接可能失效，也可能是画廊刚上传还未完成索引，或已回滚到旧版本。', false],
  GALLERY_COPYRIGHT_REMOVED: ['画廊因版权要求被移除', '上游已按版权方要求下架该画廊，评论不再可用。', false],
  GALLERY_UNAVAILABLE: ['画廊暂时无法访问', '链接可能失效，或上游暂时不可用。', false],
  NETWORK_ERROR: ['无法获取 E-Hentai 评论', '网络、反向代理或 CORS 配置可能异常。', false],
  EH_UPSTREAM_ERROR: ['E-Hentai 上游响应异常', '上游暂时无法返回有效页面，请稍后重试。', false],
  EH_EMPTY_RESPONSE: ['评论页面响应异常', '上游返回空白页面，Cookie 或链接可能已失效。', false],
  EH_UNEXPECTED_PAGE: ['评论页面格式异常', 'Cookie 可能已过期，或 E-Hentai 页面结构已变化。', false],
};

export function presentEhError(code, detail = '') {
  const known = PRESENTATIONS[code];
  if (known) {
    return { title: known[0], detail: known[1], needsCookie: known[2] };
  }
  return {
    title: '无法获取 E-Hentai 评论',
    detail: trimDetail(detail) || 'Worker 返回未知错误，请稍后重试。',
    needsCookie: false,
  };
}

export function isTerminalGalleryError(code) {
  return code === 'GALLERY_NOT_FOUND' || code === 'GALLERY_COPYRIGHT_REMOVED' || code === 'GALLERY_UNAVAILABLE';
}

export function shouldKeepEhCommentsOnRefreshFailure(cachedComments, visibleComments) {
  return (Array.isArray(cachedComments) && cachedComments.length > 0)
    || (Array.isArray(visibleComments) && visibleComments.length > 0);
}
