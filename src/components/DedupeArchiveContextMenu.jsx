import React, { useEffect, useMemo, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { getFavoriteState, setArchiveFavorite } from '../lib/categories';
import { useToast } from './Toast';

function pointAnchor(x, y) {
  return {
    getBoundingClientRect: () => ({
      x, y, top: y, right: x, bottom: y, left: x, width: 0, height: 0,
    }),
  };
}

function MenuButton({ children, disabled = false, closeOnClick = true, onClick }) {
  return (
    <Menu.Item
      nativeButton
      render={<button type="button" />}
      className="archive-context-menu-item"
      disabled={disabled}
      closeOnClick={closeOnClick}
      onClick={onClick}
    >
      {children}
    </Menu.Item>
  );
}

export default function DedupeArchiveContextMenu({ menu, onClose, onOpenNewTab, onViewThumbnails }) {
  const { showToast } = useToast();
  const archiveId = menu?.archive?.arcid || menu?.archive?.id || '';
  const [favorite, setFavorite] = useState(false);
  const [favoriteKnown, setFavoriteKnown] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const anchor = useMemo(() => pointAnchor(menu?.x || 0, menu?.y || 0), [menu?.x, menu?.y]);

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
  const run = (action) => () => action?.(menu.archive);
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
          <Menu.Popup className="archive-context-menu dedupe-archive-context-menu dropdown-animate" finalFocus={false}>
            <MenuButton onClick={run(onOpenNewTab)}>打开无痕阅读页</MenuButton>
            <MenuButton onClick={run(onViewThumbnails)}>查看缩略图</MenuButton>
            <MenuButton disabled={favoriteBusy} closeOnClick={false} onClick={toggleFavorite}>
              {favoriteBusy
                ? (favoriteKnown ? (favorite ? '正在移出收藏夹…' : '正在加入收藏夹…') : '正在读取收藏状态…')
                : (favorite ? '移出收藏夹' : '加入收藏夹')}
            </MenuButton>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
