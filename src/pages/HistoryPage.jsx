import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ArchiveCard from '../components/ArchiveCard';
import ArchiveGrid from '../components/ArchiveGrid';
import ArchiveContextMenu from '../components/ArchiveContextMenu';
import ConfirmDialog from '../components/ConfirmDialog';
import ArchiveSearchBox from '../components/ArchiveSearchBox';
import EhFavoriteDeleteSwitch from '../components/EhFavoriteDeleteSwitch';
import ArchiveDeletionFailureDialog from '../components/ArchiveDeletionFailureDialog';
import { HomeSectionGlyph, ToolbarGlyph, getSectionGlyphColor } from '../components/AppGlyphs';
import { getArchiveDisplayMode, getCropCover, getHideRead, getHistory, loadHistoryState, removeHistoryItems } from '../lib/history';
import { isArchiveMissingError, runHistoryExistenceCheck } from '../lib/historyMaintenance';
import { hasValidWorkerConfig } from '../lib/worker-config';
import { archiveMatchesSearch } from '../lib/archiveSearch';
import { lrrApi } from '../lib/api';
import { deleteArchiveWithFavoriteSync } from '../lib/archiveDeletion';
import { getEhFavoriteDeleteSync } from '../lib/ehFavoriteSync';
import { navigateToMetadata } from '../lib/navigation';
import { removeWatchlistItem } from '../lib/watchlist';
import { ARCHIVE_PROGRESS_VISIBILITY, readArchiveProgressVisibility, shouldShowArchiveProgress } from '../lib/archiveProgress';
import { clearConfiguredArchiveReadingProgress } from '../lib/archiveProgressActions';

function HeaderGlyph() {
  return <HomeSectionGlyph name="continue" size={24} color={getSectionGlyphColor('continue')} />;
}

function startOfLocalDay(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatHistoryDate(time) {
  if (!time) return '时间未知';
  try {
    return new Date(time).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '时间未知';
  }
}

function historyPeriodFor(time, todayStart = startOfLocalDay(Date.now())) {
  if (!time) return { key: 'older', title: '更久以前' };
  const dayStart = startOfLocalDay(time);
  const ageDays = Math.floor((todayStart - dayStart) / (24 * 60 * 60 * 1000));

  if (ageDays <= 0) {
    return { key: 'today', title: '今天' };
  }
  if (ageDays === 1) {
    return { key: 'yesterday', title: '昨天' };
  }
  if (ageDays < 7) {
    return { key: 'week', title: '最近 7 天' };
  }
  if (ageDays < 30) {
    return { key: 'month', title: '最近 30 天' };
  }
  return { key: 'older', title: '更久以前' };
}

function groupHistoryByPeriod(items) {
  const order = ['today', 'yesterday', 'week', 'month', 'older'];
  const groups = new Map();
  const todayStart = startOfLocalDay(Date.now());

  items.forEach((item) => {
    const period = historyPeriodFor(item.time, todayStart);
    if (!groups.has(period.key)) {
      groups.set(period.key, { ...period, items: [] });
    }
    groups.get(period.key).items.push(item);
  });

  return order.map((key) => groups.get(key)).filter(Boolean);
}

export default function HistoryPage({ onSelectArchive, onBack }) {
  const archiveDisplayMode = getArchiveDisplayMode();
  const workerReady = hasValidWorkerConfig();
  const [history, setHistoryState] = useState(() => getHistory());
  const [hideRead, setHideReadState] = useState(getHideRead);
  const [cropCover] = useState(getCropCover);
  const [progressBarVisibility] = useState(readArchiveProgressVisibility);
  const showHistoricalArchiveProgress = shouldShowArchiveProgress(progressBarVisibility, true);
  const reserveGlobalProgressSpace = progressBarVisibility === ARCHIVE_PROGRESS_VISIBILITY.GLOBAL;
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [menu, setMenu] = useState(null);
  const [archiveDeleteTarget, setArchiveDeleteTarget] = useState(null);
  const [archiveDeleting, setArchiveDeleting] = useState(false);
  const [archiveDeleteSyncConfirmed, setArchiveDeleteSyncConfirmed] = useState(true);
  const [archiveFailureReport, setArchiveFailureReport] = useState(null);
  const [notice, setNotice] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 600);
  const [query, setQuery] = useState('');

  useEffect(() => {
    loadHistoryState().then((state) => {
      setHistoryState(state.histories);
      setHideReadState(state.hideRead);
    }).catch(() => setHistoryState(getHistory()));
  }, []);

  useEffect(() => {
    const refresh = () => {
      setHistoryState(getHistory());
      setSelectedIds((prev) => {
        const visible = new Set(getHistory().map((item) => item.id));
        return new Set(Array.from(prev).filter((id) => visible.has(id)));
      });
    };
    window.addEventListener('lrr:history-changed', refresh);
    return () => window.removeEventListener('lrr:history-changed', refresh);
  }, []);

  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < 600);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const filteredHistory = useMemo(() => {
    if (!hideRead) return history;
    return history.filter((h) => !(h.total > 0 && h.page >= h.total));
  }, [history, hideRead]);

  const searchedHistory = useMemo(() => (
    filteredHistory.filter((item) => archiveMatchesSearch(item, query))
  ), [filteredHistory, query]);

  const groupedHistory = useMemo(() => groupHistoryByPeriod(searchedHistory), [searchedHistory]);

  const selectedCount = selectedIds.size;

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((value) => {
      const next = !value;
      if (!next) {
        setSelectedIds(new Set());
        setLastSelectedId(null);
      }
      return next;
    });
  }, []);

  const handleSyncHistory = useCallback(async () => {
    if (!workerReady || syncing) return;
    setSyncing(true);
    try {
      const state = await loadHistoryState({ force: true });
      setHistoryState(state.histories);
      setHideReadState(state.hideRead);
    } finally {
      setSyncing(false);
    }
  }, [syncing, workerReady]);

  const handleCheckHistory = useCallback(async () => {
    if (checking) return;
    setMenu(null);
    setChecking(true);
    try {
      const removed = await runHistoryExistenceCheck({ force: true });
      setHistoryState(getHistory());
      if (removed > 0) setNotice(`已清理 ${removed} 条失效记录。`);
    } catch (error) {
      setNotice(`清理失败：${error?.message || '未知错误'}`);
    } finally {
      setChecking(false);
    }
  }, [checking]);

  const toggleSelection = useCallback((id, event) => {
    if (!id) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (event?.shiftKey && lastSelectedId) {
        const ids = searchedHistory.map((item) => item.id);
        const from = ids.indexOf(lastSelectedId);
        const to = ids.indexOf(id);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          ids.slice(start, end + 1).forEach((rangeId) => next.add(rangeId));
        } else {
          next.add(id);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastSelectedId(id);
  }, [lastSelectedId, searchedHistory]);

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(searchedHistory.map((item) => item.id)));
    setLastSelectedId(searchedHistory[0]?.id || null);
  }, [searchedHistory]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }, []);

  const requestBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    setDeleteTarget({ ids: Array.from(selectedIds), batch: true });
  }, [selectedIds]);

  const requestSingleDelete = useCallback((item) => {
    if (!item?.id) return;
    setDeleteTarget({ ids: [item.id], title: item.title, batch: false });
  }, []);

  const handleRemoveHistory = useCallback(async () => {
    if (!Array.isArray(deleteTarget?.ids) || deleteTarget.ids.length === 0) return;
    await removeHistoryItems(deleteTarget.ids);
    setHistoryState(getHistory());
    setSelectedIds((prev) => {
      const removeSet = new Set(deleteTarget.ids);
      return new Set(Array.from(prev).filter((id) => !removeSet.has(id)));
    });
    setDeleteTarget(null);
  }, [deleteTarget]);

  const handleDownload = useCallback(async (archive) => {
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
    } catch (error) {
      setNotice(`下载失败：${error?.message || '未知错误'}`);
    }
  }, []);

  const handleCopyLink = useCallback(async (archive) => {
    const archiveId = archive?.arcid || archive?.id;
    if (!archiveId) return;
    const url = `${window.location.origin}/?id=${encodeURIComponent(archiveId)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      setNotice(`无法自动复制，请手动复制：${url}`);
    }
  }, []);

  const handleClearArchiveProgress = useCallback(async (archive) => {
    const result = await clearConfiguredArchiveReadingProgress(archive);
    setHistoryState(getHistory());
    return result;
  }, []);

  const requestArchiveDelete = useCallback((archive) => {
    setArchiveDeleteSyncConfirmed(true);
    setArchiveDeleteTarget(archive);
  }, []);

  const handleArchiveDelete = useCallback(async () => {
    if (!archiveDeleteTarget || archiveDeleting) return;
    const archiveId = archiveDeleteTarget.arcid || archiveDeleteTarget.id;
    const title = archiveDeleteTarget.title || archiveId;
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
      await Promise.all([removeHistoryItems([archiveId]), removeWatchlistItem(archiveId)]);
      setHistoryState(getHistory());
      setArchiveDeleteTarget(null);
      if (ehFailures.length > 0) {
        setArchiveFailureReport({ ehFailures, lrrFailures: [], message: 'LANraragi 档案已删除，但 E-Hentai 收藏夹移除失败。' });
      }
    } catch (error) {
      if (isArchiveMissingError(error)) {
        await removeHistoryItems([archiveId]);
        setHistoryState(getHistory());
        setArchiveDeleteTarget(null);
        if (ehFailures.length > 0) {
          setArchiveFailureReport({ ehFailures, lrrFailures: [], message: '档案已不存在于 LANraragi，相关历史记录已清理；E-Hentai 收藏夹移除失败。' });
        } else {
          setNotice('档案已不存在于 LANraragi，相关历史记录已清理。');
        }
      } else {
        setArchiveDeleteTarget(null);
        setArchiveFailureReport({
          ehFailures,
          lrrFailures: [{ id: archiveId, title, message: error?.message || '未知错误' }],
          message: '档案删除未全部完成，可稍后重试。',
        });
      }
    } finally {
      setArchiveDeleting(false);
    }
  }, [archiveDeleteSyncConfirmed, archiveDeleteTarget, archiveDeleting, workerReady]);

  return (
    <>
      <div className="history-page" style={{ padding: isNarrow ? '16px 10px' : '24px 20px' }}>
        <div className="history-page-header">
          <div className="history-page-title-block">
            <div className="history-page-title-row">
              <h1 className="history-page-title">
                <HeaderGlyph />
                阅读历史
              </h1>
              <div className="history-page-summary">
                <span className="history-summary-part">共 {history.length} 条记录</span>
                {hideRead && <span className="history-summary-part">当前显示 {filteredHistory.length} 条</span>}
                {query.trim() && <span className="history-summary-part">搜索结果 {searchedHistory.length} 条</span>}
              </div>
            </div>
          </div>
          <div className="history-page-actions">
            <button className="btn" onClick={onBack}>返回</button>
            {workerReady && (
            <button
              className="btn"
              onClick={handleSyncHistory}
              disabled={syncing || checking}
              title="从 Worker 刷新阅读历史"
            >
              {syncing ? '刷新中' : '刷新'}
            </button>
            )}
            <button className="btn" onClick={handleCheckHistory} disabled={checking}>
              {checking ? '检查中' : '清理失效'}
            </button>
          </div>
        </div>

        <section
          className="glass-panel section-reveal section-reveal-delay-1"
          inert={checking ? '' : undefined}
          aria-busy={checking}
          style={{ padding: isNarrow ? '16px 14px' : '20px 24px' }}
        >
          <div className="history-section-header">
            <div className="history-section-title">
              <HeaderGlyph />
              <span>全部历史记录</span>
            </div>
            <div className="history-section-actions">
              {selectedCount > 0 && (
                <>
                  <span>{selectedCount} 项已选</span>
                  <button className="btn" onClick={requestBatchDelete}>删除选中</button>
                  <button className="btn" onClick={clearSelection}>取消选择</button>
                </>
              )}
              {selectionMode && selectedCount === 0 && searchedHistory.length > 0 && (
                <button className="btn" onClick={selectAllVisible}>全选当前</button>
              )}
              {searchedHistory.length > 0 && (
                <button
                  className="btn"
                  onClick={toggleSelectionMode}
                  style={{
                    background: selectionMode ? 'var(--accent)' : undefined,
                    borderColor: selectionMode ? 'var(--accent)' : undefined,
                    color: selectionMode ? 'var(--accent-contrast)' : undefined,
                  }}
                >
                  {selectionMode ? '退出多选' : '多选'}
                </button>
              )}
            </div>
          </div>

          <div className="history-section-toolbar">
            <ArchiveSearchBox query={query} setQuery={setQuery} placeholder="在阅读历史中搜索标题或标签" />
          </div>

          {searchedHistory.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: isNarrow ? '22px' : '28px' }}>
              {groupedHistory.map((group) => (
                <div key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: isNarrow ? '12px' : '16px' }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(92px, auto) 1fr auto',
                    alignItems: 'center',
                    gap: isNarrow ? '10px' : '14px',
                    color: 'var(--text-sub)',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ color: 'var(--text-main)', fontSize: '15px', fontWeight: 700 }}>{group.title}</span>
                    </div>
                    <div style={{ height: '1px', background: 'var(--glass-border)' }} />
                    <div style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                      {group.items.length} 条
                    </div>
                  </div>

                  <ArchiveGrid displayMode={archiveDisplayMode} style={{ gap: isNarrow ? '10px' : '16px' }}>
                    {group.items.map((h) => {
                      const selected = selectedIds.has(h.id);
                      return (
                        <ArchiveCard
                          key={`all-hist-${group.key}-${h.id}`}
                          archive={h}
                          wrapStyle={{ position: 'relative' }}
                          overlay={selectionMode ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSelection(h.id, e);
                              }}
                              title={`选择历史记录，最后阅读于 ${formatHistoryDate(h.time)}`}
                              style={{
                                position: 'absolute',
                                zIndex: 5,
                                top: '8px',
                                left: '8px',
                                width: '28px',
                                height: '28px',
                                borderRadius: '8px',
                                border: selected ? '1px solid var(--accent)' : '1px solid color-mix(in srgb, var(--accent-contrast) 26%, transparent)',
                                background: selected ? 'var(--accent)' : 'var(--overlay-bg)',
                                color: 'var(--accent-contrast)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: 'var(--shadow-soft)',
                              }}
                            >
                              {selected && <ToolbarGlyph name="check" size={15} color="var(--accent-contrast)" />}
                            </button>
                          ) : null}
                          onClick={(e) => {
                            if (selectionMode) {
                              toggleSelection(h.id, e);
                            } else {
                              onSelectArchive(h.id);
                            }
                          }}
                          onArchiveContextMenu={(archive, point) => setMenu({ archive, x: point.x, y: point.y, showRemoveHistory: true })}
                          longPressTitle="打开菜单"
                          currentPage={h.page}
                          showProgressBar={showHistoricalArchiveProgress}
                          reserveProgressSpace={reserveGlobalProgressSpace}
                          noCrop={!cropCover}
                        />
                      );
                    })}
                  </ArchiveGrid>

                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-sub)', fontSize: '14px' }}>
              {query.trim() ? '没有匹配的阅读历史' : (hideRead && history.length > 0 ? '所有档案均已读完' : '暂无阅读历史')}
            </div>
          )}
        </section>
      </div>
      <ArchiveContextMenu
        menu={menu}
        onClose={() => setMenu(null)}
        onRead={(archive) => onSelectArchive(archive.arcid || archive.id)}
        onClearProgress={handleClearArchiveProgress}
        onEditMetadata={(archive) => navigateToMetadata(archive.arcid || archive.id)}
        onDownload={handleDownload}
        onCopyLink={handleCopyLink}
        onRemoveHistory={requestSingleDelete}
        onDelete={requestArchiveDelete}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除阅读记录"
        message={deleteTarget ? (deleteTarget.batch ? `将选中的 ${deleteTarget.ids.length} 条记录从阅读历史中移除。再次阅读对应档案时会重新加入历史记录。` : `将“${deleteTarget.title}”从阅读历史中移除。再次阅读该档案时会重新加入历史记录。`) : ''}
        confirmLabel="确认删除"
        cancelLabel="取消"
        onConfirm={handleRemoveHistory}
        onCancel={() => setDeleteTarget(null)}
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
      <ConfirmDialog
        open={!!notice}
        title="操作提示"
        message={notice}
        confirmLabel="知道了"
        showCancel={false}
        destructive={false}
        initialFocusSelector="[data-dialog-confirm]"
        onConfirm={() => setNotice('')}
        onCancel={() => setNotice('')}
      />
    </>
  );
}
