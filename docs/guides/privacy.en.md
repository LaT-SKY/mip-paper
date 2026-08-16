# Privacy and Licenses

[中文](privacy.md)

## Media Output Only

The visualizer follows the current default PipeWire output device. It connects to sink monitor ports with `stream.capture.sink=true` and identifies the stream as `Stream/Input/Audio/Internal`. It never connects to a microphone, never records audio, and does not appear as a recording application in Plasma's microphone list.

Raw PCM exists only briefly inside the main-process FFT pipeline. It is never written to disk, logs, cache, IPC, or the renderer. Three curves share one baseline: the right channel uses that display's wallpaper accent, the left channel uses its complementary color, and the combined spectrum uses pure black or pure white. Each display independently selects the higher-contrast neutral from its own wallpaper luminance, so light wallpapers use pure black and dark wallpapers use pure white. The strokes have no glow, frosted background, border, or panel shadow.

## Licenses and Third-Party Components

Mip-Paper program code is `GPL-3.0-only`; see [LICENSE](../../LICENSE). Copyright (C) 2026 LaT-SKY.

The default photograph is Copyright (C) 2026 LaT-SKY and licensed under CC BY 4.0; attribution and modification details are in [assets/ATTRIBUTION.md](../../assets/ATTRIBUTION.md). Bundled JavaScript dependencies retain their own licenses, primarily MIT. QWeather icons (`qweather-icons@1.8.0`) are CC BY 4.0. AUR package-source files use 0BSD. You remain responsible for the rights and license of any imported image.
