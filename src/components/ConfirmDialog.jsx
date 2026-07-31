import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { acquireBodyScrollLock } from '../lib/bodyScrollLock';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  showCancel = true,
  onConfirm,
  onCancel,
  destructive = true,
  confirmDisabled = false,
  initialFocusSelector = '[data-dialog-cancel]',
  actionsBefore,
  children,
  dismissOnBackdrop = true,
}) {
  const titleId = useId();
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;
    const getFocusable = () => Array.from(dialogRef.current?.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) || []);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel?.();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const releaseScrollLock = acquireBodyScrollLock();
    window.addEventListener('keydown', handleKeyDown);
    const focusFrame = requestAnimationFrame(() => dialogRef.current?.querySelector(initialFocusSelector)?.focus());

    return () => {
      cancelAnimationFrame(focusFrame);
      releaseScrollLock();
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [initialFocusSelector, onCancel, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="confirm-dialog-overlay"
      data-dialog-overlay
      onClick={dismissOnBackdrop ? onCancel : undefined}
    >
      <div
        ref={dialogRef}
        className="glass-panel dropdown-animate confirm-dialog"
        data-dialog-root
        role={destructive ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-title" id={titleId}>
          {title}
        </div>
        {message && (
          <div className="confirm-dialog-message">
            {message}
          </div>
        )}
        {children}
        <div className="confirm-dialog-actions">
          {actionsBefore}
          {showCancel && (
            <button
              type="button"
              className="btn"
              data-dialog-cancel
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={`btn confirm-dialog-confirm${destructive ? ' is-destructive' : ''}`}
            data-dialog-confirm
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
