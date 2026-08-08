# 渲染性能 Probe 第二轮结果（2026-08-09）

## 测试环境与协议

- KDE Plasma 6 / KWin 6 / Wayland
- Electron 43.3.0
- 双显示器，运行快照已重新安装
- 原始结果：`/tmp/animated-ocean-probe-round2.72rlCT`
- 每种策略执行 `idle`、`sweep`、`return`
- 每个场景预热 30 秒、采样 60 秒

本轮修正了 callback interval、动态 `mode` 和动态目标帧率的记录。测试期间服务保持 `active`，结束后 probe 环境变量为空。

## 帧率与时序结果

每个单元为两块显示器的结果范围；FPS 使用相邻汇总的累计 `drawCount` 差值计算。

| 策略/场景 | 绘制 FPS | callback p95 | callback p99 | 结果 |
| --- | ---: | ---: | ---: | --- |
| `raf` / idle | 27.2 - 28.8 | 3.4 - 8.4 ms | 3.5 - 8.5 ms | 失败：一块屏幕低于 28.5 FPS |
| `raf` / sweep | 52.3 - 56.2 | 3.4 - 8.4 ms | 3.4 - 8.5 ms | 失败：低于 57 FPS |
| `raf` / return | 27.2 - 28.7 | 3.4 - 8.4 ms | 3.4 - 8.5 ms | 失败：一块屏幕低于 28.5 FPS |
| `timer` / idle | 30.0 | 33.2 ms | 33.2 ms | 通过 |
| `timer` / sweep | 60.0 | 16.2 ms | 16.2 ms | 通过 |
| `timer` / return | 30.0 | 33.2 ms | 33.3 ms | 通过 |
| `adaptive` / idle | 30.0 | 3.4 - 8.4 ms | 3.5 - 8.5 ms | 通过 |
| `adaptive` / sweep | 60.0 | 3.4 - 8.4 ms | 3.5 - 8.5 ms | 通过 |
| `adaptive` / return | 30.0 | 3.4 - 9.5 ms | 3.5 - 19.3 ms | 通过 |

阈值为：交互 FPS 不低于 57、callback p95 不超过 20 ms、p99 不超过 33.4 ms；漂移/回归 FPS 不低于 28.5、callback p95 不超过 40 ms、p99 不超过 66.7 ms。

## 结论

- `raf` 淘汰。固定 deadline 在当前双屏 VSync 节奏下无法稳定达到目标绘制 FPS。
- `timer` 和 `adaptive` 均通过全部帧率及时序阈值。
- 当前不能在 `timer` 与 `adaptive` 之间选择默认策略，因为 CPU/RSS 采样仍未归一化：每个场景会重启服务，`CPUUsageNSec` 被重置，`MemoryCurrent` 读数也明显不符合服务进程实际 RSS。
- 本轮不修改默认调度策略。

## 下一步

改造资源采样器，使每个场景在单次服务生命周期内采集多个点，并使用相邻 CPU 时间差除以墙钟时间计算占用率；RSS 取稳定采样窗口的中位数。完成后只需对 `timer` 和 `adaptive` 重跑完整协议即可做最终选择。
