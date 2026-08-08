# 渲染资源 Probe 第四轮结果（2026-08-09）

## 协议

- 双显示器、Wayland、Electron 43.3.0
- 依次测试 `raf`、`timer`、`adaptive`，每种策略执行 `idle`、`sweep`、`return`
- 每个窗口单次采样 10 秒，`warmup=0`，不重复场景
- CPU：窗口前后 `CPUUsageNSec` 差分除以墙钟时间
- RSS：窗口结束时 systemd service cgroup 的 `MemoryCurrent`
- GPU：窗口结束时 `nvidia-smi` 单次快照；当前 GPU 为 NVIDIA RTX 5060 Laptop GPU
- 原始结果：`/tmp/animated-ocean-resource-full.hPZMIW`

## 逐场景结果

| 策略/场景 | CPU | RSS | GPU 利用率 | 显存 | 功耗 | 温度 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `raf` / idle | 21.70% | 199.5 MiB | 5% | 1308 MiB | 19.38 W | 51 C |
| `raf` / sweep | 25.45% | 203.1 MiB | 8% | 1308 MiB | 23.06 W | 51 C |
| `raf` / return | 22.23% | 197.5 MiB | 5% | 1308 MiB | 19.37 W | 51 C |
| `timer` / idle | 19.62% | 201.6 MiB | 5% | 1308 MiB | 19.87 W | 51 C |
| `timer` / sweep | 24.78% | 197.7 MiB | 9% | 1318 MiB | 24.27 W | 52 C |
| `timer` / return | 19.59% | 194.1 MiB | 5% | 1326 MiB | 20.05 W | 51 C |
| `adaptive` / idle | 22.17% | 202.9 MiB | 5% | 1377 MiB | 19.23 W | 51 C |
| `adaptive` / sweep | 26.25% | 205.2 MiB | 9% | 1360 MiB | 24.79 W | 51 C |
| `adaptive` / return | 22.45% | 195.2 MiB | 5% | 1360 MiB | 19.94 W | 51 C |

## 策略均值

| 策略 | CPU | RSS | GPU 利用率 | 显存 | 功耗 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `raf` | 23.13% | 200.1 MiB | 6.0% | 1308 MiB | 20.60 W |
| `timer` | 21.33% | 197.8 MiB | 6.3% | 1317 MiB | 21.40 W |
| `adaptive` | 23.63% | 201.1 MiB | 6.3% | 1366 MiB | 21.32 W |

## 结论与限制

- 本轮资源窗口中，`timer` 的平均 CPU 和 RSS 最低；GPU 利用率与功耗和其他策略接近。
- `adaptive` 的显存快照均值较高，但单点快照受进程启动、GPU 回收和采样时刻影响，不能据此判定持续显存开销更高。
- `raf` 的资源略高且第二、三轮已确认 FPS 不达标，因此不考虑恢复为默认策略。
- 本轮只验证资源采集链路和短窗口趋势，不替代长时稳定性测试；GPU 指标应在后续需要时改为窗口内多点采样的均值/峰值。

当前服务结束后为 `active`，probe 环境变量已清理。
