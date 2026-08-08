let navigationGuard = null;

export function setNavigationGuard(guard) {
  navigationGuard = typeof guard === 'function' ? guard : null;
  return () => { if (navigationGuard === guard) navigationGuard = null; };
}

export function canNavigate(detail) {
  return !navigationGuard || navigationGuard(detail) !== false;
}

function dispatchRouteChange(detail) {
  window.dispatchEvent(new CustomEvent('lrr:navigate', { detail }));
}

function openRouteInNewTab(url) {
  window.open(url, '_blank', 'noopener');
}

export function parseRouteSearch(search = '') {
  const params = new URLSearchParams(search);
  const archiveId = params.get('id');
  const query = params.get('q');
  const view = params.get('view');

  if (archiveId && view === 'metadata') return { kind: 'metadata', archiveId };

  if (archiveId) {
    return { kind: 'reader', archiveId, incognito: params.get('incognito') === '1' };
  }
  if (view === 'history') {
    return { kind: 'history' };
  }
  if (view === 'watchlist') {
    return { kind: 'watchlist' };
  }
  if (view === 'dedupe') {
    return { kind: 'dedupe' };
  }
  if (view === 'upload') {
    return { kind: 'upload' };
  }

  return { kind: 'home', query: query || '' };
}

export function parseRouteFromLocation() {
  return parseRouteSearch(window.location.search);
}

export function navigateToArchive(archiveId, { replace = false, incognito = false, newTab = false } = {}) {
  if (!archiveId) return;
  if (!canNavigate({ kind: 'reader', archiveId: String(archiveId), incognito })) return false;
  const url = incognito ? `/?id=${encodeURIComponent(archiveId)}&incognito=1` : `/?id=${encodeURIComponent(archiveId)}`;
  if (newTab) {
    openRouteInNewTab(url);
    return true;
  }
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'reader', archiveId: String(archiveId), incognito });
  return true;
}

export function navigateToMetadata(archiveId, { replace = false, newTab = false } = {}) {
  if (!archiveId) return;
  if (!canNavigate({ kind: 'metadata', archiveId: String(archiveId) })) return false;
  const url = `/?view=metadata&id=${encodeURIComponent(archiveId)}`;
  if (newTab) {
    openRouteInNewTab(url);
    return true;
  }
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'metadata', archiveId: String(archiveId) });
  return true;
}

export function navigateHome({ query = '', replace = false, scrollToArchives = false } = {}) {
  const nextQuery = (query || '').trim();
  if (!canNavigate({ kind: 'home', query: nextQuery, scrollToArchives })) return false;
  const url = nextQuery ? `/?q=${encodeURIComponent(nextQuery)}` : '/';
  if (scrollToArchives) {
    try { sessionStorage.setItem('lrr_scroll_archives_on_arrival', '1'); } catch {}
  }
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'home', query: nextQuery, scrollToArchives });
  return true;
}

export function navigateHistory({ replace = false } = {}) {
  if (!canNavigate({ kind: 'history' })) return false;
  const url = '/?view=history';
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'history' });
  return true;
}

export function navigateWatchlist({ replace = false } = {}) {
  if (!canNavigate({ kind: 'watchlist' })) return false;
  const url = '/?view=watchlist';
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'watchlist' });
  return true;
}

export function navigateDeduplicate({ replace = false } = {}) {
  if (!canNavigate({ kind: 'dedupe' })) return false;
  const url = '/?view=dedupe';
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'dedupe' });
  return true;
}

export function navigateUpload({ replace = false } = {}) {
  if (!canNavigate({ kind: 'upload' })) return false;
  const url = '/?view=upload';
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'upload' });
  return true;
}
