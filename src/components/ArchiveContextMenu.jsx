import React, { useEffect, useMemo, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { hasArchiveReadingProgress } from '../lib/archiveProgress';
import { getFavoriteState, setArchiveFavorite } from '../lib/categories';
import { useToast } from './Toast';

function pointAnchor(x, y) {
  return {
    getBoundingClientRect: () => ({
      x, y, top: y, right: x, bottom: y, left: x, width: 0, height: 0,
    }),
  };
}

function MenuButton({ children, danger = false, disabled = false, closeOnClick = true, onClick }) {
  return (
    <Menu.Item
      nativeButton
      render={<button type="button" />}
      className={`archive-context-menu-item${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      closeOnClick={closeOnClick}
      onClick={onClick}
    >
      {children}
    </Menu.Item>
  );
}

export default function ArchiveContextMenu({ menu, onClose, onRead, onReadIncognito, onClearProgress, onEditMetadata, onDownload, onDelete, onCopyLink, onRemoveHistory, onAddWatchlist, onRemoveWatchlist }) {
  const { showToast } = useToast();
  const archiveId = menu?.archive?.arcid || menu?.archive?.id || '';
  const [favorite, setFavorite] = useState(false);
  const [favoriteKnown, setFavoriteKnown] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const anchor = useMemo(() => pointAnchor(menu?.x || 0, menu?.y || 0), [menu?.x, menu?.y]);
  const showRemoveHistory = !!menu?.showRemoveHistory && !!onRemoveHistory;
  const showRemoveWatchlist = !!menu?.showRemoveWatchlist && !!onRemoveWatchlist;
  const showAddWatchlist = !showRemoveWatchlist && !!onAddWatchlist;
  const showClearProgress = !!onClearProgress && hasArchiveReadingProgress(menu?.archive);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => onClose?.();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
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
    action?.(menu.archive, { newTab: event.ctrlKey });
  };
  const runClearProgress = async () => {
    try {
      const result = await onClearProgress(menu.archive);
      if (result?.fallback) showToast('服务器不支持清零，已回退到第一页。', 'info');
    } catch (error) {
      showToast(`清除阅读进度失败：${error?.message || '未知错误'}`, 'error');
    } finally {
      onClose?.();
    }
  };
  const toggleFavorite = async () => {
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

  return (
    <Menu.Root open onOpenChange={(nextOpen) => { if (!nextOpen) onClose?.(); }} modal={false}>
      <Menu.Portal>
        <Menu.Positioner
          className="archive-context-menu-positioner"
          anchor={anchor}
          side="bottom"
          align="start"
          positionMethod="fixed"
          collisionPadding={8}
        >
          <Menu.Popup className="archive-context-menu dropdown-animate" finalFocus={false}>
            <MenuButton onClick={run(onRead)}>阅读</MenuButton>
            <MenuButton onClick={run(onReadIncognito)}>无痕阅读</MenuButton>
            {showClearProgress && <MenuButton closeOnClick={false} onClick={runClearProgress}>清除阅读进度</MenuButton>}
            {onEditMetadata && <MenuButton onClick={run(onEditMetadata)}>编辑元数据</MenuButton>}
            <MenuButton onClick={run(onDownload)}>下载</MenuButton>
            <MenuButton onClick={run(onCopyLink)}>复制链接</MenuButton>
            <MenuButton disabled={favoriteBusy} closeOnClick={false} onClick={toggleFavorite}>
              {favoriteBusy
                ? (favoriteKnown ? (favorite ? '正在移出收藏夹…' : '正在加入收藏夹…') : '正在读取收藏状态…')
                : (favorite ? '移出收藏夹' : '加入收藏夹')}
            </MenuButton>
            {showAddWatchlist && <MenuButton onClick={run(onAddWatchlist)}>加入待看</MenuButton>}
            {showRemoveWatchlist && <MenuButton onClick={run(onRemoveWatchlist)}>移出待看</MenuButton>}
            {showRemoveHistory && <MenuButton danger onClick={run(onRemoveHistory)}>删除历史记录</MenuButton>}
            {onDelete && <div className="archive-context-menu-divider" />}
            {onDelete && <MenuButton danger onClick={run(onDelete)}>删除</MenuButton>}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
