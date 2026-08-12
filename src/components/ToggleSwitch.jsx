import React from 'react';

export default function ToggleSwitch({ checked, onChange, disabled = false, label }) {
  return <button type="button" className={`toggle-switch-track${checked ? ' is-checked' : ''}${disabled ? ' is-disabled' : ''}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span className="toggle-switch-thumb" /></button>;
}
