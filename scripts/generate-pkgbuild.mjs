#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(2);
}

export function generatePkgbuild(version, sourceUrl, checksum) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new TypeError('VERSION must be semantic x.y.z');
  if (!/^[0-9a-f]{64}$/.test(checksum ?? '')) {
    throw new TypeError('SHA256 must be 64 lowercase hexadecimal characters');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new TypeError('SOURCE_URL must be an absolute URL');
  }
  if (!['https:', 'file:'].includes(parsedUrl.protocol) || sourceUrl.includes("'")) {
    throw new TypeError('SOURCE_URL must use HTTPS or file');
  }

  return `# Maintainer: LaT-SKY <miprota at 163 dot com>
pkgname=mip-paper
pkgver=${version}
pkgrel=1
pkgdesc='Dynamic wallpaper engine for KDE Plasma 6 on Wayland'
arch=('x86_64')
url='https://github.com/LaT-SKY/mip-paper'
license=('GPL-3.0-only' 'MIT' 'CC-BY-4.0')
depends=('bash' 'electron43' 'nodejs' 'plasma-workspace' 'kwin>=6.7' 'kconfig' 'qt6-tools' 'systemd' 'pipewire' 'pipewire-audio' 'wireplumber')
optdepends=('geoclue: automatic location through XDG Desktop Portal')
makedepends=('npm')
options=('!strip')
install=mip-paper.install
source=("$pkgname-$pkgver.tar.gz::${parsedUrl.href}")
sha256sums=('${checksum}')

prepare() {
  cd "$srcdir/$pkgname-$pkgver"
  npm ci --omit=dev --omit=optional --ignore-scripts --cache "$srcdir/npm-cache"
}

package() {
  cd "$srcdir/$pkgname-$pkgver"

  install -d "$pkgdir/usr/lib/mip-paper"
  cp -a bin config kwin resources scripts src assets node_modules package.json \
    "$pkgdir/usr/lib/mip-paper/"

  install -Dm755 packaging/mip-paper "$pkgdir/usr/bin/mip-paper"
  install -Dm644 resources/mip-paper-packaged.service \
    "$pkgdir/usr/lib/systemd/user/mip-paper.service"

  install -Dm644 LICENSE "$pkgdir/usr/share/licenses/mip-paper/LICENSE"
  install -Dm644 assets/ATTRIBUTION.md \
    "$pkgdir/usr/share/licenses/mip-paper/default-wallpaper-ATTRIBUTION"
  install -Dm644 node_modules/@particle/dbus-next/LICENSE \
    "$pkgdir/usr/share/licenses/mip-paper/dbus-next-LICENSE"
  install -Dm644 node_modules/fft.js/README.md \
    "$pkgdir/usr/share/licenses/mip-paper/fft.js-LICENSE"
  install -Dm644 node_modules/qweather-icons/LICENSE \
    "$pkgdir/usr/share/licenses/mip-paper/qweather-icons-LICENSE"
  install -Dm644 node_modules/qweather-icons/README.md \
    "$pkgdir/usr/share/licenses/mip-paper/qweather-icons-ATTRIBUTION"
}
`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(generatePkgbuild(...process.argv.slice(2)));
  } catch (error) {
    fail(error.message);
  }
}
