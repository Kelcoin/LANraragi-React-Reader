import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ToastProvider } from './components/Toast';
import { installDiagnostics } from './lib/diagnostics';
import { markPwaUpdateReload } from './lib/sessionState';
import '@fontsource-variable/noto-sans-sc/wght.css';
import '@fontsource-variable/noto-sans-jp/wght.css';
import './index.css';

installDiagnostics();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const hadControllerBeforeRegistration = !!navigator.serviceWorker.controller;
    let hasControlledPage = hadControllerBeforeRegistration;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hasControlledPage) {
        hasControlledPage = true;
        return;
      }
      if (refreshing) return;
      refreshing = true;
      markPwaUpdateReload();
      window.location.reload();
    });

    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__APP_BUILD_ID__)}`, { updateViaCache: 'none' })
      .then((registration) => {
        let lastUpdateCheck = 0;
        const notifyUpdateReady = (worker) => {
          if (!worker || !navigator.serviceWorker.controller) return;
          window.dispatchEvent(new CustomEvent('lrr:pwa-update-ready', { detail: { worker } }));
        };

        const checkForUpdate = () => {
          const now = Date.now();
          if (now - lastUpdateCheck < 30 * 60 * 1000) return;
          lastUpdateCheck = now;
          registration.update().catch(() => {});
        };

        checkForUpdate();
        window.addEventListener('focus', checkForUpdate);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });

        if (registration.waiting) {
          notifyUpdateReady(registration.waiting);
        }

        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              notifyUpdateReady(worker);
            }
            if (worker.state === 'activated') {
              console.log('[SW] 已激活新版缓存策略');
            }
          });
        });
      })
      .catch(() => {});
  });
}
