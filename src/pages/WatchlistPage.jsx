import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ArchiveCard from '../components/ArchiveCard';
import ArchiveGrid from '../components/ArchiveGrid';
import ArchiveContextMenu from '../components/ArchiveContextMenu';
import { navigateToMetadata } from '../lib/navigation';
import ConfirmDialog from '../components/ConfirmDialog';
import ArchiveSearchBox from '../components/ArchiveSearchBox';
import { HomeSectionGlyph, ToolbarGlyph, getSectionGlyphColor } from '../components/AppGlyphs';
import { getArchiveDisplayMode, getCropCover, getHistory, loadHistoryState } from '../lib/history';
import { lrrApi } from '../lib/api';
import { archiveMatchesSearch } from '../lib/archiveSearch';
import { hasValidWorkerConfig } from '../lib/worker-config';
import { getWatchlist, getWatchlistAutoRemoveIds, loadWatchlistState, mergeWatchlistProgress, removeWatchlistItems } from '../lib/watchlist';
import { ARCHIVE_PROGRESS_VISIBILITY, readArchiveProgressVisibility, shouldShowArchiveProgress } from '../lib/archiveProgress';
import { clearConfiguredArchiveReadingProgress } from '../lib/archiveProgressActions';
import { useToast } from '../components/Toast';

function HeaderGlyph() {
  return <HomeSectionGlyph name="watchlist" size={24} color={getSectionGlyphColor('watchlist')} />;
}

function ArchiveListLoadingGrid({ count = 8, displayMode = 'card' }) {
  return (
    <ArchiveGrid className="archive-list-loading-grid" displayMode={displayMode} aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className={`archive-list-loading-card${displayMode === 'compact' ? ' is-compact' : ''}`} key={`watchlist-loading-${index}`}>
          <div className="archive-list-loading-cover shimmer-strip" />
          <div className="archive-list-loading-line shimmer-strip" />
          <div className="archive-list-loading-line archive-list-loading-line-short shimmer-strip" />
        </div>
      ))}
    </ArchiveGrid>
  );
}

export default function WatchlistPage({ onSelectArchive, onBack }) {
  const { showToast } = useToast();
  const archiveDisplayMode = getArchiveDisplayMode();
  const workerReady = hasValidWorkerConfig();
  const [items, setItems] = useState(() => getWatchlist());
  const [history, setHistory] = useState(() => getHistory());
  const [initialLoading, setInitialLoading] = useState(true);
  const [cropCover] = useState(getCropCover);
  const [progressBarVisibility] = useState(readArchiveProgressVisibility);
  const showHistoricalArchiveProgress = shouldShowArchiveProgress(progressBarVisibility, true);
  const reserveGlobalProgressSpace = progressBarVisibility === ARCHIVE_PROGRESS_VISIBILITY.GLOBAL;
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [menu, setMenu] = useState(null);
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 600);
  const gridRef = useRef(null);

  useEffect(() => {
    let active = true;
    loadWatchlistState().then((state) => {
      if (!active) return;
      // Keep items written while hydrating (removed/added elsewhere); snapshot
      // enhancement fields only survive when the entry was not touched.
      const latest = getWatchlist();
      const stateById = new Map(state.items.map((item) => [item.id, item]));
      setItems(latest.map((item) => {
        const enhanced = stateById.get(item.id);
        return enhanced && enhanced.addedAt === item.addedAt ? { ...item, ...enhanced } : item;
      }));
    }).catch(() => {
      if (active) setItems(getWatchlist());
    }).finally(() => {
      if (active) setInitialLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    loadHistoryState().then((state) => {
      if (active) setHistory(state.histories);
    }).catch(() => {
      if (active) setHistory(getHistory());
    });
    const refresh = () => {
      if (active) setHistory(getHistory());
    };
    window.addEventListener('lrr:history-changed', refresh);
    return () => {
      active = false;
      window.removeEventListener('lrr:history-changed', refresh);
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      const next = getWatchlist();
      setItems(next);
      setSelectedIds((prev) => {
        const visible = new Set(next.map((item) => item.id));
        return new Set(Array.from(prev).filter((id) => visible.has(id)));
      });
    };
    window.addEventListener('lrr:watchlist-changed', refresh);
    return () => window.removeEventListener('lrr:watchlist-changed', refresh);
  }, []);

  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < 600);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const itemsWithProgress = useMemo(() => mergeWatchlistProgress(items, history), [history, items]);
  const autoRemoveIds = useMemo(() => getWatchlistAutoRemoveIds(itemsWithProgress), [itemsWithProgress]);
  const filteredItems = useMemo(() => itemsWithProgress.filter((item) => archiveMatchesSearch(item, query)), [itemsWithProgress, query]);
  const selectedCount = selectedIds.size;

  useEffect(() => {
    if (autoRemoveIds.length > 0) removeWatchlistItems(autoRemoveIds).catch(() => {});
  }, [autoRemoveIds]);

  const handleSync = useCallback(async () => {
    if (!workerReady || syncing) return;
    setSyncing(true);
    try {
      const state = await loadWatchlistState({ force: true });
      setItems(state.items);
    } finally {
      setSyncing(false);
    }
  }, [syncing, workerReady]);

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

  const toggleSelection = useCallback((id, event) => {
    if (!id) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (event?.shiftKey && lastSelectedId) {
        const ids = filteredItems.map((item) => item.id);
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
  }, [filteredItems, lastSelectedId]);

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(filteredItems.map((item) => item.id)));
    setLastSelectedId(filteredItems[0]?.id || null);
  }, [filteredItems]);

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

  const handleRemove = useCallback(async () => {
    if (!Array.isArray(deleteTarget?.ids) || deleteTarget.ids.length === 0) return;
    await removeWatchlistItems(deleteTarget.ids);
    setItems(getWatchlist());
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
    } catch (err) {
      showToast(err.message || '下载失败', 'error');
    }
  }, [showToast]);

  const handleCopyLink = useCallback(async (archive) => {
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
    const archiveId = archive.arcid || archive.id;
    setItems((previous) => previous.map((item) => (
      (item.arcid || item.id) === archiveId ? { ...item, progress: result.page, page: result.page } : item
    )));
    setHistory(getHistory());
    return result;
  }, []);

  return (
    <>
      <div className="history-page watchlist-page page-workspace">
        <div className="history-page-header page-header">
          <div className="history-page-title-block">
            <div className="history-page-title-row">
              <h1 className="history-page-title">
                <HeaderGlyph />
                待看档案
              </h1>
              <div className="history-page-summary page-summary">
                <span className="history-summary-part">共 {items.length} 个档案</span>
                {query.trim() && <span className="history-summary-part">当前显示 {filteredItems.length} 个</span>}
              </div>
            </div>
          </div>
          <div className="history-page-actions">
            <button className="btn" onClick={onBack}>返回</button>
            {workerReady && (
            <button
              className="btn"
              onClick={handleSync}
              disabled={syncing}
              title="从 Worker 刷新待看档案"
            >
              {syncing ? '刷新中' : '刷新'}
            </button>
            )}
          </div>
        </div>

        <section className="glass-panel archive-workspace section-reveal section-reveal-delay-1">
          <div className="history-section-header archive-toolbar">
            <div className="history-section-title">
              <HeaderGlyph />
              <span>全部待看</span>
            </div>
            <div className="history-section-actions">
              {selectedCount > 0 && (
                <>
                  <span>{selectedCount} 项已选</span>
                  <button className="btn" onClick={requestBatchDelete}>移除选中</button>
                  <button className="btn" onClick={clearSelection}>取消选择</button>
                </>
              )}
              {selectionMode && selectedCount === 0 && filteredItems.length > 0 && (
                <button className="btn" onClick={selectAllVisible}>全选当前</button>
              )}
              {filteredItems.length > 0 && (
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
            <ArchiveSearchBox query={query} setQuery={setQuery} placeholder="在待看档案中搜索标题或标签" />
          </div>

          {initialLoading && filteredItems.length === 0 ? (
            <ArchiveListLoadingGrid count={8} displayMode={archiveDisplayMode} />
          ) : filteredItems.length > 0 ? (
            <ArchiveGrid ref={gridRef} displayMode={archiveDisplayMode} style={{ gap: isNarrow ? '10px' : '16px' }}>
              {filteredItems.map((item) => {
                const selected = selectedIds.has(item.id);
                return (
                  <ArchiveCard
                    key={`watchlist-${item.id}`}
                    archive={item}
                    className="watchlist-card watchlist-card-plain"
                    wrapStyle={{ position: 'relative' }}
                    overlay={selectionMode ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSelection(item.id, event);
                        }}
                        title="选择待看档案"
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
                    onClick={(event) => {
                      if (selectionMode) toggleSelection(item.id, event);
                      else onSelectArchive(item.id);
                    }}
                    onArchiveContextMenu={(archive, point) => setMenu({ archive, x: point.x, y: point.y, showRemoveWatchlist: true })}
                    onLongPress={() => requestSingleDelete(item)}
                    longPressTitle="移除待看"
                    currentPage={item.page}
                    showProgressBar={showHistoricalArchiveProgress}
                    reserveProgressSpace={reserveGlobalProgressSpace}
                    noCrop={!cropCover}
                    selectionMode={selectionMode}
                    selected={selected}
                    onSelectToggle={(archive, event) => toggleSelection(archive.id || archive.arcid, event)}
                  />
                );
              })}
            </ArchiveGrid>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-sub)', fontSize: '14px' }}>
              {items.length > 0 ? '没有匹配的待看档案' : '暂无待看档案'}
            </div>
          )}
        </section>
      </div>

      <ArchiveContextMenu
        menu={menu}
        onClose={() => setMenu(null)}
        onRead={(archive, options) => onSelectArchive(archive.arcid || archive.id, options)}
        onReadIncognito={(archive, options) => onSelectArchive(archive.arcid || archive.id, { ...options, incognito: true })}
        onClearProgress={handleClearArchiveProgress}
        onEditMetadata={(archive, options) => navigateToMetadata(archive.arcid || archive.id, options)}
        onDownload={handleDownload}
        onCopyLink={handleCopyLink}
        onRemoveWatchlist={(archive) => requestSingleDelete(archive)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="确认移除待看"
        message={deleteTarget ? (deleteTarget.batch ? `将选中的 ${deleteTarget.ids.length} 个档案从待看中移除。` : `将“${deleteTarget.title}”从待看中移除。`) : ''}
        confirmLabel="确认移除"
        cancelLabel="取消"
        onConfirm={handleRemove}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
