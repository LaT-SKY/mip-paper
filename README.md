# Animated Ocean Wallpaper

面向 KDE Plasma 6、KWin 和 Wayland 的 Electron/Canvas 2D 动态壁纸技术原型。
它使用 `161-2.jpeg` 作为完整画面，通过弹性镜头、鼠标交互和待机微漂移产生运动。

这不是 Plasma 原生 wallpaper plugin。每块显示器对应一个由 KWin 管理的 Electron
窗口，因此窗口层级、任务切换器隔离和输入行为必须在目标桌面上实机验证。

## 环境

- KDE Plasma 6
- KWin 6
- Wayland 会话
- Node.js 与 npm
- `systemd --user`
- `kreadconfig6`、`kwriteconfig6` 和 `qdbus6`

安装器只写入当前用户目录，不使用 `sudo`。

## 安装

从仓库根目录执行：

```bash
./bin/animated-ocean-wallpaper install
```

默认会安装并立即启用用户服务。只安装、不启动：

```bash
./bin/animated-ocean-wallpaper install --no-start
```

安装内容：

| 内容 | 路径 |
| --- | --- |
| 程序快照 | `~/.local/lib/animated-ocean-wallpaper/` |
| 命令入口 | `~/.local/bin/animated-ocean-wallpaper` |
| 配置 | `~/.config/animated-ocean-wallpaper/config.json` |
| 用户服务 | `~/.config/systemd/user/animated-ocean-wallpaper.service` |
| KWin 规则 | `~/.config/kwinrulesrc` 中的 `animated-ocean-wallpaper` 规则组 |

重复安装会替换程序快照，但保留现有用户配置。依赖准备或集成步骤失败时，安装器恢复
之前的项目快照、入口和服务文件。它不会覆盖或删除其他 KWin 规则。

## 命令

```bash
animated-ocean-wallpaper start
animated-ocean-wallpaper stop
animated-ocean-wallpaper restart
animated-ocean-wallpaper status
animated-ocean-wallpaper doctor
```

查看服务日志：

```bash
journalctl --user -u animated-ocean-wallpaper.service -f
```

`doctor` 自动检查环境、安装快照、配置、服务和 KWin 规则。窗口层级、面板可见性、
Alt+Tab/概览隔离、鼠标输入、多显示器热插拔、锁屏恢复和资源占用会标为 `MANUAL`，
需要人工验收。

## 配置

默认配置：

```json
{
  "interactionEnabled": true,
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
    "maxRotationDegrees": 0.7
  }
}
```

帧率不得低于 `30`。配置包含未知字段、错误类型或越界值时，运行器拒绝启动并在用户
服务日志中报告具体问题。修改配置后执行：

```bash
animated-ocean-wallpaper restart
```

## 卸载

保留用户配置：

```bash
animated-ocean-wallpaper uninstall
```

同时删除配置：

```bash
animated-ocean-wallpaper uninstall --purge
```

卸载会停止并禁用服务，删除程序快照、命令入口、服务文件和本项目 KWin 规则。

## 开发验证

```bash
npm ci
npm test
npm run check
bash -n bin/animated-ocean-wallpaper scripts/kwin-rules.sh
```

设计与实施计划分别位于：

- `docs/design/v1/animated-ocean-wallpaper.md`
- `docs/superpowers/plans/2026-08-07-animated-ocean-wallpaper-v1.md`
