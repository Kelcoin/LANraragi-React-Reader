import React, { useEffect, useId, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

export default function ConfigTransferDialog({ open, mode = 'export', initialValue = '', onCancel, onConfirm }) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const inputId = useId();
  const isExport = mode === 'export';

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError('');
      setCopied(false);
    }
  }, [initialValue, open]);

  const copyValue = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setError('');
    } catch {
      setError('无法访问剪贴板，请手动复制文本。');
    }
  };

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('请粘贴配置文本后再导入。');
      return;
    }
    try {
      await onConfirm(trimmed);
    } catch (err) {
      setError(err?.message || '导入失败，请检查配置文本。');
    }
  };

  return (
    <ConfirmDialog
      open={open}
      title={isExport ? '导出配置' : '导入配置'}
      confirmLabel={isExport ? '关闭' : '导入配置'}
      cancelLabel={isExport ? '关闭' : '取消'}
      showCancel={!isExport}
      destructive={false}
      confirmDisabled={!isExport && !value.trim()}
      initialFocusSelector="[data-config-transfer-input]"
      onCancel={onCancel}
      dismissOnBackdrop={false}
      onConfirm={isExport ? onCancel : submit}
      actionsBefore={isExport ? (
        <button type="button" className="btn btn-secondary" onClick={copyValue}>
          {copied ? '已复制' : '复制'}
        </button>
      ) : null}
    >
      <div className="config-transfer-warning" role="alert">
        警告：请勿分享或导入他人配置！
      </div>
      <label className="config-transfer-field" htmlFor={inputId}>
        配置文本
        <textarea
          id={inputId}
          data-config-transfer-input
          className="field"
          name="config-transfer"
          autoComplete="off"
          spellCheck={false}
          readOnly={isExport}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={isExport ? 8 : 7}
          placeholder="粘贴配置文本…"
        />
      </label>
      {error && <div className="config-transfer-error" role="alert">{error}</div>}
    </ConfirmDialog>
  );
}
