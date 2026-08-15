/* eslint-env browser */
// ==UserScript==
// @name         Readoshi 超分链路监视器
// @namespace    readoshi
// @version      1.0.0
// @description  手动操作真实 Reader 时抓取超分初始化、推理、图片替换和沉浸状态
// @match        http://localhost:27789/*
// @match        http://127.0.0.1:27789/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const startedAt = Date.now();
  const events = [];
  const pending = new Map();
  const maxEvents = 4000;
  let recording = true;
  let panel;

  const redact = (value) => String(value ?? '')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:api|key|token|cookie|secret|password)[^=]*=)[^&\s]+/gi, '$1[redacted]');
  const classify = (value) => {
    const text = String(value || '');
    if (text.includes('/models/')) return 'model';
    if (text.includes('/api/')) return 'api';
    if (text.startsWith('blob:')) return 'blob';
    if (/\.(?:jpg|jpeg|png|webp|gif|avif)(?:[?#]|$)/i.test(text)) return 'image';
    return text ? 'other' : 'empty';
  };
  const safeError = (error) => ({
    name: redact(error?.name || 'Error'),
    message: redact(error?.message || String(error)),
  });
  const record = (type, data = {}) => {
    if (!recording || events.length >= maxEvents) return;
    events.push({ t: Date.now() - startedAt, type, ...data });
    if (panel) panel.querySelector('[data-count]').textContent = `${events.length} 条`;
  };
  const snapshot = () => {
    const images = [...document.querySelectorAll('img')].map((img, index) => ({
      index,
      pageIndex: img.dataset.pageIndex || '',
      readerUnit: img.dataset.readerUnit || '',
      decodePrecision: img.dataset.decodePrecision || '',
      sourceWidth: Number(img.dataset.sourceWidth) || 0,
      sourceHeight: Number(img.dataset.sourceHeight) || 0,
      naturalWidth: img.naturalWidth || 0,
      naturalHeight: img.naturalHeight || 0,
      visible: Boolean(img.offsetWidth || img.offsetHeight || img.getClientRects().length),
      srcKind: classify(img.currentSrc || img.src),
    })).filter((item) => item.visible || item.pageIndex).slice(0, 30);
    const srButton = [...document.querySelectorAll('button')].find((button) => (
      button.getAttribute('aria-label') === '关闭当前档案超分'
      || button.getAttribute('aria-label') === '为当前档案启用超分'
    ));
    return {
      route: location.search.includes('id=') ? 'reader' : 'home',
      immersive: Boolean(document.querySelector('[data-reader-immersive-stage="true"]')),
      srState: srButton?.getAttribute('aria-label') || 'unavailable',
      images,
    };
  };

  const originalWorker = window.Worker;
  if (typeof originalWorker === 'function') {
    window.Worker = function MonitoredWorker(url, options) {
      const worker = new originalWorker(url, options);
      const label = String(url || '');
      if (!label.includes('superResolution.worker')) return worker;
      record('worker-created', { worker: 'superResolution' });
      const originalPost = worker.postMessage.bind(worker);
      worker.postMessage = (message, transfer) => {
        if (message?.type === 'init' || message?.type === 'process') {
          pending.set(message.requestId, { type: message.type, at: performance.now(), model: message.manifest?.id || '' });
          record(`worker-${message.type}-post`, {
            requestId: message.requestId,
            model: message.manifest?.id || '',
            width: Number(message.width) || 0,
            height: Number(message.height) || 0,
            blobBytes: Number(message.blob?.size) || 0,
            pixelBytes: Number(message.pixels?.byteLength) || 0,
            providers: Array.isArray(message.manifest?.executionProviders)
              ? message.manifest.executionProviders.join(',')
              : '',
            inputWidth: Number(message.manifest?.inputWidth) || 0,
            inputHeight: Number(message.manifest?.inputHeight) || 0,
            tileCore: Number(message.manifest?.tileCore) || 0,
          });
        } else if (message?.type === 'cancel') {
          record('worker-cancel-post', { requestId: message.requestId });
        }
        return originalPost(message, transfer);
      };
      const originalAdd = worker.addEventListener.bind(worker);
      worker.addEventListener = (type, listener, optionsArg) => {
        if (type !== 'message') return originalAdd(type, listener, optionsArg);
        return originalAdd(type, (event) => {
          const data = event.data || {};
          const request = pending.get(data.requestId);
          if (request && ['ready', 'result', 'error'].includes(data.type)) {
            pending.delete(data.requestId);
            const durationMs = Math.round(performance.now() - request.at);
            record(`worker-${data.type}`, {
              requestId: data.requestId,
              model: request.model,
              durationMs,
              width: Number(data.width) || 0,
              height: Number(data.height) || 0,
              blobBytes: Number(data.blob?.size) || 0,
              backend: typeof data.backend === 'string' ? data.backend : '',
              error: data.error ? safeError(data.error) : undefined,
            });
          }
          listener(event);
        }, optionsArg);
      };
      return worker;
    };
  }

  addEventListener('error', (event) => record('window-error', { error: safeError(event.error || event.message) }));
  addEventListener('unhandledrejection', (event) => record('unhandled-rejection', { error: safeError(event.reason) }));
  const observer = new MutationObserver(() => {
    const current = snapshot();
    const key = JSON.stringify(current);
    if (key !== observer.lastSnapshot) {
      observer.lastSnapshot = key;
      record('reader-snapshot', current);
    }
  });
  addEventListener('DOMContentLoaded', () => observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-page-index', 'data-decode-precision', 'class'] }));
  setInterval(() => record('periodic-snapshot', snapshot()), 2000);

  const report = () => ({
    schema: 1,
    tool: 'readoshi-sr-monitor',
    createdAt: new Date().toISOString(),
    page: { origin: location.origin, route: location.search.includes('id=') ? 'reader' : 'home' },
    config: {
      importedKeys: ['lrr_server_url', 'lrr_api_key', 'lrr_worker_url', 'lrr_sync_token', 'lrr_eh_cookie', 'lrr_reader_settings'],
      values: '[not captured]',
    },
    browser: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency || null },
    events,
    final: snapshot(),
  });
  const download = () => {
    const blob = new Blob([JSON.stringify(report(), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `readoshi-sr-monitor-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    record('report-downloaded');
  };
  const clear = () => { events.length = 0; if (panel) panel.querySelector('[data-count]').textContent = '0 条'; };
  const makePanel = () => {
    panel = document.createElement('div');
    panel.innerHTML = '<button data-action="download">导出脱敏报告</button><button data-action="clear">清空</button> <span data-count>0 条</span>';
    Object.assign(panel.style, { position: 'fixed', zIndex: 2147483647, right: '12px', bottom: '12px', padding: '8px 10px', background: '#171717', color: '#fff', font: '13px sans-serif', borderRadius: '6px', boxShadow: '0 2px 12px #0008' });
    panel.querySelectorAll('button').forEach((button) => Object.assign(button.style, { marginRight: '6px', cursor: 'pointer' }));
    panel.addEventListener('click', (event) => { if (event.target.dataset.action === 'download') download(); if (event.target.dataset.action === 'clear') clear(); });
    document.body.appendChild(panel);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', makePanel, { once: true }); else makePanel();
  window.__readoshiSrMonitor = { report, download, clear, stop: () => { recording = false; observer.disconnect(); } };
})();
