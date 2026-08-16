# 隐私与许可证

[English](privacy.en.md)

## 只响应媒体输出

音频可视化通过 PipeWire 跟随当前默认输出设备。实现使用 `stream.capture.sink=true` 连接输出设备的 monitor 端口，并把流标记为 `Stream/Input/Audio/Internal`。它不会连接麦克风，不会录制或保存 PCM 音频，也不会作为录音应用出现在 Plasma 麦克风列表中。

原始 PCM 只在主进程内短暂进入 FFT 管线，不会写入磁盘、日志、缓存、IPC 或 renderer。三层曲线围绕共同基线显示左声道、右声道和合并频谱：右声道使用所在屏幕壁纸的动态强调色，左声道使用其互补色，合并曲线使用纯黑或纯白。每块屏幕根据自己的壁纸感知亮度独立选择对比度更高的中性色，因此浅色壁纸使用纯黑，深色壁纸使用纯白。曲线不使用辉光、磨砂背景、边框或面板阴影。

## 许可证与第三方组件

Mip-Paper 程序代码采用 `GPL-3.0-only`，详见 [LICENSE](../../LICENSE)。Copyright (C) 2026 LaT-SKY。

默认照片 Copyright (C) 2026 LaT-SKY，采用 CC BY 4.0，归属和修改说明见 [assets/ATTRIBUTION.md](../../assets/ATTRIBUTION.md)。随包保留的 JavaScript 依赖代码采用各自许可证，主要为 MIT；和风天气图标（`qweather-icons@1.8.0`）采用 CC BY 4.0。AUR 的 PKGBUILD 与安装脚本单独采用 0BSD。用户导入图片的权利与许可证由用户自行负责。
