# Changelog

All notable changes to Mip-Paper are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — 0.3.2 (in development)

### Added

- Pause a display's wallpaper while a fullscreen window covers it
  (`motion.pauseWhenFullscreen`, default `true`): the render loop stops and
  the camera, panels, and audio ribbon freeze until the window closes or moves
  away; other displays are unaffected. The KWin display coordinator reports
  per-output fullscreen state over the session bus `org.mip.Paper`, and a
  5-second heartbeat converges after app or KWin restarts. The wallpaper's own
  windows never trigger the pause.

### Removed

- The KWin window rule no longer forces the wallpaper window to ignore focus
  (`acceptfocus`). New installs write no focus rule; upgrades delete the
  legacy `acceptfocus`/`acceptfocusrule` keys so an existing installation is
  cleaned in place (`scripts/kwin-rules.sh`).

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
