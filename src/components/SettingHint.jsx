import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function SettingHint({ text, children, className = 'settings-row-title' }) {
  const wrapRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const updatePosition = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxWidth = Math.min(320, Math.max(0, window.innerWidth - 48));
    const left = Math.min(Math.max(24, rect.left), Math.max(24, window.innerWidth - maxWidth - 24));
    setPosition({ left, bottom: Math.max(16, window.innerHeight - rect.top + 8) });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const handleViewportChange = () => updatePosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updatePosition]);

  return (
    <span
      ref={wrapRef}
      className="settings-hint-wrap"
      tabIndex={0}
      onMouseEnter={() => { setOpen(true); updatePosition(); }}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => { setOpen(true); updatePosition(); }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span className={className}>{children}</span>
      {text && open && position && createPortal(
        <span className="settings-hint-bubble settings-hint-bubble-portal is-visible" role="tooltip" style={position}>{text}</span>,
        document.body,
      )}
    </span>
  );
}
