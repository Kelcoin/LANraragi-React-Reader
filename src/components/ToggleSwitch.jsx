import React from 'react';

export default function ToggleSwitch({ checked, onChange, disabled = false, label }) {
  return <button type="button" className={`toggle-switch-track${checked ? ' is-checked' : ''}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} style={{
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1,
    justifyContent: checked ? 'flex-end' : 'flex-start',
  }}><span className="toggle-switch-thumb" /></button>;
}
