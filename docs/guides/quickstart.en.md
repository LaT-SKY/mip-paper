# Quick Start

[中文](quickstart.md)

This guide covers Mip-Paper's requirements, installation and removal, everyday usage, wallpaper management, KWin integration, weather service, context menu, and troubleshooting. The complete configuration reference lives in [Configuration](configuration.en.md), and privacy and licensing details in [Privacy and Licenses](privacy.en.md).

## Requirements

- Arch Linux or a compatible environment
- KDE Plasma 6 and KWin >= 6.7 in a Wayland session; KWin scripting APIs before 6.7 are unsupported
- A systemd user manager
- PipeWire, WirePlumber, `pw-cat`, and `pw-metadata`
- GeoClue for automatic location only

## Installation and Removal

### Install from AUR

With yay:

```bash
yay -S mip-paper
```

Or with paru:

```bash
paru -S mip-paper
```

The package installs only system files and never changes a particular user's home as root. Each user completes setup once:

```bash
mip-paper setup
```

Setup creates missing configuration and weather credentials, follows each display's KDE static wallpaper by default, installs the user's KWin rule, installs and enables the KWin coordinator in the user's data directory, and starts `mip-paper.service`. Displays without a readable KDE static image use the bundled default. Existing configuration, credentials, and managed images are preserved. To switch directly to manual mode with your own image, run `mip-paper setup --image /path/to/image.png`.

After completion, setup reports the active wallpaper file, the replacement command, and whether weather still needs configuration. The bundled photograph is only the initial value. Replace it at any time with:

```bash
mip-paper wallpaper set /path/to/image.jpg
```

### Source Installation and Development Checks

Source installs also use system `electron43` and do not copy npm Electron:

```bash
sudo pacman -S electron43 nodejs npm pipewire pipewire-audio wireplumber
./bin/mip-paper install
```

Prepare without starting:

```bash
./bin/mip-paper install --no-start
```

Development checks:

```bash
npm ci
npm test
npm run check
bash -n bin/mip-paper scripts/kwin-rules.sh scripts/kwin-script.sh
```

### Removal

For AUR installs, remove per-user integration before pacman-owned files:

```bash
mip-paper teardown
sudo pacman -R mip-paper
```

Normal teardown preserves configuration, credentials, and the managed image. Explicitly remove all Mip-Paper user data with `mip-paper teardown --purge`. Source installs use `mip-paper uninstall` or `mip-paper uninstall --purge`.

## Usage

```bash
mip-paper start
mip-paper stop
mip-paper restart
mip-paper status
mip-paper doctor
```

Read service logs:

```bash
journalctl --user -u mip-paper.service -n 100 --no-pager
```

`start` launches only the desktop background service. Verify login startup with:

```bash
systemctl --user is-enabled mip-paper.service
systemctl --user is-active mip-paper.service
```

## Wallpaper and Showcase

Mip-Paper includes a default photograph by LaT-SKY under CC BY 4.0; see the [image attribution](../../assets/ATTRIBUTION.md). EXIF and other metadata are removed from the distributed copy. The former third-party wallpaper is not included, and Mip-Paper does not download external images automatically.

KDE synchronization is the default mode. Each display follows the static `org.kde.image` selected for that Plasma screen and updates after KDE settings change. The watcher does not poll: writes are debounced for 350 ms, and image data is copied and decoded only when its path, size, or modification time changes.

KDE slideshows and third-party dynamic wallpaper plugins are unsupported. The affected display preserves its last valid cache, or uses the bundled default when no cache exists.

Selecting one image manually switches to manual mode and applies it to every display. The manual image is stored at:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/mip-paper/wallpaper
```

Pass `--image /path/to/image` during setup or import your own JPEG, PNG, or WebP later. The original file can then be moved or deleted. You are responsible for having the right to use a selected image. The program's GPL license does not cover user-imported images.

Set, replace, or inspect the managed image:

```bash
mip-paper wallpaper set /path/to/image.png
mip-paper wallpaper status
```

Return to per-display KDE synchronization with:

```bash
mip-paper wallpaper use-kde
```

A failed replacement preserves the previous valid image. A successful replacement restarts the service when it is active.

You can also import an image from the settings window: right-click the wallpaper → Settings → Wallpaper section → Choose image…, which imports a JPEG / PNG / WebP and switches to manual mode automatically.

## KWin Integration

`setup` (or `install` for source installs) installs two KWin integrations for Mip-Paper windows:

- **Window rule**: matches the window class `mip-paper` for windows whose caption contains `mip-paper|display=` (the wallpaper windows) and forces fullscreen, no border, below other windows, **no keyboard focus** (the context menu is pure mouse interaction and needs no focus; avoiding focus prevents KWin from re-laying-out the window on focus changes, which could overflow into neighbouring displays), and exclusion from the taskbar, pager, and Alt+Tab switcher, on all virtual desktops. The caption condition scopes the rule to wallpaper windows: the app's own GUI windows (the settings dialog) stay normal framed, taskbar-visible windows above the wallpaper.
- **Display coordinator** (KWin Script): reads each window's declared target display from its caption, moves the window to that output, pins its geometry, reacts to display hot-plug and screen-order changes, and reports fullscreen window state per output over the session bus `org.mip.Paper`.

Removal (`teardown` / `uninstall`) removes both integrations.

## Settings Window

Right-click the wallpaper and choose **Settings** to open the visual settings window (same design language as the context menu: white surface in light mode, large rounded corners, SVG icons, spring motion). The window edits every configuration field with live hot reload, manages weather credentials (masked), edits custom context-menu commands, and imports wallpaper images. It is a normal application window above the wallpaper, visible in the taskbar; focusing it or moving the pointer onto it never dismisses wallpaper context menus.

With `mouse.buttonsEnabled: false` the wallpaper windows pass the mouse through entirely, so the context menu and the settings entry are unavailable; `mouse.interactionEnabled: false` only stops pointer-driven parallax while the context menu still works. Both are adjustable in the **Interaction** section of the settings window, or by editing `~/.config/mip-paper/config.json`.

## Weather Service

Automatic location uses GeoClue:

```bash
sudo pacman -S geoclue
sudo systemctl enable --now geoclue
gsettings set org.gnome.system.location enabled true
```

Log in again after installation so the desktop session starts its GeoClue authorization agent. Mip-Paper requests city-level location through XDG Desktop Portal; the renderer cannot access GeoClue directly.

Weather credentials are stored separately at `~/.config/mip-paper/weather-credentials.json` and must have mode `0600`:

```json
{
  "apiHost": "your-project-host.qweatherapi.com",
  "apiKey": "your-api-key"
}
```

Create a project and API key in the [QWeather Console](https://console.qweather.com/), then put the assigned API Host and API Key into those fields. Restrict the file:

```bash
chmod 600 ~/.config/mip-paper/weather-credentials.json
```

The host is an HTTPS domain without scheme, path, query, or user information. Only the main process reads the key; it never enters the renderer, URLs, logs, or cache. Saving valid credentials immediately rebuilds the weather source and refreshes data. Invalid, unsafe, incomplete, or deleted files preserve the last valid credentials and recover automatically when fixed.

Current weather refreshes every 30 minutes; forecasts and tides refresh every 6 hours. Cache state is fresh through 6 hours, stale from 6 to 24 hours, and unavailable after 24 hours. Weather data comes from QWeather. `qweather-icons@1.8.0` code is MIT and its icons are CC BY 4.0 (attribution in [Privacy and Licenses](privacy.en.md)).

## Right-click Context Menu

Right-click on the wallpaper to open the menu: four built-in actions are provided — **Refresh Wallpaper**, **Toggle Information Panels** (disables auto expand/collapse and pins the target state), **Pause/Resume Wallpaper**, and **Settings** — scoped to the display you right-clicked. The menu follows the light/dark appearance. Custom commands are added through the `menu.customCommands` array (configuration and per-field reference in [Configuration](configuration.en.md)) and hot reload as soon as the file is saved; `id` must not collide with the built-in actions (`refresh`, `toggle-panel`, `toggle-pause`, and `settings` are reserved).

`background` runs the command via `sh -c` without a window, suitable for `xdg-open` or launching GUI apps; `terminal` runs it inside a terminal emulator that stays open, suitable for interactive commands such as `sudo pacman -Syu`. Terminals are probed in the order `konsole` → `kitty` → `gnome-terminal` → `x-terminal-emulator` → `xdg-terminal-exec`, falling back to background execution when none exists. Commands come from your own configuration file; failures only write to the log, and the renderer only sends command ids, so it cannot inject arbitrary commands.

`menu.avoidObstacles` (default `true`) enables obstacle avoidance: the KWin coordinator continuously reports each output's work area (output geometry minus the space occupied by Plasma panels/app bars), and the menu clamps inside it near docks so it is never occluded.

**Dismiss on leaving the wallpaper**: with `menu.closeOnFocusChange` (default `true`), the menu dismisses itself as soon as the pointer leaves the wallpaper (the KWin coordinator also reports switching to another app). Moving the pointer off the wallpaper also dismisses the menu immediately — this covers clicking a window that is **already focused**. The wallpaper windows themselves ignore focus, so right-clicking to open the menu never triggers a spurious close. The menu itself and the app's GUI windows (the settings window) are never dismissed by these mechanisms.

As a fallback, `menu.autoCloseMs` auto-closes the menu after the given number of idle milliseconds (`0` disables it).

## Diagnostics and Common Problems

```bash
mip-paper doctor
journalctl --user -u mip-paper.service -n 100 --no-pager
```

- Active service but no wallpaper: run `mip-paper wallpaper status`, then inspect the KWin rule and coordinator doctor checks.
- Missing audio ribbon: require PASS for `command:pw-cat`, `command:pw-metadata`, and `audio-output`, then check the default output device.
- Unavailable weather: check credential mode, Portal permission, and network access. The key is never printed.
- No normal window after `start`: expected; the windows live on the desktop layer.

Run the renderer scheduling probe with `mip-paper probe --duration 60`.
