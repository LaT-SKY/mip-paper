# Packaged KWin Coordinator Loading

## Problem

After a clean AUR installation, `mip-paper setup` enables the packaged KWin
script but reloads it from the per-user installation path. That path does not
exist for packaged installations. The helper also ignores `loadScript` and
`start` failures, so setup succeeds while the coordinator remains unloaded.

Without the coordinator, Wayland places all Electron wallpaper windows on one
output. Restarting the systemd service cannot repair that state because it does
not load the missing KWin script.

## Design

- Installing a source checkout copies the script into the user data directory
  and loads that copied path.
- Enabling an existing package loads the supplied `KWIN_SCRIPT_SOURCE` path
  directly, including `/usr/share/kwin/scripts/mip-paper` for AUR packages.
- Disabling or removing the integration unloads the script and never reloads
  it.
- A failed `loadScript` or `start` call fails setup instead of being ignored.
- `check-loaded` reports KWin's runtime state through `isScriptLoaded`.
- `mip-paper doctor` requires both installed/enabled state and loaded runtime
  state before reporting the coordinator as healthy.

## Verification

Regression tests cover the packaged source path, D-Bus failure propagation,
and the unloaded doctor state. Final validation must also load the coordinator
in the current Plasma session, confirm `isScriptLoaded=true`, inspect per-output
coordinator assignments, and capture the resulting desktop.
