# Configuration

[中文](configuration.md)

The configuration file is `~/.config/mip-paper/config.json`. Set `wallpaper.mode` to `kde` (default, follow each display's Plasma static wallpaper) or `manual` (use the manually imported image on every display). Choose `color.mode` as `default` to keep the approved palette, `kde` to follow KDE's accent, `wallpaper` to analyze each display's wallpaper, or `hybrid` (default) to prefer wallpaper and fall back to KDE. Choose `appearance.mode` as `light`, `dark`, or `system` (default); `system` follows the actual luminance of KDE's window background. `color.transitionDurationMs` defaults to `900` ms and accepts `0–5000`; it controls both accent and appearance transitions, and `0` switches immediately. Reduced motion preferences disable transitions automatically. Every setting supports live reload. Complete defaults:

```json
{
  "mouse": {
    "buttonsEnabled": true,
    "interactionEnabled": true
  },
  "wallpaper": { "mode": "kde" },
  "color": { "mode": "hybrid", "transitionDurationMs": 900 },
  "appearance": {
    "mode": "system",
    "dark": { "wallpaperBrightness": 0.72 }
  },
  "audio": {
    "enabled": true,
    "gain": 1,
    "silenceDelayMs": 600,
    "fadeOutMs": 450,
    "fadeInMs": 160
  },
  "frameRate": {
    "interactive": 60,
    "drift": 30
  },
  "motion": {
    "interactionSpeed": 1.15,
    "returnSpeed": 0.3,
    "driftSpeed": 1,
    "deadZonePx": 2,
    "horizontalPanPercent": 4.6,
    "verticalPanPercent": 4.5,
    "maxRotationDegrees": 0.7,
    "pauseWhenFullscreen": true
  },
  "panel": {
    "autoExpandHide": true,
    "expandTriggerDistancePx": 48,
    "collapseDelaySeconds": 8,
    "expanded": true,
    "collapsedOpacity": 0.08,
    "animation": {
      "staggerDelayMs": 60,
      "durationMs": 950
    }
  },
  "weather": {
    "location": {
      "mode": "auto",
      "latitude": null,
      "longitude": null,
      "fallbackLocationId": "101281601"
    },
    "tideStationId": "P2352"
  },
  "menu": {
    "customCommands": [],
    "avoidObstacles": true,
    "closeOnFocusChange": true,
    "autoCloseMs": 0,
    "terminal": ""
  }
}
```

The legacy top-level `interactionEnabled` key from 0.3.2 and earlier is migrated automatically to `mouse.buttonsEnabled` and `mouse.interactionEnabled` (the old value is applied to both). Unknown fields are rejected. Every valid saved field takes effect without restarting Electron or wallpaper windows. Invalid JSON, unknown fields, out-of-range values, incomplete writes, and deleted files retain the last valid configuration and recover automatically when fixed. `mip-paper restart` remains available for service management and troubleshooting, but is not a normal configuration step. Invalid audio values keep their compatibility behavior and fall back to defaults.

## Top Level and Frame Rates

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `mouse.buttonsEnabled` | boolean | `true` | Accept mouse buttons; false makes the wallpaper windows click-through, so the context menu and the settings entry are unavailable | Live reload |
| `mouse.interactionEnabled` | boolean | `true` | Use pointer movement to drive parallax and the information panels; false only stops parallax, the context menu still opens | Live reload |
| `frameRate.interactive` | integer, `1–180` FPS | `60` | Target rate during interaction, return, expanded panel, and panel animation | Live reload |
| `frameRate.drift` | integer, `1–180` FPS | `30` | Target rate during idle drift when the panel is collapsed and settled | Live reload |

## Light and Dark Appearance

`system` reads KDE's actual window background color and classifies its relative luminance instead of relying on the color-scheme name. `dark` switches the information cards to deep graphite surfaces and dims the wallpaper only during final Canvas composition; `light` preserves original wallpaper brightness. Dynamic accents are always analyzed from the original wallpaper pixels, so appearance changes preserve each display's own accent and color cache.

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `appearance.mode` | `light`, `dark`, or `system` | `system` | Force light, force dark, or follow KDE window background luminance | Live reload |
| `appearance.dark.wallpaperBrightness` | finite number, `0.2–1` | `0.72` | Final wallpaper brightness multiplier in dark mode; `1` does not dim | Live reload |

Appearance and accent transitions share `color.transitionDurationMs`. Saving a mode, brightness, or duration change does not restart Electron, windows, wallpaper images, or accent analysis. Invalid or incomplete candidates retain the last valid configuration and live reload resumes automatically after the file is fixed.

## Dynamic Accent Color

Each display owns an independent accent and perceived luminance derived from its current wallpaper: different wallpapers can use different colors, and both the information cards and all three audio-ribbon layers consume that display's palette. Results are cached by wallpaper content instead of display ID, so identical images can share one result and an A → B → A switch or service restart restores A's previous color.

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `color.mode` | `default`, `kde`, `wallpaper`, or `hybrid` | `hybrid` | Keep the default palette, follow KDE, analyze each display wallpaper, or fall back wallpaper → KDE → default | Live reload |
| `color.transitionDurationMs` | integer, `0–5000 ms` | `900` | Accent transition duration; `0` is immediate and reduced motion forces `0` | Live reload |

## Audio Visualization

Every `audio.*` setting live reloads and updates the active spectrum controller in place.

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `audio.enabled` | boolean | `true` | Start or stop output-monitor visualization | Live reload |
| `audio.gain` | `0.25–4` | `1` | Spectrum gain | Live reload |
| `audio.silenceDelayMs` | `0–5000 ms` | `600` | Hold time after silence begins | Live reload |
| `audio.fadeOutMs` | `0–3000 ms` | `450` | Fade-out time; `0` is immediate | Live reload |
| `audio.fadeInMs` | `0–3000 ms` | `160` | Fade-in time; `0` is immediate | Live reload |

## Motion and Parallax

After effective pointer input stops for `0.95` seconds, the scene returns smoothly at the existing `motion.returnSpeed`; frame-rate switching does not change that setting or the camera trajectory. The first `1.5` seconds of return keep the interactive frame rate, then only the drawing cadence restores the configured drift frame rate while the camera continues its natural return at the original speed. New input restarts this frame-rate hold window. An expanded panel or an in-flight panel animation keeps the interactive frame rate (including during return); only when the panel is collapsed and fully settled does the drawing cadence fall back to the drift frame rate.

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `motion.interactionSpeed` | finite number, `> 0` | `1.15` | Pointer-follow response speed | Live reload |
| `motion.returnSpeed` | finite number, `> 0` | `0.3` | Speed returning from interaction to drift | Live reload |
| `motion.driftSpeed` | finite number, `> 0` | `1` | Idle drift speed multiplier | Live reload |
| `motion.deadZonePx` | finite number, `>= 0` px | `2` | Sliding dead zone for pointer noise | Live reload |
| `motion.horizontalPanPercent` | finite number, `>= 0` % | `4.6` | Maximum horizontal pan as viewport percentage | Live reload |
| `motion.verticalPanPercent` | finite number, `>= 0` % | `4.5` | Maximum vertical pan as viewport percentage | Live reload |
| `motion.maxRotationDegrees` | finite number, `>= 0` degrees | `0.7` | Maximum image rotation | Live reload |
| `motion.pauseWhenFullscreen` | boolean | `true` | Pause that display's wallpaper motion and rendering while a fullscreen or maximized window covers it; resume automatically when it is restored | Live reload |

When a fullscreen or maximized window (video, game, etc.) covers a display, that display's render loop stops completely and the camera, panels, and audio ribbon freeze, saving GPU/CPU; other displays are unaffected. When the window returns to normal size or moves away, the wallpaper continues drifting from the frozen position. The wallpaper's own windows never trigger the pause. The display coordinator (KWin Script) reports covering-window state over the session bus `org.mip.Paper`, visible only to the current desktop session.

**Workspace aware**: the covering check only considers windows on that display's **current virtual desktop** — the wallpaper pauses only when the current workspace has a fullscreen/maximized app. If a workspace has a fullscreen video running but you switch to a workspace without one, the wallpaper keeps drifting instead of freezing; state updates live when windows move across workspaces or you switch desktops. Windows pinned to all desktops count as covering on every workspace.

## Floating Information Panels

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `panel.autoExpandHide` | boolean | `true` | Expand by pointer proximity and collapse after delay | Live reload |
| `panel.expandTriggerDistancePx` | finite number, `>= 0` px | `48` | Accumulated pointer travel before the next panel expands | Live reload |
| `panel.collapseDelaySeconds` | finite number, `>= 0` seconds | `8` | Idle delay before collapse starts | Live reload |
| `panel.expanded` | boolean | `true` | Fixed state when automatic behavior is disabled | Live reload |
| `panel.collapsedOpacity` | `0–1` | `0.08` | Minimum opacity of collapsed panels | Live reload |
| `panel.animation.staggerDelayMs` | finite number, `>= 0` ms | `60` | Delay between panel animations | Live reload |
| `panel.animation.durationMs` | finite number, `>= 400` ms | `950` | Single-panel animation including two rebounds | Live reload |

An expanded panel or an in-flight panel animation renders at the interactive frame rate; after the collapse animation finishes and the cards settle, the drawing cadence falls back to `frameRate.drift`.

## Weather, Location, and Tides

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `weather.location.mode` | `auto` or `fixed` | `auto` | Portal location or configured coordinates | Live reload |
| `weather.location.latitude` | `null` or `-90–90` | `null` | Fixed latitude; must be paired with longitude | Live reload |
| `weather.location.longitude` | `null` or `-180–180` | `null` | Fixed longitude; must be paired with latitude | Live reload |
| `weather.location.fallbackLocationId` | non-empty string | `101281601` | QWeather LocationID used after Portal and cache fail | Live reload |
| `weather.tideStationId` | non-empty string | `P2352` | Tide observation station ID | Live reload |

Auto mode tries the Portal, then cached coordinates, then the fallback LocationID. Fixed mode requires numeric latitude and longitude and does not request the Portal.

## Right-click Context Menu

Menu behavior is described in [Quick Start](quickstart.en.md). Custom commands are added through the `menu.customCommands` array and hot reload as soon as the file is saved; `id` must not collide with the built-in actions:

```json
"menu": {
  "customCommands": [
    { "id": "downloads", "label": "Open Downloads", "command": "xdg-open ~/Downloads", "mode": "background", "icon": "folder" },
    { "id": "update", "label": "System Update", "command": "sudo pacman -Syu", "mode": "terminal", "icon": "update" }
  ]
}
```

| Field | Type / range | Default | Effect | Apply |
| --- | --- | --- | --- | --- |
| `menu.customCommands` | array | `[]` | Custom right-click menu commands | Live reload |
| `menu.customCommands[].id` | non-empty string, unique | — | Command id; `refresh`, `toggle-panel`, `toggle-pause`, and `settings` are reserved | Live reload |
| `menu.customCommands[].label` | non-empty string | — | Label shown in the menu | Live reload |
| `menu.customCommands[].command` | non-empty string | — | Shell command to run | Live reload |
| `menu.customCommands[].mode` | `background` or `terminal` | `background` | Run in the background or in a terminal emulator | Live reload |
| `menu.customCommands[].icon` | non-empty string (built-in icon name) | none | `folder`, `terminal`, `update`, `app`, `info`, `settings`, etc.; unknown names render text only | Live reload |
| `menu.customCommands[].autoExit` | boolean | `true` | Close the terminal window automatically when the command finishes (terminal mode); `false` keeps the window open | Live reload |
| `menu.avoidObstacles` | boolean | `true` | Avoid obstacles: clamp the menu inside the KWin work area (excluding Plasma panels/app bars) so it cannot be occluded; when off the menu appears exactly at the right-click point | Live reload |
| `menu.closeOnFocusChange` | boolean | `true` | Close the menu automatically when another app gains focus | Live reload |
| `menu.autoCloseMs` | finite number, `>= 0` ms | `0` | Auto-close the menu after this many idle milliseconds; `0` disables this fallback | Live reload |
| `menu.terminal` | string | `""` | Terminal emulator command name for terminal-mode menu commands; empty auto-detects in the konsole → xfce4-terminal → kitty → gnome-terminal → alacritty → wezterm → foot → … preference order, and an unpreset terminal is invoked generically as `-e sh -c` | Live reload |
