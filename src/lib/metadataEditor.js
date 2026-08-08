export function parseTags(value) {
  const seen = new Set();
  return String(value || '').split(',').map(tag => tag.trim()).filter(tag => {
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function mergeTags(current, incoming) { return parseTags([...current, ...parseTags(incoming)].join(',')); }
export function metadataFingerprint(value = {}) { return JSON.stringify([value.title || '', value.summary || '', parseTags(value.tags).join(',')]); }

export function readMetadataPluginResult(result) {
  if (!result || typeof result !== 'object') throw new Error('插件返回了无效结果');
  if (Number(result.success) === 0) throw new Error(result.error || '插件执行失败');
  const data = result?.data && typeof result.data === 'object' ? result.data : {};
  return {
    title: data.title ?? data.new_title ?? result.title ?? result.new_title ?? '',
    summary: data.summary ?? data.new_summary ?? result.summary ?? result.new_summary ?? '',
    tags: data.tags ?? data.new_tags ?? result.tags ?? result.new_tags ?? '',
  };
}

function stripPluginDescription(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&bull;/g, '•')
    .replace(/&rarr;/g, '→')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

export function normalizeMetadataPlugins(list) {
  const source = Array.isArray(list) ? list : (list?.data || list?.plugins || []);
  const seen = new Set();
  return source.map((item, index) => {
    if (typeof item === 'string') return { value: item, label: item, description: '' };
    const candidates = [item?.namespace, item?.plugin_id, item?.id, item?.plugin, item?.name];
    const rawValue = candidates.find(value => ['string', 'number'].includes(typeof value));
    const value = String(rawValue ?? `plugin-${index}`);
    const label = String(item?.name || item?.label || rawValue || `插件 ${index + 1}`);
    return { value, label, description: stripPluginDescription(item?.description) };
  }).filter(option => option.value && !seen.has(option.value) && seen.add(option.value));
}

export function formatMetadataTag(tag, translate = (_namespace, value) => value) {
  const raw = String(tag || '').trim();
  const separator = raw.indexOf(':');
  if (separator < 1) return raw;
  const namespace = raw.slice(0, separator).toLowerCase();
  const value = raw.slice(separator + 1).trim();
  if (namespace === 'date_added' || namespace === 'timestamp') {
    const number = Number(value);
    if (number > 0) {
      const date = new Date(number > 1e12 ? number : number * 1000);
      if (!Number.isNaN(date.getTime())) return `${namespace === 'date_added' ? '添加日期' : '发布日期'}：${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    }
  }
  if (namespace === 'source') {
    try { const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); return `来源：${url.hostname}${url.pathname === '/' ? '' : url.pathname}`; } catch { return `来源：${value}`; }
  }
  const translated = translate(namespace, value);
  const namespaceLabels = { artist: '作者', uploader: '上传者', female: '女性', male: '男性', mixed: '混合', other: '其他', parody: '原作', character: '角色', group: '社团', series: '系列', language: '语言', category: '分类', general: '通用' };
  const namespaceLabel = namespaceLabels[namespace] || namespace;
  return `${namespaceLabel}：${translated || value}`;
}
