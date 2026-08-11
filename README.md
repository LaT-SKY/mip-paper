# Mip-Paper

[English](README.en.md)

Mip-Paper 是面向 KDE Plasma 6、KWin 6 和 Wayland 的动态桌面壁纸引擎。它把默认或用户选择的图片以覆盖方式绘制到每台显示器的全屏 Canvas 上，并加入缓慢漂移、鼠标视差、立体悬浮信息面板和媒体音频频谱。

Mip-Paper 不是 Plasma 原生 wallpaper plugin，也不会打开普通应用窗口。它由 Electron 创建受 KWin 管理的桌面层窗口；窗口不会进入任务栏、分页器、Alt+Tab 或应用启动器。

## 功能

- 每台显示器独立渲染，支持不同分辨率、缩放、布局和热插拔。
- 指针移动驱动平移、缩放与轻微旋转；停止交互后平滑回归并进入缓慢漂移。
- 时间、天气、潮汐和月历四块悬浮信息面板根据鼠标距离依次展开，并按相反顺序收起。
- 天气使用和风天气数据与官方图标，可通过 XDG Desktop Portal 自动定位，也可使用固定经纬度。
- 音频声带显示左声道、右声道和合并频谱，只响应当前默认输出设备正在播放的媒体音频。
- systemd 用户服务随 Plasma 工作区启动，并在注销、关机和重启时完成有序清理。

## 图片与版权

Mip-Paper 附带一张由 LaT-SKY 拍摄并以 CC BY 4.0 授权的默认照片，详见 [图片归属说明](assets/ATTRIBUTION.md)。发行副本已移除 EXIF 等元数据。项目不附带第三方壁纸，也不会自动下载外部图片。

首次运行 `mip-paper setup` 时，如果用户尚未选择图片，程序会验证默认照片并将其原子复制到：

```text
${XDG_DATA_HOME:-$HOME/.local/share}/mip-paper/wallpaper
```

也可以在 setup 时使用 `--image /path/to/image`，或稍后导入自己的 JPEG、PNG 或 WebP。导入后原文件可以移动或删除。用户应确保自己有权使用所选图片；程序的 GPL 许可证不适用于用户导入的图片。

设置或更换图片：

```bash
mip-paper wallpaper set /path/to/image.png
mip-paper wallpaper status
```

替换失败时会保留上一张有效图片。若服务正在运行，成功更换后会自动重启壁纸。

## 隐私：只响应媒体输出

音频可视化通过 PipeWire 跟随当前默认输出设备。实现使用 `stream.capture.sink=true` 连接输出设备的 monitor 端口，并把流标记为 `Stream/Input/Audio/Internal`。它不会连接麦克风，不会录制或保存 PCM 音频，也不会作为录音应用出现在 Plasma 麦克风列表中。

原始 PCM 只在主进程内短暂进入 FFT 管线，不会写入磁盘、日志、缓存、IPC 或 renderer。白色曲线向上显示左声道，粉色曲线向下镜像显示右声道，较粗的青色合并频谱在共同基线后层显示总体能量。

## 环境要求

- Arch Linux 或兼容环境
- KDE Plasma 6、KWin 6、Wayland 会话
- systemd 用户管理器
- PipeWire、WirePlumber、`pw-cat`、`pw-metadata`
- GeoClue（仅自动定位需要）

## 通过 AUR 安装

使用 yay：

```bash
yay -S mip-paper
```

或使用 paru：

```bash
paru -S mip-paper
```

软件包只安装系统文件，不会以 root 身份修改某个用户的主目录。每位用户首次安装后运行：

```bash
mip-paper setup
```

`setup` 创建缺失的配置与天气凭据、首次导入默认照片、安装当前用户的 KWin 规则、启用系统 KWin coordinator，并启动 `mip-paper.service`。已有配置、凭据和受管理图片不会被覆盖。要在首次设置时直接使用自己的图片，可运行 `mip-paper setup --image /path/to/image.png`。

## 管理壁纸与服务

```bash
mip-paper start
mip-paper stop
mip-paper restart
mip-paper status
mip-paper doctor
```

查看服务日志：

```bash
journalctl --user -u mip-paper.service -n 100 --no-pager
```

`start` 只启动桌面背景服务，不会弹出窗口。确认登录自启动：

```bash
systemctl --user is-enabled mip-paper.service
systemctl --user is-active mip-paper.service
```

## 天气服务

自动定位依赖 GeoClue：

```bash
sudo pacman -S geoclue
sudo systemctl enable --now geoclue
gsettings set org.gnome.system.location enabled true
```

安装后重新登录一次，使桌面会话启动 GeoClue 授权代理。应用通过 XDG Desktop Portal 请求城市级位置，不允许 renderer 直接访问 GeoClue。

天气凭据独立保存在 `~/.config/mip-paper/weather-credentials.json`，权限必须为 `0600`：

```json
{
  "apiHost": "your-project-host.qweatherapi.com",
  "apiKey": "your-api-key"
}
```

Host 只填写 HTTPS 域名，不包含协议、路径、查询参数或用户信息。Key 只由主进程读取，不进入 renderer、URL、日志或缓存。修改凭据后运行 `mip-paper restart`。

实时天气每 30 分钟刷新，预报和潮汐每 6 小时刷新。缓存 6 小时内为 fresh，6 至 24 小时为 stale，超过 24 小时为 unavailable。天气数据由和风天气提供；`qweather-icons@1.8.0` 代码采用 MIT，图标采用 CC BY 4.0。

## 配置文件

配置位于 `~/.config/mip-paper/config.json`。完整默认值：

```json
{
  "interactionEnabled": true,
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
    "maxRotationDegrees": 0.7
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
  }
}
```

未知字段会被拒绝。`audio.*` 字段支持实时热加载；其他配置修改后需要重启壁纸服务，请运行 `mip-paper restart`。除 `audio.*` 外，错误类型或越界值会阻止服务启动并写入日志；音频字段的错误值会回退到默认值。

### 顶层与帧率

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `interactionEnabled` | boolean | `true` | 是否接收鼠标并驱动视差；关闭后窗口穿透鼠标 | 重启 |
| `frameRate.interactive` | 数值，`>= 30` FPS | `60` | 交互与回归阶段目标帧率 | 重启 |
| `frameRate.drift` | 数值，`>= 30` FPS | `30` | 待机漂移阶段目标帧率 | 重启 |

### 音频可视化

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `audio.enabled` | boolean | `true` | 启用或停止输出 monitor 频谱 | 实时热加载 |
| `audio.gain` | `0.25–4` | `1` | 频谱增益 | 实时热加载 |
| `audio.silenceDelayMs` | `0–5000 ms` | `600` | 静音后保持曲线的等待时间 | 实时热加载 |
| `audio.fadeOutMs` | `0–3000 ms` | `450` | 静音或不可用时淡出时长；`0` 为立即完成 | 实时热加载 |
| `audio.fadeInMs` | `0–3000 ms` | `160` | 音频恢复后的淡入时长；`0` 为立即完成 | 实时热加载 |

### 运动与视差

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `motion.interactionSpeed` | 有限数值，`> 0` | `1.15` | 指针交互追随速度 | 重启 |
| `motion.returnSpeed` | 有限数值，`> 0` | `0.3` | 从交互姿态返回漂移轨迹的速度 | 重启 |
| `motion.driftSpeed` | 有限数值，`> 0` | `1` | 待机漂移速度倍率 | 重启 |
| `motion.deadZonePx` | 有限数值，`>= 0` px | `2` | 过滤细小指针抖动的滑动死区 | 重启 |
| `motion.horizontalPanPercent` | 有限数值，`>= 0` % | `4.6` | 最大水平平移占视口宽度的比例 | 重启 |
| `motion.verticalPanPercent` | 有限数值，`>= 0` % | `4.5` | 最大垂直平移占视口高度的比例 | 重启 |
| `motion.maxRotationDegrees` | 有限数值，`>= 0` 度 | `0.7` | 最大画面旋转角度 | 重启 |

### 悬浮信息面板

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `panel.autoExpandHide` | boolean | `true` | 按鼠标距离自动展开并延迟收起 | 重启 |
| `panel.expandTriggerDistancePx` | 有限数值，`>= 0` px | `48` | 触发下一块面板展开所需的累计指针移动 | 重启 |
| `panel.collapseDelaySeconds` | 有限数值，`>= 0` 秒 | `8` | 无交互后开始收起的等待时间 | 重启 |
| `panel.expanded` | boolean | `true` | 禁用自动模式时使用的固定展开状态 | 重启 |
| `panel.collapsedOpacity` | `0–1` | `0.08` | 收起面板的最低不透明度 | 重启 |
| `panel.animation.staggerDelayMs` | 有限数值，`>= 0` ms | `60` | 多块面板依次动画的错开时间 | 重启 |
| `panel.animation.durationMs` | 有限数值，`>= 400` ms | `950` | 包含两次回弹的单块面板动画时长 | 重启 |

### 天气、定位与潮汐

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `weather.location.mode` | `auto` 或 `fixed` | `auto` | 自动 Portal 定位或固定坐标 | 重启 |
| `weather.location.latitude` | `null` 或 `-90–90` | `null` | fixed 模式纬度；必须与经度同时提供 | 重启 |
| `weather.location.longitude` | `null` 或 `-180–180` | `null` | fixed 模式经度；必须与纬度同时提供 | 重启 |
| `weather.location.fallbackLocationId` | 非空字符串 | `101281601` | 自动定位和缓存均失败时使用的和风 LocationID | 重启 |
| `weather.tideStationId` | 非空字符串 | `P2352` | 潮汐观测站 ID | 重启 |

`auto` 模式先请求 Portal，失败后使用缓存位置，最后使用 fallback LocationID。`fixed` 模式必须同时提供数值型纬度和经度，并且不会请求 Portal。

## 诊断与常见问题

```bash
mip-paper doctor
journalctl --user -u mip-paper.service -n 100 --no-pager
```

- 服务 active 但没有画面：运行 `mip-paper wallpaper status`，再检查 doctor 的 KWin rule 与 KWin coordinator。
- 音频声带不显示：确认 `command:pw-cat`、`command:pw-metadata` 和 `audio-output` 为 PASS，并检查默认输出设备。
- 天气 unavailable：检查凭据权限、Portal 定位权限和网络，日志不会打印 Key。
- `start` 没有普通窗口：这是预期行为，壁纸位于桌面层。

## 从源码安装与开发验证

源码安装仍使用系统的 `electron43`，不会复制 npm Electron：

```bash
sudo pacman -S electron43 nodejs npm pipewire pipewire-audio wireplumber
./bin/mip-paper install
```

只准备文件、不启动服务：

```bash
./bin/mip-paper install --no-start
```

开发检查：

```bash
npm ci
npm test
npm run check
bash -n bin/mip-paper scripts/kwin-rules.sh scripts/kwin-script.sh
```

渲染调度性能实验：

```bash
mip-paper probe --duration 60
```

## 卸载

AUR 安装先清理当前用户集成，再由 pacman 删除系统文件：

```bash
mip-paper teardown
sudo pacman -R mip-paper
```

普通 teardown 保留配置、天气凭据和用户图片。显式清除所有 Mip-Paper 用户数据：

```bash
mip-paper teardown --purge
```

源码安装使用 `mip-paper uninstall` 或 `mip-paper uninstall --purge`。

## 许可证与第三方组件

Mip-Paper 程序代码采用 `GPL-3.0-only`，详见 [LICENSE](LICENSE)。Copyright (C) 2026 LaT-SKY。

默认照片 Copyright (C) 2026 LaT-SKY，采用 CC BY 4.0，归属和修改说明见 [assets/ATTRIBUTION.md](assets/ATTRIBUTION.md)。随包保留的 JavaScript 依赖代码采用各自许可证，主要为 MIT；和风天气图标采用 CC BY 4.0。AUR 的 PKGBUILD 与安装脚本单独采用 0BSD。用户导入图片的权利与许可证由用户自行负责。
