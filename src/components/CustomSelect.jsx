import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { ToolbarGlyph } from './AppGlyphs';

export default function CustomSelect({ value, options, onChange, style, compact, ariaLabel }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, maxHeight: 250 });

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const gap = 8;
    const viewportGap = 12;
    const below = window.innerHeight - r.bottom - gap - viewportGap;
    const above = r.top - gap - viewportGap;
    const openAbove = below < 180 && above > below;
    const maxHeight = Math.max(120, Math.min(320, openAbove ? above : below));
    setPos({ top: openAbove ? Math.max(viewportGap, r.top - gap - maxHeight) : r.bottom + gap, left: Math.max(viewportGap, Math.min(r.left, window.innerWidth - r.width - viewportGap)), width: r.width, maxHeight });
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && containerRef.current.contains(e.target)) return;
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  const selectedOption = options.find(opt => opt.value === value);
  const selectedIndex = options.findIndex(opt => opt.value === value);
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 480;

  const selectOption = useCallback((nextValue) => {
    onChange(nextValue);
    setIsOpen(false);
  }, [onChange]);

  const openDropdown = useCallback(() => {
    if (!isOpen && triggerRef.current) updatePosition();
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : (options.length > 0 ? 0 : -1));
    setIsOpen(true);
  }, [isOpen, options.length, selectedIndex, updatePosition]);

  useEffect(() => {
    if (!isOpen) setActiveIndex(selectedIndex);
  }, [isOpen, selectedIndex]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', minWidth: compact ? (isNarrow ? '80px' : '100px') : '150px', ...style }}>
      <div 
        ref={triggerRef}
        className="input-glass"
        role="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        tabIndex={0}
        style={{ 
          cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
          userSelect: 'none',
          padding: compact && isNarrow ? '6px 8px' : undefined,
          background: isOpen ? 'var(--accent-soft)' : undefined,
          borderColor: isOpen ? 'var(--accent)' : undefined
        }}
        onClick={() => {
            if (isOpen) setIsOpen(false);
            else openDropdown();
          }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setIsOpen(false);
            return;
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!isOpen) {
              openDropdown();
              return;
            }
            if (options.length === 0) return;
            setActiveIndex((previous) => {
              const next = e.key === 'ArrowDown' ? previous + 1 : previous - 1;
              return (next + options.length) % options.length;
            });
            return;
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!isOpen) openDropdown();
            else if (activeIndex >= 0 && options[activeIndex]) selectOption(options[activeIndex].value);
          }
        }}
      >
        <span style={{ flex: 1, minWidth: 0, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selectedOption ? selectedOption.label : '请选择…'}
        </span>
        <span className="custom-select-chevron" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s', fontSize: '10px', color: 'var(--text-sub)', flexShrink: 0 }}>▼</span>
      </div>

      {isOpen && createPortal(
        <div ref={dropdownRef} id={listboxId} className="glass-panel dropdown-animate" data-select-dropdown="true" role="listbox" aria-label={ariaLabel} style={{
          position: 'fixed', top: pos.top, left: pos.left, width: pos.width || 'auto',
          zIndex: 100100, padding: '8px 0', maxHeight: pos.maxHeight, overflowY: 'auto',
          overscrollBehavior: 'contain', touchAction: 'pan-y',
          boxShadow: '0 18px 52px rgba(0,0,0,0.46)',
          background: 'var(--dropdown-bg)'
        }}>
          {options.map((opt, index) => (
            <div
              key={opt.value}
              className="custom-select-option"
              data-selected={opt.value === value}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={opt.value === value}
              style={{
                minHeight: '40px', padding: '0 12px', margin: '3px 8px', borderRadius: '9px', cursor: 'pointer', fontSize: '14px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: index === activeIndex || opt.value === value ? 'var(--accent-soft)' : 'transparent',
                color: opt.value === value ? 'var(--accent-strong)' : 'var(--text-main)',
                transition: 'background 0.2s'
              }}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(opt.value)}
            >
              <span>{opt.label}</span>
              {opt.value === value && <ToolbarGlyph name="check" size={15} color="var(--accent-strong)" />}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
