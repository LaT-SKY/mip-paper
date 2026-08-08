# Animated Ocean Wallpaper

面向 KDE Plasma 6、KWin 6 和 Wayland 的动态桌面壁纸运行器。程序使用 Electron 创建每显示器一个的全屏 Canvas 窗口，绘制 `assets/161-2.jpeg`，并提供缓慢漂移与鼠标视差交互。

这是一个 Electron 壁纸运行器，不是 Plasma 原生 wallpaper plugin，也不是会弹出主窗口的桌面应用。执行 `start` 后，壁纸应直接出现在桌面背景层；不会出现在任务栏、Alt+Tab 或应用启动器中。

## 要求

- KDE Plasma 6 和 KWin 6
- Wayland 会话
- Node.js、npm、Electron 43.3.0
- `systemd --user`
- `kreadconfig6`、`kwriteconfig6`

安装器只写入当前用户目录，不需要 `sudo`。

## 安装或更新

在仓库根目录执行：

```bash
./bin/animated-ocean-wallpaper install
```

这会完成以下操作：

1. 将当前源码复制到 `~/.local/lib/animated-ocean-wallpaper/`。
2. 在安装快照中执行 `npm ci --omit=dev`，准备 Electron 运行时。
3. 安装命令入口 `~/.local/bin/animated-ocean-wallpaper`。
4. 写入 systemd 用户服务、KWin 壁纸窗口规则和多显示器 coordinator。
5. 执行 `systemctl --user enable --now`，立即启动并设置登录自启。

KWin 规则只负责桌面层级、任务栏、分页器和 Alt+Tab 隔离；coordinator 读取每个 Electron 窗口标题中的目标显示器描述，并把窗口移动到唯一匹配的输出。显示器重连后会创建新的 Electron 窗口，因此该屏幕会从独立的运动状态重新开始。

安装完成后，自动启动状态可以这样确认：

```bash
systemctl --user is-enabled animated-ocean-wallpaper.service
```

输出 `enabled` 即表示下次登录会自动启动。若曾手动禁用，可重新启用：

```bash
systemctl --user enable --now animated-ocean-wallpaper.service
```

只更新文件、不启动服务：

```bash
./bin/animated-ocean-wallpaper install --no-start
```

修改源码后，必须重新执行 `install`，因为服务运行的是 `~/.local/lib` 中的安装快照，不是仓库目录。

## 启动、停止和查看状态

```bash
animated-ocean-wallpaper start
animated-ocean-wallpaper stop
animated-ocean-wallpaper restart
animated-ocean-wallpaper status
```

如果 shell 找不到命令，使用完整路径：

```bash
~/.local/bin/animated-ocean-wallpaper start
```

`start` 只启动后台用户服务，不会打开普通应用窗口；当前版本会打印一行服务请求确认。确认是否真的启动：

```bash
systemctl --user is-active animated-ocean-wallpaper.service
systemctl --user status animated-ocean-wallpaper.service --no-pager -l
```

第一个命令应输出 `active`。壁纸窗口被 KWin 放在桌面层，因此不能通过 Alt+Tab 找到。

## 排错

先运行诊断：

```bash
animated-ocean-wallpaper doctor
```

查看本次服务日志：

```bash
journalctl --user -u animated-ocean-wallpaper.service -n 100 --no-pager
```

查看 KWin coordinator 的定位日志：

```bash
journalctl --user -b --no-pager | grep animated-ocean-coordinator
```

常见情况：

- `status=203/EXEC`：安装快照缺少 Electron，重新执行 `install`。
- `Wallpaper failed to start`：查看日志中的配置或 preload 错误，确认安装快照已更新。
- 服务是 `active` 但桌面没有壁纸：确认 `doctor` 的 `KWin rule` 和 `KWin coordinator` 都为 `PASS`，然后执行 `restart`。规则文件是 `${XDG_CONFIG_HOME:-$HOME/.config}/kwinrulesrc`。
- `start` 无任何窗口：这是预期行为；本项目没有普通应用窗口，检查桌面背景和 `systemctl --user is-active`。

`doctor` 会自动检查环境、配置、Electron 快照、服务、KWin 规则和 coordinator；窗口层级、面板遮挡、鼠标输入、多显示器热插拔、锁屏恢复和资源占用仍需人工确认。

## 配置

配置文件：`~/.config/animated-ocean-wallpaper/config.json`。

```json
{
  "interactionEnabled": true,
  "frameRate": { "interactive": 60, "drift": 30 },
  "motion": {
    "interactionSpeed": 1.15,
    "returnSpeed": 0.3,
    "driftSpeed": 1,
    "deadZonePx": 2,
    "horizontalPanPercent": 4.6,
    "verticalPanPercent": 4.5,
    "maxRotationDegrees": 0.7
  }
}
```

修改后执行：

```bash
animated-ocean-wallpaper restart
```

未知字段、错误类型或低于限制的帧率会阻止启动，并在 service 日志中报告原因。

## 卸载

保留配置：

```bash
animated-ocean-wallpaper uninstall
```

连配置一起删除：

```bash
animated-ocean-wallpaper uninstall --purge
```

卸载会停止并禁用服务，删除安装快照、命令入口、服务文件和本项目 KWin 规则，不会删除其他 KWin 规则。

## 开发验证

```bash
npm ci
npm test
npm run check
bash -n bin/animated-ocean-wallpaper scripts/kwin-rules.sh
```

项目设计和研究资料位于 `docs/`。
