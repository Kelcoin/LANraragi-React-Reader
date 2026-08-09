function pluginSource(payload) {
  return Array.isArray(payload) ? payload : (payload?.data || payload?.plugins || []);
}

const ACCEPTED_UPLOAD_EXTENSION = /\.(zip|cbz|rar|cbr|7z|pdf)$/i;

export function partitionUploadFiles(files = []) {
  const accepted = [];
  const rejected = [];
  for (const file of Array.from(files || [])) {
    (ACCEPTED_UPLOAD_EXTENSION.test(String(file?.name || '')) ? accepted : rejected).push(file);
  }
  return { accepted: dedupeUploadFiles(accepted), rejected };
}

export function parseUploadUrls(text = '') {
  const seen = new Set();
  const valid = [];
  const invalid = [];

  String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach((line) => {
    try {
      const url = new URL(line);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
      if (!seen.has(url.href)) {
        seen.add(url.href);
        valid.push(url.href);
      }
    } catch {
      if (!invalid.includes(line)) invalid.push(line);
    }
  });

  return { valid, invalid };
}

export function createUploadUrlTasks(urls = [], existingLabels = new Set()) {
  const seen = new Set(existingLabels);
  return Array.from(urls || []).filter((url) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  }).map((url) => ({
    type: 'url',
    label: url,
    url,
    status: 'queued',
    progress: 0,
    message: '',
  }));
}

function compilePattern(pattern) {
  if (!pattern) return null;
  const literal = pattern.match(/^\/(.*)\/([dgimsuvy]*)$/);
  return literal ? new RegExp(literal[1], literal[2]) : new RegExp(pattern);
}

export function normalizeDownloadPlugins(payload) {
  const warnings = [];
  const plugins = pluginSource(payload).map((item, index) => {
    const value = String(item?.namespace ?? item?.plugin_id ?? item?.id ?? item?.plugin ?? item?.name ?? `plugin-${index}`);
    const label = String(item?.name ?? value);
    const pattern = String(item?.oneshot_arg ?? item?.url_regex ?? item?.regex ?? item?.pattern ?? '');
    let matcher = null;
    if (pattern) {
      try { matcher = compilePattern(pattern); }
      catch { warnings.push(`${label} 的 URL 匹配正则无效`); }
    }
    return { label, value, pattern, matcher };
  });

  return {
    plugins,
    warnings,
    options: [{ label: '自动匹配', value: 'auto' }, ...plugins.map(({ label, value }) => ({ label, value }))],
  };
}

export function matchDownloadPlugin(url, plugins = []) {
  return plugins.find((plugin) => {
    if (!plugin.matcher) return false;
    plugin.matcher.lastIndex = 0;
    return plugin.matcher.test(url);
  }) || null;
}

export function dedupeUploadFiles(files = []) {
  const seen = new Set();
  return Array.from(files).filter((file) => {
    const key = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clampProgress(value) {
  const progress = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(100, progress));
}

export async function runUploadTasks(items, worker, onUpdate = () => {}) {
  const results = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const updateProgress = (progress) => {
      onUpdate({ index, item, status: 'running', progress: clampProgress(progress) });
    };
    onUpdate({ index, item, status: 'running', progress: 0 });
    try {
      const value = await worker(item, index, updateProgress);
      const result = { item, status: 'success', value };
      results.push(result);
      onUpdate({ index, ...result, progress: 100 });
    } catch (error) {
      const result = { item, status: 'failed', error: error?.message || String(error) };
      results.push(result);
      onUpdate({ index, ...result, progress: 100 });
    }
  }
  return results;
}
