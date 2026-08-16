# Changelog

All notable changes to Mip-Paper are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Enabling the packaged KWin coordinator now performs the complete plugin
  manager transition that Plasma's checkbox applies, so a fresh setup does not
  require manually unchecking and rechecking the script.
- Packaged teardown now explains that the system KWin script is pacman-owned
  and must be removed with `sudo pacman -R mip-paper`.

## [0.3.4] - 2026-08-16

### Fixed

- Packaged/AUR setup now loads the KWin display coordinator from its actual
  system package path instead of an absent per-user path, so wallpaper windows
  are assigned to their independent displays after a clean installation.
- KWin script activation now fails loudly when D-Bus loading or startup fails,
  and `mip-paper doctor` verifies that the coordinator is actually loaded.

## [0.3.3] - 2026-08-16

### Added

- Visual settings window, opened from a new built-in 设置 entry in the
  wallpaper context menu: every config.json field is editable through
  switches, selects, and number/text inputs and persists atomically with the
  same validation as config.mjs, then applies through the existing config
  watcher without restarting Electron or wallpaper windows. The window also
  manages QWeather credentials (masked API key, written to
  weather-credentials.json with 0600 permissions), edits menu.customCommands
  in a list editor, and imports JPEG/PNG/WebP wallpapers through a file dialog
  (switching to manual mode). The UI mirrors the context menu's design
  language — white surface in light mode, large rounded corners, SVG icons,
  and the same spring animation (with reduced-motion fallback) — and is
  registered as an app-UI window so wallpaper context menus stay open while
  interacting with it.
- The settings menu command id is reserved so a user custom command cannot
  shadow the settings entry.

### Changed

- The KWin window rule now also matches the wallpaper display-target caption
  (mip-paper|display=, substring match), scoping its forced
  fullscreen/below/no-focus properties to the wallpaper windows so the
  settings window renders as a normal framed, taskbar-visible window above the
  wallpaper.
- README decoupling: the landing README (中文/English) is now a concise page
  with the wallpaper introduction, promotional showcase material, and an
  index; the rest of the user guide moved to docs/guides/ as three bilingual
  documents — 快速开始 (Quick Start), 配置 (Configuration), and 隐私与许可证
  (Privacy and Licenses). Content assertions migrated from test/readme.test.mjs
  to the new test/docs-guides.test.mjs.

### Changed

- Settings window navigation is consolidated from twelve groups to nine
  (交互 / 壁纸 / 外观 / 音频 / 运动与视差 / 信息面板 / 天气 / 右键菜单 / 关于):
  颜色 and 外观 merge into 外观, 帧率 merges into 运动与视差, and 天气凭据
  merges into 天气 as an inline credentials sub-section. Every navigation item
  now carries an SVG icon (settings-fields.mjs owns a dedicated icon set), and
  the Mip-Paper header mark shows a settings gear icon instead of the accent
  dot.
- Mouse input config is split: the single `interactionEnabled` boolean is
  replaced by `mouse.buttonsEnabled` (accept mouse buttons; off makes the
  wallpaper windows click-through, so the context menu and settings entry are
  unavailable) and `mouse.interactionEnabled` (pointer-driven parallax and
  information-panel tracking; off still allows the context menu). The legacy
  top-level key is migrated automatically to both fields. The previously
  misleading "mouse interaction off also disables right-click" hint is gone.
- The settings footer buttons (重新加载 / 恢复默认 / 保存更改) stay pinned to
  the right edge; a status message takes the left slot instead of pushing the
  buttons.
- Wallpaper section of the settings window: the mode dropdown labels drop
  their parenthetical explanations, the current manual wallpaper is previewed
  inline, the pick button and preview are greyed while following KDE, and
  importing an image re-publishes the manual wallpaper immediately (manual
  mode also cache-busts the wallpaper URL so the new file always reloads).
- Status text after saving is simplified to "修改成功".
- `menu.avoidObstacles` is now actually honored: when off the context menu
  appears exactly at the right-click point with no viewport/bottom clamping or
  flipping; when on it keeps the KWin work-area clamping (viewport fallback).
- The custom-command editor is rebuilt: the icon is a visual glyph picker in
  the first column (no more typing icon names), the unique id is auto-managed
  (cmd-1, cmd-2, …) and hidden from the editor so the command input can be
  wider, and the row layout is a stacked field that no longer squeezes the
  inputs into a single column. Per-row operations collapse into one "更多"
  (SVG) button that opens a small menu — move up, move down, delete — plus an
  "自动退出" toggle for terminal-mode commands.
- Terminal-mode menu commands exit the terminal automatically once the
  command finishes (new per-command `menu.customCommands[].autoExit`,
  default `true`); disabling it keeps the window open via `--hold` where
  the emulator supports it or an interactive read suffix otherwise.
- Terminal-mode menu commands actually open a terminal: the emulator lookup
  used to invoke `command -v` as an executable, which always failed because
  `command` is a shell builtin, so terminal mode silently fell back to
  background execution. The lookup now runs through `sh -c`.
- Terminal-mode menu commands honor a user-chosen terminal: `menu.terminal`
  pins the emulator (empty auto-detects in preference order). Known emulators
  (konsole, xfce4-terminal, kitty, gnome-terminal, alacritty, wezterm, foot,
  …) use their native invocation; any other installed terminal is launched
  generically with `-e sh -c`, and a missing configured terminal falls back
  to auto-detection.
- The context menu hides its scrollbar (still scrolls by wheel/touch) so a
  long custom-command list keeps the clean control surface.
- Number inputs render with `color-scheme` so the spinner buttons follow the
  dark theme instead of staying white.
- The About section shows the app logo (assets/logo.png) and the settings
  window uses it as its window icon.

### Docs

- Configuration and quick-start guides describe `mouse.buttonsEnabled` /
  `mouse.interactionEnabled` and the automatic migration of the legacy
  `interactionEnabled` key.

### Docs

- Add the user-guide index to docs/README.md and document the settings
  window, the scoped KWin rule, and the menu/settings unavailability while
  mouse.buttonsEnabled is false.

## [0.3.2] - 2026-08-16

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
- Workspace-aware covering detection: a fullscreen/maximized window only
  pauses the wallpaper when it lives on the display's **current virtual
  desktop** (windows pinned to all desktops still count everywhere). Switching
  workspaces or moving windows across desktops re-evaluates each display live,
  so a video running on another workspace no longer freezes the wallpaper.
  KWin exposes `window.desktops` as an array-like object for which
  `Array.isArray()` is false, so the coordinator normalizes it before
  comparing desktop identity or id.
- Dismiss open context menus when another application is activated
  (`menu.closeOnFocusChange`, default `true`): the KWin coordinator reports
  non-wallpaper window activations over the session bus and every renderer
  closes its menu. Moving the pointer off the wallpaper also dismisses the
  menu, covering clicks on the window that is already focused (no activation
  change fires for it). The context menu itself and future app UI windows
  (e.g. a settings dialog) are excluded from dismissal: the menu is a
  pointer-events surface above the canvas, and app windows are identified by
  the `mip-paper` window class in the coordinator plus an app-UI window
  registry in the main process consulted on pointer-leave. A timed fallback
  (`menu.autoCloseMs`, default `0` = disabled) auto-closes a menu after the
  configured idle delay, independent of the focus signal.

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
