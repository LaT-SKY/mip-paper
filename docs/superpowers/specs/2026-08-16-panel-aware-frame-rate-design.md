# Mip-Paper 0.3.1 面板感知帧率节拍设计

日期：2026-08-16
目标版本：0.3.1（当前 main 为 0.3.0）
目标环境：KDE Plasma 6 / KWin 6 / Wayland / Electron 43.3.0

## 1. 目标与范围

0.3.1 目标：让绘制节拍感知信息面板状态，消除"信息面板收起时使用漂移帧率"的体验问题。

现状下，帧率只由相机运动状态决定，与信息面板完全解耦：

- 信息面板收起（含收起动画）时相机处于漂移态 → 漂移帧率（默认 30 FPS）。收起动画
  （950ms 交错弹簧）在 30 FPS 下运行有明显卡顿；收起后卡片以 `collapsedOpacity`
  （默认 0.08）常驻角落并跟随相机漂移，呈 30 FPS 抖动。
- 面板展开、但指针停止超过 1.5s（回归后期）时帧率同样掉到漂移帧率，面板完全可见
  却降帧。

已与需求方确认的决策（2026-08-16）：

1. 面板展开 → 一律交互帧率（无论指针运动与回归状态）。
2. 面板收起/展开动画期间 → 交互帧率。
3. 面板收起且完全静止（动画结束、所有卡片停在目标位置）→ 回到漂移帧率，保留省电
   稳态。
4. 不新增配置项；交互帧率与漂移帧率仍取现有 `frameRate.interactive` /
   `frameRate.drift`（默认 60 / 30）。

范围外：

- 不改相机运动、回归轨迹与面板弹簧参数。
- 不引入"面板完全隐藏"状态；漂移帧率的稳态适用场景保持为"面板收起且静止"。
- 不改 probe 的验收口径（probe 场景节拍预期随策略更新，见 4.5）。

## 2. 现状与根因

帧率决策链路（唯一决策点）：

- `src/motion.mjs` `requestedFrameRate(state, config)`（216–220 行）只读运动状态：
  - `mode === 'drift'`，或 `mode === 'returning'` 且
    `returnElapsed >= RETURN_INTERACTIVE_FPS_SECONDS`（1.5s）→ `config.frameRate.drift`；
  - 其余（interactive、回归初期）→ `config.frameRate.interactive`。
- 运动模式由 `simulateStep`（150–200 行）维护：指针有效输入 0.95s 内为
  `interactive`；结束后 `returning`；相机回归到 `driftReference` 且持续
  `SETTLE_SECONDS`（0.2s）后进入 `drift`。
- 面板状态（`src/panel-motion.mjs`）完全独立于运动：指针移动 `expandTriggerDistancePx`
  （48px）触发展开，空闲 `collapseDelaySeconds`（8s）触发收起；`advancePanel`
  （92–130 行）以固定 60 子步/秒的弹簧推进卡片 `progress`。
- 渲染器（`src/renderer/renderer.mjs` `advanceScene`，181–185 行）每帧先
  `advanceMotion` 再 `panel.advance`；目标帧率由调度器
  （`src/render-scheduler.mjs` 49、86 行）每帧调用 `requestedFrameRate` 决定。

结果：收起是面板的稳态（无交互 8s 后），此时相机处于 `drift` → 30 FPS，且收起动画
也在 30 FPS 下运行。展开态的"回归后期"同样掉到 30 FPS。

## 3. 方案

### 3.1 帧率决策模型

新增"面板关注"（panel attention）概念，在运动节拍之上叠加面板覆盖：

```text
targetFrameRate =
  panelAttention ? frameRate.interactive
                 : requestedFrameRate(state, config)   // 现有运动节拍，语义不变

panelAttention = panel.expanded || isPanelAnimating(panel)
```

`requestedFrameRate` 保持纯运动节拍函数，行为与现有实现完全一致，现有运动相关测试
不破坏。`panelAttention` 为真时覆盖为交互帧率；为假时回落现有运动节拍。

| 场景 | 运动节拍 | 面板关注 | 结果 |
|---|---|---|---|
| 指针交互 / 回归初期 | 60 | 否 | 60（不变） |
| 面板展开（含回归后期） | 30 | 是 | 60（本次修复） |
| 面板收起/展开动画中 | 30 | 是 | 60（本次修复） |
| 面板收起且完全静止 | 30 | 否 | 30（省电稳态，不变） |

### 3.2 面板动画判定

`src/panel-motion.mjs` 新增导出：

```js
export function isPanelAnimating(state) {
  return state.cards.some((card) => Math.abs(card.progress - card.pending) > 1e-9);
}
```

语义：

- `progress !== pending`：卡片仍有视觉上的运动要做。`pending` 是 `begin()`
  写入的目标 progress（52–65 行），`advancePanel` 激活后 `target = pending`
  （100 行）并向其收敛（123–127 行收敛时精确置为 `target`），因此
  `progress === pending` 等价于"该卡片已停在最终目标"；
- 交错等待阶段（`timeMs < activateAt`）无需单独判断：等待期间若
  `pending !== progress`，第一项判据已为 true；若 `pending === progress`
  （如已收起态重复 `requestCollapsed`，无视觉变化），则无需交互帧率；
- 完全静止的收起态：所有卡片 `progress === pending === 0` → false；
- 初始创建态：`progress === pending`（13–38 行同步初始化）→ false；
- 无需检查 `settling`/`bounceCount`：它们只是弹簧内部中间状态，progress 未收敛
  即已判 true。

`state.expanded` 直接可用：`begin()`（52–65 行）在请求展开/收起时立即同步为
目标态（`state.expanded = target === 1`），因此在收起动画期间 `expanded === false`
而 `isPanelAnimating === true`，两者互补覆盖。

### 3.3 接线（关键实现细节）

面板状态目前是 `src/renderer/panel.mjs` `createPanelController` 闭包内的私有变量，
渲染器拿不到原始 state。因此：

1. `src/renderer/panel.mjs`：控制器返回值新增帧率查询方法：

   ```js
   // 返回面板是否需要交互帧率
   attention() { return state.expanded || isPanelAnimating(state); }
   ```

2. `src/renderer/renderer.mjs`：两个 `scheduler.start` 调用（正常分支 255–267 行、
   probe 分支 197–216 行）都传入 `panelActive: () => panel.attention()`。

3. `src/render-scheduler.mjs`：49、86 两处帧率取值改为统一走一个本地函数：

   ```js
   function targetRate() {
     return options.panelActive?.()
       ? options.config.frameRate.interactive
       : requestedFrameRate(options.state, options.config);
   }
   ```

   `start()` 对 `options.panelActive` 保持可选（缺省退化现有行为），既有调用方与
   测试不破坏。调度器只认识一个布尔 getter，不感知面板语义。

备选方案（否决）：把组合决策放入 `motion.mjs` 的 `targetFrameRate(state, config,
panel)` 并让调度器传入 `options.panel`。会让纯运动核心依赖面板模块、且需要把
私有 state 暴露给调度器，改动面更大；选布尔 getter 方案。

### 3.4 帧率切换机制

无需改调度器节拍切换逻辑：`render-scheduler.mjs` 在 `previousIntervalMs !==
intervalMs` 时重置绘制累加器与 `firstFrame`（88–93 行），60↔30 切换不产生多余
绘制。收起动画结束瞬间 progress 收敛，下一帧回落到漂移帧率，属预期稳态。

### 3.5 边界情况

1. 热加载：`onConfigUpdated` → `panel.setConfig` → `updatePanelConfig`
   （panel-motion.mjs 41–50 行）可能立即触发 `requestExpanded`/`requestCollapsed`，
   动画期判 true → 交互帧率，正确。
2. `autoExpandHide=false`：面板固定展开/收起。固定展开时 `expanded` 恒 true →
   恒交互帧率（用户显式选择）；固定收起时动画结束后回落漂移帧率。
3. 收起动画被展开打断：progress 未收敛判 true → 交互帧率；随后 `expanded` 转 true
   继续 60 FPS，无降帧毛刺。
4. `collapseDelaySeconds = 0`：收起与展开请求可能相邻触发，判据只看
   progress/activateAt，瞬时切换仍平滑。
5. probe 'return' 场景：面板在无输入 8s 后才收起，回归全程面板保持展开 →
   面板关注为真，probe 汇总的 `targetFrameRate` 全程为交互帧率。probe 仍按
   `event.targetFrameRate` 上报（renderer.mjs 211–215 行），无需改上报逻辑；但
   依赖"回归后期出现漂移节拍"的探针口径需按新策略更新（见 4.5）。

## 4. 测试与验收

遵循测试驱动：

1. `test/panel-motion.test.mjs` 新增 `isPanelAnimating` 测试：
   - 新建收起态 → false；新建展开态（autoExpandHide 下仍为收起初始）→ false；
   - `requestExpanded` 后（交错等待中）→ true；
   - 推进至动画收敛（`advancePanel` 直到 progress 到目标）→ false；
   - `requestCollapsed` 后 → true；推进收敛 → false；
   - 已收起态重复 `requestCollapsed`（无视觉变化）→ false。
2. `test/render-scheduler.test.mjs`：
   - 现有用例不传 `panelActive` 保持通过（退化路径）；
   - 新增：`panelActive: () => true` + 漂移运动态 → 目标帧率为 interactive；
   - 新增：`panelActive: () => false` + 漂移运动态 → 目标帧率为 drift。
3. `test/renderer.test.mjs`：断言 `scheduler.start` 传入了 `panelActive`（正则
   `panelActive:`）。
4. README：更新帧率章节（`README.md` 244–250 行表格与 286 行回归节拍说明），补充
   "面板展开/动画期间使用交互帧率；面板收起且完全静止后回落到漂移帧率"；同步
   `README.en.md`；`test/readme.test.mjs` 对等断言。
5. 最终运行：
   - `npm test`
   - `npm run check`
   - `git diff --check`
   - `npm audit` 与 `npm audit --omit=dev`

验收要求：所有测试与检查退出码为 0；不推送远端。

## 5. 不做的事

- 不新增配置项（不引入面板帧率开关；帧率继续由现有 `frameRate.*` 控制）。
- 不改相机运动/回归轨迹参数、不改面板弹簧参数（动画时长/交错/回弹不变）。
- 不引入"面板完全隐藏"状态。
- 不改 probe 上报协议与验收口径本身，仅更新依赖旧节拍预期的场景说明。
