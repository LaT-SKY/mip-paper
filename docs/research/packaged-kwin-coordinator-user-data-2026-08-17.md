# Packaged KWin Coordinator User-Data Installation

## Problem

After the AUR package installed the KWin coordinator under
`/usr/share/kwin/scripts/mip-paper`, Plasma 6 did not reliably apply the
script's enabled state. Packaged activation went through three incompatible
fixes in one release cycle — direct `loadScript`, a full plugin-manager
false→reconfigure→true→reconfigure transition, and finally manual activation
in System Settings — before 0.3.7 reverted to automatic `enable` again. Every
iteration kept a separate system-script path that behaved differently from the
source install.

Meanwhile the source install path — copy the coordinator to
`~/.local/share/kwin/scripts/mip-paper` and enable it from there — has been
stable. On 2026-08-17 the running source installation reported
`kwinrc: mip-paperEnabled=true` and
`qdbus6 ... isScriptLoaded mip-paper = true`.

## Decision

Remove the system-script path entirely. Packaged installations use the same
user-data installation path as source installations.

## Design

- The Arch package ships `kwin/` under `/usr/lib/mip-paper/kwin` and no
  longer installs `/usr/share/kwin/scripts/mip-paper`.
- `mip-paper setup` copies `/usr/lib/mip-paper/kwin/mip-paper` to the
  user's KWin script directory and calls `kwin-script.sh install`.
- `mip-paper teardown` removes that user copy via `kwin-script.sh remove`.
- `mip-paper doctor` checks the user copy for both install modes.
- `scripts/kwin-script.sh` drops `enable`, `disable`, and
  `check-enabled`; only `install`, `remove`, `check`, and
  `check-loaded` remain.
- The packaged wrapper no longer exports `MIP_PAPER_KWIN_SOURCE`.
- The post-upgrade hook asks users to run `mip-paper setup` to re-sync the
  per-user copy after a package upgrade.
- `prepare-aur-release.mjs` refuses a release when
  `kwin/mip-paper/metadata.json` does not match `package.json`, so the KCM
  version cannot drift again.

## Rejected alternatives

- **`mip-paper-git` + full user-space install.** Switching the AUR source
  from release tarballs to git does not change where KWin scripts are
  installed or enabled, so it does not solve the activation problem. It would
  require npm and network access on every user machine, keep a second full
  copy under `~/.local`, and introduce upgrade drift between the pacman
  payload and the user copy. AUR history is append-only, so the noisy
  release-bump history cannot be rewritten.
- **Keep the system script and require manual activation.** This is the 0.3.6
  approach. It preserves two activation modes and leaves the display
  coordinator unloaded until a manual step.

## Verification

- Full test suite: 404 passing, 0 failing.
- `npm run check`, `bash -n` on the shell entry points, and
  `git diff --check`.
- Live source installation: `isScriptLoaded mip-paper` returns `true`.
- The 0.3.8 AUR metadata ships `kwin/` under `/usr/lib/mip-paper`; the
  remaining end-to-end check is a clean install reporting the same loaded
  state from `mip-paper doctor`.

## References

- `docs/research/packaged-kwin-coordinator-loading-2026-08-16.md` (superseded)
- `bin/mip-paper`, `scripts/kwin-script.sh`, `scripts/generate-pkgbuild.mjs`
