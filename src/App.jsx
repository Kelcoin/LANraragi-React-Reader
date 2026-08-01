import React, { lazy, Suspense, useState, useEffect } from 'react';
import { loadTagDB } from './lib/tags';
import { checkServerStatus } from './lib/api';
import { canNavigate, navigateHome, navigateToArchive, parseRouteFromLocation } from './lib/navigation';
import { startHistoryExistenceCheckTimer, stopHistoryExistenceCheckTimer } from './lib/historyMaintenance';
import { getWorkerUrl, setWorkerUrl, getSyncToken, setSyncToken, importConfig } from './lib/worker-config';
import { applyThemeMode, getNextThemeMode, readStoredThemeMode, readStoredThemePalettes, watchSystemTheme, writeStoredThemeMode, writeStoredThemePalettes } from './lib/theme';
import PwaStatus from './components/PwaStatus';
import SecretInput from './components/SecretInput';
import AppVersion from './components/AppVersion';
import ConfigTransferDialog from './components/ConfigTransferDialog';
import { cacheServerInfo } from './lib/serverInfoCache';
import { resolveInitialRoute } from './lib/sessionState';
import './index.css';

const Reader = lazy(() => import('./pages/Reader'));
const Home = lazy(() => import('./pages/Home'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const WatchlistPage = lazy(() => import('./pages/WatchlistPage'));
const DeduplicatePage = lazy(() => import('./pages/DeduplicatePage'));
const MetadataPage = lazy(() => import('./pages/MetadataPage'));
const UploadPage = lazy(() => import('./pages/UploadPage'));

function AppRouteFallback() {
  return <div className="metadata-loading-state" role="status">正在加载页面…</div>;
}

export default function App() {
  const [route, setRoute] = useState(() => resolveInitialRoute(parseRouteFromLocation()));
  const [themePalettes, setThemePalettes] = useState(readStoredThemePalettes);
  const [themeMode, setThemeMode] = useState(() => {
    const mode = readStoredThemeMode();
    applyThemeMode(mode, { palettes: readStoredThemePalettes() });
    return mode;
  });
  
  const [savedConfig, setSavedConfig] = useState({
    url: localStorage.getItem('lrr_server_url') || '',
    key: localStorage.getItem('lrr_api_key') || ''
  });

  const [tempConfig, setTempConfig] = useState({
    url: savedConfig.url,
    key: savedConfig.key,
    workerUrl: getWorkerUrl(),
    syncToken: getSyncToken(),
  });

  const [loginNotice, setLoginNotice] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [workerCollapsed, setWorkerCollapsed] = useState(true);
  const [configTransfer, setConfigTransfer] = useState(null);

  useEffect(() => {
    if (loginNotice?.type !== 'success') return undefined;
    const timer = setTimeout(() => setLoginNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [loginNotice]);
  
  useEffect(() => {
    const run = () => loadTagDB();
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 1500 });
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(run, 250);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    applyThemeMode(themeMode, { palettes: themePalettes });
    writeStoredThemeMode(themeMode);
    return watchSystemTheme(() => {
      if (themeMode === 'auto') applyThemeMode(themeMode, { palettes: themePalettes });
    });
  }, [themeMode, themePalettes]);

  const handleThemeModeChange = () => {
    setThemeMode((mode) => getNextThemeMode(mode));
  };

  const handleThemePalettesChange = (palettes) => {
    const normalized = writeStoredThemePalettes(palettes);
    setThemePalettes(normalized);
    applyThemeMode(themeMode, { palettes: normalized });
  };

  useEffect(() => {
    const applyRoute = (route) => {
      setRoute(route);
    };

    const handleNavigate = (event) => {
      applyRoute(event.detail || parseRouteFromLocation());
    };
    const handlePopState = () => {
      const next = parseRouteFromLocation();
      if (!canNavigate(next)) {
        window.history.go(1);
        return;
      }
      applyRoute(next);
    };

    window.addEventListener('lrr:navigate', handleNavigate);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('lrr:navigate', handleNavigate);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!savedConfig.url || !savedConfig.key) return undefined;
    startHistoryExistenceCheckTimer();
    return () => stopHistoryExistenceCheckTimer();
  }, [savedConfig.url, savedConfig.key]);

  const handleConnect = async (e) => {
    e.preventDefault();
    setLoginNotice(null);
    setLoginLoading(true);
    try {
      const serverInfo = await checkServerStatus(tempConfig.url, tempConfig.key);
      localStorage.setItem('lrr_server_url', tempConfig.url);
      localStorage.setItem('lrr_api_key', tempConfig.key);
      cacheServerInfo(serverInfo);
      setWorkerUrl(tempConfig.workerUrl);
      setSyncToken(tempConfig.syncToken);
      setSavedConfig({ url: tempConfig.url, key: tempConfig.key });
    } catch (err) {
      setLoginNotice({ type: 'error', text: err.message || '无法连接到服务器，请检查 LANraragi 地址和 LANraragi API Key 是否正确，以及 LANraragi 服务是否在运行' });
    } finally {
      setLoginLoading(false);
    }
  };

  const handleImportConfig = async () => {
    let encoded = '';
    try { encoded = await navigator.clipboard.readText(); } catch {}
    setConfigTransfer({ mode: 'import', value: encoded });
  };

  const handleConfirmImportConfig = async (encoded) => {
    const count = importConfig(encoded);
    const next = {
      url: localStorage.getItem('lrr_server_url') || '',
      key: localStorage.getItem('lrr_api_key') || '',
      workerUrl: getWorkerUrl(),
      syncToken: getSyncToken(),
    };
    setTempConfig(next);
    const nextThemeMode = readStoredThemeMode();
    const nextThemePalettes = readStoredThemePalettes();
    applyThemeMode(nextThemeMode, { palettes: nextThemePalettes });
    setThemeMode(nextThemeMode);
    setThemePalettes(nextThemePalettes);
    setConfigTransfer(null);
    setLoginNotice({ type: 'success', text: `已导入 ${count} 项配置` });
  };

  if (!savedConfig.url || !savedConfig.key) {
    return (
      <>
        <div className="login-shell">
          <div className="login-stack">

          <form onSubmit={handleConnect} className={`glass-panel login-card${workerCollapsed ? ' is-worker-collapsed' : ''}`}>
            <button type="button" className="login-import-button" onClick={handleImportConfig} aria-label="导入配置" title="导入配置">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12" />
                <path d="m8 11 4 4 4-4" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
            </button>
            <div className="login-brand-lockup">
              <span className="login-brand-logo" aria-hidden="true" />
              <h2 className="login-title">Readoshi</h2>
            </div>
            
            <div>
              <label className="field-label" htmlFor="server-url">LANraragi 地址 *</label>
              <input id="server-url" name="server-url" type="url" inputMode="url" autoComplete="url" spellCheck={false} className="input-glass" value={tempConfig.url} onChange={e => setTempConfig({...tempConfig, url: e.target.value})} required />
            </div>
            
            <div>
              <label className="field-label" htmlFor="api-key">LANraragi API Key *</label>
              <input id="api-key" name="api-key" type="password" autoComplete="off" spellCheck={false} className="input-glass" value={tempConfig.key} onChange={e => setTempConfig({...tempConfig, key: e.target.value})} required />
            </div>

            <div className="login-worker-section-content">
              <div className="login-worker-heading">
                <span>Worker 设置</span>
                <button
                  type="button"
                  className="login-collapse-button"
                  onClick={() => setWorkerCollapsed(value => !value)}
                  aria-expanded={!workerCollapsed}
                  aria-controls="login-worker-fields"
                  aria-label={workerCollapsed ? '展开 Worker 设置' : '收起 Worker 设置'}
                >
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
                    <path d="M6 15l6-6 6 6z" />
                  </svg>
                </button>
              </div>
              <div id="login-worker-fields" className={`login-worker-fields${workerCollapsed ? ' is-collapsed' : ''}`}>
                <div>
                  <label className="field-label" htmlFor="worker-url">Cloudflare Worker 端点</label>
                  <input id="worker-url" name="worker-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} className="input-glass" value={tempConfig.workerUrl} onChange={e => setTempConfig({...tempConfig, workerUrl: e.target.value})} />
                </div>
                <div>
                  <label className="field-label" htmlFor="sync-token">访问 Token</label>
                  <SecretInput
                    id="sync-token"
                    name="sync-token"
                    ariaLabel="访问 Token"
                    value={tempConfig.syncToken}
                    onChange={e => setTempConfig({...tempConfig, syncToken: e.target.value})}
                  />
                </div>
              </div>
            </div>

            <button type="submit" className="btn" style={{ marginTop: '8px', padding: '12px', background: 'var(--accent)', borderColor: 'var(--accent-strong)', color: 'var(--accent-contrast)' }} disabled={loginLoading}>
              {loginLoading ? '正在验证连接…' : '开始阅读'}
            </button>

          </form>
          {loginNotice && (
            <div className="login-stack-notice">
              <div className={`login-notice is-${loginNotice.type}`} role={loginNotice.type === 'error' ? 'alert' : 'status'}>
                {loginNotice.text}
              </div>
            </div>
          )}
          <AppVersion />
          </div>
        </div>
        <PwaStatus />
        <ConfigTransferDialog
          open={!!configTransfer}
          mode={configTransfer?.mode}
          initialValue={configTransfer?.value}
          onCancel={() => setConfigTransfer(null)}
          onConfirm={handleConfirmImportConfig}
        />
      </>
    );
  }

  let routeContent;
  if (route.kind === 'reader') {
    routeContent = <Reader key={route.archiveId} archiveId={route.archiveId} onBack={() => navigateHome()} />;
  } else if (route.kind === 'metadata') {
    routeContent = <MetadataPage archiveId={route.archiveId} />;
  } else if (route.kind === 'history') {
    routeContent = <HistoryPage onSelectArchive={(id) => navigateToArchive(id)} onBack={() => navigateHome()} />;
  } else if (route.kind === 'watchlist') {
    routeContent = <WatchlistPage onSelectArchive={(id) => navigateToArchive(id)} onBack={() => navigateHome()} />;
  } else if (route.kind === 'dedupe') {
    routeContent = <DeduplicatePage onBack={() => navigateHome()} />;
  } else if (route.kind === 'upload') {
    routeContent = <UploadPage />;
  } else {
    routeContent = <Home onSelectArchive={(id) => {
        navigateToArchive(id);
      }} onLogout={() => {
        setSavedConfig({ url: '', key: '' });
        setTempConfig({
          url: localStorage.getItem('lrr_server_url') || '',
          key: localStorage.getItem('lrr_api_key') || '',
          workerUrl: getWorkerUrl(),
          syncToken: getSyncToken(),
        });
        navigateHome({ replace: true });
        }} themeMode={themeMode} onThemeModeChange={handleThemeModeChange} themePalettes={themePalettes} onThemePalettesChange={handleThemePalettesChange} />;
  }

  return (
    <>
      <Suspense fallback={<AppRouteFallback />}>
        {routeContent}
      </Suspense>
      <PwaStatus />
    </>
  );
}
