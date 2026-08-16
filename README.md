# Mip-Paper

[English](README.en.md)

Mip-Paper 是面向 KDE Plasma 6、KWin 6 和 Wayland 的动态桌面壁纸引擎。它把默认或用户选择的图片以覆盖方式绘制到每台显示器的全屏 Canvas 上，并加入缓慢漂移、鼠标视差、立体悬浮信息面板和媒体音频频谱。

Mip-Paper 不是 Plasma 原生 wallpaper plugin，也不会打开普通应用窗口。它由 Electron 创建受 KWin 管理的桌面层窗口；窗口不会进入任务栏、分页器、Alt+Tab 或应用启动器。

### 功能概览

- 每台显示器独立渲染，支持不同分辨率、缩放、布局和热插拔。
- 指针移动驱动平移、缩放与轻微旋转；停止交互后平滑回归并进入缓慢漂移。
- 时间、天气、潮汐和月历四块悬浮信息面板根据鼠标距离依次展开，并按相反顺序收起。
- 天气使用和风天气数据与官方图标，可通过 XDG Desktop Portal 自动定位，也可使用固定经纬度。
- 音频声带显示左声道、右声道和合并频谱，只响应当前默认输出设备正在播放的媒体音频。
- systemd 用户服务随 Plasma 工作区启动，并在注销、关机和重启时完成有序清理。

## 壁纸与展示

![Mip-Paper 随包默认壁纸](assets/default-wallpaper.jpg)

<!-- 完整桌面效果截图预留位置：docs/images/mip-paper-desktop.webp -->

Mip-Paper 附带一张由 LaT-SKY 拍摄并以 CC BY 4.0 授权的默认照片，详见[图片归属说明](assets/ATTRIBUTION.md)。项目不附带第三方壁纸，也不会自动下载外部图片；支持导入自己的 JPEG、PNG 或 WebP 图片。壁纸模式、KDE 同步、图片导入与右键菜单的详细说明见[快速开始指南](docs/guides/quickstart.md)。

## 索引

| 文档 | 说明 |
| --- | --- |
| [快速开始](docs/guides/quickstart.md) · [Quick Start](docs/guides/quickstart.en.md) | 环境要求、安装与卸载、使用方法、壁纸管理、KWin 集成、天气服务、右键菜单、诊断 |
| [配置](docs/guides/configuration.md) · [Configuration](docs/guides/configuration.en.md) | `config.json` 全部配置项与默认值参考表 |
| [隐私与许可证](docs/guides/privacy.md) · [Privacy and Licenses](docs/guides/privacy.en.md) | 音频隐私边界与第三方组件许可 |
| [工程文档](docs/README.md) | 研究记录与工程文档索引 |
| [CHANGELOG](CHANGELOG.md) | 版本变更记录 |

程序代码采用 `GPL-3.0-only`（Copyright (C) 2026 LaT-SKY），默认照片采用 CC BY 4.0，详见[隐私与许可证](docs/guides/privacy.md)。
