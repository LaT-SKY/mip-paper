# Qt Quick WebView 用于 Plasma 6 HTML 壁纸的可行性研究

- 状态：初步研究
- 日期：2026-08-07
- 目标环境：KDE Plasma 6、KWin、Wayland
- 当前环境：Plasma 6.7.4、KWin 6.7.4、Qt 6.11.1、Wayland

## 1. 研究问题

本研究评估 Qt Quick WebView 能否作为 Plasma 6 原生 HTML 壁纸插件的网页渲染层，
尤其关注以下问题：

- Linux 上的实际渲染后端；
- 能否嵌入 Plasma wallpaper plugin 的 QML 场景；
- 鼠标和其他输入事件是否可用；
- 与 Qt WebEngine Quick 相比是否更轻、更简单或更稳定；
- 当前系统上的依赖和部署条件。

## 2. 核心结论

Qt Quick WebView 不适合作为本项目的 Plasma 6 原生壁纸渲染层。

原因不是它无法显示网页，而是它在 Linux 上并不是独立的轻量 WebView：官方文档明确
说明 Qt WebView 在 Linux 上依赖 Qt WebEngine。Qt 6.11 源码进一步显示，Linux 后端
动态创建的实际对象就是 `QQuickWebEngineView`。

因此，使用 Qt Quick WebView 不会绕过 Chromium、Qt WebEngine 的进程模型、GPU
开销或初始化要求，只会在 Qt WebEngine Quick 之上增加一层功能更少的抽象。

对 Plasma 插件而言还有一个更直接的结构性问题：Qt 官方要求在创建
`QGuiApplication` 以及窗口的图形上下文之前调用 `QtWebView::initialize()`。
wallpaper plugin 是在已经运行的 `plasmashell` 进程中动态加载的，此时应用实例和
场景图上下文早已存在，插件无法满足这一初始化顺序。直接在壁纸 QML 中导入
`QtWebView` 因此不属于官方保证的使用方式。

## 3. Linux 上的实际后端

Qt WebView 的定位是跨平台统一接口：

- Android 使用系统 WebView；
- Apple 平台使用系统 WebKit；
- Windows 可以使用 Qt WebEngine 或 WebView2；
- Linux 使用 Qt WebEngine。

Qt 6.11 源码中的 WebEngine 插件依赖：

- `Qt::WebEngineCorePrivate`；
- `Qt::WebEngineQuickPrivate`；
- `Qt::WebViewPrivate`；
- `Qt::WebViewQuickPrivate`。

后端实现会从 `QtWebEngine` 模块创建 `WebEngineView`，将其转换为
`QQuickWebEngineView`，设置为 Qt Quick 父项，并填充父项范围。这说明 Linux 上的
`WebView` 是 `WebEngineView` 的适配层，不是另一个渲染器。

这也与当前发行版软件包元数据一致：`qt6-webview` 直接依赖 `qt6-webengine`。
`qt6-webview` 本体安装体积约 420 KiB，但该数字不包含体积大得多的 Qt WebEngine
依赖，因此不能用来说明整体方案轻量。

## 4. QML 能力与限制

### 4.1 可用能力

Qt Quick `WebView` 提供适合基本网页容器的 API：

- 设置 URL 和加载 HTML；
- 前进、后退、刷新和停止；
- 加载状态与进度；
- 执行 JavaScript 并接收返回值；
- Cookie 操作；
- JavaScript、文件访问和本地存储等基础设置。

网页内部的 DOM 输入由底层网页视图处理。对一个占满整个 QML 区域的 WebView，
鼠标事件理论上会直接到达网页，这是它相对于“截图式离屏渲染”的优势。

### 4.2 QML 合成限制

Qt 官方文档明确警告：

- 不支持让其他 QML 组件与 WebView 重叠；
- 重叠后的结果不可预测，并可能因平台不同而变化；
- 不能依赖 WebView 内的事件传播到 Qt 事件系统；
- 不能在 WebView 上覆盖透明 QML 项来截获未处理事件。

这对壁纸插件影响很大。加载错误提示、调试信息、设置按钮或 QML 动画层都不能可靠地
叠加在 WebView 上。所有可视内容和交互最好都必须在 HTML 内实现。

需要注意的是，Linux 后端实际使用 Qt Quick `WebEngineView`，它本身可以参与 Qt
Quick 场景图。上面的限制是 Qt WebView 统一 API 给出的跨平台保证边界，不能因为
某个 Linux 版本当前表现正常，就把叠加行为视为稳定接口。

### 4.3 API 缩减

与直接使用 `QtWebEngine.WebEngineView` 相比，`QtWebView.WebView` 暴露的控制面较小。
高级壁纸运行器可能需要的以下能力，在 WebEngine Quick 中更完整：

- profile 和持久化策略；
- 生命周期冻结和丢弃；
- 渲染进程终止通知；
- 权限请求处理；
- 新窗口、导航和下载拦截；
- DevTools；
- 音频静音、后台色和焦点行为；
- 自定义 URL scheme 和更完整的安全策略。

本项目需要控制第三方 HTML 壁纸内容的权限、导航、后台资源消耗和崩溃恢复，因此
缩减后的 WebView API 反而会增加限制。

## 5. Plasma 6 插件生命周期问题

普通 Qt WebView 应用可以在 `main()` 中按官方要求执行：

1. 调用 `QtWebView::initialize()`；
2. 创建 `QGuiApplication`；
3. 创建窗口和图形上下文；
4. 加载含 `WebView` 的 QML。

Plasma wallpaper plugin 不拥有这个启动序列。它由 `plasmashell` 在运行过程中加载：

1. `plasmashell` 已经创建 `QGuiApplication`；
2. Plasma 已经创建显示器窗口与 Qt Quick 场景图；
3. 用户选择壁纸插件；
4. 插件的 QML 和可选 C++ 模块才被加载。

因此，插件既不能在 `QGuiApplication` 之前初始化 Qt WebView，也不应修改宿主进程的
全局图形初始化状态。该问题不能通过在 QML `Component.onCompleted` 中调用初始化来
解决，因为此时已经太晚。

理论上可以修改 `plasmashell` 本身，让它在启动早期初始化 Qt WebView，但这要求维护
自定义 Plasma 构建，不适合作为可安装壁纸包的依赖。

## 6. 输入事件分析

Qt Quick WebView 并不会自动解决所有桌面输入问题，需要区分两个层次：

### 6.1 HTML 内部输入

如果 WebView 成功嵌入并占满壁纸区域，点击、移动、滚轮和触摸事件可由底层
`QQuickWebEngineView` 交给 DOM。该路线不需要手工把 `QMouseEvent` 转换为网页事件。

### 6.2 Plasma 桌面输入

壁纸是 Plasma desktop containment 的一部分。鼠标事件究竟先由 containment、桌面
操作还是 WebView 接收，仍取决于 Plasma 的 QML 结构和事件接受策略。特别需要验证：

- 左键和鼠标移动是否到达 WebView；
- 右键是否被 Plasma 桌面菜单截获；
- 滚轮切换虚拟桌面与网页滚动的冲突；
- WebView 获得焦点后是否影响全局快捷键和键盘导航；
- 锁屏、编辑模式和桌面概览时的输入行为。

WebView 内事件不能向普通 QML 父项传播，使“网页不处理时再由 Plasma 接管”的策略
难以可靠实现。

## 7. 当前系统依赖状态

本机检查结果：

- 已安装 `qt6-webengine` 6.11.1；
- 已安装 `Qt6WebEngineQuick` CMake 模块和 `QtWebEngine` QML 模块；
- 未安装 `qt6-webview`；
- 软件仓库提供 `qt6-webview` 6.11.1；
- 该软件包声明依赖 `qt6-webengine`。

因此，本机可以继续测试直接的 Qt WebEngine Quick，但若测试 Qt Quick WebView，仍需
额外安装 `qt6-webview`。鉴于它只是一层包装，暂时没有安装的必要。

## 8. 与其他路线的比较

| 维度 | Qt Quick WebView | 直接 Qt WebEngine Quick | Electron 外部窗口 |
| --- | --- | --- | --- |
| Linux 渲染内核 | Qt WebEngine/Chromium | Qt WebEngine/Chromium | Electron/Chromium |
| Plasma 原生 surface | 目标上是，但初始化不受支持 | 需要专门验证宿主兼容性 | 否 |
| DOM 鼠标事件 | 理论支持 | 支持 | 支持 |
| QML 合成控制 | 官方限制重叠 | 更完整 | 不适用 |
| 浏览器控制 API | 较少 | 最完整 | 完整且成熟 |
| 初始化控制 | 插件无法满足官方顺序 | 同样需要仔细验证 | 独立进程可完全控制 |
| KWin 窗口规则 | 不需要 | 不需要 | 需要 |
| 部署重量 | 依赖 Qt WebEngine | 依赖 Qt WebEngine | 携带 Electron 运行时 |
| 适合当前项目 | 不推荐 | 原生路线候选 | 外部运行器候选 |

## 9. 风险判断

### 已确认

- Linux 上 Qt WebView 依赖 Qt WebEngine；
- Linux 后端源码创建 `QQuickWebEngineView`；
- Qt WebView 要求在应用和图形上下文创建前初始化；
- Qt WebView 官方不保证与其他 QML 项目重叠；
- 当前系统未安装 Qt WebView，但已经安装 Qt WebEngine Quick。

### 需要原型验证

- 在当前 Plasma 6.7.4 进程中直接导入 Qt WebView 是否失败、告警或偶然可用；
- wallpaper containment 是否会把鼠标事件交给 WebView；
- WebView 与 Plasma 桌面编辑、右键菜单、概览和锁屏的实际冲突；
- Qt WebEngine 渲染进程在 plasmashell 宿主中的稳定性与资源占用。

即便上述原型在当前机器上能够运行，也不能消除官方初始化顺序不满足的问题，只能说明
某个具体版本存在可用的非保证行为。

## 10. 结论与建议

停止把 Qt Quick WebView 作为独立候选路线。它在 Linux 上没有带来新的渲染后端、
更低的部署成本或更好的 Plasma 集成，反而隐藏了 Qt WebEngine 的高级控制能力，并
引入了无法由动态 wallpaper plugin 正确满足的初始化约束。

后续研究应集中在两个真正不同的方向：

1. 原生方向：直接研究 `QtWebEngine.WebEngineView` 能否安全嵌入 Plasma 6 壁纸插件；
2. 独立方向：研究 Electron 窗口在 KWin Wayland 下的桌面层行为。

如果仍要验证 Qt Quick WebView，只需制作一个最小、一次性原型来确认预期失败点，
不应围绕它设计正式架构。

## 11. 参考资料

- [Qt WebView Overview](https://doc.qt.io/qt-6/qtwebview-index.html)
- [Qt Quick WebView QML Type](https://doc.qt.io/qt-6/qml-qtwebview-webview.html)
- [Qt Quick WebViewSettings QML Type](https://doc.qt.io/qt-6/qml-qtwebview-webviewsettings.html)
- [Qt WebEngineView QML Type](https://doc.qt.io/qt-6/qml-qtwebengine-webengineview.html)
- [Qt WebEngine Platform Notes](https://doc.qt.io/qt-6/qtwebengine-platform-notes.html)
- [Qt WebView 6.11 source tree](https://code.qt.io/cgit/qt/qtwebview.git/tree/?h=6.11)
- [Qt WebView WebEngine backend source](https://code.qt.io/cgit/qt/qtwebview.git/tree/src/plugins/webengine/qwebenginewebview.cpp?h=6.11)

