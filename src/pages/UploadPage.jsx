import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lrrApi } from '../lib/api';
import { navigateHome, navigateToArchive, navigateToMetadata } from '../lib/navigation';
import {
  partitionUploadFiles,
  createUploadUrlTasks,
  matchDownloadPlugin,
  normalizeDownloadPlugins,
  parseUploadUrls,
  runUploadTasks,
} from '../lib/upload';
import CustomSelect from '../components/CustomSelect';
import { ToolbarGlyph } from '../components/AppGlyphs';
import ArchiveContextMenu from '../components/ArchiveContextMenu';
import ConfirmDialog from '../components/ConfirmDialog';
import EhFavoriteDeleteSwitch from '../components/EhFavoriteDeleteSwitch';
import ArchiveDeletionFailureDialog from '../components/ArchiveDeletionFailureDialog';
import { markArchiveCatalogDirty } from '../lib/archiveMetadataCache';
import { addWatchlistItem } from '../lib/watchlist';
import { clearConfiguredArchiveReadingProgress } from '../lib/archiveProgressActions';
import { deleteArchiveWithFavoriteSync } from '../lib/archiveDeletion';
import { getEhFavoriteDeleteSync } from '../lib/ehFavoriteSync';
import { useToast } from '../components/Toast';

const ACCEPTED_FILES = '.zip,.cbz,.rar,.cbr,.7z,.pdf';

function taskKey(type, value, index) {
  return `${type}:${value}:${index}`;
}

function archiveFromUploadResponse(value, fallbackTitle) {
  const data = value?.data && typeof value.data === 'object' ? value.data : value;
  const id = data?.id || data?.arcid || data?.archive_id;
  if (!id) return null;
  return { ...data, id, arcid: id, title: data?.title || fallbackTitle || id };
}

function statusTitle(status) {
  if (status === 'running') return '处理中';
  if (status === 'success') return '成功';
  if (status === 'failed') return '失败';
  return '等待';
}

export default function UploadPage() {
  const { showToast } = useToast();
  const fileInputRef = useRef(null);
  const [mode, setMode] = useState('local');
  const [urlText, setUrlText] = useState('');
  const [pluginValue, setPluginValue] = useState('auto');
  const [pluginState, setPluginState] = useState({ plugins: [], options: [{ label: '自动匹配', value: 'auto' }], warnings: [] });
  const [pluginStatus, setPluginStatus] = useState('');
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [clearingResults, setClearingResults] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [archiveMenu, setArchiveMenu] = useState(null);
  const [archiveDeleteTarget, setArchiveDeleteTarget] = useState(null);
  const [archiveDeleteSyncConfirmed, setArchiveDeleteSyncConfirmed] = useState(getEhFavoriteDeleteSync);
  const [archiveDeleting, setArchiveDeleting] = useState(false);
  const [archiveFailureReport, setArchiveFailureReport] = useState(null);

  const parsedUrls = useMemo(() => parseUploadUrls(urlText), [urlText]);
  const unmatchedUrlCount = useMemo(() => (
    pluginValue === 'auto'
      ? parsedUrls.valid.filter(url => !matchDownloadPlugin(url, pluginState.plugins)).length
      : 0
  ), [parsedUrls.valid, pluginState.plugins, pluginValue]);
  const queuedTaskCount = results.filter(item => item.status === 'queued').length;
  const totalProgress = results.length ? Math.max(0, Math.min(100, Math.round(results.reduce((sum, item) => sum + (Number(item.progress) || 0), 0) / results.length))) : 0;

  useEffect(() => {
    let disposed = false;
    lrrApi.getDownloadPlugins().then((payload) => {
      if (disposed) return;
      const normalized = normalizeDownloadPlugins(payload);
      setPluginState(normalized);
      setPluginStatus(normalized.plugins.length ? '' : '服务器没有提供可用的下载插件');
    }).catch((error) => {
      if (!disposed) setPluginStatus(error.message || '下载插件载入失败');
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const guard = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [running]);

  useEffect(() => {
    if (mode !== 'url' || running || clearingResults || parsedUrls.valid.length === 0) return;
    setResults(current => {
      const next = createUploadUrlTasks(
        parsedUrls.valid,
        new Set(current.map((item) => item.label)),
      ).map((task, index) => ({
        ...task,
        id: taskKey('url', task.url, current.length + index),
      }));
      return next.length ? [...current, ...next] : current;
    });
    setUrlText(current => {
      const valid = new Set(parseUploadUrls(current).valid);
      return String(current).split(/\r?\n/).filter(line => {
        const t = line.trim();
        if (!t) return true;
        let href = t;
        try { href = new URL(t).href; } catch { /* 保留无效行 */ }
        return !valid.has(href);
      }).join('\n');
    });
  }, [mode, parsedUrls.valid, running, clearingResults]);

  const addFiles = useCallback((incoming) => {
    if (clearingResults) return;
    const { accepted, rejected } = partitionUploadFiles(incoming);
    if (accepted.length) {
      setResults(current => {
        const existing = new Set(current.filter((item) => item.type === 'file').map((item) => item.label));
        const next = accepted
          .filter((file) => !existing.has(file.name))
          .map((file, index) => ({
            id: taskKey('file', file.name, current.length + index),
            type: 'file',
            label: file.name,
            file,
            status: 'queued',
            progress: 0,
            message: '',
          }));
        return [...current, ...next];
      });
    }
    if (rejected.length) showToast(`已忽略不支持的文件：${rejected.map((file) => file.name).join('、')}`, 'info');
  }, [clearingResults, showToast]);

  const clearSearchCache = useCallback(async (successLabel = '档案已提交') => {
    try {
      await lrrApi.clearSearchCache();
    } catch (error) {
        showToast(`${successLabel}，但搜索缓存清理失败：${error.message || '请稍后在首页刷新'}`, 'error');
    }
  }, [showToast]);

  const updateTask = useCallback((update) => {
    const updateId = update.item?.id;
    setResults(current => current.map((item) => {
      if (updateId == null || item.id !== updateId) return item;
      const archive = update.status === 'success'
        ? archiveFromUploadResponse(update.value, item.label)
        : null;
      return {
        ...item,
        status: update.status,
        progress: update.progress ?? item.progress ?? 0,
        archive: archive || item.archive,
        message: update.error || (update.status === 'success' ? '' : item.message),
      };
    }));
  }, []);

  const handleTaskContextMenu = useCallback((event, item) => {
    const archive = item?.status === 'success' ? item.archive : null;
    const archiveId = archive?.arcid || archive?.id;
    if (!archiveId) return;
    event.preventDefault();
    setArchiveMenu({ archive, x: event.clientX, y: event.clientY, showAddWatchlist: true });
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
    const archiveId = archive?.arcid || archive?.id;
    setResults(current => current.map(item => (
      (item.archive?.arcid || item.archive?.id) === archiveId
        ? { ...item, archive: { ...item.archive, progress: result.page, page: result.page } }
        : item
    )));
    return result;
  }, []);

  const handleArchiveDelete = useCallback(async () => {
    const archiveId = archiveDeleteTarget?.arcid || archiveDeleteTarget?.id;
    if (!archiveId) return;
    const title = archiveDeleteTarget?.title || archiveId;
    const ehFailures = [];
    setArchiveDeleting(true);
    try {
      const deletedId = await deleteArchiveWithFavoriteSync(archiveDeleteTarget, {
        syncEnabled: getEhFavoriteDeleteSync(),
        confirmationEnabled: archiveDeleteSyncConfirmed,
        continueOnFavoriteError: true,
        onFavoriteError: ({ galleryUrl, error }) => {
          ehFailures.push({ url: galleryUrl, message: error?.message || 'E-Hentai 收藏夹删除失败' });
        },
      });
      markArchiveCatalogDirty();
      await clearSearchCache('档案已删除');
      setResults(current => current.filter(item => (item.archive?.arcid || item.archive?.id) !== deletedId));
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
  }, [archiveDeleteSyncConfirmed, archiveDeleteTarget, clearSearchCache]);

  const runPending = useCallback(async () => {
    if (running) return;
    const tasks = results.filter((item) => item.status === 'queued');
    if (tasks.length === 0) return;
    setRunning(true);
    try {
      const uploadResults = await runUploadTasks(tasks, async (task, index, updateProgress) => {
        if (task.type === 'file') {
          return lrrApi.uploadArchive(task.file, { onProgress: updateProgress });
        }
        const plugin = pluginValue === 'auto'
          ? matchDownloadPlugin(task.url, pluginState.plugins)
          : pluginState.plugins.find(item => item.value === pluginValue);
        if (!plugin) throw new Error('没有下载插件匹配该 URL，请手动选择插件');
        return lrrApi.useDownloadPlugin(plugin.value, task.url);
      }, updateTask);
      if (uploadResults.some((result) => result.status === 'success')) markArchiveCatalogDirty();
      await clearSearchCache();
    } finally {
      setRunning(false);
    }
  }, [running, results, pluginValue, pluginState.plugins, updateTask, clearSearchCache]);

  const clearResults = useCallback(() => {
    if (clearingResults || results.length === 0) return;
    setClearingResults(true);
  }, [clearingResults, results.length]);

  useEffect(() => {
    if (!clearingResults) return undefined;
    const timer = window.setTimeout(() => {
      setResults([]);
      setClearingResults(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [clearingResults]);

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else navigateHome();
  };

  return (
    <main className="upload-page">
      <header className="upload-page-header">
        <div className="upload-page-title">
          <span className="upload-title-icon"><ToolbarGlyph name="upload" size={25} /></span>
          <div><h1>上传档案</h1><p>从本地文件或互联网添加到 LANraragi</p></div>
        </div>
        <button type="button" className="btn" onClick={goBack} disabled={running}>返回</button>
      </header>

      <div className="settings-category-tabs upload-mode-tabs" role="tablist" aria-label="添加入口">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'local'}
          className={`btn settings-category-tab upload-mode-tab${mode === 'local' ? ' is-active' : ''}`}
          onClick={() => setMode('local')}
          disabled={running || clearingResults}
        >从本地添加</button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'url'}
          className={`btn settings-category-tab upload-mode-tab${mode === 'url' ? ' is-active' : ''}`}
          onClick={() => setMode('url')}
          disabled={running || clearingResults}
        >从互联网添加</button>
      </div>

      <section className="glass-panel upload-panel">
        <div className="upload-mode-panel-stack">
          <div
            className={`upload-mode-panel${mode === 'local' ? ' is-active' : ''}`}
            aria-hidden={mode !== 'local'}
          >
            <div className="upload-section-heading">
              <ToolbarGlyph name="upload" size={20} />
              <div><h2>从本地添加</h2><p>支持一次选择多个档案文件</p></div>
            </div>
            <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_FILES} aria-label="选择档案文件" hidden disabled={running || clearingResults} onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
            <div
              className={`upload-dropzone${dragActive ? ' is-dragging' : ''}`}
              role="button"
              tabIndex={0}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInputRef.current?.click(); } }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={event => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={event => { event.preventDefault(); setDragActive(false); addFiles(event.dataTransfer.files); }}
            >
              <ToolbarGlyph name="upload" size={34} />
              <strong>选择文件或拖放到这里</strong>
              <span>ZIP、CBZ、RAR、CBR、7Z、PDF</span>
            </div>
          </div>

          <div
            className={`upload-mode-panel${mode === 'url' ? ' is-active' : ''}`}
            aria-hidden={mode !== 'url'}
          >
            <div className="upload-section-heading">
              <ToolbarGlyph name="cloudDownload" size={20} />
              <div><h2>从互联网添加</h2><p>自动根据插件正则匹配每个 URL</p></div>
            </div>
            <label className="upload-field-label">下载插件</label>
            <CustomSelect
              value={pluginValue}
              options={pluginState.options}
              onChange={setPluginValue}
              style={running || clearingResults ? { pointerEvents: 'none', opacity: 0.55 } : undefined}
            />
            {(pluginStatus || pluginState.warnings.length > 0) && <div className="upload-notice">
              {pluginStatus && <div>{pluginStatus}</div>}
              {pluginState.warnings.map(warning => <div key={warning}>{warning}</div>)}
            </div>}
            <div className="upload-url-label-row">
              <label className="upload-field-label" htmlFor="upload-urls">要下载的 URL（一行一个）</label>
              <div className="upload-url-summary">
                <span>{parsedUrls.valid.length} 个有效 URL</span>
                {parsedUrls.invalid.length > 0 && <span className="is-error">{parsedUrls.invalid.length} 个无效 URL</span>}
                {unmatchedUrlCount > 0 && <span className="is-error">{unmatchedUrlCount} 个未匹配插件</span>}
              </div>
            </div>
            <textarea id="upload-urls" className="input-glass upload-url-input" value={urlText} onChange={event => setUrlText(event.target.value)} placeholder={'https://example.com/gallery/123\nhttps://example.com/gallery/456'} disabled={running || clearingResults} />
          </div>
        </div>
      </section>

      <section className="glass-panel upload-results" aria-live="polite">
        <div className="upload-results-heading">
          <div><h2>任务列表</h2></div>
          <div className="upload-results-actions">
            <button type="button" className="btn" onClick={runPending} disabled={running || clearingResults || queuedTaskCount === 0}>
              {running ? '处理中…' : '开始处理'}
            </button>
            <button type="button" className="btn" onClick={clearResults} disabled={running || clearingResults || results.length === 0}>清空列表</button>
          </div>
        </div>
        <div className="upload-progress"><span style={{ width: `${totalProgress}%` }} /></div>
        <div className={`upload-task-list${clearingResults ? ' is-clearing' : ''}`}>
          {results.map(item => <div
            key={item.id}
            className={`upload-task-row${item.archive ? ' has-menu' : ''}`}
            style={{ '--task-progress': `${Number(item.progress) || 0}%` }}
            title={item.message ? `${item.label}：${item.message}` : item.label}
            onContextMenu={(event) => handleTaskContextMenu(event, item)}
          >
            <div><strong>{item.label}</strong></div>
            <span className={`upload-status-dot is-${item.status}`} title={statusTitle(item.status)} />
          </div>)}
        </div>
      </section>
      <ArchiveContextMenu
        menu={archiveMenu}
        onClose={() => setArchiveMenu(null)}
        onRead={(archive, options) => navigateToArchive(archive.arcid || archive.id, options)}
        onReadIncognito={(archive, options) => navigateToArchive(archive.arcid || archive.id, { ...options, incognito: true })}
        onClearProgress={handleClearArchiveProgress}
        onEditMetadata={(archive, options) => navigateToMetadata(archive.arcid || archive.id, options)}
        onDownload={handleArchiveDownload}
        onCopyLink={handleArchiveCopyLink}
        onAddWatchlist={(archive) => addWatchlistItem(archive)}
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
        {getEhFavoriteDeleteSync() && (
          <EhFavoriteDeleteSwitch checked={archiveDeleteSyncConfirmed} onChange={setArchiveDeleteSyncConfirmed} disabled={archiveDeleting} />
        )}
      </ConfirmDialog>
      <ArchiveDeletionFailureDialog report={archiveFailureReport} message={archiveFailureReport?.message} onClose={() => setArchiveFailureReport(null)} />
    </main>
  );
}
