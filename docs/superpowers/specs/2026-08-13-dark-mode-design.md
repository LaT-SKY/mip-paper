# Mip-Paper 暗色模式设计

**日期：** 2026-08-13

**状态：** 已批准，待书面规格复核

**范围：** 0.2 系列收尾功能；KDE/Plasma 系统主题跟随、暗色组件和壁纸夜间调制

## 目标

Mip-Paper 新增足够鲜明的完整暗色模式，而不是只替换信息卡颜色。暗色状态同时调整信息组件和最终显示的壁纸亮度，保留壁纸运动、媒体输出音频可视化、逐显示器壁纸以及逐显示器动态强调色。

所有暗色模式配置必须完整热重载。修改合法配置或切换 KDE 配色方案后，现有 Electron 进程、壁纸窗口、renderer、壁纸图片和组件状态继续运行，不通过重启或重建窗口实现切换。

## 配置契约

默认配置新增：

```json
{
  "appearance": {
    "mode": "system",
    "dark": {
      "wallpaperBrightness": 0.72
    }
  }
}
```

`appearance.mode` 只接受：

- `light`：强制使用亮色组件和原始壁纸亮度。
- `dark`：强制使用暗色组件，并将壁纸显示亮度调制为配置倍率。
- `system`：跟随 KDE 当前实际配色，默认值。

`appearance.dark.wallpaperBrightness` 接受 `0.2–1` 的有限数值，默认 `0.72`。它表示暗色模式下壁纸最终显示亮度相对于原图的倍率；`1` 表示不压暗。亮色模式始终以倍率 `1` 显示。

明暗模式不新增独立过渡时间。壁纸亮度、卡片表面、文字、边框和阴影统一复用 `color.transitionDurationMs`。该值热更新后，下一次以及当前尚未结束的主题过渡采用最新有效配置。启用 `prefers-reduced-motion: reduce` 时，颜色与明暗切换均立即完成。

未知字段、错误类型、越界倍率和无效模式继续由严格配置校验拒绝。

## 系统主题解析

主进程新增职责单一的 KDE 配色监听与解析单元，复用现有目录监听、防抖、原子替换兼容和 generation 失效机制。

`system` 模式读取 `kdeglobals` 中代表窗口表面的实际背景颜色，校验为三个 `0–255` 的整数后计算 WCAG 相对亮度。固定判定规则为：相对亮度小于 `0.35` 时解析为 `dark`，否则解析为 `light`。主题名称以及名称中是否包含 `Dark` 不参与判定。

解析失败时保留上一份有效系统主题，防止短暂写入或损坏文件引起闪烁。进程首次启动且没有有效结果时回退 `light`。强制 `light` 或 `dark` 模式不受 KDE 配色变化影响。

KDE 配色 watcher 只在 `appearance.mode === "system"` 时运行。模式热切换负责幂等启停 watcher，禁止重复实例；停止、重新配置或关闭应用后，旧 generation 的迟到读取结果不得发布。

## 运行时状态与数据流

主进程根据有效配置和 KDE 状态生成已解析外观状态：

```js
{
  mode: 'system',
  resolvedTheme: 'dark',
  wallpaperBrightness: 0.72,
  transitionDurationMs: 900
}
```

强制亮色状态的有效壁纸倍率为 `1`；强制暗色或解析为暗色时使用 `appearance.dark.wallpaperBrightness`。

已解析外观状态进入现有完整运行时配置 bootstrap 和更新广播。Renderer 不读取 `kdeglobals`，也不使用 `prefers-color-scheme` 猜测 KDE 主题；它只消费主进程发布的已验证状态。这样所有显示器使用一致的系统明暗结果，同时仍保留各自壁纸和颜色状态。

配置热重载流程为：

1. 配置 watcher 读取并校验完整候选配置。
2. 运行时配置协调器按 generation 串行采用候选值。
3. 外观协调单元根据模式准备或停止 KDE watcher，并计算已解析外观状态。
4. Window manager 更新后续 bootstrap，并向所有受管理 renderer 广播完整配置和已解析状态。
5. 每个 renderer 原位采用外观状态，不重建控制器、窗口或图片对象。

修改 `appearance.mode` 后立即解析并切换。修改 `appearance.dark.wallpaperBrightness` 后，各显示器从下一渲染帧开始向新目标倍率过渡。修改 `color.transitionDurationMs` 后，颜色与明暗过渡共享新时长。快速连续保存时只有最新 generation 可以成为当前状态。

非法 JSON、未写完整文件、未知字段或越界值均保留最后一份有效配置和已解析外观状态；文件修正后 watcher 自动恢复热重载。

## Renderer 与壁纸合成

Renderer 在根元素设置明确的 `data-theme="light|dark"`，并以语义 CSS 变量表达两套组件颜色，包括：

- 卡片表面和边框
- 主文字、次级文字和图标
- 标签底色
- 环境阴影
- 错误界面背景与文字

暗色视觉采用深石墨半透明卡片、暖白主文字和柔和灰次级文字。原始壁纸动态强调色继续控制硬阴影、标题、状态线、日历今日标记和音频强调线，保留 Mip-Paper 现有视觉身份。

壁纸暗化只发生在 Canvas 最终显示合成阶段。Renderer 持有 `currentWallpaperBrightness`、过渡起点、目标值和开始时间，在既有调度帧中根据 `color.transitionDurationMs` 插值。稳定后只使用当前倍率绘制，不创建额外计时器，也不生成或写入修改后的图片。

亮度调制不得改变：

- 原始已解码图片对象
- 壁纸内容哈希和缓存键
- 逐显示器壁纸身份与 generation
- 动态强调色分析输入
- 已缓存的 RGB 和原始壁纸亮度

动态强调色始终从原始壁纸像素计算。明暗切换本身不得触发图片重新解码、重新分析或颜色缓存写入，因此同一显示器在 light/dark 间切换时强调色身份保持稳定。

## 视觉过渡

以下属性显式使用共享过渡变量，不使用 `transition: all`：

- 卡片背景色、边框色和文字颜色
- 标签背景色和图标颜色
- 卡片环境阴影
- 已有强调色属性
- Canvas 壁纸亮度倍率

CSS 和 Canvas 使用同一份已解析 `transitionDurationMs`。过渡期间收到新主题、倍率或时长时，以当前可见亮度和当前计算样式作为新起点，平滑转向最新目标，不先跳回旧端点。Reduced motion 状态变化后，当前过渡立即收敛到目标。

## 多显示器行为

KDE 系统主题是全局状态，所有 renderer 接收相同 `resolvedTheme`。每块屏幕仍独立持有：

- 实际壁纸与壁纸 generation
- 原始壁纸内容键
- 原始壁纸亮度分析
- 动态强调色和语义音频色
- 当前 Canvas 亮度过渡状态

同一壁纸可共享内容缓存，但不同显示器的当前颜色与显示状态不能合并。显示器热插拔后新窗口的 bootstrap 必须直接包含最新外观状态，避免先闪亮色再切暗色。

## 错误处理与生命周期

- KDE 配色字段缺失、损坏或越界：保留上一有效系统主题；首次失败回退亮色，并记录不含配置内容的错误。
- 配置候选无效：不更新 watcher、bootstrap 或 renderer，继续使用最后有效快照。
- Renderer 收到无效外观载荷：忽略整次候选更新并保留当前状态。
- 快速 KDE 主题切换或配置保存：generation 较新的结果永远优先。
- Watcher 建立失败：应用继续运行并保留当前状态；强制 `light` 和 `dark` 仍可通过配置热切换。
- Shutdown：先阻止新外观提交，再停止配置与 KDE watcher，最后销毁 renderer 和窗口；所有 stop 操作幂等。

## 文档

中英文 README 同步说明：

- `light / dark / system` 三档及默认 `system`
- KDE 实际配色跟随规则
- 默认 `wallpaperBrightness: 0.72` 和 `0.2–1` 范围
- 与 `color.transitionDurationMs` 共用过渡
- 所有配置保存后实时热加载
- 暗化不修改图片文件、不改变逐屏强调色
- Reduced motion 下即时切换

配置示例、默认值测试、版本化配置文档与实际默认对象必须同步，禁止硬编码重复默认值。

## 测试与验收

实现采用测试驱动，自动测试至少覆盖：

- `appearance` 默认合并、未知字段、三种模式和 `0.2–1` 边界。
- KDE RGB 解析、相对亮度、`0.35` 阈值两侧、缺失字段和损坏输入。
- `system` 模式首次解析、运行时变化、失败保留、首次失败回退。
- 强制模式忽略 KDE 更新，模式热切换正确启停且不重复 watcher。
- 完整 bootstrap 和配置广播包含已解析外观状态；非受管理 renderer 不能影响状态。
- 合法外观配置原位热更新；非法候选保留最后有效状态并在修正后恢复。
- 多显示器接收相同系统主题，但继续保存独立壁纸、颜色和 Canvas 过渡状态。
- 明暗切换不重新解码壁纸、不重新分析强调色、不更改内容缓存。
- 壁纸倍率过渡的起点、终点、中途重定向、时长热更新和 reduced motion。
- 暗色 CSS 使用语义变量、显式过渡和已批准的深石墨/暖白视觉契约。
- Window manager、外观协调器和 watcher 的停止及迟到回调失效。
- 中英文 README 契约与实现一致。

最终自动验收：

```bash
npm test
npm run check
bash -n bin/mip-paper scripts/kwin-rules.sh scripts/kwin-script.sh
npm audit
npm audit --omit=dev
git diff --check
```

所有命令必须成功，两个 audit 均为 `0 vulnerabilities`。

真实 KDE/Plasma 会话还必须手工验证：

1. KDE 浅色与深色配色切换可被 `system` 实时跟随。
2. `light` 和 `dark` 强制模式不随 KDE 变化。
3. 连续保存模式、倍率和共享过渡时长时，无窗口重启、壁纸闪断或过期状态回写。
4. 两块屏幕同步明暗，但保留不同壁纸、不同强调色和正确 z-index。
5. 默认 `0.72` 下壁纸细节、暗色卡片和文字可读性符合已批准样稿。
6. 壁纸运动、面板展开/收起、媒体输出音频可视化、锁屏与恢复不回归。
7. Reduced motion 下明暗和颜色均即时切换。

## 非目标

- 0.2 收尾阶段不实现按日出日落或时间表自动切换。
- 不新增暗色强度预设枚举；本阶段只提供直接倍率配置。
- 不新增设置 GUI；未来界面可直接为 `wallpaperBrightness` 提供滑块。
- 不读取或修改 Plasma 当前配色方案。
- 不支持每块显示器不同的 light/dark 模式。
- 不使用暗化后的壁纸重新计算强调色。
- 不引入新的 npm 依赖。
