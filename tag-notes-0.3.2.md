# v0.3.2 Tag Notes（临时记录，打 tag 后删除）

> 用途：记录 0.3.2 自 v0.3.1（18f60b5）以来的全部变更，用于后续创建 git tag 时撰写说明。

## 提交清单（自 v0.3.1 之后，均已合入 main）

| 提交 | 说明 |
| --- | --- |
| 36e33a3 | chore: prepare 0.3.2 development（仓库整理 / 文档） |
| 6663468 | feat: pause wallpaper while a fullscreen window covers the display（全屏暂停功能） |
| 1ae7c3c | fix: replace KWin script heartbeat with app-side resync（无定时器问题的修复） |
| 7a99374 | feat: add a right-click context menu with data-driven commands and obstacle avoidance（右键菜单 + 避障 + 全局唯一 + 恢复忽略焦点） |
| d09ad96 | feat: treat maximized windows as covering the display（最大化窗口也暂停壁纸；maximizeMode 精确检测；修复残留实例抢占 DBus 名称） |
| （待提交） | feat: scope fullscreen pause to the current virtual desktop; dismiss the context menu when another app is focused（多工作区感知暂停 + 右键菜单聚焦自动消失/autoCloseMs 兜底） |

## 变更摘要

### 新功能
- **全屏/最大化窗口暂停壁纸**（`motion.pauseWhenFullscreen`，默认 `true`，实时热加载）：
  - 某台显示器被全屏或**最大化**窗口（视频/游戏等）覆盖时，该屏壁纸渲染循环完全停止（相机、面板、音频冻结，renderer CPU 降至 ~0%）；窗口恢复或移出后自动恢复，其他显示器不受影响。
  - 实现：KWin 显示协调器（`kwin/mip-paper`，v0.3.2）跟踪每输出的覆盖窗口（排除壁纸自身窗口）——`fullScreen===true` 或 `maximizeMode===3`（MaximizeFull，即最大化）——经会话总线 `org.mip.Paper` 推送 `SetOutputFullscreen(name,x,y,w,h,covering)`；主进程新增 `src/fullscreen-watcher.mjs`（dbus-next 服务，按几何匹配显示器、逐屏暂停）；renderer 暂停/恢复调度器，暂停期间对换壁纸/配置/resize 绘制静态帧。
  - 关键修复：
    - KWin 脚本环境无 `setTimeout`/`setInterval`，故无脚本侧心跳；改为事件驱动（`fullScreenChanged`/`maximizedChanged`/`frameGeometryChanged`/`windowAdded`/`windowRemoved`/`windowActivated` 等）+ 应用启动时通过 `org.kde.kwin.Scripting` 重启协调器触发初始推送（自愈）；`scripts/kwin-script.sh` 的 reload 同步改为 unload→load→start（升级无需重启 KWin 即生效）。
    - 最大化检测：KWin 6.7 脚本 API **没有 `window.maximized` 属性**，但有 `window.maximizeMode`（MaximizeFull=3）与 `setMaximize`、`maximizedChanged` 信号；**不能用几何兜底**——plasmashell 桌面窗口也铺满输出，几何检测会误判为覆盖导致永远暂停（实测 `.some()` 短路）。
    - **残留实例抢占 DBus 名称**：曾出现 `npm start`（repo node_modules electron）孤儿实例持有 `org.mip.Paper`，推送全进死实例导致"无效果"；`requestName` 改用 `REPLACE_EXISTING` 并校验回复码后修复。

- **右键菜单**（`menu.*` 配置，实时热加载）：
  - 壁纸上右键打开菜单：默认提供**刷新壁纸**、**切换信息面板**（停用自动展开收起并钉住目标状态）、**暂停/恢复壁纸**三个内置动作，作用于被右键的这块屏；菜单跟随系统明暗（亮色白底/暗色深灰，16px 圆角，内置线性 SVG 图标）。
  - **自定义命令**：`menu.customCommands` 数组（id 唯一且不与内置保留名冲突），`background` 模式 `sh -c` 后台执行（xdg-open/启动应用），`terminal` 模式打开终端模拟器运行并保持窗口（konsole → kitty → gnome-terminal → x-terminal-emulator → xdg-terminal-exec 回退链，全部缺失回退后台）。安全模型：renderer 只发命令 id，命令字符串只在主进程 config 侧解析。
  - **动画**：锚定微弹——从右键落点长出（JS 弹簧 omega=2π×6.5、阻尼 0.6、单次回弹 ~200ms）+ 行内 24ms 错落；关闭 110ms 收向锚点；reduced-motion 即时切换；只动 transform/opacity（性能红线安全）。
  - **避障**（`menu.avoidObstacles`，默认 `true`）：KWin 协调器经 `SetOutputWorkArea` 推送每屏工作区（输出几何减 Plasma 面板/应用栏），菜单按工作区渐进式上移/翻转（超出安全区少则底部贴边，多则完全翻转到点击点上方），面板不再遮挡菜单；工作区跟随面板增删与热插拔实时更新。
  - **全局唯一**：任意窗口打开菜单或指针按下，都会广播关闭其他窗口的菜单，桌面上同时最多一个菜单。
  - **忽略焦点规则恢复**：`scripts/kwin-rules.sh` 重新写入 `acceptfocus=false`/`acceptfocusrule=2`——右键菜单为纯鼠标交互无需焦点；避免焦点变化触发 KWin 重排窗口（Chromium Wayland 分数缩放下窗口被放大，重排导致跨屏溢出）。
  - **渲染边界修复**：renderer 按 display.bounds（DIP）渲染并裁剪，画布超出的边缘填背景色——Chromium Wayland 把窗口算大（如 1568×1002 vs 1536×960）时壁纸不再溢出到相邻显示器。

- **多工作区感知的全屏暂停**（续 motion.pauseWhenFullscreen）：
  - 覆盖判定只考虑该显示器**当前虚拟桌面**上的窗口：KWin 6.7 脚本用 window.desktops（VirtualDesktop 数组）+ window.onAllDesktops 判定窗口所在桌面，workspace.currentDesktop 为当前桌面；其他工作区的全屏/最大化窗口不再冻结壁纸（切到无覆盖的工作区时继续漂移）；切换工作区（currentDesktopChanged）实时重推覆盖状态；固定在所有桌面的窗口任何工作区都视为覆盖。兼容 Plasma 5 数字桌面兜底（window.desktop）。

- **右键菜单聚焦自动消失 + 自动关闭兜底**（menu.* 配置，实时热加载）：
  - menu.closeOnFocusChange（默认 true）：KWin 协调器在 windowActivated 时（非壁纸窗口）经会话总线 org.mip.Paper 的 /Menu·org.mip.Paper.Menu·WindowActivated 通知主进程，window-manager 新增 closeMenus() 向所有 renderer 广播 MENU_CLOSE_CHANNEL，各屏菜单自动收起；壁纸窗口忽略焦点，右键打开菜单不会误触关闭。
  - menu.autoCloseMs（默认 0 = 关闭）：renderer 侧兜底——菜单打开后启动一次性定时器，超时未操作自动关闭；createContextMenu 支持 getter 实时读取热加载值，open/close/destroy 正确取消定时器。

### 仓库整理
- 停止跟踪本地 `.idea/` 与 `docs/design`、`docs/superpowers` 设计文档（保留在本地）。
- 移除废弃的 Rust/CXX-Qt 实验目录（`crates/`、`target/`，13GB 构建产物）。
- 清理多余分支：删除已合入的 `feat/pause-on-fullscreen`、`feature/0.3.1-panel-aware-frame-rate` 与废弃的 `feature/0.3.0-rust-qt-quick`（Rust/Qt 实验 temp-commit），仓库仅保留 `main`。

### 文档
- README（中/英）新增「KWin 集成」章节与 `motion.pauseWhenFullscreen` 配置说明。
- 新增 `CHANGELOG.md`（Keep a Changelog 格式）与 `docs/README.md` 索引。

## 验证
- `npm test`：366/366 通过（含新增 `test/context-menu.test.mjs`、`test/menu-command.test.mjs` 及扩展的 config/fullscreen-watcher/kwin-coordinator/kwin-rules/preload/renderer/readme/window-manager 测试；最大化检测 4 个用例 + plasmashell 桌面层回归；多工作区覆盖 6 个用例：其他工作区不暂停/当前工作区暂停/所有桌面固定仍暂停/切桌面重评估/Plasma 5 数字兜底/壁纸窗口激活不发菜单通知；菜单聚焦关闭 4 个用例：watcher 转发 onWindowActivated、不受 pauseWhenFullscreen 门控、closeMenus 广播、preload/renderer/context-menu 接线）。
- `npm run check`、`bash -n bin/mip-paper scripts/kwin-rules.sh scripts/kwin-script.sh` 通过。
- 实机验证：mpv 真实全屏与**真实最大化**（脚本 `setMaximize` 触发）均验证：总线捕获 `SetOutputFullscreen("eDP-1",0,0,1536,960,true)`，对应屏 renderer CPU 6.5%→0.5%（另一屏保持 7%，逐屏正确）；手动 DBus 推送隔离测试通过；`SetOutputWorkArea(..., 0,0,1536,922)`（双屏：eDP-1 1536×960 scale 1.66667 + HDMI-A-1 1933×1087 scale 1.325）；右键菜单开合/翻转避障/跨屏全局唯一；`mip-paper doctor` 23 项 PASS。
- 已知限制：Chromium Wayland 分数缩放下窗口 CSS 视口被算大（如 1568×1002），已通过渲染边界裁剪规避内容溢出；窗口边缘溢出区域显示背景色。

## 打 tag 前的收尾（提醒）
- [ ] `package.json` 版本号从 0.3.1 升到 0.3.2（按既有流程随 release 提交）
- [ ] 建议 tag 命令：`git tag -a v0.3.2 -m "..."`（可参考本文件内容）
- [ ] 本地 main 领先 `origin/main` 5 个提交（0.3.2 全部工作），打 tag 前先 `git push origin main`
- [ ] 本文件用完删除