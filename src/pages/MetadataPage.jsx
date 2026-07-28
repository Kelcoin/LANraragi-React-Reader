import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { lrrApi } from '../lib/api';
import { formatMetadataTag, mergeTags, metadataFingerprint, normalizeMetadataPlugins, parseTags, readMetadataPluginResult } from '../lib/metadataEditor';
import { navigateHome, navigateToArchive, setNavigationGuard } from '../lib/navigation';
import CustomSelect from '../components/CustomSelect';
import TagSuggest from '../components/TagSuggest';
import ConfirmDialog from '../components/ConfirmDialog';
import MetadataTagChip from '../components/MetadataTagChip';
import EhFavoriteDeleteSwitch from '../components/EhFavoriteDeleteSwitch';
import ArchiveDeletionFailureDialog from '../components/ArchiveDeletionFailureDialog';
import { getEhFavoriteDeleteSync } from '../lib/ehFavoriteSync';
import { deleteArchiveWithFavoriteSync } from '../lib/archiveDeletion';
import { rememberArchiveInCatalog } from '../lib/archiveMetadataCache';
import { loadTagDB, translateTag } from '../lib/tags';

const field = { width: '100%', boxSizing: 'border-box' };

function MetadataTagsBox({ children, onPointerMove, onPointerLeave }) {
  const contentRef = useRef(null);
  const [height, setHeight] = useState(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [itemWidths, setItemWidths] = useState({});

  const handleMeasure = useCallback((tag, width) => {
    setItemWidths(current => current[tag] === width ? current : { ...current, [tag]: width });
  }, []);

  const rows = useMemo(() => {
    const items = React.Children.toArray(children);
    if (!contentWidth) return [items];
    const gap = Math.max(4, Math.min(7, window.innerWidth * 0.0125));
    const result = [];
    let row = [];
    let rowWidth = 0;
    items.forEach((child) => {
      const reservedWidth = Math.min(itemWidths[child.props.tag] || 74, contentWidth);
      const nextWidth = row.length ? rowWidth + gap + reservedWidth : reservedWidth;
      if (row.length && nextWidth > contentWidth) {
        result.push(row);
        row = [];
        rowWidth = 0;
      }
      row.push(React.cloneElement(child, { onMeasure: handleMeasure }));
      rowWidth = row.length === 1 ? reservedWidth : rowWidth + gap + reservedWidth;
    });
    if (row.length) result.push(row);
    return result;
  }, [children, contentWidth, handleMeasure, itemWidths]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return undefined;
    const updateHeight = () => {
      const frame = getComputedStyle(content.parentElement);
      const inset = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
        .reduce((total, property) => total + (Number.parseFloat(frame[property]) || 0), 0);
      setHeight(Math.ceil(content.getBoundingClientRect().height + inset));
      setContentWidth(content.clientWidth);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return <div className="metadata-tags-box" style={height ? { height: Math.max(74, height) } : undefined}>
    <div ref={contentRef} className="metadata-tags-list" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      {rows.map((row, index) => <div className="metadata-tags-row" key={index}>{row}</div>)}
    </div>
  </div>;
}

export default function MetadataPage({ archiveId }) {
  const [archive, setArchive] = useState(null);
  const [baseline, setBaseline] = useState('');
  const [form, setForm] = useState({ title: '', summary: '', tags: [] });
  const [tagInput, setTagInput] = useState('');
  const [plugins, setPlugins] = useState([]);
  const [plugin, setPlugin] = useState('');
  const [pluginArg, setPluginArg] = useState('');
  const [status, setStatus] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSync, setDeleteSync] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailureReport, setDeleteFailureReport] = useState(null);
  const [deletedWithReport, setDeletedWithReport] = useState(false);
  const [busy, setBusy] = useState('');
  const [revealedTag, setRevealedTag] = useState('');
  const [, setTagDBRevision] = useState(0);
  const tagInputRef = useRef(null);
  const statusTimerRef = useRef(null);
  const statusIdRef = useRef(0);
  const loadSequenceRef = useRef(0);
  const operationControllerRef = useRef(null);
  const allowNavigationRef = useRef(false);
  const dirty = useMemo(() => !!baseline && metadataFingerprint({ ...form, tags: form.tags.join(',') }) !== baseline, [baseline, form]);

  const handleArchiveDelete = useCallback(async () => {
    const title = archive?.title || archiveId;
    const ehFailures = [];
    setDeleting(true);
    try {
      await deleteArchiveWithFavoriteSync({ ...archive, id: archiveId }, {
        syncEnabled: getEhFavoriteDeleteSync(),
        confirmationEnabled: deleteSync,
        continueOnFavoriteError: true,
        onFavoriteError: ({ galleryUrl, error }) => {
          ehFailures.push({ url: galleryUrl, message: error?.message || 'E-Hentai 收藏夹删除失败' });
        },
      });
      if (ehFailures.length > 0) {
        setDeleteOpen(false);
        setDeletedWithReport(true);
        setDeleteFailureReport({ ehFailures, lrrFailures: [], message: 'LANraragi 档案已删除，但 E-Hentai 收藏夹移除失败。' });
        setDeleting(false);
        return;
      }
      allowNavigationRef.current = true;
      navigateHome();
    } catch (error) {
      setDeleteOpen(false);
      setDeletedWithReport(false);
      setDeleteFailureReport({
        ehFailures,
        lrrFailures: [{ id: archiveId, title, message: error?.message || '删除失败' }],
        message: '档案删除未全部完成，可稍后重试。',
      });
      setDeleting(false);
    }
  }, [archive, archiveId, deleteSync]);

  const closeDeleteFailureReport = useCallback(() => {
    setDeleteFailureReport(null);
    if (deletedWithReport) {
      setDeletedWithReport(false);
      allowNavigationRef.current = true;
      navigateHome();
    }
  }, [deletedWithReport]);

  useEffect(() => {
    let active = true;
    loadTagDB().then(() => {
      if (active) setTagDBRevision(current => current + 1);
    });
    return () => { active = false; };
  }, []);

  const showStatus = (text, type = 'info', { autoHide = type === 'error' } = {}) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusIdRef.current += 1;
    setStatus({ id: statusIdRef.current, text, type, closing: false });
    if (autoHide) {
      statusTimerRef.current = setTimeout(() => {
        setStatus(current => current ? { ...current, closing: true } : current);
        statusTimerRef.current = setTimeout(() => setStatus(null), 260);
      }, 1800);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++loadSequenceRef.current;
    operationControllerRef.current?.abort();
    setArchive(null);
    setBusy('load');
    Promise.all([
      lrrApi.getArchive(archiveId, { signal: controller.signal }),
      lrrApi.getMetadataPlugins({ signal: controller.signal }).catch((error) => {
        if (error?.name === 'AbortError') throw error;
        return [];
      }),
    ]).then(([data, list]) => {
      if (sequence !== loadSequenceRef.current) return;
      const next = { title: data.title || '', summary: data.summary || '', tags: parseTags(data.tags) };
      setArchive(data); setForm(next); setBaseline(metadataFingerprint({ ...next, tags: next.tags.join(',') }));
      const values = normalizeMetadataPlugins(list);
      setPlugins(values); setPlugin(values[0]?.value || '');
    }).catch((error) => {
      if (sequence === loadSequenceRef.current && error?.name !== 'AbortError') showStatus(error.message, 'error');
    }).finally(() => {
      if (sequence === loadSequenceRef.current) setBusy('');
    });
    return () => controller.abort();
  }, [archiveId]);

  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    operationControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const guard = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  useEffect(() => setNavigationGuard((nextRoute) => (
    allowNavigationRef.current
    || !dirty
    || (nextRoute?.kind === 'metadata' && nextRoute.archiveId === archiveId)
    || window.confirm('元数据尚未保存，确定离开并放弃修改吗？')
  )), [archiveId, dirty]);

  const addTags = (value) => {
    const incomingTags = parseTags(value);
    const nextTags = mergeTags(form.tags, incomingTags.join(','));
    if (incomingTags.length && nextTags.length === form.tags.length) {
      showStatus(`标签已存在：${incomingTags[0]}`, 'error');
    } else if (incomingTags.length) {
      setForm({ ...form, tags: nextTags });
    }
    setTagInput('');
  };
  const save = async () => {
    if (busy) return;
    const controller = new AbortController();
    operationControllerRef.current = controller;
    setBusy('save');
    showStatus('正在保存…');
    try {
      const latest = await lrrApi.getArchive(archiveId, { signal: controller.signal });
      if (metadataFingerprint(latest) !== baseline) throw new Error('服务器上的元数据已发生变化，请刷新后再编辑。');
      const updatedArchive = { ...latest, ...form, id: archiveId, arcid: archiveId, tags: form.tags.join(',') };
      await lrrApi.updateArchiveMetadata(archiveId, updatedArchive, { signal: controller.signal });
      rememberArchiveInCatalog(updatedArchive);
      await lrrApi.clearSearchCache().catch(() => {});
      setBaseline(metadataFingerprint(updatedArchive)); showStatus('已保存', 'success', { autoHide: true });
    } catch (error) {
      if (error?.name !== 'AbortError') showStatus(error.status === 423 ? '档案正被其他任务占用，请稍后重试。' : error.message, 'error');
    } finally {
      if (operationControllerRef.current === controller) operationControllerRef.current = null;
      setBusy('');
    }
  };
  const runPlugin = async () => {
    if (!plugin || busy) return;
    const controller = new AbortController();
    operationControllerRef.current = controller;
    setBusy('plugin');
    showStatus('插件执行中…');
    try {
      const result = await lrrApi.useMetadataPlugin(archiveId, plugin, pluginArg.trim() || form.title || archive.title || '', { signal: controller.signal });
      const { tags } = readMetadataPluginResult(result);
      if (tags) addTags(tags);
      showStatus(tags ? '插件标签已合并，保存后生效。' : '插件执行完成，未返回新标签。', tags ? 'success' : 'info', { autoHide: true });
    } catch (error) {
      if (error?.name !== 'AbortError') showStatus(error.message, 'error');
    } finally {
      if (operationControllerRef.current === controller) operationControllerRef.current = null;
      setBusy('');
    }
  };
  if (!archive) return <div className="metadata-loading-state">{status?.text || '正在载入元数据…'}</div>;
  return <main className="metadata-page">
    <h2 className="metadata-page-title">编辑 {archive.title}</h2>
    <section className="glass-panel metadata-panel">
      <label className="metadata-field">当前文件名<input className="input-glass" style={field} readOnly value={archive.filename || archive.filepath || ''} /></label>
      <label className="metadata-field">ID<input className="input-glass" style={field} readOnly value={archiveId} /></label>
      <label className="metadata-field">标题<input className="input-glass" style={field} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label className="metadata-field">摘要<textarea className="input-glass" style={{ ...field, minHeight: 110 }} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} /></label>
      <div className="metadata-tag-field"><div className="metadata-field-label">标签</div>
        <div ref={tagInputRef} style={{ position: 'relative', marginBottom: 10 }}><input className="input-glass" style={field} value={tagInput} placeholder="输入中文、拼音或标签，按回车/逗号添加" onChange={e => { const value = e.target.value; if (value.includes(',')) addTags(value); else setTagInput(value); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTags(tagInput); } else if (e.key === 'Backspace' && !tagInput && form.tags.length) setForm({ ...form, tags: form.tags.slice(0, -1) }); }} /><TagSuggest inputValue={tagInput} containerRef={tagInputRef} onSelectTag={(tag) => addTags(tag.replace(/\$$/, ''))} /></div>
        <MetadataTagsBox
          onPointerMove={(event) => {
            if (event.pointerType !== 'mouse') return;
            const nextTag = event.target.closest('.metadata-tag-slot')?.dataset.metadataTag || '';
            setRevealedTag(current => current === nextTag ? current : nextTag);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') setRevealedTag('');
          }}
        >{form.tags.map(tag => <MetadataTagChip key={tag} tag={tag} translatedTag={formatMetadataTag(tag, translateTag)} revealed={revealedTag === tag} onToggle={() => setRevealedTag(current => current === tag ? '' : tag)} onCopy={async () => { try { await navigator.clipboard.writeText(tag); showStatus(`已复制标签：${tag}`, 'success'); } catch { showStatus('复制标签失败', 'error'); } }} onDelete={() => { setRevealedTag(current => current === tag ? '' : current); setForm({ ...form, tags: form.tags.filter(item => item !== tag) }); }} />)}</MetadataTagsBox>
      </div>
      <div className="metadata-plugin-row"><CustomSelect value={plugin} options={plugins} onChange={setPlugin} /><input className="input-glass" value={pluginArg} onChange={e => setPluginArg(e.target.value)} placeholder="插件参数或 URL" disabled={!!busy} /><button className="btn" onClick={runPlugin} disabled={!!busy}>执行插件</button></div>
      <div className="metadata-status-wrap" data-open={status && !status.closing ? 'true' : 'false'} aria-live="polite">
        <div className="metadata-status-clip">
          {status && <div key={status.id} className={`metadata-status-card is-${status.type}${status.closing ? ' is-closing' : ''}`}>{status.text}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 14 }}><button className="btn" onClick={() => navigateToArchive(archiveId)} disabled={!!busy}>阅读档案</button><button className="btn metadata-delete-button" onClick={() => { setDeleteSync(true); setDeleteOpen(true); }} disabled={!!busy}>删除档案</button><button className="btn" onClick={save} disabled={!!busy}>{busy === 'save' ? '保存中…' : '保存元数据'}</button><button className="btn" disabled={!!busy} onClick={() => { if (window.history.length > 1) window.history.back(); else navigateHome(); }}>返回</button></div>
    </section>
    <ConfirmDialog open={deleteOpen} title="确认删除档案" message={`将永久删除“${archive.title}”。`} confirmLabel={deleting ? '删除中…' : '确认删除'} confirmDisabled={deleting} onCancel={() => !deleting && setDeleteOpen(false)} onConfirm={handleArchiveDelete} dismissOnBackdrop={!deleting}>
      {getEhFavoriteDeleteSync() && <EhFavoriteDeleteSwitch checked={deleteSync} onChange={setDeleteSync} disabled={deleting} />}
    </ConfirmDialog>
    <ArchiveDeletionFailureDialog report={deleteFailureReport} message={deleteFailureReport?.message} onClose={closeDeleteFailureReport} />
  </main>;
}
