import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ToolbarGlyph } from './AppGlyphs';

const TOAST_DURATION_MS = 3600;
const TOAST_ERROR_DURATION_MS = 7000;
const TOAST_CLOSE_MS = 280;

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());
  const idRef = useRef(0);

  const clearToastTimer = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
  }, []);

  const closeToast = useCallback((id) => {
    clearToastTimer(id);
    setToasts((current) => current.map((toast) => (
      toast.id === id ? { ...toast, closing: true } : toast
    )));
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, TOAST_CLOSE_MS);
    timersRef.current.set(id, timer);
  }, [clearToastTimer]);

  const showToast = useCallback((text, type = 'info', { autoHide = true, duration } = {}) => {
    const message = String(text ?? '').trim();
    if (!message) return null;
    idRef.current += 1;
    const id = idRef.current;
    const toastDuration = duration ?? (type === 'error' ? TOAST_ERROR_DURATION_MS : TOAST_DURATION_MS);
    setToasts((current) => [...current, { id, text: message, type, closing: false, autoHide, duration: toastDuration }]);
    if (autoHide) {
      const timer = setTimeout(() => closeToast(id), toastDuration);
      timersRef.current.set(id, timer);
    }
    return id;
  }, [closeToast]);

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
  }, []);

  const value = useMemo(() => ({ showToast, closeToast }), [closeToast, showToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-card is-${toast.type}${toast.closing ? ' is-closing' : ''}`}
            role={toast.type === 'error' ? 'alert' : 'status'}
            style={{ '--toast-duration': `${toast.duration}ms` }}
          >
            <span className="toast-icon" aria-hidden="true">{toast.type === 'success' ? '✓' : toast.type === 'error' ? '!' : 'i'}</span>
            <span className="toast-text">{toast.text}</span>
            <button type="button" className="toast-close" aria-label="关闭提示" onClick={() => closeToast(toast.id)}><ToolbarGlyph name="close" size={15} /></button>
            {toast.autoHide && <span className="toast-progress" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
