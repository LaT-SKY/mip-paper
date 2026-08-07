# Qt WebEngine 离屏渲染用于 Plasma 6 HTML 壁纸的可行性研究

- 状态：初步研究
- 日期：2026-08-07
- 目标环境：KDE Plasma 6、KWin、Wayland
- 当前环境：Plasma 6.7.4、KWin 6.7.4、Qt WebEngine 6.11.1、Wayland
- 当前图形环境：KWin OpenGL 合成、EGL、NVIDIA 驱动

## 1. 研究问题

本研究评估是否可以在 Plasma 6 原生壁纸插件中使用 Qt WebEngine 离屏渲染 HTML，
再把生成的纹理或图像交给壁纸 QML 显示，同时自行转发鼠标事件。

需要回答：

- `QWebEnginePage` 能否直接输出连续像素帧；
- `QQuickRenderControl` 能否把 `WebEngineView` 渲染到自定义纹理；
- `grabToImage()` 或窗口截图能否承担动态 4K 壁纸；
- Qt Quick layer/`ShaderEffectSource` 是否属于可用的离屏方式；
- Plasma 插件能否满足 Qt WebEngine Quick 的初始化要求；
- 是否值得为鼠标事件建立手工转发层。

## 2. “离屏渲染”的四种不同含义

讨论 Qt WebEngine 时，以下方案经常都被称为离屏渲染，但它们的能力完全不同。

### 2.1 页面对象直接输出像素

期望 `QWebEnginePage` 像 CEF Off-Screen Rendering 一样，在每帧变化时提供像素缓冲区
或 GPU 纹理回调。Qt WebEngine 6.11 没有这样的公共 API。

### 2.2 Qt Quick 场景重定向到纹理

使用 `QQuickRenderControl` 创建不对应原生窗口的 `QQuickWindow`，把其中的
`WebEngineView` 渲染到应用提供的纹理。这是最接近“真正离屏渲染”的设计，但
Qt 官方明确说明该组合不能正确工作，公共 API 无法完成所需的上下文共享。

### 2.3 已渲染项目截图

先让 `WebEngineView` 在真实 Qt Quick 场景中渲染，再使用 `grabToImage()` 或窗口截图
把结果从 GPU 读回 CPU。它适合缩略图、预览或测试截图，不适合持续动态壁纸。

### 2.4 同一场景内渲染到图层

使用 `layer.enabled` 或 `ShaderEffectSource` 把一个可见场景中的 Qt Quick 项目先渲染
到 GPU 纹理，再在同一场景中使用这张纹理。该方式可用于着色器效果和局部缓存，
但它不是独立 HTML 渲染服务，也不会绕过 `WebEngineView` 的初始化与宿主限制。

## 3. `QWebEnginePage` 不提供连续帧输出

`QWebEnginePage` 是网页状态、导航、脚本、权限、生命周期和渲染进程的控制对象。
其公共 API 提供：

- HTML/URL 加载；
- JavaScript 执行；
- 页面属性和生命周期控制；
- 打印为 PDF；
- 导航、权限、Cookie 和下载管理；
- 与 `QWebEngineView` 或 QML `WebEngineView` 关联后的页面逻辑。

但它没有公共的 `paint()`、`render()`、`grabFrame()`、像素缓冲回调或纹理句柄接口。
`printToPdf()` 是文档排版输出，不能代替实时屏幕帧。

因此，以下初步架构不成立：

> C++ `QQuickItem` 只持有 `QWebEnginePage`，要求页面直接渲染到该 Item 的纹理。

页面必须连接到 Qt 提供的实际视图实现。Qt WebEngine Quick 的 QML 类型是公共接口，
但其底层 C++ `QQuickWebEngineView` 类位于 Qt 私有 API；从 C++ 直接实例化和控制该类
会绑定 Qt 私有 ABI，不适合可分发的 Plasma 插件。

## 4. `QQuickRenderControl` 路线

### 4.1 RenderControl 本身的能力

`QQuickRenderControl` 是 Qt Quick 正式提供的离屏场景图 API。应用可以：

- 创建不显示到屏幕的 `QQuickWindow`；
- 指定纹理或图像作为 render target；
- 自己管理 GPU 设备、上下文、同步和帧循环；
- 把鼠标和键盘事件发送给离屏 `QQuickWindow`；
- 将生成的纹理交给其他渲染器。

对于普通 Qt Quick 项目，这是合理的硬件加速离屏方案。

### 4.2 WebEngineView 的官方限制

Qt WebEngine 的 `WebEngineView` 文档专门说明：当使用 `QQuickRenderControl` 将 Qt
Quick UI 渲染到 OpenGL surface 时，`WebEngineView` 不能正确渲染。

原因是 WebEngine 尝试使用由 `QtWebEngineQuick::initialize()` 创建的全局 OpenGL
共享上下文，但没有公共 API 可以取得该上下文，并让它与 RenderControl 的上下文共享。

文档描述的绕行方法是：

1. 手工创建离屏 OpenGL context；
2. 让它与 RenderControl context 共享；
3. 调用非公开函数 `qt_gl_set_global_share_context()`；
4. 不再依赖正常的 `QtWebEngineQuick::initialize()` 路径。

这个方法依赖 Qt 私有函数和 OpenGL 实现细节，存在以下问题：

- 不属于 Qt 公共 ABI；
- Qt 小版本或发行版补丁可能改变行为；
- 与 Qt Quick 的 RHI、多渲染后端和 Plasma 宿主图形状态耦合；
- 插件会修改 `plasmashell` 进程的全局图形共享上下文；
- 初始化失败可能影响整个桌面 shell，而不只是壁纸。

结论：不能把 `QQuickRenderControl` + `WebEngineView` 作为正式安装包架构。

## 5. Qt WebEngine Quick 初始化问题

Qt 官方要求在创建 `QGuiApplication` 和窗口的 `QPlatformOpenGLContext` 之前调用
`QtWebEngineQuick::initialize()`。其作用等价于在创建应用前设置
`Qt::AA_ShareOpenGLContexts`。

Qt 6.11 源码显示，如果在应用已经创建后调用初始化：

- OpenGL 或未明确支持的图形后端会输出警告；
- 这种晚调用方式已被标记为 deprecated；
- 源码明确提示未来可能失败；
- 当前版本仍会继续调用 WebEngine Core 初始化，但已经错过应用级共享上下文设置时机。

Plasma wallpaper plugin 在 `plasmashell` 已运行并创建显示窗口后才被加载，因此插件
无法遵守官方初始化顺序。除非 `plasmashell` 自身已经提前设置共享 OpenGL contexts，
否则插件只能依赖不受保证的晚初始化行为。

当前尚未确认 `plasmashell` 是否提前设置了 `Qt::AA_ShareOpenGLContexts`。这必须通过
专门的进程内探针或最小原生插件验证，不能从 KWin 使用 OpenGL 合成推导出来，因为
KWin 和 plasmashell 是不同进程。

## 6. 截图式离屏方案

### 6.1 `QQuickItem::grabToImage()`

`WebEngineView` 作为 Qt Quick Item，可以在已经进入真实场景并完成渲染后尝试调用
`grabToImage()`。Qt 文档明确指出，该调用会：

- 将项目渲染到离屏 surface；
- 将结果从 GPU 内存复制到 CPU 内存；
- 产生较高成本；
- 不推荐用于实时预览。

3840 x 2160 RGBA 单帧约为 31.6 MiB。即使只按 30 FPS 读取，理论原始读回量也接近
950 MiB/s，尚未计入同步、额外复制、纹理再次上传和 Chromium 自身渲染开销。

此外，截图得到的是图像，不是可接收 DOM 输入的视图。若把截图显示在另一个 Item，
仍需手工完成坐标转换、鼠标按键、滚轮、触摸、键盘焦点和输入法转发。

结论：适合生成预览图和自动化视觉测试，不适合动态 4K 壁纸主路径。

### 6.2 `QQuickWindow::grabWindow()` 或 QWidget 抓取

窗口截图具有类似问题：必须先有一个能够正常渲染 WebEngine 内容的真实窗口或场景，
随后进行 GPU 到 CPU 的读取。隐藏窗口停止渲染或释放场景图资源的行为还会受到窗口
系统和持久化设置影响。

`QWebEngineView` 继承 QWidget 的通用抓取能力，但 Qt WebEngine 没有将其定义为连续
帧流 API。该方案仍然需要真实视图、周期截图和输入转发，不具有架构优势。

## 7. Qt Quick layer 与 `ShaderEffectSource`

`layer.enabled` 和 `ShaderEffectSource` 可以把 Qt Quick 项目及其子树渲染到 GPU 纹理。
它们比 `grabToImage()` 更适合实时图形处理，因为纹理保留在 GPU 内。

可能用途：

- 给网页壁纸施加色彩、模糊或过渡效果；
- 控制网页渲染分辨率；
- 在同一 Qt Quick 场景中缓存网页画面；
- 将 WebEngine 内容作为 shader 输入。

输入方面，`ShaderEffectSource` 本身不转发鼠标或键盘事件。如果需要显示纹理同时保留
源项目输入，应使用 `hideSource: true`，而不是把源项目设置为不可见或透明。

限制：

- 源 `WebEngineView` 必须已经能在当前真实场景中工作；
- 仍需满足 WebEngine Quick 初始化；
- 仍在 plasmashell 进程内运行 Chromium 集成；
- 额外图层增加显存占用和合成成本；
- 它不提供跨进程帧传输，也不生成独立可管理的像素流。

结论：它可能是直接嵌入路线中的可选视觉效果工具，但不是解决宿主和初始化问题的
离屏渲染器。第一版原型不应启用额外 layer。

## 8. 输入事件转发成本

若采用真正的 RenderControl 离屏窗口，Qt Quick 允许使用
`QCoreApplication::sendEvent()` 把事件发给离屏 `QQuickWindow`。但壁纸插件还需要自行
处理：

- 屏幕坐标、设备像素比与网页 CSS 像素之间的转换；
- hover、press、move、release 和双击；
- 滚轮像素增量与角度增量；
- 多点触摸与手势；
- 键盘焦点、组合键和自动重复；
- 输入法 preedit、commit 和候选窗口位置；
- 鼠标捕获、拖放和光标形状；
- Plasma 桌面菜单与网页输入的优先级。

由于 RenderControl + WebEngineView 本身就依赖私有图形 API，再承担完整输入转发没有
合理收益。直接让 `WebEngineView` 位于壁纸场景中，或让 Electron/Qt WebEngine
存在于独立真实窗口中，均能让平台事件直接到达网页。

## 9. 可行方案比较

| 方案 | 公共 API | 连续动态画面 | DOM 输入 | 4K 性能前景 | 判断 |
| --- | --- | --- | --- | --- | --- |
| `QWebEnginePage` 直接取帧 | 不存在 | 否 | 否 | 不适用 | 不可行 |
| RenderControl + WebEngineView | 官方说明不能正确渲染 | 理论可 | 需转发 | 风险很高 | 不采用 |
| 私有全局共享 context 绕行 | 私有 API | 理论可 | 需转发 | 未知 | 不可分发 |
| `grabToImage()` 连续截图 | 公共 API | 可勉强轮询 | 需转发 | 很差 | 仅测试/预览 |
| Quick layer/ShaderEffectSource | 公共 API | 是 | 源 Item 可保留输入 | 尚可但增加开销 | 可选效果层 |
| WebEngineView 直接嵌入场景 | 公共 QML API | 是 | 原生 | 最合理 | 值得原型验证 |
| 独立真实 WebEngine/Electron 窗口 | 公共 API | 是 | 原生 | 合理 | 另一主路线 |

## 10. 对 Plasma 原生插件路线的修正

此前设想的“C++ `HtmlWallpaperItem` 持有 `QWebEnginePage`，离屏渲染为纹理，再转发
事件”应当废弃。Qt WebEngine 公共 API 不支持这一数据流。

若继续研究 Plasma 原生插件，最小架构应改为：

- 壁纸 QML 直接声明 `QtWebEngine.WebEngineView`；
- `WebEngineView` 直接填充 wallpaper Item；
- HTML 内部直接接收 DOM 鼠标事件；
- 第一阶段不使用 RenderControl、截图、layer 或 C++ 事件转发；
- C++ 只用于检测宿主初始化属性，或提供最小的安全/配置桥接；
- 先验证 plasmashell 是否允许 WebEngine 在当前场景图中稳定初始化。

该原型的首要目标不是制作正式壁纸，而是回答：

1. QML 模块能否在 plasmashell 中加载；
2. 是否出现共享 context 或渲染错误；
3. 网页是否持续刷新；
4. 鼠标移动、点击和滚轮是否到达 DOM；
5. 多屏和桌面切换是否稳定；
6. plasmashell 重载或退出时 Chromium 子进程是否正确回收。

如果直接嵌入失败，不应退回私有离屏 hack，而应转向独立窗口路线。

## 11. 安全与故障边界

即便直接嵌入能够运行，Qt WebEngine renderer 仍是由 plasmashell 启动和管理的子进程。
必须验证 renderer 崩溃不会导致桌面 shell 失效，并处理：

- `renderProcessTerminated`；
- 页面加载失败；
- 导航、新窗口、下载和权限请求；
- 网络访问与本地文件权限；
- profile、缓存和 local storage 隔离；
- 锁屏或省电时将生命周期切换为 Frozen；
- 高 CPU/GPU 使用时的自动降帧或静态回退。

离屏渲染不能提供额外的安全隔离。真正的进程边界来自 Chromium renderer，或来自将
整个 WebEngine/Electron 运行器放到 plasmashell 之外的独立应用进程。

## 12. 结论

Qt WebEngine 的公共 API 不支持我们最初设想的持续、可交互、纹理回调式离屏渲染。
官方唯一描述的 RenderControl 绕行方法依赖私有 OpenGL 全局共享上下文函数，不能
作为 Plasma 6 壁纸安装包的稳定基础。

截图只能用于预览和测试；Quick layer 只能作为同场景视觉效果。真正值得验证的原生
路线是让 QML `WebEngineView` 直接进入 Plasma 壁纸场景图，不再增加离屏层和手工
输入桥接。

但直接嵌入仍面临 `QtWebEngineQuick::initialize()` 必须早于 `QGuiApplication` 的宿主
生命周期冲突。若最小 Plasma 原型无法稳定运行，应放弃进程内 WebEngine，继续验证
Electron/KWin 或独立 Qt WebEngine 窗口路线。

## 13. 参考资料

- [Qt WebEngineView QML Type](https://doc.qt.io/qt-6/qml-qtwebengine-webengineview.html)
- [QtWebEngineQuick namespace and initialize](https://doc.qt.io/qt-6/qtwebenginequick.html)
- [QWebEnginePage](https://doc.qt.io/qt-6/qwebenginepage.html)
- [QWebEngineView](https://doc.qt.io/qt-6/qwebengineview.html)
- [QQuickRenderControl](https://doc.qt.io/qt-6/qquickrendercontrol.html)
- [QQuickItem and grabToImage](https://doc.qt.io/qt-6/qquickitem.html)
- [ShaderEffectSource](https://doc.qt.io/qt-6/qml-qtquick-shadereffectsource.html)
- [Qt WebEngine Quick initialization source](https://code.qt.io/cgit/qt/qtwebengine.git/tree/src/webenginequick/api/qtwebenginequickglobal.cpp?h=6.11)

