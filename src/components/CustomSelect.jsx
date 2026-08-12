import React from 'react';
import { Select } from '@base-ui/react/select';
import { ToolbarGlyph } from './AppGlyphs';
import SettingHint from './SettingHint';

export default function CustomSelect({ value, options, onChange, style, compact, ariaLabel, disabled = false }) {
  const selectedOption = options.find((option) => option.value === value);

  return (
    <div
      className={`custom-select-root${compact ? ' is-compact' : ''}${disabled ? ' is-disabled' : ''}`}
      style={style}
    >
      <Select.Root
        value={value}
        items={options}
        disabled={disabled}
        onValueChange={(nextValue) => { if (nextValue !== null) onChange(nextValue); }}
      >
        <Select.Trigger className="input-glass custom-select-trigger" aria-label={ariaLabel}>
          <Select.Value className="custom-select-value" placeholder="请选择…">
            {selectedOption?.label || '请选择…'}
          </Select.Value>
          <Select.Icon className="custom-select-chevron" aria-hidden="true">▼</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner
            className="custom-select-positioner"
            sideOffset={8}
            align="start"
            alignItemWithTrigger={false}
            positionMethod="fixed"
            collisionPadding={12}
          >
            <Select.Popup className="glass-panel dropdown-animate custom-select-popup" data-select-dropdown="true">
              <Select.List className="custom-select-list">
                {options.map((option) => (
                  <Select.Item key={option.value} value={option.value} className="custom-select-option">
                    <Select.ItemText className="custom-select-option-text">
                      {option.description ? (
                        <SettingHint text={option.description} className="custom-select-option-label">{option.label}</SettingHint>
                      ) : <span>{option.label}</span>}
                    </Select.ItemText>
                    <Select.ItemIndicator className="custom-select-check">
                      <ToolbarGlyph name="check" size={15} />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
