# Animated Ocean Wallpaper

面向 KDE Plasma 6、KWin 6 和 Wayland 的动态桌面壁纸运行器。程序使用 Electron 创建每显示器一个的全屏 Canvas 窗口，绘制 `assets/161-2.jpeg`，并提供缓慢漂移与鼠标视差交互。

这是一个 Electron 壁纸运行器，不是 Plasma 原生 wallpaper plugin，也不是会弹出主窗口的桌面应用。执行 `start` 后，壁纸应直接出现在桌面背景层；不会出现在任务栏、Alt+Tab 或应用启动器中。

## 要求

- KDE Plasma 6 和 KWin 6
- Wayland 会话
- Node.js、npm、Electron 43.3.0
- `systemd --user`
- `kreadconfig6`、`kwriteconfig6`
- GeoClue（自动定位时需要）

Arch Linux 安装并启动 GeoClue：

```bash
sudo pacman -S geoclue
sudo systemctl enable --now geoclue
gsettings set org.gnome.system.location enabled true
```

安装后重新登录一次，让桌面会话启动 GeoClue 授权代理；软件包是在当前会话中刚安装时，这一步尤其重要。GeoClue 是按需启动的 D-Bus 服务，空闲后显示 `inactive` 属于正常行为。

其他发行版请安装对应的 GeoClue 软件包、启用全局定位并确保授权代理随桌面会话启动。应用仍通过 XDG Desktop Portal 请求位置，不会由 renderer 直接访问 GeoClue；桌面环境的定位权限设置也必须允许该请求。

安装器只写入当前用户目录，不需要 `sudo`。

## 安装或更新

在仓库根目录执行：

```bash
./bin/animated-ocean-wallpaper install
```

这会完成以下操作：

1. 将当前源码复制到 `~/.local/lib/animated-ocean-wallpaper/`。
2. 在安装快照中执行 `npm ci --omit=dev`，准备 Electron 运行时。
3. 安装命令入口 `~/.local/bin/animated-ocean-wallpaper`。
4. 写入 systemd 用户服务、KWin 壁纸窗口规则和多显示器 coordinator。
5. 执行 `systemctl --user enable --now`，立即启动并设置登录自启。

KWin 规则负责移除窗口边框，以及桌面层级、任务栏、分页器和 Alt+Tab 隔离。coordinator 读取每个 Electron 窗口标题中的目标显示器描述，并把窗口移动到唯一匹配的输出；KWin 保留每个输出的实际缩放和窗口几何。显示器重连后会创建新的 Electron 窗口，因此该屏幕会从独立的运动状态重新开始。

安装完成后，自动启动状态可以这样确认：

```bash
systemctl --user is-enabled animated-ocean-wallpaper.service
```

输出 `enabled` 即表示下次登录会自动启动。若曾手动禁用，可重新启用：

```bash
systemctl --user enable --now animated-ocean-wallpaper.service
```

只更新文件、不启动服务：

```bash
./bin/animated-ocean-wallpaper install --no-start
```

修改源码后，必须重新执行 `install`，因为服务运行的是 `~/.local/lib` 中的安装快照，不是仓库目录。重复安装也会更新本项目已有的 KWin 规则。

## 启动、停止和查看状态

```bash
animated-ocean-wallpaper start
animated-ocean-wallpaper stop
animated-ocean-wallpaper restart
animated-ocean-wallpaper status
```

如果 shell 找不到命令，使用完整路径：

```bash
~/.local/bin/animated-ocean-wallpaper start
```

`start` 只启动后台用户服务，不会打开普通应用窗口；当前版本会打印一行服务请求确认。确认是否真的启动：

```bash
systemctl --user is-active animated-ocean-wallpaper.service
systemctl --user status animated-ocean-wallpaper.service --no-pager -l
```

第一个命令应输出 `active`。壁纸窗口被 KWin 放在桌面层，因此不能通过 Alt+Tab 找到。

## 排错

先运行诊断：

```bash
animated-ocean-wallpaper doctor
```

查看本次服务日志：

```bash
journalctl --user -u animated-ocean-wallpaper.service -n 100 --no-pager
```

查看 KWin coordinator 的定位日志：

```bash
journalctl --user -b --no-pager | grep animated-ocean-coordinator
```

常见情况：

- `status=203/EXEC`：安装快照缺少 Electron，重新执行 `install`。
- `Wallpaper failed to start`：查看日志中的配置或 preload 错误，确认安装快照已更新。
- 服务是 `active` 但桌面没有壁纸：确认 `doctor` 的 `KWin rule` 和 `KWin coordinator` 都为 `PASS`，然后执行 `restart`。规则文件是 `${XDG_CONFIG_HOME:-$HOME/.config}/kwinrulesrc`。
- `start` 无任何窗口：这是预期行为；本项目没有普通应用窗口，检查桌面背景和 `systemctl --user is-active`。

`doctor` 会自动检查环境、配置、Electron 快照、服务、KWin 规则和 coordinator；窗口层级、面板遮挡、鼠标输入、多显示器热插拔、锁屏恢复和资源占用仍需人工确认。

## 配置

配置文件：`~/.config/animated-ocean-wallpaper/config.json`。

```json
{
  "interactionEnabled": true,
  "frameRate": { "interactive": 60, "drift": 30 },
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

天气凭据与普通配置分开保存在 `~/.config/animated-ocean-wallpaper/weather-credentials.json`。安装器首次创建该文件并设置为 `0600`；重复安装和普通卸载会保留它，只有 `uninstall --purge` 会删除。第三期暂时需要手工填写：

```json
{
  "apiHost": "your-project-host.qweatherapi.com",
  "apiKey": "your-api-key"
}
```

填写后执行 `chmod 600 ~/.config/animated-ocean-wallpaper/weather-credentials.json`。Host 只填写 HTTPS 域名，不包含协议、路径、查询参数或用户信息。Key 仅由主进程读取，不会进入 renderer、URL、日志或缓存。

`weather.location.mode` 为 `auto` 时，通过 XDG Desktop Portal 请求城市级位置；权限被拒绝或定位失败后，使用缓存位置，最后以 `fallbackLocationId` 对应的东莞坐标降级。改为 `fixed` 时必须同时提供数值型 `latitude` 和 `longitude`，并且不请求 Portal。潮汐默认使用观测站 `P2352`。

实时天气每 30 分钟刷新，预报和潮汐每 6 小时刷新。缓存 6 小时内标记为 fresh，6 至 24 小时标记为 stale，超过 24 小时显示 unavailable。天气数据由和风天气提供。天气状态使用本地依赖 `qweather-icons@1.8.0` 映射为和风天气图标；其代码采用 MIT License，图标采用 CC BY 4.0 License。

修改后执行：

```bash
animated-ocean-wallpaper restart
```

未知字段、错误类型或超出限制的数值会阻止启动，并在 service 日志中报告原因。普通配置或凭据修改后都需要重启服务。

## 卸载

保留普通配置和天气凭据：

```bash
animated-ocean-wallpaper uninstall
```

连普通配置和天气凭据一起删除：

```bash
animated-ocean-wallpaper uninstall --purge
```

卸载会停止并禁用服务，删除安装快照、命令入口、服务文件和本项目 KWin 规则，不会删除其他 KWin 规则。

## 开发验证

```bash
npm ci
npm test
npm run check
bash -n bin/animated-ocean-wallpaper scripts/kwin-rules.sh scripts/kwin-script.sh
```

## 渲染性能 Probe

在目标 Plasma Wayland 双屏会话中，可显式运行三种渲染调度策略的对比实验：

```bash
animated-ocean-wallpaper probe --duration 60
```

命令会为 `raf`、`timer` 和 `adaptive` 分别执行待机、持续交互和交互回归场景，输出目录默认位于系统临时目录，也可通过 `--output` 指定。每个场景应先预热 30 秒，再采样 60 秒；`--duration` 用于调整采样时长。实验不会自动修改默认策略，结束后会恢复服务原状态。

交互场景要求有效绘制 FPS 不低于 57、回调间隔 p95 不超过 20 ms；漂移场景要求有效绘制 FPS 不低于 28.5、回调间隔 p95 不超过 40 ms。GPU 指标在本机没有兼容采集工具时会标记为 unavailable，不影响其他指标。

项目设计和研究资料位于 `docs/`。
