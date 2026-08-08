import React, { useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import ToggleSwitch from './ToggleSwitch';
import { CONFIG_KEYS, exportConfig } from '../lib/worker-config';

const CONFIG_GROUPS = [
  {
    title: '服务器连接',
    keys: [
      ['lrr_server_url', '服务器地址'],
      ['lrr_api_key', 'API Key'],
    ],
  },
  {
    title: 'Worker 同步',
    keys: [
      ['lrr_worker_url', 'Cloudflare Worker 端点'],
      ['lrr_sync_token', '访问 Token'],
    ],
  },
  {
    title: 'E-Hentai',
    keys: [
      ['lrr_eh_cookie', 'E-Hentai Cookie'],
      ['lrr_eh_min_score', '评论最低分数'],
      ['lrr_eh_max_comments', '评论最多数量'],
      ['lrr_eh_sort_method', '评论排序方式'],
      ['lrr_eh_sort_order', '评论排序方向'],
      ['lrr_eh_favorite_delete_sync', '同步删除收藏'],
    ],
  },
  {
    title: '阅读与档案',
    keys: [
      ['lrr_reader_settings', '阅读器设置'],
      ['lrr_crop_cover', '裁剪封面'],
      ['lrr_archive_browse_mode', '档案浏览模式'],
      ['lrr_archive_display_mode', '档案显示模式'],
    ],
  },
  {
    title: '历史与筛选',
    keys: [
      ['lrr_hide_read', '隐藏已读完'],
      ['lrr_random_hide_read', '随机漫游隐藏已读完'],
      ['lrr_filter', '当前筛选条件'],
      ['lrr_filter_presets', '筛选预设'],
    ],
  },
  {
    title: '外观配色',
    keys: [
      ['lrr_theme_mode', '主题模式'],
      ['lrr_custom_theme', '自定义配色'],
    ],
  },
  {
    title: '图片缓存',
    keys: [
      ['lrr_image_cache_limit', '图片缓存上限'],
    ],
  },
];

function buildSelection(keys) {
  return new Set(keys);
}

export default function ConfigExportDialog({ open, onClose }) {
  const [selected, setSelected] = useState(() => buildSelection(CONFIG_KEYS));
  const [result, setResult] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setSelected(buildSelection(CONFIG_KEYS));
      setResult('');
      setCopied(false);
      setError('');
    }
  }, [open]);

  const toggle = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === CONFIG_KEYS.length ? new Set() : buildSelection(CONFIG_KEYS)));
  };

  const generate = () => {
    const keys = CONFIG_KEYS.filter((key) => selected.has(key));
    if (keys.length === 0) {
      setError('请至少选择一项配置。');
      return;
    }
    setError('');
    setResult(exportConfig({}, keys));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setError('');
    } catch {
      setError('无法访问剪贴板，请手动复制文本。');
    }
  };

  const allSelected = selected.size === CONFIG_KEYS.length;

  return (
    <ConfirmDialog
      open={open}
      title="导出配置"
      confirmLabel={result ? '关闭' : '导出配置'}
      cancelLabel="取消"
      showCancel={!result}
      destructive={false}
      confirmDisabled={!result && selected.size === 0}
      initialFocusSelector={result ? '[data-config-export-copy]' : undefined}
      onCancel={onClose}
      dismissOnBackdrop={false}
      onConfirm={result ? onClose : generate}
      actionsBefore={result ? (
        <button type="button" className="btn" data-config-export-copy onClick={copy}>
          {copied ? '已复制' : '复制'}
        </button>
      ) : (
        <button type="button" className="btn" onClick={toggleAll}>
          {allSelected ? '全不选' : '全选'}
        </button>
      )}
    >
      <div className="config-export-hint">
        勾选需要导出的配置项，默认全选。
      </div>
      {result ? (
        <textarea
          className="input-glass config-export-text"
          readOnly
          value={result}
          rows={8}
          spellCheck={false}
          aria-label="导出的配置文本"
        />
      ) : (
        <div className="config-export-list">
          {CONFIG_GROUPS.map((group) => (
            <fieldset key={group.title} className="config-export-group">
              <legend className="config-export-group-title">{group.title}</legend>
              <div className="config-export-items">
                {group.keys.map(([key, label]) => (
                  <div key={key} className="config-export-item">
                    <span className="config-export-item-name">{label}</span>
                    <ToggleSwitch checked={selected.has(key)} onChange={() => toggle(key)} label={label} />
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}
      {error && <div className="config-transfer-error" role="alert">{error}</div>}
    </ConfirmDialog>
  );
}
