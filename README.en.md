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

Mip-Paper includes a default photograph by LaT-SKY under CC BY 4.0; see the [image attribution](assets/ATTRIBUTION.md). The former third-party wallpaper is not included, and Mip-Paper does not download external images automatically; you can import your own JPEG, PNG, or WebP images. See the [Quick Start guide](docs/guides/quickstart.en.md) for wallpaper modes, KDE synchronization, image import, and the context menu.

## Index

| Document | Description |
| --- | --- |
| [Quick Start](docs/guides/quickstart.en.md) · [快速开始](docs/guides/quickstart.md) | Requirements, installation and removal, usage, wallpaper management, KWin integration, weather service, context menu, troubleshooting |
| [Configuration](docs/guides/configuration.en.md) · [配置](docs/guides/configuration.md) | Reference tables for every `config.json` field and default |
| [Privacy and Licenses](docs/guides/privacy.en.md) · [隐私与许可证](docs/guides/privacy.md) | Audio privacy boundaries and third-party component licenses |
| [Engineering docs](docs/README.md) | Research records and engineering documentation index |
| [CHANGELOG](CHANGELOG.md) | Version history |

The program code is `GPL-3.0-only` (Copyright (C) 2026 LaT-SKY) and the default photograph is CC BY 4.0; see [Privacy and Licenses](docs/guides/privacy.en.md).
