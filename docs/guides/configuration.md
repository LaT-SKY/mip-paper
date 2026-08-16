# 配置文件

[English](configuration.en.md)

配置位于 `~/.config/mip-paper/config.json`。`wallpaper.mode` 可设为 `kde`（默认，按显示器跟随 Plasma 静态壁纸）或 `manual`（所有显示器使用手动导入的图片）。强调色通过 `color.mode` 选择：`default` 保留当前粉色默认配色，`kde` 跟随 KDE 强调色，`wallpaper` 从每台显示器壁纸取色，`hybrid`（默认）优先壁纸再回退 KDE。外观通过 `appearance.mode` 选择 `light`、`dark` 或 `system`（默认）；`system` 根据 KDE 窗口背景的实际亮度实时切换。`color.transitionDurationMs` 默认 `900` ms，范围 `0–5000`；它同时控制强调色和明暗过渡，`0` 立即切换。系统启用"减少动态效果"时过渡自动关闭。所有配置均支持实时热加载。完整默认值：

```json
{
  "interactionEnabled": true,
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
    "autoCloseMs": 0
  }
}
```

未知字段会被拒绝。保存合法文件后所有字段自动生效，不会重启 Electron 或壁纸窗口。JSON 错误、未知字段、越界值、未完整写入或删除文件都会保留最后一份有效配置；文件修正后自动恢复热加载。`mip-paper restart` 仍可用于服务管理和故障排查，但不是正常配置步骤。音频字段的错误值沿用兼容行为并回退到默认值。

## 顶层与帧率

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `interactionEnabled` | boolean | `true` | 是否接收鼠标并驱动视差；关闭后窗口穿透鼠标 | 实时热加载 |
| `frameRate.interactive` | 整数，`1–180` FPS | `60` | 交互、回归、面板展开与面板动画阶段目标帧率 | 实时热加载 |
| `frameRate.drift` | 整数，`1–180` FPS | `30` | 面板收起且完全静止时的待机漂移阶段目标帧率 | 实时热加载 |

## 明暗外观

`system` 读取 KDE 实际窗口背景色并按相对亮度判定明暗，不依赖配色方案名称。`dark` 将信息卡切换为深石墨表面，并只在最终 Canvas 合成时压暗壁纸；`light` 保持原始壁纸亮度。动态强调色始终从原始壁纸像素计算，因此明暗切换不会改变每块屏幕自己的强调色或颜色缓存。

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `appearance.mode` | `light`、`dark` 或 `system` | `system` | 强制亮色、强制暗色，或跟随 KDE 窗口背景亮度 | 实时热加载 |
| `appearance.dark.wallpaperBrightness` | 有限数值，`0.2–1` | `0.72` | 暗色模式的壁纸最终显示亮度倍率；`1` 不压暗 | 实时热加载 |

明暗过渡与强调色共用 `color.transitionDurationMs`。保存模式、亮度倍率或过渡时长后，现有 Electron 进程、窗口、壁纸和强调色分析均不重启；无效或未写完整的候选继续使用最后一份有效配置，修正后自动恢复实时热加载。

## 动态强调色

每块屏幕独立使用其当前壁纸的强调色与感知亮度：不同壁纸可以显示不同颜色，信息卡和三层音频频谱都使用所在屏幕自己的配色。分析结果按壁纸内容缓存，而不是按显示器编号缓存；相同图片可跨屏复用结果，执行 A → B → A 或重启服务后会恢复 A 原来的颜色。

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `color.mode` | `default`、`kde`、`wallpaper` 或 `hybrid` | `hybrid` | 保留默认配色、跟随 KDE、按屏幕壁纸取色，或按壁纸→KDE→默认顺序回退 | 实时热加载 |
| `color.transitionDurationMs` | 整数，`0–5000 ms` | `900` | 强调色切换时长；`0` 为立即切换，减少动态效果时强制为 `0` | 实时热加载 |

## 音频可视化

全部 `audio.*` 配置均实时热加载，并原位更新当前频谱控制器。

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `audio.enabled` | boolean | `true` | 启用或停止输出 monitor 频谱 | 实时热加载 |
| `audio.gain` | `0.25–4` | `1` | 频谱增益 | 实时热加载 |
| `audio.silenceDelayMs` | `0–5000 ms` | `600` | 静音后保持曲线的等待时间 | 实时热加载 |
| `audio.fadeOutMs` | `0–3000 ms` | `450` | 静音或不可用时淡出时长；`0` 为立即完成 | 实时热加载 |
| `audio.fadeInMs` | `0–3000 ms` | `160` | 音频恢复后的淡入时长；`0` 为立即完成 | 实时热加载 |

## 运动与视差

有效指针输入结束 `0.95` 秒后，画面按原有 `motion.returnSpeed` 平滑回归；该参数和相机运动轨迹不会因帧率切换而改变。回归开始后的前 `1.5` 秒保持交互帧率，随后仅将绘制节拍恢复为 `frameRate.drift` 配置的漂移帧率，相机仍按原速继续自然回归。回归途中再次输入会重新计算这段帧率保持时间。信息面板展开或动画期间一律保持交互帧率（含回归后期）；仅当面板收起且完全静止时，绘制节拍才回落到漂移帧率。

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `motion.interactionSpeed` | 有限数值，`> 0` | `1.15` | 指针交互追随速度 | 实时热加载 |
| `motion.returnSpeed` | 有限数值，`> 0` | `0.3` | 从交互姿态返回漂移轨迹的速度 | 实时热加载 |
| `motion.driftSpeed` | 有限数值，`> 0` | `1` | 待机漂移速度倍率 | 实时热加载 |
| `motion.deadZonePx` | 有限数值，`>= 0` px | `2` | 过滤细小指针抖动的滑动死区 | 实时热加载 |
| `motion.horizontalPanPercent` | 有限数值，`>= 0` % | `4.6` | 最大水平平移占视口宽度的比例 | 实时热加载 |
| `motion.verticalPanPercent` | 有限数值，`>= 0` % | `4.5` | 最大垂直平移占视口高度的比例 | 实时热加载 |
| `motion.maxRotationDegrees` | 有限数值，`>= 0` 度 | `0.7` | 最大画面旋转角度 | 实时热加载 |
| `motion.pauseWhenFullscreen` | boolean | `true` | 显示器被全屏或最大化窗口覆盖时暂停该屏壁纸的移动与渲染，窗口恢复后自动继续 | 实时热加载 |

当某台显示器被全屏或最大化窗口（视频、游戏等）覆盖时，该屏壁纸的渲染循环会完全停止，相机、面板与音频一并冻结，节省 GPU/CPU；其他显示器不受影响。窗口恢复普通大小或移出该屏后，壁纸从冻结位置继续漂移。壁纸自身的窗口不会触发暂停。该功能通过显示协调器（KWin Script）经会话总线 `org.mip.Paper` 上报，仅当前桌面会话可见。

**多工作区感知**：覆盖判定只考虑该显示器**当前虚拟桌面**上的窗口——只有当前工作区存在全屏/最大化应用时才暂停。某个工作区开着全屏视频，切到没有覆盖窗口的工作区时，壁纸会继续漂移，不会误冻结；窗口跨工作区移动或切换工作区时状态实时更新。固定在所有桌面上的窗口（"所有桌面"/on all desktops）在任何工作区都视为覆盖。

## 悬浮信息面板

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `panel.autoExpandHide` | boolean | `true` | 按鼠标距离自动展开并延迟收起 | 实时热加载 |
| `panel.expandTriggerDistancePx` | 有限数值，`>= 0` px | `48` | 触发下一块面板展开所需的累计指针移动 | 实时热加载 |
| `panel.collapseDelaySeconds` | 有限数值，`>= 0` 秒 | `8` | 无交互后开始收起的等待时间 | 实时热加载 |
| `panel.expanded` | boolean | `true` | 禁用自动模式时使用的固定展开状态 | 实时热加载 |
| `panel.collapsedOpacity` | `0–1` | `0.08` | 收起面板的最低不透明度 | 实时热加载 |
| `panel.animation.staggerDelayMs` | 有限数值，`>= 0` ms | `60` | 多块面板依次动画的错开时间 | 实时热加载 |
| `panel.animation.durationMs` | 有限数值，`>= 400` ms | `950` | 包含两次回弹的单块面板动画时长 | 实时热加载 |

面板展开或动画期间使用交互帧率；收起动画结束后、卡片完全静止时，绘制节拍回落到 `frameRate.drift`。

## 天气、定位与潮汐

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `weather.location.mode` | `auto` 或 `fixed` | `auto` | 自动 Portal 定位或固定坐标 | 实时热加载 |
| `weather.location.latitude` | `null` 或 `-90–90` | `null` | fixed 模式纬度；必须与经度同时提供 | 实时热加载 |
| `weather.location.longitude` | `null` 或 `-180–180` | `null` | fixed 模式经度；必须与纬度同时提供 | 实时热加载 |
| `weather.location.fallbackLocationId` | 非空字符串 | `101281601` | 自动定位和缓存均失败时使用的和风 LocationID | 实时热加载 |
| `weather.tideStationId` | 非空字符串 | `P2352` | 潮汐观测站 ID | 实时热加载 |

`auto` 模式先请求 Portal，失败后使用缓存位置，最后使用 fallback LocationID。`fixed` 模式必须同时提供数值型纬度和经度，并且不会请求 Portal。

## 右键菜单

右键菜单的行为说明见[快速开始](quickstart.md)。自定义命令通过 `menu.customCommands` 数组添加，保存后实时热加载；`id` 不可与内置动作重名：

```json
"menu": {
  "customCommands": [
    { "id": "downloads", "label": "打开下载文件夹", "command": "xdg-open ~/Downloads", "mode": "background", "icon": "folder" },
    { "id": "update", "label": "系统更新", "command": "sudo pacman -Syu", "mode": "terminal", "icon": "update" }
  ]
}
```

| 配置项 | 类型/范围 | 默认值 | 作用 | 生效方式 |
| --- | --- | --- | --- | --- |
| `menu.customCommands` | 数组 | `[]` | 自定义右键菜单命令列表 | 实时热加载 |
| `menu.customCommands[].id` | 非空字符串，全数组唯一 | — | 命令标识；`refresh`、`toggle-panel`、`toggle-pause`、`settings` 为内置保留 | 实时热加载 |
| `menu.customCommands[].label` | 非空字符串 | — | 菜单显示文字 | 实时热加载 |
| `menu.customCommands[].command` | 非空字符串 | — | 要执行的 shell 命令 | 实时热加载 |
| `menu.customCommands[].mode` | `background` 或 `terminal` | `background` | 后台执行，或打开终端模拟器运行 | 实时热加载 |
| `menu.customCommands[].icon` | 非空字符串（内置图标名） | 无 | `folder`、`terminal`、`update`、`app`、`info`、`settings` 等；未知则只显示文字 | 实时热加载 |
| `menu.avoidObstacles` | boolean | `true` | 开启避障：菜单按 KWin 工作区（扣除 Plasma 面板/应用栏）钳制，避免被遮挡 | 实时热加载 |
| `menu.closeOnFocusChange` | boolean | `true` | 聚焦到其他应用时自动关闭菜单 | 实时热加载 |
| `menu.autoCloseMs` | 有限数值，`>= 0` ms | `0` | 打开后无人操作超过该时长自动关闭；`0` 关闭此兜底 | 实时热加载 |
