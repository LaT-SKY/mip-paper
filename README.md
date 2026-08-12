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

Mip-Paper 附带一张由 LaT-SKY 拍摄并以 CC BY 4.0 授权的默认照片，详见 [图片归属说明](assets/ATTRIBUTION.md)。发行副本已移除 EXIF 等元数据。项目不附带第三方壁纸，也不会自动下载外部图片。

默认使用 KDE 同步模式：每台显示器分别采用 Plasma 在该屏选择的 `org.kde.image` 静态图片，并在 KDE 设置变化后自动同步。监听器不轮询；配置写入经过 350 ms 防抖，只有图片路径、大小或修改时间变化才复制和解码图片。

KDE 幻灯片与第三方动态壁纸插件暂不支持。该屏会保留上一张有效缓存；首次没有缓存时使用随包默认照片。

手动指定一张图片会切换到 manual 模式并应用到所有显示器。手动图片保存在：

```text
${XDG_DATA_HOME:-$HOME/.local/share}/mip-paper/wallpaper
```

也可以在 setup 时使用 `--image /path/to/image`，或稍后导入自己的 JPEG、PNG 或 WebP。导入后原文件可以移动或删除。用户应确保自己有权使用所选图片；程序的 GPL 许可证不适用于用户导入的图片。

设置或更换图片：

```bash
mip-paper wallpaper set /path/to/image.png
mip-paper wallpaper status
```

恢复按显示器跟随 KDE：

```bash
mip-paper wallpaper use-kde
```

替换失败时会保留上一张有效图片。若服务正在运行，成功更换后会自动重启壁纸。

## 环境要求

- Arch Linux 或兼容环境
- KDE Plasma 6、KWin >= 6.7、Wayland 会话；6.7 之前的 KWin scripting API 不在支持范围内
- systemd 用户管理器
- PipeWire、WirePlumber、`pw-cat`、`pw-metadata`
- GeoClue（仅自动定位需要）

## 安装与卸载

### 通过 AUR 安装

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

`setup` 创建缺失的配置与天气凭据，默认按显示器读取 KDE 静态壁纸，安装当前用户的 KWin 规则、启用系统 KWin coordinator，并启动 `mip-paper.service`。无法读取 KDE 静态图片的屏幕使用随包默认照片。已有配置、凭据和受管理图片不会被覆盖。要在首次设置时直接切换到 manual 模式并使用自己的图片，可运行 `mip-paper setup --image /path/to/image.png`。

完成后，`setup` 会明确显示当前壁纸文件、替换壁纸的命令以及天气是否仍需配置。默认照片只是初始值，随时可以运行：

```bash
mip-paper wallpaper set /path/to/image.jpg
```

### 从源码安装与开发验证

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

### 卸载

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

## 使用方法

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

先登录[和风天气控制台](https://console.qweather.com/)创建项目和 API Key；控制台分配的 API Host 与 API Key 分别填入上面的字段。写入后收紧权限：

```bash
chmod 600 ~/.config/mip-paper/weather-credentials.json
```

Host 只填写 HTTPS 域名，不包含协议、路径、查询参数或用户信息。Key 只由主进程读取，不进入 renderer、URL、日志或缓存。保存合法凭据后会立即重新定位并刷新天气；无效、不安全、未完整写入或被删除的文件会保留最后一份有效凭据，修正后自动恢复。

实时天气每 30 分钟刷新，预报和潮汐每 6 小时刷新。缓存 6 小时内为 fresh，6 至 24 小时为 stale，超过 24 小时为 unavailable。天气数据由和风天气提供；`qweather-icons@1.8.0` 代码采用 MIT，图标采用 CC BY 4.0。

## 配置文件

配置位于 `~/.config/mip-paper/config.json`。`wallpaper.mode` 可设为 `kde`（默认，按显示器跟随 Plasma 静态壁纸）或 `manual`（所有显示器使用手动导入的图片）。强调色通过 `color.mode` 选择：`default` 保留当前粉色默认配色，`kde` 跟随 KDE 强调色，`wallpaper` 从每台显示器壁纸取色，`hybrid`（默认）优先壁纸再回退 KDE。`color.transitionDurationMs` 默认 `900` ms，范围 `0–5000`；`0` 立即切换。系统启用“减少动态效果”时过渡自动关闭。所有配置均支持实时热加载。完整默认值：

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
  "frameRate": {
    "interactive": 60,
    "drift": 12
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

未知字段会被拒绝。保存合法文件后所有字段自动生效，不会重启 Electron 或壁纸窗口。JSON 错误、未知字段、越界值、未完整写入或删除文件都会保留最后一份有效配置；文件修正后自动恢复热加载。`mip-paper restart` 仍可用于服务管理和故障排查，但不是正常配置步骤。音频字段的错误值沿用兼容行为并回退到默认值。

### 顶层与帧率

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `interactionEnabled` | boolean | `true` | 是否接收鼠标并驱动视差；关闭后窗口穿透鼠标 | 实时热加载 |
| `frameRate.interactive` | 整数，`1–180` FPS | `60` | 交互与回归阶段目标帧率 | 实时热加载 |
| `frameRate.drift` | 整数，`1–180` FPS | `12` | 待机漂移阶段目标帧率 | 实时热加载 |

### 动态强调色

每块屏幕独立使用其当前壁纸的强调色：不同壁纸可以显示不同颜色，信息卡和三层音频频谱都使用所在屏幕自己的颜色。分析结果按壁纸内容缓存，而不是按显示器编号缓存；相同图片可跨屏复用结果，执行 A → B → A 或重启服务后会恢复 A 原来的颜色。

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `color.mode` | `default`、`kde`、`wallpaper` 或 `hybrid` | `hybrid` | 保留默认配色、跟随 KDE、按屏幕壁纸取色，或按壁纸→KDE→默认顺序回退 | 实时热加载 |
| `color.transitionDurationMs` | 整数，`0–5000 ms` | `900` | 强调色切换时长；`0` 为立即切换，减少动态效果时强制为 `0` | 实时热加载 |

### 音频可视化

全部 `audio.*` 配置均实时热加载，并原位更新当前频谱控制器。

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
| `motion.interactionSpeed` | 有限数值，`> 0` | `1.15` | 指针交互追随速度 | 实时热加载 |
| `motion.returnSpeed` | 有限数值，`> 0` | `0.3` | 从交互姿态返回漂移轨迹的速度 | 实时热加载 |
| `motion.driftSpeed` | 有限数值，`> 0` | `1` | 待机漂移速度倍率 | 实时热加载 |
| `motion.deadZonePx` | 有限数值，`>= 0` px | `2` | 过滤细小指针抖动的滑动死区 | 实时热加载 |
| `motion.horizontalPanPercent` | 有限数值，`>= 0` % | `4.6` | 最大水平平移占视口宽度的比例 | 实时热加载 |
| `motion.verticalPanPercent` | 有限数值，`>= 0` % | `4.5` | 最大垂直平移占视口高度的比例 | 实时热加载 |
| `motion.maxRotationDegrees` | 有限数值，`>= 0` 度 | `0.7` | 最大画面旋转角度 | 实时热加载 |

### 悬浮信息面板

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `panel.autoExpandHide` | boolean | `true` | 按鼠标距离自动展开并延迟收起 | 实时热加载 |
| `panel.expandTriggerDistancePx` | 有限数值，`>= 0` px | `48` | 触发下一块面板展开所需的累计指针移动 | 实时热加载 |
| `panel.collapseDelaySeconds` | 有限数值，`>= 0` 秒 | `8` | 无交互后开始收起的等待时间 | 实时热加载 |
| `panel.expanded` | boolean | `true` | 禁用自动模式时使用的固定展开状态 | 实时热加载 |
| `panel.collapsedOpacity` | `0–1` | `0.08` | 收起面板的最低不透明度 | 实时热加载 |
| `panel.animation.staggerDelayMs` | 有限数值，`>= 0` ms | `60` | 多块面板依次动画的错开时间 | 实时热加载 |
| `panel.animation.durationMs` | 有限数值，`>= 400` ms | `950` | 包含两次回弹的单块面板动画时长 | 实时热加载 |

### 天气、定位与潮汐

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `weather.location.mode` | `auto` 或 `fixed` | `auto` | 自动 Portal 定位或固定坐标 | 实时热加载 |
| `weather.location.latitude` | `null` 或 `-90–90` | `null` | fixed 模式纬度；必须与经度同时提供 | 实时热加载 |
| `weather.location.longitude` | `null` 或 `-180–180` | `null` | fixed 模式经度；必须与纬度同时提供 | 实时热加载 |
| `weather.location.fallbackLocationId` | 非空字符串 | `101281601` | 自动定位和缓存均失败时使用的和风 LocationID | 实时热加载 |
| `weather.tideStationId` | 非空字符串 | `P2352` | 潮汐观测站 ID | 实时热加载 |

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

渲染调度性能实验：

```bash
mip-paper probe --duration 60
```

## 隐私与许可证

### 只响应媒体输出

音频可视化通过 PipeWire 跟随当前默认输出设备。实现使用 `stream.capture.sink=true` 连接输出设备的 monitor 端口，并把流标记为 `Stream/Input/Audio/Internal`。它不会连接麦克风，不会录制或保存 PCM 音频，也不会作为录音应用出现在 Plasma 麦克风列表中。

原始 PCM 只在主进程内短暂进入 FFT 管线，不会写入磁盘、日志、缓存、IPC 或 renderer。三层曲线围绕共同基线分别显示左声道、右声道和合并频谱，并从所在屏幕的动态强调色派生不同亮度。曲线不使用辉光、磨砂背景、边框或面板阴影。

### 许可证与第三方组件

Mip-Paper 程序代码采用 `GPL-3.0-only`，详见 [LICENSE](LICENSE)。Copyright (C) 2026 LaT-SKY。

默认照片 Copyright (C) 2026 LaT-SKY，采用 CC BY 4.0，归属和修改说明见 [assets/ATTRIBUTION.md](assets/ATTRIBUTION.md)。随包保留的 JavaScript 依赖代码采用各自许可证，主要为 MIT；和风天气图标采用 CC BY 4.0。AUR 的 PKGBUILD 与安装脚本单独采用 0BSD。用户导入图片的权利与许可证由用户自行负责。
