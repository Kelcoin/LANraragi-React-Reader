import React, { useCallback, useEffect, useState } from 'react';
import { clearImageCache, getImageCacheStats, setImageCacheLimit } from '../lib/imageCache';
import { getCacheUsagePercent } from '../lib/cacheDisplay';
import CustomSelect from './CustomSelect';
import SettingHint from './SettingHint';

const formatBytes = (bytes) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

export default function CacheSettings() {
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => getImageCacheStats().then(setStats).catch(() => setStats(null)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const run = async (operation) => { setBusy(true); try { await operation(); await refresh(); } finally { setBusy(false); } };
  const options = [
    { label: '自动', value: 'auto' },
    { label: '256 MB', value: 'mb256' },
    { label: '512 MB', value: 'mb512' },
    { label: '1 GB', value: 'gb1' },
    { label: '2 GB', value: 'gb2' },
  ];
  const usagePercent = getCacheUsagePercent(stats);
  return <div className="settings-subgroup-content">
    <label className="settings-row">
      <SettingHint text={'自动：按浏览器可用空间计算安全上限。\n手动：使用你指定的容量。\n达到上限后会优先清理较旧图片。'}>最大缓存容量</SettingHint>
      <div className={`settings-control${busy ? ' is-busy' : ''}`}>
        <CustomSelect value={stats?.mode || 'auto'} options={options} onChange={(value) => run(() => setImageCacheLimit(value))} compact />
      </div>
    </label>
    <div className="cache-usage-row">
      <div className="cache-usage-main">
        <div className="cache-usage-text">{stats ? `已用 ${formatBytes(stats.bytes)} / ${formatBytes(stats.limit)} · ${stats.entries} 项` : '暂时无法读取缓存用量'}</div>
        <div className="cache-usage-track" aria-hidden="true"><span style={{ width: `${usagePercent}%` }} /></div>
      </div>
      <button type="button" className="btn btn-secondary cache-clear-button" disabled={busy} onClick={() => run(async () => clearImageCache({ disk: true }))}>清空缓存</button>
    </div>
  </div>;
}
