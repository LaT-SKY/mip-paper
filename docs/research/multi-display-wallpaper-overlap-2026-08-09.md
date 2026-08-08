# 多显示器壁纸跨屏重叠诊断（2026-08-09）

## 现象

副屏左侧出现一条主屏壁纸内容，表现为壁纸窗口在两个输出之间发生物理边界重叠。

## 输出布局

`kscreen-doctor -o` 报告：

- `eDP-1`：逻辑几何 `0,0 1536x960`，缩放 `1.66667`
- `HDMI-A-1`：逻辑几何 `1536,0 1933x1087`，缩放 `1.325`

## 根因证据

强制 fullscreen 规则启用时，KWin coordinator 记录到的 frame geometry 为：

| 输出 | 目标 geometry | 实际 frame geometry |
| --- | --- | --- |
| `eDP-1` | `0,0,1536,960` | `0,0,1567.8,1002` |
| `HDMI-A-1` | `1536,0,1932,1087` | `1536,0,1963.77,1129.06` |

两块屏幕都被放大约 `31.8 DIP`，在不同缩放比例下造成跨输出绘制。

关闭 fullscreen 规则并重新启动后，最终 frame geometry 变为：

| 输出 | 目标 geometry | 实际 frame geometry |
| --- | --- | --- |
| `eDP-1` | `0,0,1536,960` | `0,0,1536,960` |
| `HDMI-A-1` | `1536,0,1932,1087` | `1536,0,1932.08,1087.55` |

这与现象消失的假设一致。窗口在 `window-added` 的瞬间可能暂时位于错误 output，但随 `output-changed` 事件收敛到目标 output，最终几何正确。

## 修复

- KWin 项目规则不再写入 `fullscreen=true` 和 `fullscreenrule=2`。
- 卸载/升级流程仍删除遗留 fullscreen keys，避免旧配置继续生效。
- coordinator 增加 geometry 诊断日志，记录 target、frame、当前 output 和 output geometry。
- 已更新实际安装快照并重启服务。

## 验证

- KWin rule 测试、完整 Node 测试和 shell 语法检查通过。
- 当前服务为 `active`。
- 实际安装配置中的 `fullscreen` 已为 `false`，最终窗口 frame 与输出 geometry 对齐。
