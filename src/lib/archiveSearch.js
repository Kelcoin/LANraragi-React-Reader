export function tokenizeArchiveSearch(query = '') {
  return String(query || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function hasArchiveSearchQuery(query = '') {
  return String(query || '').trim().length > 0;
}

export function formatArchiveSearchTokens(tokens, { trailingComma = false } = {}) {
  const text = (tokens || []).map((token) => token.trim()).filter(Boolean).join(', ');
  if (!text) return '';
  return trailingComma ? `${text}, ` : text;
}

export function replaceCurrentArchiveSearchToken(query, token) {
  const trimmed = String(token || '').trim();
  if (!trimmed) return query || '';
  const raw = query || '';
  const commaIndex = raw.lastIndexOf(',');
  const prefix = commaIndex >= 0 ? raw.slice(0, commaIndex) : '';
  const tokens = tokenizeArchiveSearch(prefix);
  tokens.push(trimmed);
  return formatArchiveSearchTokens(tokens, { trailingComma: true });
}

export function getArchiveSearchTotal(response, dataLength, previousTotal = null) {
  const candidates = [
    response?.recordsFiltered,
    response?.recordsTotal,
    response?.total,
    response?.filtered,
    response?.count,
  ];
  const found = candidates.find((value) => (
    value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value))
  ));
  if (found !== undefined) return Number(found);
  if (dataLength === 0 && !Number.isFinite(previousTotal)) return 0;
  return Number.isFinite(previousTotal) ? previousTotal : null;
}

function normalizeSearchToken(token) {
  return String(token || '').trim().replace(/\$$/, '').toLowerCase();
}

export function archiveMatchesSearch(archive, query = '') {
  const tokens = tokenizeArchiveSearch(query).map(normalizeSearchToken).filter(Boolean);
  if (tokens.length === 0) return true;
  const title = String(archive?.title || '').toLowerCase();
  const tags = String(archive?.tags || '').toLowerCase();
  const haystack = `${title}\n${tags}`;
  return tokens.every((token) => {
    if (!token) return true;
    if (token.includes(':')) return tags.includes(token);
    return haystack.includes(token);
  });
}
