# 信息面板三期实机验证记录

- 日期：2026-08-09
- 环境：KDE Plasma 6.7.4、KWin 6.7.4、Wayland、Electron 43.3.0
- 分支：`feature/phase3-components`
- 数据记录原则：不记录凭据、API Host、精确经纬度或原始 API 响应

## 已验证

- `npm test`：104 项测试通过，0 失败。
- `npm run check`：所有 `src` 与 `test` ES modules 通过语法检查。
- installer、doctor 与 shell 脚本语法检查通过。
- 正式用户安装快照已更新；面板运动与天气客户端文件和仓库版本一致。
- systemd 用户服务为 `active` 且 `enabled`，命令行与近 10 分钟日志不含凭据。
- 凭据文件存在且权限为 `0600`；doctor 的自动检查全部为 PASS。
- 和风城市 fallback 可解析；实时天气、7 天预报、当天 4 个潮汐事件和 24 个逐小时潮位均成功返回。
- 完整 Electron 应用经 fallback 显示 fresh 天气与 fresh 潮汐；湿度已按 v1 的 `0..1` 比例转换为百分比。
- 两个实际显示器分别完成 2560x1441 与 2560x1600 高 DPI 截图；Canvas 非空，四卡梯形布局、主体避让与卡片叠放正常。
- 收起透明度为 `0.08`；允许卡片在外飘状态部分越出视口。
- 真实页面输入触发展开；最近卡优先、收起逆序由自动化测试覆盖。
- 60Hz 动画轨迹与冻结原型数值一致；强越界实测缩放约 `1.0744`，并出现亮度/饱和度能量突破；低帧率子步保证只计一次强回弹和一次弱回弹。

## 当前降级

XDG Desktop Portal 可连接，但系统返回 `org.freedesktop.portal.Error.NotAllowed`，原因是系统定位服务被禁用。因此本次实机运行使用配置的东莞 LocationID fallback；应用没有因定位失败退出。

## 尚待验收

- 启用系统定位服务后完成 Portal 授权成功路径，并确认城市级坐标刷新。
- 在真实桌面中手工验证固定坐标覆盖、断网后的 stale/unavailable 状态、显示器热插拔、锁屏、挂起和唤醒。
- 对正式服务执行持续资源 Probe，并确认长期运行的 CPU/GPU/内存表现。

## 剩余风险

- `dbus-next@0.10.2` 已替换为 API 兼容的 `@particle/dbus-next@0.11.4`。新依赖移除了 `usocket` 原生构建链，并使用已修复的 `xml2js@0.6.2`；Portal D-Bus 调用行为保持不变。
- 和风文档已宣布未来收紧 API Key 支持；认证模块应保留迁移到 JWT 的边界。
