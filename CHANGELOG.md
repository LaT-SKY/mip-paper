# Changelog

All notable changes to Mip-Paper are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — 0.3.2 (in development)

### Added

- Right-click context menu on the wallpaper: built-in actions (refresh
  wallpaper, pin/toggle the information panels, pause/resume the display) and
  data-driven custom shell commands from `menu.customCommands` (background
  fire-and-forget or terminal-emulator mode). The menu follows the light/dark
  appearance, is scoped to the right-clicked display, and stays extensible for
  a future settings page.
- Pause a display's wallpaper while a fullscreen or maximized window covers
  it (`motion.pauseWhenFullscreen`, default `true`): the render loop stops
  and the camera, panels, and audio ribbon freeze until the window returns to
  normal size or moves away; other displays are unaffected. The KWin display
  coordinator detects covering windows (fullscreen property or geometry
  matching the output's maximize area) and reports them over the session bus
  `org.mip.Paper`; the service restarts the coordinator on startup to
  re-sync state after app or KWin restarts. The wallpaper's own windows never
  trigger the pause.

### Changed

- The KWin window rule forces the wallpaper window to ignore focus again
  (`acceptfocus=false`): the context menu is mouse-driven and other windows
  must keep keyboard focus, and not accepting focus prevents KWin from
  re-laying-out the oversized Wayland window on focus changes (which overflowed
  into neighbouring displays). `scripts/kwin-rules.sh` writes the rule and
  upgrades rewrite it in place.

### Changed

- Repository hygiene: stop tracking the local `.idea/` project files and the
  design/plan documents under `docs/design` and `docs/superpowers`; remove the
  abandoned Rust/CXX-Qt experiment directories (`crates/`, `target/`).

### Docs

- Document the KWin window rule and display coordinator in the user guides.
- Add this changelog and a docs index.

## [0.3.1] - 2026-08-16

### Fixed

- Keep the interactive frame rate while an information panel is expanded or a
  panel animation is in flight, instead of dropping to the drift rate early.

## [0.3.0] - 2026-08-16

### Changed

- Gate adaptive rendering by target deadlines: frame work is scheduled against
  the target frame time so missed deadlines do not cascade.

## [0.2.3] - 2026-08-13

### Added

- Light and dark appearance (`appearance.mode` = `light` | `dark` |
  `system`), following the actual luminance of the KDE window background.
- Hot reload of KDE appearance state without restarting Electron or windows.

## [0.2.2] - 2026-08-13

### Internal

- Release preparation; no user-visible changes.

## [0.2.1] - 2026-08-12

### Fixed

- Per-display accent consistency: accent colors are cached by wallpaper
  content, wallpaper transactions publish atomically, and the audio ribbon
  uses the display's dynamic accent colors.

## [0.2.0] - 2026-08-12

### Added

- Dynamic accent colors with `color.mode` = `default` | `kde` |
  `wallpaper` | `hybrid`, computed deterministically from wallpaper content
  and animated between sources.
- Per-display synchronization with Plasma static wallpapers
  (`org.kde.image`), debounced without polling.
- Full configuration hot reload.
- Bundled default wallpaper (CC BY 4.0) and Arch packaging on the system
  Electron runtime.

### Changed

- Lower the default drift frame rate to 30 FPS.

### Security

- Replace the vulnerable image parser and D-Bus dependency.

## [0.1.0] - 2026-08-11

### Added

- Initial release: per-display full-screen Canvas wallpaper with elastic
  camera motion and pointer parallax, floating information panels (time,
  weather, tides, month calendar), QWeather integration, media-audio ribbon,
  transactional user installer, KWin window rule and display coordinator,
  and a Plasma-owned systemd user service.
