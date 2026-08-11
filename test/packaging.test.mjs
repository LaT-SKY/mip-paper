import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('uses system Electron for source and packaged installations', async () => {
  const [packageJson, sourceUnit, packagedUnit, wrapper] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('resources/mip-paper.service.in', 'utf8'),
    readFile('resources/mip-paper-packaged.service', 'utf8'),
    readFile('packaging/mip-paper', 'utf8'),
  ]);

  assert.equal(packageJson.dependencies.electron, undefined);
  assert.equal(packageJson.devDependencies.electron, '43.3.0');
  assert.match(sourceUnit, /ExecStart=@ELECTRON@ @INSTALL_ROOT@/);
  assert.match(packagedUnit, /ExecStart=\/usr\/bin\/electron43 \/usr\/lib\/mip-paper/);
  assert.match(packagedUnit, /WorkingDirectory=\/usr\/lib\/mip-paper/);
  assert.doesNotMatch(packagedUnit, /node_modules\/electron/);
  for (const required of [
    'MIP_PAPER_MODE=packaged',
    'MIP_PAPER_SOURCE_ROOT=/usr/lib/mip-paper',
    'MIP_PAPER_INSTALL_ROOT=/usr/lib/mip-paper',
    'MIP_PAPER_SERVICE_PATH=/usr/lib/systemd/user/mip-paper.service',
    'MIP_PAPER_KWIN_SOURCE=/usr/share/kwin/scripts/mip-paper',
  ]) {
    assert.ok(wrapper.includes(required), `packaged wrapper is missing: ${required}`);
  }
  assert.match(wrapper, /exec \/usr\/lib\/mip-paper\/bin\/mip-paper "\$@"/);
});

test('generates fixed-checksum Arch metadata and package ownership', async () => {
  const checksum = 'a'.repeat(64);
  const [{ stdout: pkgbuild }, installHook, packageLicense, wallpaperAttribution] = await Promise.all([
    execFileAsync(process.execPath, [
      'scripts/generate-pkgbuild.mjs',
      '0.1.0',
      'https://example.invalid/mip-paper-0.1.0.tar.gz',
      checksum,
    ]),
    readFile('packaging/mip-paper.install', 'utf8'),
    readFile('packaging/LICENSE', 'utf8'),
    readFile('assets/ATTRIBUTION.md', 'utf8'),
  ]);

  for (const required of [
    'pkgname=mip-paper',
    'pkgver=0.1.0',
    'pkgrel=1',
    "arch=('x86_64')",
    "license=('GPL-3.0-only' 'MIT' 'CC-BY-4.0')",
    "depends=('bash' 'electron43' 'nodejs' 'plasma-workspace' 'kwin' 'kconfig' 'qt6-tools' 'systemd' 'pipewire' 'pipewire-audio' 'wireplumber')",
    "optdepends=('geoclue: automatic location through XDG Desktop Portal')",
    "makedepends=('npm')",
    "options=('!strip')",
    'npm ci --omit=dev --omit=optional --ignore-scripts --cache "$srcdir/npm-cache"',
    '"$pkgdir/usr/lib/mip-paper"',
    '"$pkgdir/usr/bin/mip-paper"',
    '"$pkgdir/usr/lib/systemd/user/mip-paper.service"',
    '"$pkgdir/usr/share/kwin/scripts/mip-paper"',
    '"$pkgdir/usr/share/licenses/mip-paper/LICENSE"',
    '"$pkgdir/usr/share/licenses/mip-paper/default-wallpaper-ATTRIBUTION"',
    checksum,
  ]) {
    assert.ok(pkgbuild.includes(required), `PKGBUILD is missing: ${required}`);
  }
  assert.doesNotMatch(pkgbuild, /SKIP|node_modules\/electron|161-2\.jpeg/);
  assert.match(pkgbuild, /cp -a bin config resources scripts src assets node_modules package\.json/);
  assert.match(installHook, /Run: mip-paper setup/);
  assert.doesNotMatch(installHook, /setup --image/);
  assert.match(installHook, /mip-paper restart/);
  assert.match(packageLicense, /Copyright Arch Linux Contributors/);
  assert.match(packageLicense, /Permission to use, copy, modify, and\/or distribute/);
  assert.match(wallpaperAttribution, /Photograph by LaT-SKY/);
  assert.match(wallpaperAttribution, /CC BY 4\.0/);
  assert.match(wallpaperAttribution, /removing metadata and recompressing/);
});

test('rejects mutable or malformed PKGBUILD inputs', async () => {
  for (const arguments_ of [
    ['next', 'https://example.invalid/source.tar.gz', 'a'.repeat(64)],
    ['0.1.0', 'http://example.invalid/source.tar.gz', 'a'.repeat(64)],
    ['0.1.0', 'https://example.invalid/source.tar.gz', 'SKIP'],
  ]) {
    await assert.rejects(execFileAsync(process.execPath, ['scripts/generate-pkgbuild.mjs', ...arguments_]));
  }
});
