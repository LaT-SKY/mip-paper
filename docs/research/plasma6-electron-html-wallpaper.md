# Plasma 6 HTML 壁纸运行方案研究

- 状态：初步研究
- 日期：2026-08-07
- 目标环境：KDE Plasma 6、KWin、Wayland
- 当前验证环境：Plasma 6.7.4、KWin 6.7.4、Wayland
- 图像来源：用户导入的 JPEG、PNG 或 WebP，由应用复制到 XDG 数据目录

## 1. 背景与目标

项目最初计划制作一个完整的 KDE 壁纸安装包，并优先使用 HTML
表达动态内容。现有 HTML 壁纸插件的主要问题是鼠标事件不可用或行为不可靠，
因此需要同时提供可控的 HTML 运行环境。

目标不只是把网页截图作为壁纸，而是让桌面成为可观看、可动画、必要时可交互的
完整画布。目标用户的桌面布局较为简洁，主要保留底部 Plasma 面板，没有依赖大量
桌面图标，因此允许壁纸运行器占据整个桌面区域。

当前范围只考虑 Plasma 6，不要求兼容 Plasma 5。

## 2. 已讨论的技术路线

### 2.1 Plasma 原生插件内嵌 Qt WebEngine

做法是在 Plasma wallpaper plugin 中使用 C++、Qt Quick 和 Qt WebEngine，
将网页离屏渲染为 Plasma 壁纸内容，并在插件内转发输入事件。

优点：

- 生命周期和屏幕几何由 Plasma 管理；
- 从用户视角看是真正的原生壁纸插件；
- 理论上不会产生普通应用窗口或任务切换器条目。

风险：

- 需要自行解决 Qt WebEngine 与 Qt Quick 场景图之间的离屏渲染；
- 鼠标、滚轮、键盘、焦点和输入法事件的转发复杂；
- GPU 上下文、缩放比例、多屏和 Plasma 重载会增加稳定性风险；
- 依赖 Qt WebEngine，部署体积仍然较大。

### 2.2 Qt Quick WebView

代码量可能更少，但 Linux 桌面端的后端可用性、离屏行为和输入支持不够明确。
目前不作为优先路线。

### 2.3 Chromium/Electron 外部窗口

做法是使用 Electron 创建无边框 Chromium 窗口，每个显示器对应一个窗口，
窗口加载本地 HTML 壁纸内容。KWin 负责将窗口约束到接近桌面背景的行为。

优点：

- 直接获得完整 HTML、CSS、JavaScript、Canvas、WebGL 和媒体能力；
- 原生 DOM 鼠标事件无需跨 Qt 场景图桥接；
- 开发、调试和加载不同 HTML 壁纸包较直接；
- Electron `screen` API 可以枚举显示器，并监听显示器增加、移除和参数变化。

缺点：

- 它不是 Plasma 的 wallpaper surface，而是受 KWin 管理的应用窗口；
- Electron 没有直接暴露 KDE layer-shell 的桌面背景层接口；
- 窗口层级、任务栏可见性、焦点和虚拟桌面行为需要 KWin 规则或额外集成；
- Chromium/Electron 的内存和磁盘开销高于原生 Qt 壁纸插件；
- Plasma 桌面图标、桌面小部件与外部窗口的前后关系需要实机验证。

## 3. Electron API 调查结果

以下结论基于 2026-08-07 查阅的 Electron 官方文档。

| 能力 | Electron API | Linux 情况 | 结论 |
| --- | --- | --- | --- |
| 枚举显示器 | `screen.getAllDisplays()` | 支持 | 可为每块屏幕创建独立窗口 |
| 监听显示变化 | `display-added`、`display-removed`、`display-metrics-changed` | 支持 | 可响应热插拔、分辨率和缩放变化 |
| 跨工作区显示 | `setVisibleOnAllWorkspaces()` | 文档标注支持 Linux | 可作为辅助能力，但仍需 KWin 实测 |
| 鼠标穿透 | `setIgnoreMouseEvents()` | API 未排除 Linux | 可提供交互/穿透模式切换 |
| 跳过任务栏 | `setSkipTaskbar()` | 方法文档只标注 macOS、Windows | Linux 上不能把它作为可靠保证 |
| 禁止窗口聚焦 | `setFocusable()` | 方法文档只标注 macOS、Windows | Linux 上需要依靠 KWin 规则或其他机制 |

因此，Electron 自身不足以完整定义 KDE 桌面窗口语义。尤其不能假设
`setSkipTaskbar()` 和 `setFocusable()` 在 Plasma Wayland 会按预期工作。

## 4. 推荐的实验架构

当前推荐先制作一个深度集成 Plasma/KWin 的 Electron 壁纸运行器原型，
不要在验证前将它描述为 Plasma 原生 wallpaper plugin。

### 4.1 进程与窗口

- 一个 Electron 主进程负责壁纸包发现、配置、生命周期和显示器变化；
- 每块显示器创建一个无边框 `BrowserWindow`；
- 每个窗口使用对应显示器的完整边界，而不是 `workArea`，使内容可以延伸到面板后方；
- 窗口使用固定的应用标识、窗口标题或窗口角色，供 KWin 规则稳定匹配；
- 页面加载本地受信任资源，不允许任意远程页面获得 Node.js 权限。

### 4.2 KWin 集成

计划通过随安装包提供的 KWin 窗口规则约束壁纸窗口：

- 保持在其他普通应用窗口下方；
- 跳过任务栏、分页器和窗口切换器；
- 显示在所有虚拟桌面和活动中；
- 禁止装饰、移动、改变大小和主动抢占焦点；
- 保证 Plasma 面板和普通应用窗口位于壁纸之上。

这些规则目前属于设计假设，不是已经验证的结果。需要特别验证 Wayland 下 KWin
能否稳定匹配 Electron 窗口，以及“保持在下方”时窗口是否仍能接收预期输入。

### 4.3 输入模式

建议提供两种模式：

1. 交互模式：HTML 页面正常接收鼠标移动、点击和滚轮事件；
2. 穿透模式：调用 `setIgnoreMouseEvents(true)`，让输入落到 Plasma 桌面。

模式切换应使用全局快捷键或托盘/配置入口，不能依赖壁纸页面内的按钮，否则进入
穿透模式后将无法从页面自身恢复。

### 4.4 会话与恢复

- 使用 `systemd --user` 启动壁纸运行器；
- 在 Plasma 图形会话可用后启动；
- 对异常退出设置有限度的自动重启；
- 正常退出时销毁所有显示器窗口；
- 屏幕锁定、休眠或电池模式下可以暂停动画，降低 GPU 和电量消耗。

## 5. 与“Plasma 原生壁纸插件”的关系

外部 Electron 窗口和 Plasma wallpaper plugin 是两种不同的窗口模型。
Electron 路线的主要价值是完整 Web 平台和原生 DOM 输入；代价是它不能天然获得
Plasma 壁纸层的生命周期、堆叠关系和配置界面。

在原型验证前，不建议把二者强行组合为“原生插件启动 Electron”这一混合结构：

- 原生插件的画面会由 Plasma 自己的桌面 surface 绘制；
- 外部 Electron 窗口是否能从其下方显示，取决于 Plasma surface 的透明和合成行为；
- 如果 Electron 位于 Plasma 桌面之上，它又可能遮挡桌面图标和小部件；
- 让壁纸插件负责启动外部进程会引入多屏实例重复启动和生命周期竞争。

如果 Electron 原型验证成功，更准确的产品定义是“面向 Plasma 6/KWin 的 HTML
壁纸运行器”。它可以提供 KDE 风格的安装、配置和自启动体验，但不冒充 Plasma
wallpaper plugin。

## 6. 原型必须验证的问题

按优先级排列：

1. Electron Wayland 窗口能否被 KWin 规则稳定识别；
2. 保持在下方时，窗口与 Plasma 桌面 surface、面板、概览效果的堆叠顺序；
3. 交互模式下，鼠标事件是否到达 Electron，而不会被 Plasma 桌面截获；
4. 穿透模式下，右键桌面菜单、桌面图标和 Plasma 小部件是否正常；
5. 是否能可靠跳过任务栏、分页器、Alt+Tab 和窗口概览；
6. 多显示器、不同缩放比例、旋转、热插拔时的窗口几何；
7. 锁屏、休眠、用户切换、plasmashell/KWin 重启后的恢复；
8. CPU、GPU、内存、空闲帧率和笔记本电池消耗；
9. Chromium 崩溃或 HTML 页面无响应时的降级行为；
10. 本地壁纸包的权限模型和内容安全策略。

若第 2、3 或 5 项无法可靠通过，应停止 Electron 外部窗口路线，并回到 Plasma
原生插件内嵌 Qt WebEngine 的方案。

## 7. 安全边界

HTML 壁纸会执行 JavaScript，因此运行器必须默认采用浏览器安全模型：

- `contextIsolation: true`；
- `nodeIntegration: false`；
- 启用 Chromium sandbox；
- 使用最小化的 preload API，并为 IPC 建立明确白名单；
- 默认拒绝弹窗、导航到外部来源、下载和权限请求；
- 本地壁纸资源使用受控协议或只读目录；
- 远程网络访问默认关闭，确有需要时由用户按壁纸包授权。

## 8. 初步结论

Electron 外部窗口值得制作技术原型。它最符合“桌面用于观看和交互”的产品方向，
也直接解决现有 HTML 壁纸插件无法可靠接收鼠标事件的问题。

但其可行性取决于 KWin 在 Plasma 6 Wayland 下对窗口堆叠、焦点、任务切换器和
输入的实际控制效果。当前不能宣称该路线已经可替代 Plasma 原生壁纸插件。

下一步应先做最小验证程序：纯色或测试网格 HTML、一个显示器窗口、鼠标事件计数器
和可切换的鼠标穿透模式。只有核心窗口行为验证通过后，再加入正式壁纸素材、动画、
多屏管理和安装包。

## 9. 参考资料

- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron screen API](https://www.electronjs.org/docs/latest/api/screen)
- [KDE Plasma development documentation](https://develop.kde.org/docs/plasma/)
