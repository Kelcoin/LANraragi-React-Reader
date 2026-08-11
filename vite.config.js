import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAppVersion } from './scripts/app-version.mjs';

function readEnvLocal(cwd) {
  const filePath = path.resolve(cwd, '.env.local');
  if (!fs.existsSync(filePath)) return {};
  const map = {};
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const k = trimmed.substring(0, eqIdx).trim();
      const v = trimmed.substring(eqIdx + 1).trim();
      if (k && v) map[k] = v;
    }
  } catch {}
  return map;
}

export default defineConfig(({ mode }) => {
  const cwd = process.cwd();
  const env = loadEnv(mode, cwd, '');

  // Fallback: manually parse .env.local in case Vite's loadEnv doesn't pick it up
  const localEnv = readEnvLocal(cwd);
  const appVersion = resolveAppVersion({ cwd });

  const forceIPv4 = env.VITE_FORCE_IPV4 === 'true';
  const httpAgent = forceIPv4
    ? new http.Agent({ family: 4 })
    : new http.Agent({ family: 0, autoSelectFamily: true });
  const httpsAgent = forceIPv4
    ? new https.Agent({ family: 4 })
    : new https.Agent({ family: 0, autoSelectFamily: true });

  const allowedHostsRaw = env.VITE_ALLOWED_HOSTS || localEnv.VITE_ALLOWED_HOSTS || '';
  const allowedHosts = allowedHostsRaw
    ? (() => {
        const hosts = allowedHostsRaw.split(',').map((h) => {
          let trimmed = h.trim();
          if (!trimmed) return null;

          // strip scheme if present (e.g. https://example.com)
          try { const u = new URL(trimmed); trimmed = u.hostname; } catch {}

          // strip trailing port (reverse proxies often append :443 / :80)
          const portIdx = trimmed.lastIndexOf(':');
          if (portIdx > 0) trimmed = trimmed.substring(0, portIdx);

          return trimmed;
        }).filter(Boolean);

        console.log('[vite] allowedHosts:', hosts);
        return hosts;
      })()
    : undefined;

  const proxy = {};

  proxy['/eh'] = {
    target: 'https://exhentai.org',
    changeOrigin: true,
    agent: httpsAgent,
    rewrite: (path) => path.replace(/^\/eh/, ''),
    configure: (proxyServer) => {
      proxyServer.on('proxyReq', (proxyReq, req) => {
        // Strip reverse-proxy headers that would trigger exhentai anti-bot
        [
          'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
          'x-forwarded-port', 'x-real-ip', 'x-forwarded-server',
          'forwarded', 'cf-connecting-ip', 'cf-ipcountry',
          'true-client-ip', 'x-cluster-client-ip',
        ].forEach((h) => proxyReq.removeHeader(h));

        const ehCookie = proxyReq.getHeader('X-EH-Cookie');
        if (ehCookie) {
          proxyReq.removeHeader('X-EH-Cookie');
          proxyReq.setHeader('Cookie', ehCookie);
        }
        proxyReq.setHeader('Host', 'exhentai.org');
        proxyReq.setHeader('Origin', 'https://exhentai.org');
        proxyReq.setHeader('Referer', 'https://exhentai.org/');
        proxyReq.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
        proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
        proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
      });
      proxyServer.on('proxyRes', (proxyRes, req) => {
        const st = proxyRes.statusCode;
        if (st >= 400) console.warn(`[eh proxy] ${req.url} → ${st} ${proxyRes.statusMessage || ''}`);
      });
      proxyServer.on('error', (err, req, res) => {
        console.error('[eh proxy error]', err.message);
        if (res && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Proxy error: ' + err.message);
        }
      });
    }
  };

  const lrrProxyTarget = env.VITE_LRR_PROXY_TARGET || localEnv.VITE_LRR_PROXY_TARGET || '';
  if (lrrProxyTarget) {
    const target = new URL(lrrProxyTarget).origin;
    proxy['/api'] = {
      target,
      changeOrigin: true,
      agent: target.startsWith('https:') ? httpsAgent : httpAgent,
    };
  }

  const serverConfig = {
    proxy,
    cors: true,
    hmr: false,
    watch: {
      usePolling: true,
      interval: 1000,
    }
  };
  if (allowedHosts) {
    serverConfig.allowedHosts = allowedHosts;
  }

  return {
    worker: { format: 'es' },
    define: {
      __APP_BUILD_ID__: JSON.stringify(appVersion.buildId),
      __APP_VERSION__: JSON.stringify(appVersion.version),
    },
    plugins: [
      react(),
      {
        name: 'cors-preflight-for-eh-proxy',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url.startsWith('/eh')) {
              res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
              res.setHeader('Access-Control-Allow-Credentials', 'true');
              if (req.method === 'OPTIONS') {
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'X-EH-Cookie, Content-Type');
                res.setHeader('Access-Control-Max-Age', '86400');
                res.statusCode = 204;
                res.end();
                return;
              }
            }
            next();
          });
        }
      },
    ],
    server: serverConfig
  };
});
