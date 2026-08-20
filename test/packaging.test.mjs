import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('declares the 0.3.9 release version consistently', async () => {
  const [packageJson, lockfile, kwinMetadata] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('package-lock.json', 'utf8').then(JSON.parse),
    readFile('kwin/mip-paper/metadata.json', 'utf8').then(JSON.parse),
  ]);

  assert.equal(packageJson.version, '0.4.0');
  assert.equal(lockfile.version, '0.4.0');
  assert.equal(lockfile.packages[''].version, '0.4.0');
  assert.equal(kwinMetadata.KPlugin.Version, '0.4.0');
});

test('uses system Electron for source and packaged installations', async () => {
  const [packageJson, sourceUnit, packagedUnit, wrapper, desktopEntry] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('resources/mip-paper.service.in', 'utf8'),
    readFile('resources/mip-paper-packaged.service', 'utf8'),
    readFile('packaging/mip-paper', 'utf8'),
    readFile('resources/mip-paper.desktop', 'utf8'),
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
  ]) {
    assert.ok(wrapper.includes(required), `packaged wrapper is missing: ${required}`);
  }
  assert.doesNotMatch(wrapper, /MIP_PAPER_KWIN_SOURCE|kwin\/scripts/);
  assert.match(wrapper, /exec \/usr\/lib\/mip-paper\/bin\/mip-paper "\$@"/);
  assert.match(desktopEntry, /^\[Desktop Entry\]$/m);
  assert.match(desktopEntry, /^Type=Application$/m);
  assert.match(desktopEntry, /^Name=Mip-Paper$/m);
  assert.match(desktopEntry, /^Exec=mip-paper start$/m);
  assert.match(desktopEntry, /^Icon=mip-paper$/m);
  assert.match(desktopEntry, /^Terminal=false$/m);
});

test('uses the maintained D-Bus fork without the vulnerable legacy dependency chain', async () => {
  const [packageJson, lockfile, generator] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('package-lock.json', 'utf8').then(JSON.parse),
    readFile('scripts/generate-pkgbuild.mjs', 'utf8'),
  ]);

  assert.equal(packageJson.dependencies['dbus-next'], undefined);
  assert.equal(packageJson.dependencies['@particle/dbus-next'], '0.11.4');
  assert.equal(lockfile.packages['node_modules/dbus-next'], undefined);
  assert.equal(lockfile.packages['node_modules/usocket'], undefined);
  assert.equal(lockfile.packages['node_modules/request'], undefined);
  assert.equal(
    lockfile.packages['node_modules/@particle/dbus-next/node_modules/xml2js'].version,
    '0.6.2',
  );
  assert.match(generator, /node_modules\/@particle\/dbus-next\/LICENSE/);
});

test('has no image-size dependency or packaging residue', async () => {
  const [packageJson, lockfile, generator] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('package-lock.json', 'utf8').then(JSON.parse),
    readFile('scripts/generate-pkgbuild.mjs', 'utf8'),
  ]);

  assert.equal(packageJson.dependencies['image-size'], undefined);
  assert.equal(lockfile.packages['node_modules/image-size'], undefined);
  assert.doesNotMatch(generator, /node_modules\/image-size/);
});

test('generates fixed-checksum Arch metadata and package ownership', async () => {
  const checksum = 'a'.repeat(64);
  const [{ stdout: pkgbuild }, installHook, packageLicense, wallpaperAttribution] = await Promise.all([
    execFileAsync(process.execPath, [
      'scripts/generate-pkgbuild.mjs',
      '0.2.0',
      'https://example.invalid/mip-paper-0.2.0.tar.gz',
      checksum,
    ]),
    readFile('packaging/mip-paper.install', 'utf8'),
    readFile('packaging/LICENSE', 'utf8'),
    readFile('assets/ATTRIBUTION.md', 'utf8'),
  ]);

  for (const required of [
    '# Maintainer: LaT-SKY <miprota at 163 dot com>',
    'pkgname=mip-paper',
    'pkgver=0.2.0',
    'pkgrel=1',
    "arch=('x86_64')",
    "license=('GPL-3.0-only' 'MIT' 'CC-BY-4.0')",
    "depends=('bash' 'electron43' 'nodejs' 'plasma-workspace' 'kwin>=6.7' 'kconfig' 'qt6-tools' 'systemd' 'pipewire' 'pipewire-audio' 'wireplumber')",
    "optdepends=('geoclue: automatic location through XDG Desktop Portal')",
    "makedepends=('npm')",
    "options=('!strip')",
    'npm ci --omit=dev --omit=optional --ignore-scripts --cache "$srcdir/npm-cache"',
    '"$pkgdir/usr/lib/mip-paper"',
    '"$pkgdir/usr/bin/mip-paper"',
    'resources/mip-paper.desktop',
    'usr/share/applications/mip-paper.desktop',
    'assets/logo.png',
    'usr/share/icons/hicolor/512x512/apps/mip-paper.png',
    '"$pkgdir/usr/lib/systemd/user/mip-paper.service"',
    '"$pkgdir/usr/share/licenses/mip-paper/LICENSE"',
    '"$pkgdir/usr/share/licenses/mip-paper/default-wallpaper-ATTRIBUTION"',
    checksum,
  ]) {
    assert.ok(pkgbuild.includes(required), `PKGBUILD is missing: ${required}`);
  }
  assert.doesNotMatch(pkgbuild, /SKIP|node_modules\/electron|161-2\.jpeg|usr\/share\/kwin\/scripts/);
  assert.match(pkgbuild, /cp -a bin config kwin resources scripts src assets node_modules package\.json/);
  assert.match(installHook, /Run: mip-paper setup/);
  assert.match(installHook, /setup \[--image/);
  assert.match(installHook, /QWeather/);
  assert.match(packageLicense, /Copyright Arch Linux Contributors/);
  assert.match(packageLicense, /Permission to use, copy, modify, and\/or distribute/);
  assert.match(wallpaperAttribution, /Photograph by LaT-SKY/);
  assert.match(wallpaperAttribution, /CC BY 4\.0/);
  assert.match(wallpaperAttribution, /removing metadata and recompressing/);
});

test('release preparation enforces tag-first AUR metadata generation', async () => {
  const source = await readFile('scripts/prepare-aur-release.mjs', 'utf8');
  assert.match(source, /rev-parse.*tag/si);
  assert.match(source, /ls-remote.*--tags.*origin/si);
  assert.match(source, /publishedCommit !== localCommit/);
  assert.match(source, /freeze and tag the final/);
  assert.match(source, /github\.com\/.*releases\/download/);
  assert.match(source, /mip-paper-\$\{version\}\.tar\.gz/);
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /makepkg.*--printsrcinfo/si);
  assert.match(source, /\.SRCINFO/);
  assert.match(source, /AUR repository must be clean/);
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
