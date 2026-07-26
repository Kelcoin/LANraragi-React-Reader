import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { hasArchiveReadingProgress } from '../lib/archiveProgress';
import { getFavoriteState, setArchiveFavorite } from '../lib/categories';

function clampMenuPosition(x, y, height = 178) {
  const width = 150;
  const gap = 8;
  return {
    left: Math.min(Math.max(gap, x), Math.max(gap, window.innerWidth - width - gap)),
    top: Math.min(Math.max(gap, y), Math.max(gap, window.innerHeight - height - gap)),
  };
}

function MenuButton({ children, danger = false, disabled = false, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`archive-context-menu-item${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function ArchiveContextMenu({ menu, onClose, onRead, onClearProgress, onEditMetadata, onDownload, onDelete, onCopyLink, onRemoveHistory, onAddWatchlist, onRemoveWatchlist }) {
  const archiveId = menu?.archive?.arcid || menu?.archive?.id || '';
  const [favorite, setFavorite] = useState(false);
  const [favoriteKnown, setFavoriteKnown] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteError, setFavoriteError] = useState('');
  const showRemoveHistory = !!menu?.showRemoveHistory && !!onRemoveHistory;
  const showRemoveWatchlist = !!menu?.showRemoveWatchlist && !!onRemoveWatchlist;
  const showAddWatchlist = !showRemoveWatchlist && !!onAddWatchlist;
  const showClearProgress = !!onClearProgress && hasArchiveReadingProgress(menu?.archive);
  const extraRows = (showRemoveHistory ? 1 : 0) + (showRemoveWatchlist || showAddWatchlist ? 1 : 0) + (onDelete ? 1 : 0) + (onEditMetadata ? 1 : 0) + (showClearProgress ? 1 : 0);
  const menuHeight = 178 + extraRows * 36 + (favoriteError ? 48 : 0);
  const pos = useMemo(() => clampMenuPosition(menu?.x || 0, menu?.y || 0, menuHeight), [menu?.x, menu?.y, menuHeight]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => onClose?.();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu, onClose]);

  useEffect(() => {
    let active = true;
    setFavorite(false);
    setFavoriteKnown(false);
    setFavoriteError('');
    if (!archiveId) return undefined;
    setFavoriteBusy(true);
    getFavoriteState(archiveId)
      .then((state) => {
        if (active) {
          setFavorite(state.favorite);
          setFavoriteKnown(true);
        }
      })
      .catch((error) => {
        if (active) setFavoriteError(`读取收藏状态失败：${error?.message || '未知错误'}`);
      })
      .finally(() => {
        if (active) setFavoriteBusy(false);
      });
    return () => { active = false; };
  }, [archiveId]);

  if (!menu?.archive) return null;

  const run = (action) => (event) => {
    event.stopPropagation();
    action?.(menu.archive);
    onClose?.();
  };
  const runClearProgress = async (event) => {
    event.stopPropagation();
    try {
      const result = await onClearProgress(menu.archive);
      if (result?.fallback) window.alert('服务器不支持清零，已回退到第一页。');
    } catch (error) {
      window.alert(`清除阅读进度失败：${error?.message || '未知错误'}`);
    } finally {
      onClose?.();
    }
  };
  const toggleFavorite = async (event) => {
    event.stopPropagation();
    if (favoriteBusy) return;
    setFavoriteBusy(true);
    setFavoriteError('');
    try {
      const result = await setArchiveFavorite(archiveId, !favorite);
      setFavorite(result.favorite);
      onClose?.();
    } catch (error) {
      setFavoriteError(`${favorite ? '移出收藏夹' : '加入收藏夹'}失败：${error?.message || '未知错误'}`);
    } finally {
      setFavoriteBusy(false);
    }
  };

  return createPortal(
    <div
      role="menu"
      className="archive-context-menu dropdown-animate"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        left: `${pos.left}px`,
        top: `${pos.top}px`,
      }}
    >
      <MenuButton onClick={run(onRead)}>阅读</MenuButton>
      {showClearProgress && <MenuButton onClick={runClearProgress}>清除阅读进度</MenuButton>}
      {onEditMetadata && <MenuButton onClick={run(onEditMetadata)}>编辑元数据</MenuButton>}
      <MenuButton onClick={run(onDownload)}>下载</MenuButton>
      <MenuButton onClick={run(onCopyLink)}>复制链接</MenuButton>
      <MenuButton disabled={favoriteBusy} onClick={toggleFavorite}>
        {favoriteBusy
          ? (favoriteKnown ? (favorite ? '正在移出收藏夹…' : '正在加入收藏夹…') : '正在读取收藏状态…')
          : (favorite ? '移出收藏夹' : '加入收藏夹')}
      </MenuButton>
      {favoriteError && (
        <div className="archive-context-menu-status is-error" aria-live="polite">{favoriteError}</div>
      )}
      {showAddWatchlist && <MenuButton onClick={run(onAddWatchlist)}>加入待看</MenuButton>}
      {showRemoveWatchlist && <MenuButton onClick={run(onRemoveWatchlist)}>移出待看</MenuButton>}
      {showRemoveHistory && <MenuButton danger onClick={run(onRemoveHistory)}>删除历史记录</MenuButton>}
      {onDelete && <div className="archive-context-menu-divider" />}
      {onDelete && <MenuButton danger onClick={run(onDelete)}>删除</MenuButton>}
    </div>,
    document.body,
  );
}

