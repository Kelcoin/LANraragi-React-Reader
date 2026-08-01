import React, { useState } from 'react';

export default function SecretInput({
  value,
  onChange,
  name,
  id,
  ariaLabel,
  placeholder,
  autoComplete = 'off',
  spellCheck = false,
  style,
  className = '',
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className={`secret-input-shell${className ? ` ${className}` : ''}`}>
      <input
        type={revealed ? 'text' : 'password'}
        id={id}
        name={name}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        aria-label={ariaLabel}
        className="input-glass secret-input"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{ padding: '8px 12px', fontSize: '13px', ...style }}
        onFocus={() => setRevealed(true)}
        onBlur={() => setRevealed(false)}
      />
    </span>
  );
}
