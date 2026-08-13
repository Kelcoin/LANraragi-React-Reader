import React, { useEffect, useState } from 'react';
import { ToolbarGlyph } from './AppGlyphs';
import { dismissInstallPrompt, isInstallDismissed, isStandaloneDisplay } from '../lib/pwaInstallState';
import { markPwaUpdateReload } from '../lib/sessionState';

export default function PwaStatus() {
  const [updateWorker, setUpdateWorker] = useState(null);
  const [installEvent, setInstallEvent] = useState(null);
  const [installDismissed, setInstallDismissed] = useState(isInstallDismissed);
  const [connectionMessage, setConnectionMessage] = useState(() => (
    navigator.onLine ? '' : '已离线，可继续打开已缓存页面'
  ));

  useEffect(() => {
    if (isStandaloneDisplay()) return undefined;
    const handleBeforeInstallPrompt = (event) => {
      if (installDismissed) return;
      event.preventDefault();
      setInstallEvent(event);
    };
    const handleInstalled = () => setInstallEvent(null);

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, [installDismissed]);

  useEffect(() => {
    const handleUpdateReady = (event) => {
      const worker = event.detail?.worker;
      if (!worker) return;
      setUpdateWorker(worker);
    };

    window.addEventListener('lrr:pwa-update-ready', handleUpdateReady);
    return () => window.removeEventListener('lrr:pwa-update-ready', handleUpdateReady);
  }, []);

  useEffect(() => {
    if (!updateWorker) return undefined;
    const applyTimer = setTimeout(() => {
      updateWorker.postMessage({ type: 'SKIP_WAITING' });
    }, 900);
    const reloadTimer = setTimeout(() => {
      markPwaUpdateReload();
      window.location.reload();
    }, 8000);
    return () => {
      clearTimeout(applyTimer);
      clearTimeout(reloadTimer);
    };
  }, [updateWorker]);

  useEffect(() => {
    let clearTimer = null;

    const clearLater = () => {
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => setConnectionMessage(''), 2600);
    };

    const handleOffline = () => {
      setConnectionMessage('已离线，可继续打开已缓存页面');
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = null;
    };
    const handleOnline = () => {
      setConnectionMessage('连接已恢复');
      clearLater();
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, []);

  const primary = updateWorker
    ? { message: '新版本已就绪，即将刷新以应用。' }
    : connectionMessage
      ? { message: connectionMessage }
      : null;
  const showInstall = !primary && !!installEvent && !installDismissed;

  const handleInstall = async () => {
    if (!installEvent) return;
    const event = installEvent;
    setInstallEvent(null);
    try {
      await event.prompt();
      await event.userChoice;
    } catch {}
  };

  const handleDismissInstall = () => {
    dismissInstallPrompt();
    setInstallDismissed(true);
    setInstallEvent(null);
  };

  if (!primary && !showInstall) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pwa-status"
    >
      <div
        className="surface pwa-status-card"
      >
        <span className="pwa-status-message">
          {primary?.message || '安装 Readoshi，获得独立应用体验。'}
        </span>
        {showInstall && (
          <div className="pwa-status-actions">
            <button type="button" className="btn btn-primary pwa-status-install" onClick={handleInstall}>安装应用</button>
            <button
              type="button"
              className="btn btn-icon btn-quiet pwa-status-dismiss"
              onClick={handleDismissInstall}
              aria-label="关闭安装提示"
              title="关闭"
            >
              <ToolbarGlyph name="close" size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
