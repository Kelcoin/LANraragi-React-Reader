import React, { useEffect, useId, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

export default function TextInputDialog({ open, title, initialValue = '', confirmLabel = '保存', onCancel, onConfirm }) {
  const [value, setValue] = useState(initialValue);
  const inputId = useId();

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [initialValue, open]);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <ConfirmDialog
      open={open}
      title={title}
      destructive={false}
      confirmLabel={confirmLabel}
      cancelLabel="取消"
      confirmDisabled={!value.trim()}
      initialFocusSelector="[data-dialog-text-input]"
      onCancel={onCancel}
      onConfirm={submit}
    >
      <label className="dialog-text-field" htmlFor={inputId}>
        名称
        <input
          id={inputId}
          data-dialog-text-input
          className="field"
          name="filter-preset-name"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </label>
    </ConfirmDialog>
  );
}
