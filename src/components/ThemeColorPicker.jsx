import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hexToHsl, hexToRgb, hslToHex, parseHexColor } from '../lib/color';
import { ToolbarGlyph } from './AppGlyphs';

const DEFAULT_HSL = { h: 210, s: 72, l: 54 };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normaliseHsl(value) {
  return {
    h: clamp(Number(value?.h) || 0, 0, 359),
    s: clamp(Number(value?.s) || 0, 0, 100),
    l: clamp(Number(value?.l) || 0, 0, 100),
  };
}

export default function ThemeColorPicker({ label, value, onChange }) {
  const validValue = parseHexColor(value) || '#4a9ff0';
  const [isOpen, setIsOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(validValue);
  const [hsl, setHsl] = useState(() => hexToHsl(validValue) || DEFAULT_HSL);
  const [invalid, setInvalid] = useState(false);
  const [eyeDropperMessage, setEyeDropperMessage] = useState('');
  const pickerRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const saturationRef = useRef(null);
  const draggingRef = useRef(false);
  const [popoverPosition, setPopoverPosition] = useState(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!pickerRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen]);

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') return;
    const triggerBounds = trigger.getBoundingClientRect();
    const viewportPadding = 16;
    const gap = 8;
    const popoverHeight = popoverRef.current?.getBoundingClientRect().height || 290;
    const popoverWidth = Math.min(320, Math.max(0, window.innerWidth - (viewportPadding * 2)));
    const belowTop = triggerBounds.bottom + gap;
    const aboveTop = triggerBounds.top - gap - popoverHeight;
    const fitsBelow = belowTop + popoverHeight <= window.innerHeight - viewportPadding;
    const fitsAbove = aboveTop >= viewportPadding;
    const opensAbove = !fitsBelow && fitsAbove;
    const maxTop = Math.max(viewportPadding, window.innerHeight - popoverHeight - viewportPadding);
    const top = opensAbove ? aboveTop : Math.min(Math.max(belowTop, viewportPadding), maxTop);
    const maxLeft = Math.max(viewportPadding, window.innerWidth - popoverWidth - viewportPadding);
    const left = clamp(triggerBounds.right - popoverWidth, viewportPadding, maxLeft);
    setPopoverPosition({ top, left, placement: opensAbove ? 'above' : 'below' });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverPosition(null);
      return undefined;
    }
    let frame = 0;
    const schedulePosition = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        updatePopoverPosition();
      });
    };
    schedulePosition();
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('scroll', schedulePosition, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedulePosition);
      window.removeEventListener('scroll', schedulePosition, true);
    };
  }, [eyeDropperMessage, invalid, isOpen, updatePopoverPosition]);

  useEffect(() => {
    const next = parseHexColor(value);
    if (!next) return;
    setHexDraft(next);
    setHsl(hexToHsl(next) || DEFAULT_HSL);
    setInvalid(false);
  }, [value]);

  const emitHsl = useCallback((nextHsl) => {
    const next = normaliseHsl(nextHsl);
    const nextHex = hslToHex(next);
    setHsl(next);
    setHexDraft(nextHex);
    setInvalid(false);
    onChange?.(nextHex);
  }, [onChange]);

  const updateSaturationLightness = useCallback((event) => {
    const bounds = saturationRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    const saturation = clamp(((event.clientX - bounds.left) / bounds.width) * 100, 0, 100);
    const lightness = clamp(100 - ((event.clientY - bounds.top) / bounds.height) * 100, 0, 100);
    emitHsl({ ...hsl, s: saturation, l: lightness });
  }, [emitHsl, hsl]);

  const handleSaturationPointerDown = (event) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateSaturationLightness(event);
  };

  const handleHexCommit = () => {
    const next = parseHexColor(hexDraft);
    if (!next) {
      setInvalid(true);
      return;
    }
    setHexDraft(next);
    setHsl(hexToHsl(next) || DEFAULT_HSL);
    setInvalid(false);
    onChange?.(next);
  };

  const rgb = useMemo(() => hexToRgb(hexDraft) || hexToRgb(validValue), [hexDraft, validValue]);
  const hueBackground = 'linear-gradient(90deg, #ff0000 0%, #ffff00 16.6%, #00ff00 33.3%, #00ffff 50%, #0000ff 66.6%, #ff00ff 83.3%, #ff0000 100%)';
  const saturationBackground = `linear-gradient(to top, #000000 0%, transparent 100%), linear-gradient(to right, #ffffff 0%, hsl(${hsl.h} 100% 50%) 100%)`;

  const handleEyeDropper = async () => {
    if (typeof window === 'undefined' || typeof window.EyeDropper !== 'function') {
      setEyeDropperMessage('当前浏览器不支持吸管');
      return;
    }
    try {
      const result = await new window.EyeDropper().open();
      const next = parseHexColor(result?.sRGBHex);
      if (next) {
        setHexDraft(next);
        setHsl(hexToHsl(next) || DEFAULT_HSL);
        setInvalid(false);
        onChange?.(next);
      }
    } catch {
      setEyeDropperMessage('已取消取色');
    }
  };

  return (
    <div
      ref={pickerRef}
      className={`theme-color-picker${isOpen ? ' is-open' : ''}`}
      data-theme-color-picker
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
      }}
    >
      <div className="theme-color-picker-head">
        <span className="theme-color-picker-label">{label}</span>
        <button
          type="button"
          ref={triggerRef}
          className="btn btn-secondary btn-icon theme-color-picker-trigger"
          aria-label={`${label}当前颜色，点击编辑`}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          onClick={() => setIsOpen((current) => !current)}
        >
          <span className="theme-color-picker-preview" style={{ backgroundColor: hexDraft }} aria-hidden="true" />
        </button>
      </div>
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className="theme-color-picker-popover"
          data-placement={popoverPosition?.placement || 'below'}
          role="dialog"
          aria-label={`${label}颜色编辑`}
          style={{
            top: `${popoverPosition?.top || 0}px`,
            left: `${popoverPosition?.left || 0}px`,
            visibility: popoverPosition ? 'visible' : 'hidden',
          }}
        >
        <div
          ref={saturationRef}
          className="theme-color-picker-saturation"
          role="slider"
          tabIndex={0}
          aria-label={`${label}饱和度和明度`}
          aria-valuetext={`${Math.round(hsl.s)}% 饱和度，${Math.round(hsl.l)}% 明度`}
          style={{ backgroundImage: saturationBackground }}
          onPointerDown={handleSaturationPointerDown}
          onPointerMove={(event) => { if (draggingRef.current) updateSaturationLightness(event); }}
          onPointerUp={() => { draggingRef.current = false; }}
          onPointerCancel={() => { draggingRef.current = false; }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 10 : 2;
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            emitHsl({
              ...hsl,
              s: hsl.s + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
              l: hsl.l + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0),
            });
          }}
        >
          <span className="theme-color-picker-saturation-thumb" style={{ left: `${hsl.s}%`, top: `${100 - hsl.l}%`, background: hexDraft }} />
        </div>
        <div className="theme-color-picker-hue-row">
          <div
            className="theme-color-picker-hue"
            role="slider"
            tabIndex={0}
            aria-label={`${label}色相`}
            aria-valuemin="0"
            aria-valuemax="359"
            aria-valuenow={Math.round(hsl.h)}
            style={{ background: hueBackground }}
            onPointerDown={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const nextHue = clamp(((event.clientX - bounds.left) / bounds.width) * 359, 0, 359);
              emitHsl({ ...hsl, h: nextHue });
            }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
              event.preventDefault();
              emitHsl({ ...hsl, h: hsl.h + (event.key === 'ArrowRight' ? 2 : -2) });
            }}
          >
            <span className="theme-color-picker-hue-thumb" style={{ left: `${(hsl.h / 359) * 100}%` }} />
          </div>
          <button type="button" className="btn btn-quiet btn-icon theme-color-picker-eyedropper" onClick={handleEyeDropper} aria-label={`${label}吸管取色`} title="从屏幕取色">
            <ToolbarGlyph name="eyedropper" size={17} />
          </button>
        </div>
        <div className="theme-color-picker-values">
          <label className={`theme-color-picker-hex${invalid ? ' is-invalid' : ''}`}>
            <span>HEX</span>
            <input
              type="text"
              className={`field theme-color-picker-input${invalid ? ' is-error' : ''}`}
              inputMode="text"
              spellCheck={false}
              value={hexDraft}
              aria-label={`${label}十六进制色值`}
              aria-invalid={invalid}
              onChange={(event) => { setHexDraft(event.target.value); setInvalid(false); }}
              onBlur={handleHexCommit}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleHexCommit(); event.currentTarget.blur(); } }}
            />
          </label>
          <div className="theme-color-picker-rgb" aria-label={`${label} RGB 数值`}>
            {['r', 'g', 'b'].map((channel) => (
              <label key={channel}>
                <span>{channel.toUpperCase()}</span>
                <input className="field theme-color-picker-input" type="text" inputMode="numeric" value={rgb[channel]} readOnly aria-label={`${label} ${channel.toUpperCase()} 值`} />
              </label>
            ))}
          </div>
        </div>
        {(invalid || eyeDropperMessage) && <span className="theme-color-picker-error" role="status">{invalid ? '请输入有效的十六进制颜色' : eyeDropperMessage}</span>}
        </div>,
        document.body,
      )}
    </div>
  );
}
