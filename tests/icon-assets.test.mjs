import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const file = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url));
const text = (path) => file(path).toString('utf8');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex').toUpperCase();

const oldIconHashes = new Set([
  '8672C2F820B1436CB1869CFBD06CC1F41F426DE153EEF223ED799A51F502973B',
  '2B91AB587D2FA889BFE7C02D210AE5806FBCF8F31DFF545693D2CA203778C612',
  'E31DFC509F215B852FBE4CADC0EFF26A4229B384BB656CEEB49B9A015D040D0B',
]);

test('web uses the SVG logo while mobile builds keep monochrome PNG sources', () => {
  const html = text('index.html');
  assert.match(html, /rel="icon"[^>]+type="image\/svg\+xml"[^>]+href="\/logo\.svg"/);
  assert.match(html, /rel="apple-touch-icon"[^>]+href="\/icons\/icon-180\.png"/);
  assert.match(text('public/logo.svg'), /viewBox="0 0 1254 1254"/);

  for (const name of ['favicon-black-32.png', 'favicon-white-32.png']) {
    const favicon = file(`public/icons/${name}`);
    assert.equal(favicon.readUInt32BE(16), 32);
    assert.equal(favicon.readUInt32BE(20), 32);
    assert.equal(oldIconHashes.has(sha256(favicon)), false, `${name} still uses old artwork`);
  }

  const manifest = JSON.parse(text('public/manifest.json'));
  assert.deepEqual(manifest.icons.map(({ src }) => src), ['/icons/icon-192.png', '/icons/icon-512.png']);

  for (const size of [180, 192, 512]) {
    const png = file(`public/icons/icon-${size}.png`);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.equal(oldIconHashes.has(sha256(png)), false, `icon-${size}.png still uses old artwork`);
  }

  const workflow = text('.github/workflows/mobile-build.yml');
  assert.match(workflow, /copyFileSync\('public\/logo-white\.png', path\.join\('assets', 'logo\.png'\)\)/);
});
