# 渲染性能 Probe 第三轮结果（2026-08-09）

## 测试环境与协议

- KDE Plasma 6 / KWin 6 / Wayland
- Electron 43.3.0
- 双显示器；本轮使用移除 KWin fullscreen 规则后的安装快照
- 原始结果：`/tmp/mip-paper-probe-round3.qubSWr`
- 本轮比较 `timer` 与 `adaptive`；`raf` 已在第二轮因 FPS 不达标淘汰
- 每种策略执行 `idle`、`sweep`、`return`
- 每个场景预热 30 秒、采样 60 秒

测试结束后服务为 `active`，`ELECTRON_OZONE_PLATFORM_HINT=auto` 保持不变，probe 专用环境变量已清理。

## 帧率与时序结果

表中范围覆盖两块显示器。FPS 使用采样窗口内累计 `drawCount` 差值计算；callback 百分位是各显示器五秒汇总值的平均范围。

| 策略/场景 | 绘制 FPS | callback p95 | callback p99 | deadline miss | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| `timer` / idle | 30.02 | 33.2 ms | 33.2 - 33.3 ms | 0.0 - 5.9 / min | 通过 |
| `timer` / sweep | 59.99 - 60.0 | 16.2 ms | 16.2 ms | 0.7 / min | 通过 |
| `timer` / return | 30.02 | 33.2 ms | 33.2 - 33.3 ms | 0.7 - 1.5 / min | 通过 |
| `adaptive` / idle | 30.0 | 3.4 - 8.4 ms | 3.5 - 8.5 ms | 0 / min | 通过 |
| `adaptive` / sweep | 60.0 | 3.4 - 8.4 ms | 3.5 - 8.5 ms | 0 / min | 通过 |
| `adaptive` / return | 30.0 | 3.4 - 8.4 ms | 3.5 - 8.5 ms | 0 / min | 通过 |

阈值沿用第二轮：交互 FPS 不低于 57、callback p95 不超过 20 ms、p99 不超过 33.4 ms；漂移/回归 FPS 不低于 28.5、callback p95 不超过 40 ms、p99 不超过 66.7 ms。

## 结论

- `timer` 和 `adaptive` 在本轮全部场景均达到目标 FPS 和 callback 时序阈值。
- `adaptive` 的 callback p95/p99 明显低于 `timer`，且本轮没有记录 deadline miss；`timer` 的 30 FPS 场景 callback 间隔约为 33.2 ms，符合目标周期但余量较小。
- 资源指标暂不具备策略比较资格。`CPUUsageNSec` 是服务累计值，且每个场景重启服务；`MemoryCurrent` 记录约 7-13 GB，与服务实际 RSS 不一致。故本轮不修改默认调度策略。

## 后续

改造资源采样：在单次服务生命周期内连续采样，使用相邻 CPU 时间差除以墙钟时间计算占用率，RSS 取稳定窗口中位数。之后只需重跑 `timer` 与 `adaptive` 完整协议，即可结合资源开销决定默认策略。
