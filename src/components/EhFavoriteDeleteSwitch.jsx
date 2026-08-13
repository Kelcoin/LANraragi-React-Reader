import React from 'react';
import ToggleSwitch from './ToggleSwitch';

export default function EhFavoriteDeleteSwitch({ checked, onChange, disabled = false }) {
  return (
    <label className="surface eh-favorite-delete-switch">
      <span>同步从 E-Hentai 收藏夹移除</span>
      <ToggleSwitch label="同步从 E-Hentai 收藏夹移除" checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  );
}
