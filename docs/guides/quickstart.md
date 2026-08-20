# 快速开始

[English](quickstart.en.md)

本指南覆盖 Mip-Paper 的环境要求、安装与卸载、日常使用、壁纸管理、KWin 集成、天气服务、右键菜单与诊断排错。完整的配置参考见[配置文件](configuration.md)，隐私与许可见[隐私与许可证](privacy.md)。

## 环境要求

- Arch Linux 或兼容环境
- KDE Plasma 6、KWin >= 6.7、Wayland 会话；6.7 之前的 KWin scripting API 不在支持范围内
- systemd 用户管理器
- PipeWire、WirePlumber、`pw-cat`、`pw-metadata`
- GeoClue（仅自动定位需要）

## 安装与卸载

### 通过 AUR 安装

使用 yay：

```bash
yay -S mip-paper
```

或使用 paru：

```bash
paru -S mip-paper
```

软件包只安装系统文件，不会以 root 身份修改某个用户的主目录。每位用户首次安装后运行：

```bash
mip-paper setup
```

`setup` 创建缺失的配置与天气凭据，默认按显示器读取 KDE 静态壁纸，安装当前用户的 KWin 规则，把 KWin coordinator 安装到当前用户的数据目录并启用，最后启动 `mip-paper.service`。无法读取 KDE 静态图片的屏幕使用随包默认照片。已有配置、凭据和受管理图片不会被覆盖。要在首次设置时直接切换到 manual 模式并使用自己的图片，可运行 `mip-paper setup --image /path/to/image.png`。

完成后，`setup` 会明确显示当前壁纸文件、替换壁纸的命令以及天气是否仍需配置。默认照片只是初始值，随时可以运行：

```bash
mip-paper wallpaper set /path/to/image.jpg
```

### 从源码安装与开发验证

源码安装仍使用系统的 `electron43`，不会复制 npm Electron：

```bash
sudo pacman -S electron43 nodejs npm pipewire pipewire-audio wireplumber
./bin/mip-paper install
```

只准备文件、不启动服务：

```bash
./bin/mip-paper install --no-start
```

开发检查：

```bash
npm ci
npm test
npm run check
bash -n bin/mip-paper scripts/kwin-rules.sh scripts/kwin-script.sh
```

### 卸载

AUR 安装先清理当前用户集成，再由 pacman 删除系统文件：

```bash
mip-paper teardown
sudo pacman -R mip-paper
```

普通 teardown 保留配置、天气凭据和用户图片。显式清除所有 Mip-Paper 用户数据：

```bash
mip-paper teardown --purge
```

源码安装使用 `mip-paper uninstall` 或 `mip-paper uninstall --purge`。

## 使用方法

```bash
mip-paper start
mip-paper stop
mip-paper restart
mip-paper status
mip-paper doctor
```

查看服务日志：

```bash
journalctl --user -u mip-paper.service -n 100 --no-pager
```

`start` 只启动桌面背景服务，不会弹出窗口。确认登录自启动：

```bash
systemctl --user is-enabled mip-paper.service
systemctl --user is-active mip-paper.service
```

## 壁纸与展示

Mip-Paper 附带一张由 LaT-SKY 拍摄并以 CC BY 4.0 授权的默认照片，详见[图片归属说明](../../assets/ATTRIBUTION.md)。发行副本已移除 EXIF 等元数据。项目不附带第三方壁纸，也不会自动下载外部图片。

默认使用 KDE 同步模式：每台显示器分别采用 Plasma 在该屏选择的 `org.kde.image` 静态图片，并在 KDE 设置变化后自动同步。监听器不轮询；配置写入经过 350 ms 防抖，只有图片路径、大小或修改时间变化才复制和解码图片。

KDE 幻灯片与第三方动态壁纸插件暂不支持。该屏会保留上一张有效缓存；首次没有缓存时使用随包默认照片。

手动指定一张图片会切换到 manual 模式并应用到所有显示器。手动图片保存在：

```text
${XDG_DATA_HOME:-$HOME/.local/share}/mip-paper/wallpaper
```

也可以在 setup 时使用 `--image /path/to/image`，或稍后导入自己的 JPEG、PNG 或 WebP。导入后原文件可以移动或删除。用户应确保自己有权使用所选图片；程序的 GPL 许可证不适用于用户导入的图片。

设置或更换图片：

```bash
mip-paper wallpaper set /path/to/image.png
mip-paper wallpaper status
```

恢复按显示器跟随 KDE：

```bash
mip-paper wallpaper use-kde
```

替换失败时会保留上一张有效图片。若服务正在运行，成功更换后会自动重启壁纸。

在设置窗口中也可以导入图片：右键壁纸 → 设置 → 壁纸分区 → 选择图片…，导入 JPEG / PNG / WebP 并自动切换到手动模式。

### 画廊（0.4.0 新增）

每次 `mip-paper wallpaper set` 都会把图片导入到画廊并设为当前，自动按内容去重（`sha256:contentKey`），收藏的图片不会被自动清理。画廊保存在：

```text
${XDG_DATA_HOME:-$HOME/.local/share}/mip-paper/gallery/<shortHash>/wallpaper
${XDG_DATA_HOME:-$HOME/.local/share}/mip-paper/gallery/index.json
```

历史上限 50 张（非收藏、非当前），超出时最旧的自动清理；收藏与当前生效的图片永不过期。

```bash
mip-paper wallpaper gallery list              # 列出画廊
mip-paper wallpaper gallery show <id>         # 查看单条
mip-paper wallpaper gallery set <id>          # 设为当前（自动切 manual 并重启服务）
mip-paper wallpaper gallery favorite <id>     # 收藏
mip-paper wallpaper gallery unfavorite <id>   # 取消收藏
mip-paper wallpaper gallery remove <id>       # 移除
mip-paper wallpaper gallery prune             # 手动清理
```

设置窗口的壁纸分区新增画廊网格：缩略图按 `object-fit: cover` 预览，副标题显示按主显示器 `bounds` 计算的 cover 覆盖提示（`800×600 → 1920×1080 cover`），支持收藏/设为当前/移除与拖拽区域（拖拽后弹出文件选择对话框完成导入）。

## KWin 集成

`setup`（源码安装为 `install`）会为 Mip-Paper 窗口安装两项 KWin 集成：

- **窗口规则**：按窗口类 `mip-paper` 匹配（标题含 `mip-paper|display=` 的壁纸窗口），强制全屏、无边框、位于其他窗口下方（below）、**不接收键盘焦点**（右键菜单为纯鼠标交互，无需焦点；避免焦点变化触发 KWin 重排窗口导致跨屏溢出），并排除在任务栏、分页器和 Alt+Tab 切换器之外，作用于所有虚拟桌面。标题条件把规则限定在壁纸窗口：设置窗口等应用自带 GUI 窗口保持普通窗口形态（带边框、任务栏可见、位于壁纸之上）。
- **显示协调器**（KWin Script）：从窗口标题读取其声明的目标显示器，把每个壁纸窗口移动到对应输出并固定几何形状，处理显示器热插拔与屏幕顺序变化，并上报各输出上的全屏窗口状态（经会话总线 `org.mip.Paper`）。

卸载（`teardown` / `uninstall`）会移除以上两项集成。

## 设置界面

在壁纸上右键打开菜单，选择**设置**打开可视化的设置窗口（与右键菜单同源的设计：浅色白底、大圆角、SVG 图标、弹簧动画）。窗口可以编辑全部配置项并实时热加载、管理天气凭据（脱敏）、编辑自定义右键菜单命令、导入壁纸图片。设置窗口是普通应用窗口，位于壁纸之上、出现在任务栏中；聚焦它或把指针移入它不会收起壁纸上的右键菜单。

`mouse.buttonsEnabled: false` 时壁纸窗口整体穿透鼠标，右键菜单与设置入口均不可用；`mouse.interactionEnabled: false` 仅停止指针驱动的视差，右键菜单仍可用。两者均可在设置窗口的「交互」分区调整，或直接编辑 `~/.config/mip-paper/config.json`。

## 天气服务

自动定位依赖 GeoClue：

```bash
sudo pacman -S geoclue
sudo systemctl enable --now geoclue
gsettings set org.gnome.system.location enabled true
```

安装后重新登录一次，使桌面会话启动 GeoClue 授权代理。应用通过 XDG Desktop Portal 请求城市级位置，不允许 renderer 直接访问 GeoClue。

天气凭据独立保存在 `~/.config/mip-paper/weather-credentials.json`，权限必须为 `0600`：

```json
{
  "apiHost": "your-project-host.qweatherapi.com",
  "apiKey": "your-api-key"
}
```

先登录[和风天气控制台](https://console.qweather.com/)创建项目和 API Key；控制台分配的 API Host 与 API Key 分别填入上面的字段。写入后收紧权限：

```bash
chmod 600 ~/.config/mip-paper/weather-credentials.json
```

Host 只填写 HTTPS 域名，不包含协议、路径、查询参数或用户信息。Key 只由主进程读取，不进入 renderer、URL、日志或缓存。保存合法凭据后会立即重新定位并刷新天气；无效、不安全、未完整写入或被删除的文件会保留最后一份有效凭据，修正后自动恢复。

实时天气每 30 分钟刷新，预报和潮汐每 6 小时刷新。缓存 6 小时内为 fresh，6 至 24 小时为 stale，超过 24 小时为 unavailable。天气数据由和风天气提供；`qweather-icons@1.8.0` 代码采用 MIT，图标采用 CC BY 4.0（归属见[隐私与许可证](privacy.md)）。

## 右键菜单

在壁纸上右键打开菜单：默认提供**刷新壁纸**、**切换信息面板**（停用自动展开收起并钉住到目标状态）、**暂停/恢复壁纸**与**设置**四个内置动作，作用于被右键的这块屏幕；菜单跟随系统明暗。自定义命令通过 `menu.customCommands` 数组添加（配置与逐字段说明见[配置文件](configuration.md)），保存后实时热加载；`id` 不可与内置动作重名（`refresh`、`toggle-panel`、`toggle-pause`、`settings` 为保留 id）。

`background` 模式通过 `sh -c` 后台执行且不弹出窗口，适合 `xdg-open` 或启动图形应用；`terminal` 模式在终端模拟器中运行并保持窗口打开，适合 `sudo pacman -Syu` 这类需要交互或查看输出的命令。终端按 `konsole` → `kitty` → `gnome-terminal` → `x-terminal-emulator` → `xdg-terminal-exec` 顺序探测，全部缺失时回退为后台执行。命令来自你自己的配置文件，失败仅记录日志；渲染进程只发送命令 id，无法注入任意命令。

`menu.avoidObstacles`（默认 `true`）开启避障：KWin 协调器持续上报每块屏幕的工作区（输出几何减去 Plasma 面板/应用栏占用的区域），菜单在底部等有面板的区域打开时会钳制在工作区内，不会被应用栏遮挡。

**进入其他应用自动收起**：`menu.closeOnFocusChange`（默认 `true`）开启后，指针一离开壁纸（或 KWin 协调器检测到切换到其他应用）菜单即自动收起。同时，指针移出壁纸窗口也会立即收起菜单——这覆盖了点击**已经聚焦**的窗口的情况。壁纸窗口本身忽略焦点，因此右键打开菜单不会误触关闭。菜单自身与应用的 GUI 窗口（如设置窗口）不会被这些机制收起。

作为兜底，`menu.autoCloseMs` 可设置菜单打开后无人操作自动关闭的毫秒数（`0` 表示关闭该兜底）。

## 诊断与常见问题

```bash
mip-paper doctor
journalctl --user -u mip-paper.service -n 100 --no-pager
```

- 服务 active 但没有画面：运行 `mip-paper wallpaper status`，再检查 doctor 的 KWin rule 与 KWin coordinator。
- 音频声带不显示：确认 `command:pw-cat`、`command:pw-metadata` 和 `audio-output` 为 PASS，并检查默认输出设备。
- 天气 unavailable：检查凭据权限、Portal 定位权限和网络，日志不会打印 Key。
- `start` 没有普通窗口：这是预期行为，壁纸位于桌面层。

渲染调度性能实验：

```bash
mip-paper probe --duration 60
```
