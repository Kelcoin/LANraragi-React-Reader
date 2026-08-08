import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import TagSuggest from './TagSuggest';
import ConfirmDialog from './ConfirmDialog';
import TextInputDialog from './TextInputDialog';
import { ToolbarGlyph } from './AppGlyphs';
import { replaceCurrentArchiveSearchToken } from '../lib/archiveSearch';
import { deleteFilterPreset, readFilterPresets, renameFilterPreset, saveFilterPreset } from '../lib/filterPresets';

export default function ArchiveSearchBox({ query, setQuery, placeholder }) {
  const searchBoxRef = useRef(null);
  const suggestActiveRef = useRef(false);
  const [presets, setPresets] = useState(readFilterPresets);
  const [showPresets, setShowPresets] = useState(false);
  const [nameDialog, setNameDialog] = useState(null);
  const [editingPreset, setEditingPreset] = useState('');
  const [deleteTarget, setDeleteTarget] = useState('');
  const presetMenuId = useId();

  const handleTagSelect = useCallback((tag) => {
    suggestActiveRef.current = false;
    setQuery(value => replaceCurrentArchiveSearchToken(value, tag));
    setTimeout(() => searchBoxRef.current?.querySelector('input')?.focus(), 50);
  }, [setQuery]);

  const savePreset = useCallback(() => setNameDialog({ mode: 'create', value: '' }), []);

  useEffect(() => {
    if (!showPresets) return undefined;
    const close = (event) => {
      if (!searchBoxRef.current?.contains(event.target)) setShowPresets(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [showPresets]);

  return (
    <div className="archive-search-wrap" ref={searchBoxRef}>
      <div className="archive-search-row">
        <div className="archive-search-input-wrap">
          <input
            className="input-glass"
            name="archive-search"
            autoComplete="off"
            aria-label={placeholder}
            value={query}
            onChange={(event) => {
              if (showPresets) setShowPresets(false);
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !suggestActiveRef.current) event.currentTarget.blur();
              if (event.key === 'Escape') setShowPresets(false);
            }}
            placeholder={placeholder}
            style={{ padding: `10px ${query ? 66 : 38}px 10px 12px`, fontSize: '14px', width: '100%', boxSizing: 'border-box' }}
          />
          {query && (
            <button
              type="button"
              className="input-clear-btn"
              onClick={() => setQuery('')}
              style={{ position: 'absolute', right: '36px', top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}
              aria-label="清空搜索"
            >
              <ToolbarGlyph name="close" size={14} />
            </button>
          )}
          <button
            type="button"
            className="input-clear-btn archive-search-preset-toggle"
            onClick={() => {
              suggestActiveRef.current = false;
              setShowPresets(v => !v);
            }}
            aria-expanded={showPresets}
            aria-controls={presetMenuId}
            aria-label={showPresets ? '收起筛选预设' : '展开筛选预设'}
          >
            <svg className="archive-search-chevron" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M6 9l6 6 6-6z" />
            </svg>
          </button>
          {!showPresets && <TagSuggest inputValue={query} onSelectTag={handleTagSelect} containerRef={searchBoxRef} onSetActive={(active) => { suggestActiveRef.current = active; }} />}
          {showPresets && (
            <div className="archive-search-presets dropdown-animate" id={presetMenuId}>
              <div className="archive-search-preset-heading">
                <span>已保存的筛选方案</span>
                <button type="button" className="btn" onClick={savePreset}>+ 保存当前筛选</button>
              </div>
              {presets.length > 0 ? <div className="archive-search-preset-list">{presets.map(preset => (
                <div key={preset.name} className="archive-search-preset-row">
                  <button className="archive-search-preset-apply" type="button" onClick={() => { setQuery(preset.query || ''); setShowPresets(false); }} title={preset.query || preset.name}>
                    {preset.name}
                  </button>
                  <button className="archive-search-preset-edit" type="button" aria-label={`编辑 ${preset.name}`} aria-expanded={editingPreset === preset.name} onClick={() => setEditingPreset(current => current === preset.name ? '' : preset.name)}>
                    <ToolbarGlyph name="edit" size={16} />
                  </button>
                  {editingPreset === preset.name && (
                    <div className="archive-search-preset-actions dropdown-animate">
                      <button type="button" onClick={() => { setNameDialog({ mode: 'rename', value: preset.name }); setEditingPreset(''); }}>重命名</button>
                      <button type="button" className="is-danger" onClick={() => { setDeleteTarget(preset.name); setEditingPreset(''); }}>删除</button>
                    </div>
                  )}
                </div>
              ))}</div> : (
                <div className="archive-search-empty">暂无预设。设置筛选条件后点击「保存当前筛选」。</div>
              )}
            </div>
          )}
        </div>
        <button type="button" className="btn archive-search-submit" onClick={() => searchBoxRef.current?.querySelector('input')?.blur()}>
          筛选
        </button>
      </div>
      <TextInputDialog
        open={!!nameDialog}
        title={nameDialog?.mode === 'rename' ? '重命名筛选方案' : '为当前筛选方案命名'}
        initialValue={nameDialog?.value || ''}
        onCancel={() => setNameDialog(null)}
        onConfirm={(name) => {
          setPresets(nameDialog?.mode === 'rename'
            ? renameFilterPreset(nameDialog.value, name)
            : saveFilterPreset({ name, query }));
          setNameDialog(null);
        }}
      />
      <ConfirmDialog open={!!deleteTarget} title="删除筛选方案" message={`将删除“${deleteTarget}”。`} confirmLabel="删除" cancelLabel="取消" onCancel={() => setDeleteTarget('')} onConfirm={() => { setPresets(deleteFilterPreset(deleteTarget)); setDeleteTarget(''); }} />
    </div>
  );
}
