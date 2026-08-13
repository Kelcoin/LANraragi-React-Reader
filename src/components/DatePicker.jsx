import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CustomSelect from './CustomSelect';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function resolveCalendarPopoverPosition(triggerRect, panelRect, viewport) {
  const gap = 8;
  const margin = 10;
  const width = panelRect.width || 304;
  const height = panelRect.height || 350;
  const left = Math.min(
    Math.max(margin, triggerRect.right - width),
    Math.max(margin, viewport.width - width - margin),
  );
  const below = triggerRect.bottom + gap;
  const top = below + height <= viewport.height - margin
    ? below
    : Math.max(margin, triggerRect.top - height - gap);
  return { left, top };
}

function monthDays(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(1 - startOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export default function DatePicker({ value, disabled = false, onChange, ariaLabel }) {
  const selected = useMemo(() => parseDate(value), [value]);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => selected || new Date());
  const [position, setPosition] = useState({ left: 10, top: 10 });
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (selected) setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [selected]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = (event) => {
      if (event?.target?.closest?.('[data-select-dropdown="true"]')) return;
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (!triggerRect) return;
      const panelRect = panelRef.current?.getBoundingClientRect() || { width: 304, height: 350 };
      setPosition(resolveCalendarPopoverPosition(triggerRect, panelRect, {
        width: window.innerWidth,
        height: window.innerHeight,
      }));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, month]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.target.closest?.('[data-select-dropdown="true"]')) return;
      if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const days = monthDays(month);
  const years = useMemo(() => Array.from(
    { length: new Date().getFullYear() - 1999 },
    (_, index) => 2000 + index,
  ).reverse(), []);
  const yearOptions = useMemo(() => years.map((year) => ({ value: year, label: `${year}年` })), [years]);
  const monthOptions = useMemo(() => Array.from(
    { length: 12 },
    (_, index) => ({ value: index, label: `${index + 1}月` }),
  ), []);
  const choose = (date) => {
    onChange?.(formatDate(date));
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-secondary date-picker-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((visible) => !visible)}
      >
        <span>{value ? value.replaceAll('-', '/') : '选择日期'}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v3M17 2v3M3.5 8.5h17M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /></svg>
      </button>
      {open && createPortal(
        <div ref={panelRef} className="popover date-picker-popover dropdown-animate" style={{ left: position.left, top: position.top }}>
          <div className="date-picker-header">
            <button type="button" className="date-picker-nav" aria-label="上个月" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>‹</button>
            <div className="date-picker-jump">
              <CustomSelect
                ariaLabel="年份"
                value={month.getFullYear()}
                options={yearOptions}
                onChange={(year) => setMonth((current) => new Date(year, current.getMonth(), 1))}
                compact
                style={{ width: '126px', minWidth: '126px' }}
              />
              <CustomSelect
                ariaLabel="月份"
                value={month.getMonth()}
                options={monthOptions}
                onChange={(nextMonth) => setMonth((current) => new Date(current.getFullYear(), nextMonth, 1))}
                compact
                style={{ width: '100px', minWidth: '100px' }}
              />
            </div>
            <button type="button" className="date-picker-nav" aria-label="下个月" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>›</button>
          </div>
          <div className="date-picker-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="date-picker-days">
            {days.map((date) => {
              const dateValue = formatDate(date);
              const outside = date.getMonth() !== month.getMonth();
              return (
                <button
                  key={dateValue}
                  type="button"
                  className={`${outside ? 'is-outside' : ''}${dateValue === value ? ' is-selected' : ''}`}
                  onClick={() => choose(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="date-picker-footer">
            <button type="button" onClick={() => { onChange?.(''); setOpen(false); }}>清除</button>
            <button type="button" onClick={() => choose(new Date())}>今天</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
