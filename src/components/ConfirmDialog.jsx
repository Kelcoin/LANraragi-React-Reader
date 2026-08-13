import React, { useId, useRef } from 'react';
import { Dialog } from '@base-ui/react/dialog';

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

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) onCancel?.(); }}
      disablePointerDismissal={!dismissOnBackdrop}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="confirm-dialog-overlay" data-dialog-overlay />
        <Dialog.Popup
          ref={dialogRef}
          className="dialog dropdown-animate confirm-dialog"
          data-dialog-root
          role={destructive ? 'alertdialog' : 'dialog'}
          aria-labelledby={titleId}
          initialFocus={() => dialogRef.current?.querySelector(initialFocusSelector) || true}
        >
          <Dialog.Title className="confirm-dialog-title" id={titleId}>
            {title}
          </Dialog.Title>
          {message && <Dialog.Description className="confirm-dialog-message">{message}</Dialog.Description>}
          {children}
          <div className="confirm-dialog-actions">
            {actionsBefore}
            {showCancel && (
              <Dialog.Close
                className="btn btn-secondary"
                data-dialog-cancel
              >
                {cancelLabel}
              </Dialog.Close>
            )}
            <button
              type="button"
              className={`btn ${destructive ? 'btn-danger' : 'btn-primary'} confirm-dialog-confirm${destructive ? ' is-destructive' : ''}`}
              data-dialog-confirm
              onClick={onConfirm}
              disabled={confirmDisabled}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
