import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveAppVersion } from '../scripts/app-version.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const packageVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('package manifests use the 1.6.3 release version', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '1.6.3');
  assert.equal(lock.version, '1.6.3');
  assert.equal(lock.packages[''].version, '1.6.3');
});

test('application version always uses package.json SemVer plus build SHA', () => {
  const resolved = resolveAppVersion({ cwd, hash: 'abcdef1234567890' });
  assert.equal(resolved.version, `v${packageVersion}+abcdef1`);
  assert.equal(resolved.buildId, `${packageVersion}-abcdef1`);
});

test('branch history cannot change application SemVer', () => {
  const resolved = resolveAppVersion({
    cwd,
    baseRef: 'missing-base',
    headRef: 'missing-head',
    hash: '1234567890abcdef',
  });
  assert.equal(resolved.version, `v${packageVersion}+1234567`);
  assert.equal(resolved.buildId, `${packageVersion}-1234567`);
});

test('mobile workflow uses the shared application version resolver', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/mobile-build.yml', import.meta.url), 'utf8');
  assert.match(workflow, /import \{ resolveAppVersion \} from '\.\/scripts\/app-version\.mjs'/);
  assert.match(workflow, /resolveAppVersion\(\{ cwd: process\.cwd\(\), hash: process\.env\.GITHUB_SHA \}\)/);
});

test('mobile workflow builds APKs and an unsigned IPA with shared release publishing', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/mobile-build.yml', import.meta.url), 'utf8');

  assert.match(workflow, /^name: Build Readoshi Mobile Apps$/m);
  assert.match(workflow, /build-apk:[\s\S]*runs-on: ubuntu-latest/);
  assert.match(workflow, /build-ipa:[\s\S]*runs-on: macos-latest/);
  assert.match(workflow, /@capacitor\/ios@8\.4\.1/);
  assert.match(workflow, /cap add ios/);
  assert.match(workflow, /capacitor-assets generate --ios/);
  assert.match(workflow, /public\/logo-white\.png/);
  assert.match(workflow, /readoshi-ios-safe-area/);
  assert.match(workflow, /Add :UILaunchScreen dict/);
  assert.match(workflow, /Add :UILaunchScreen:UIColorName string LaunchBackground/);
  assert.match(workflow, /LaunchBackground\.colorset/);
  assert.match(workflow, /red: '0\.956863'/);
  assert.match(workflow, /appearances: \[\{ appearance: 'luminosity', value: 'dark' \}\]/);
  assert.match(workflow, /red: '0\.058824'/);
  assert.match(workflow, /NSAllowsArbitraryLoadsInWebContent/);
  assert.match(workflow, /NSAllowsLocalNetworking/);
  assert.match(workflow, /NSLocalNetworkUsageDescription/);
  assert.match(workflow, /test -d 'ios\/App\/App\.xcodeproj'/);
  assert.match(workflow, /-project ios\/App\/App\.xcodeproj/);
  assert.doesNotMatch(workflow, /-workspace ios\/App\/App\.xcworkspace/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(workflow, /Payload\/Readoshi\.app/);
  assert.match(workflow, /-unsigned\.ipa/);
  assert.match(workflow, /publish-release:[\s\S]*needs: \[build-apk, build-ipa\]/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.equal(workflow.includes('GH_REPO: ${{ github.repository }}'), true);
});
