import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const text = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = (path) => fs.existsSync(new URL(`../${path}`, import.meta.url));

test('project branding is consistently Readoshi', () => {
  const pkg = JSON.parse(text('package.json'));
  const manifest = JSON.parse(text('public/manifest.json'));
  const html = text('index.html');
  const readme = text('README.md');
  const app = text('src/App.jsx');
  const home = text('src/pages/Home.jsx');
  const css = text('src/index.css');
  const workflow = text('.github/workflows/mobile-build.yml');

  assert.equal(pkg.name, 'readoshi');
  assert.equal(manifest.name, 'Readoshi');
  assert.equal(manifest.short_name, 'Readoshi');
  assert.match(manifest.description, /A LANraragi Reader/);
  assert.match(html, /<title>Readoshi<\/title>/);
  assert.match(html, /type="image\/svg\+xml"[^>]+href="\/logo\.svg"/);
  assert.match(readme, /<h1 align="center">Readoshi<\/h1>/);
  assert.doesNotMatch(readme, /A LANraragi Reader/);
  assert.match(readme, /public\/logo-black\.png/);
  assert.match(readme, /public\/logo-white\.png/);
  assert.doesNotMatch(readme, /history:<token>|watchlist:<token>|dedupe:<token>|schema v\d/);
  assert.match(workflow, /appId: 'com\.kelcoin\.readoshi'/);
  assert.match(workflow, /appName: 'Readoshi'/);
  assert.match(workflow, /public\/logo-white\.png/);
  assert.match(app, /className="login-brand-lockup"/);
  assert.match(app, /<span className="login-brand-logo" aria-hidden="true" \/>/);
  assert.match(app, /className="login-title">Readoshi<\/h2>/);
  assert.match(app, />LANraragi 地址 \*<\/label>/);
  assert.match(app, />LANraragi API Key \*<\/label>/);
  assert.doesNotMatch(app, />配置 LANraragi<\/h2>|>服务器地址 \*<\/label>|>API Key \*<\/label>/);
  assert.match(css, /\.login-brand-logo\s*\{[^}]*mask:\s*url\('\/logo\.svg'\)/s);
  assert.match(home, /<span className="home-brand-logo" aria-hidden="true" \/>/);
  assert.match(css, /\.home-brand-logo\s*\{[^}]*mask:\s*url\('\/logo\.svg'\)/s);
});

test('all logo image assets live under public', () => {
  for (const path of [
    'public/logo-black.png',
    'public/logo-white.png',
    'public/icons/favicon-black-32.png',
    'public/icons/favicon-white-32.png',
    'public/icons/icon-180.png',
    'public/icons/icon-192.png',
    'public/icons/icon-512.png',
  ]) assert.equal(exists(path), true, `${path} missing`);

  assert.equal(exists('logo.png'), false, 'root logo.png must move into public');
  assert.equal(exists('favicon.ico'), false, 'root favicon.ico must move into public');
});
