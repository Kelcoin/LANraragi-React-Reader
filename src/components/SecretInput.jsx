import React, { useState } from 'react';

const MASK_CHAR = '•';

function maskValue(value) {
  const length = String(value || '').length;
  if (length === 0) return '';
  return MASK_CHAR.repeat(Math.min(length, 24));
}

export default function SecretInput({
  value,
  onChange,
  name,
  id,
  ariaLabel,
  placeholder,
  autoComplete = 'off',
  spellCheck = false,
  required = false,
  style,
  className = '',
}) {
  const [focused, setFocused] = useState(false);
  const shown = focused ? String(value ?? '') : maskValue(value);
  return (
    <span className={`secret-input-shell${className ? ` ${className}` : ''}`}>
      <input
        type="text"
        id={id}
        name={name}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        required={required}
        aria-label={ariaLabel}
        className="input-glass secret-input"
        value={shown}
        onChange={onChange}
        placeholder={placeholder}
        style={{ padding: '8px 12px', fontSize: '13px', ...style }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </span>
  );
}
