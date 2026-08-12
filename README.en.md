# Mip-Paper

[中文](README.md)

Mip-Paper is a dynamic desktop wallpaper engine for KDE Plasma 6, KWin 6, and Wayland. It cover-renders the default or a user-selected image into a full-screen Canvas on every display, with idle drift, pointer parallax, floating information panels, and a media-audio spectrum.

Mip-Paper is not a native Plasma wallpaper plugin and does not open a normal application window. Electron windows are managed by KWin on the desktop layer and are excluded from the taskbar, pager, Alt+Tab, and application launcher.

### Feature Overview

- Independent rendering for displays with different resolutions, scales, layouts, and hot-plug events.
- Pointer-driven pan, zoom, and slight rotation, followed by a smooth return to idle drift.
- Four proximity-driven panels for time, weather, tides, and a complete month calendar.
- QWeather data and official icons, with XDG Desktop Portal or fixed-coordinate location.
- A stereo audio ribbon that reacts only to media playing through the current default output device.
- A Plasma-owned systemd user service with orderly cleanup during logout, shutdown, and restart.

## Wallpaper and Showcase

![Mip-Paper bundled default wallpaper](assets/default-wallpaper.jpg)

<!-- Reserved full desktop screenshot: docs/images/mip-paper-desktop.webp -->

Mip-Paper includes a default photograph by LaT-SKY under CC BY 4.0; see the [image attribution](assets/ATTRIBUTION.md). EXIF and other metadata are removed from the distributed copy. The former third-party wallpaper is not included, and Mip-Paper does not download external images automatically.

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

Setup creates missing configuration and weather credentials, follows each display's KDE static wallpaper by default, installs the user's KWin rule, enables the system KWin coordinator, and starts `mip-paper.service`. Displays without a readable KDE static image use the bundled default. Existing configuration, credentials, and managed images are preserved. To switch directly to manual mode with your own image, run `mip-paper setup --image /path/to/image.png`.

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

Current weather refreshes every 30 minutes; forecasts and tides refresh every 6 hours. Cache state is fresh through 6 hours, stale from 6 to 24 hours, and unavailable after 24 hours. Weather data comes from QWeather. `qweather-icons@1.8.0` code is MIT and its icons are CC BY 4.0.

## Configuration

The configuration file is `~/.config/mip-paper/config.json`. Set `wallpaper.mode` to `kde` (default, follow each display's Plasma static wallpaper) or `manual` (use the manually imported image on every display). Choose `color.mode` as `default` to keep the approved palette, `kde` to follow KDE's accent, `wallpaper` to analyze each display's wallpaper, or `hybrid` (default) to prefer wallpaper and fall back to KDE. `color.transitionDurationMs` defaults to `900` ms and accepts `0–5000`; `0` switches immediately. Reduced motion preferences disable transitions automatically. Every setting supports live reload. Complete defaults:

```json
{
  "interactionEnabled": true,
  "wallpaper": { "mode": "kde" },
  "color": { "mode": "hybrid", "transitionDurationMs": 900 },
  "audio": {
    "enabled": true,
    "gain": 1,
    "silenceDelayMs": 600,
    "fadeOutMs": 450,
    "fadeInMs": 160
  },
  "frameRate": { "interactive": 60, "drift": 12 },
  "motion": {
    "interactionSpeed": 1.15,
    "returnSpeed": 0.3,
    "driftSpeed": 1,
    "deadZonePx": 2,
    "horizontalPanPercent": 4.6,
    "verticalPanPercent": 4.5,
    "maxRotationDegrees": 0.7
  },
  "panel": {
    "autoExpandHide": true,
    "expandTriggerDistancePx": 48,
    "collapseDelaySeconds": 8,
    "expanded": true,
    "collapsedOpacity": 0.08,
    "animation": { "staggerDelayMs": 60, "durationMs": 950 }
  },
  "weather": {
    "location": {
      "mode": "auto",
      "latitude": null,
      "longitude": null,
      "fallbackLocationId": "101281601"
    },
    "tideStationId": "P2352"
  }
}
```

Unknown fields are rejected. Every valid saved field takes effect without restarting Electron or wallpaper windows. Invalid JSON, unknown fields, out-of-range values, incomplete writes, and deleted files retain the last valid configuration and recover automatically when fixed. `mip-paper restart` remains available for service management and troubleshooting, but is not a normal configuration step. Invalid audio values keep their compatibility behavior and fall back to defaults.

### Top Level and Frame Rates

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `interactionEnabled` | boolean | `true` | Accept pointer input for parallax; false enables mouse pass-through | Live reload |
| `frameRate.interactive` | integer, `1–180` FPS | `60` | Target rate during interaction and return | Live reload |
| `frameRate.drift` | integer, `1–180` FPS | `12` | Target rate during idle drift | Live reload |

### Dynamic Accent Color

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `color.mode` | `default`, `kde`, `wallpaper`, or `hybrid` | `hybrid` | Keep the default palette, follow KDE, analyze each display wallpaper, or fall back wallpaper → KDE → default | Live reload |
| `color.transitionDurationMs` | integer, `0–5000 ms` | `900` | Accent transition duration; `0` is immediate and reduced motion forces `0` | Live reload |

### Audio Visualization

Every `audio.*` setting live reloads and updates the active spectrum controller in place.

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `audio.enabled` | boolean | `true` | Start or stop output-monitor visualization | Live reload |
| `audio.gain` | `0.25–4` | `1` | Spectrum gain | Live reload |
| `audio.silenceDelayMs` | `0–5000 ms` | `600` | Hold time after silence begins | Live reload |
| `audio.fadeOutMs` | `0–3000 ms` | `450` | Fade-out time; `0` is immediate | Live reload |
| `audio.fadeInMs` | `0–3000 ms` | `160` | Fade-in time; `0` is immediate | Live reload |

### Motion and Parallax

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `motion.interactionSpeed` | finite number, `> 0` | `1.15` | Pointer-follow response speed | Live reload |
| `motion.returnSpeed` | finite number, `> 0` | `0.3` | Speed returning from interaction to drift | Live reload |
| `motion.driftSpeed` | finite number, `> 0` | `1` | Idle drift speed multiplier | Live reload |
| `motion.deadZonePx` | finite number, `>= 0` px | `2` | Sliding dead zone for pointer noise | Live reload |
| `motion.horizontalPanPercent` | finite number, `>= 0` % | `4.6` | Maximum horizontal pan as viewport percentage | Live reload |
| `motion.verticalPanPercent` | finite number, `>= 0` % | `4.5` | Maximum vertical pan as viewport percentage | Live reload |
| `motion.maxRotationDegrees` | finite number, `>= 0` degrees | `0.7` | Maximum image rotation | Live reload |

### Floating Information Panels

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `panel.autoExpandHide` | boolean | `true` | Expand by pointer proximity and collapse after delay | Live reload |
| `panel.expandTriggerDistancePx` | finite number, `>= 0` px | `48` | Accumulated pointer travel before the next panel expands | Live reload |
| `panel.collapseDelaySeconds` | finite number, `>= 0` seconds | `8` | Idle delay before collapse starts | Live reload |
| `panel.expanded` | boolean | `true` | Fixed state when automatic behavior is disabled | Live reload |
| `panel.collapsedOpacity` | `0–1` | `0.08` | Minimum opacity of collapsed panels | Live reload |
| `panel.animation.staggerDelayMs` | finite number, `>= 0` ms | `60` | Delay between panel animations | Live reload |
| `panel.animation.durationMs` | finite number, `>= 400` ms | `950` | Single-panel animation including two rebounds | Live reload |

### Weather, Location, and Tides

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `weather.location.mode` | `auto` or `fixed` | `auto` | Portal location or configured coordinates | Live reload |
| `weather.location.latitude` | `null` or `-90–90` | `null` | Fixed latitude; must be paired with longitude | Live reload |
| `weather.location.longitude` | `null` or `-180–180` | `null` | Fixed longitude; must be paired with latitude | Live reload |
| `weather.location.fallbackLocationId` | non-empty string | `101281601` | QWeather LocationID used after Portal and cache fail | Live reload |
| `weather.tideStationId` | non-empty string | `P2352` | Tide observation station ID | Live reload |

Auto mode tries the Portal, then cached coordinates, then the fallback LocationID. Fixed mode requires numeric latitude and longitude and does not request the Portal.

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

## Privacy and Licenses

### Media Output Only

The visualizer follows the current default PipeWire output device. It connects to sink monitor ports with `stream.capture.sink=true` and identifies the stream as `Stream/Input/Audio/Internal`. It never connects to a microphone, never records audio, and does not appear as a recording application in Plasma's microphone list.

Raw PCM exists only briefly inside the main-process FFT pipeline. It is never written to disk, logs, cache, IPC, or the renderer. A white upward curve represents the left channel, a mirrored pink downward curve represents the right channel, and a wider cyan combined spectrum shows overall energy behind their shared baseline. The strokes have no glow, frosted background, border, or panel shadow.

### Licenses and Third-Party Components

Mip-Paper program code is `GPL-3.0-only`; see [LICENSE](LICENSE). Copyright (C) 2026 LaT-SKY.

The default photograph is Copyright (C) 2026 LaT-SKY and licensed under CC BY 4.0; attribution and modification details are in [assets/ATTRIBUTION.md](assets/ATTRIBUTION.md). Bundled JavaScript dependencies retain their own licenses, primarily MIT. QWeather icons are CC BY 4.0. AUR package-source files use 0BSD. You remain responsible for the rights and license of any imported image.
