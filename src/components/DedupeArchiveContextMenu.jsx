import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getFavoriteState, setArchiveFavorite } from '../lib/categories';
import { useToast } from './Toast';

function clampPosition(x, y, height) {
  const width = 150;
  const gap = 8;
  return {
    left: Math.min(Math.max(gap, x), Math.max(gap, window.innerWidth - width - gap)),
    top: Math.min(Math.max(gap, y), Math.max(gap, window.innerHeight - height - gap)),
  };
}

export default function DedupeArchiveContextMenu({ menu, onClose, onOpenNewTab, onViewThumbnails }) {
  const { showToast } = useToast();
  const archiveId = menu?.archive?.arcid || menu?.archive?.id || '';
  const [favorite, setFavorite] = useState(false);
  const [favoriteKnown, setFavoriteKnown] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const menuHeight = 128;
  const position = useMemo(() => clampPosition(menu?.x || 0, menu?.y || 0, menuHeight), [menu?.x, menu?.y, menuHeight]);

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
        if (active) showToast(`读取收藏状态失败：${error?.message || '未知错误'}`, 'error');
      })
      .finally(() => {
        if (active) setFavoriteBusy(false);
      });
    return () => { active = false; };
  }, [archiveId, showToast]);

  if (!menu?.archive) return null;
  const run = (action) => (event) => {
    event.stopPropagation();
    action?.(menu.archive);
    onClose?.();
  };
  const toggleFavorite = async (event) => {
    event.stopPropagation();
    if (favoriteBusy) return;
    setFavoriteBusy(true);
    try {
      const result = await setArchiveFavorite(archiveId, !favorite);
      setFavorite(result.favorite);
      onClose?.();
    } catch (error) {
      showToast(`${favorite ? '移出收藏夹' : '加入收藏夹'}失败：${error?.message || '未知错误'}`, 'error');
    } finally {
      setFavoriteBusy(false);
    }
  };

  return createPortal(
    <div
      role="menu"
      className="archive-context-menu dedupe-archive-context-menu dropdown-animate"
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" className="archive-context-menu-item" onClick={run(onOpenNewTab)}>
        打开阅读页
      </button>
      <button type="button" role="menuitem" className="archive-context-menu-item" onClick={run(onViewThumbnails)}>
        查看缩略图
      </button>
      <button type="button" role="menuitem" className="archive-context-menu-item" disabled={favoriteBusy} onClick={toggleFavorite}>
        {favoriteBusy
          ? (favoriteKnown ? (favorite ? '正在移出收藏夹…' : '正在加入收藏夹…') : '正在读取收藏状态…')
          : (favorite ? '移出收藏夹' : '加入收藏夹')}
      </button>
    </div>,
    document.body,
  );
}
