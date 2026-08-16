// Field schema for the visual settings window. Pure data — no DOM, no
// Electron. The renderer (settings.mjs) renders one control per field from
// these descriptors; tests assert the schema covers every leaf of
// DEFAULT_CONFIG/SCHEMA in src/config.mjs with matching ranges and enum
// options, so the UI cannot drift from the validated configuration shape.
//
// Field types:
//   boolean  -> switch, bound to a boolean
//   enum     -> select, options = [{ value, label }]
//   number   -> number input, min/max/step mirror config.mjs validation
//   text     -> text input
//   password -> password input (never sent back by get-state)
//   commands -> list editor for menu.customCommands (subfields below)

import { ICONS } from './renderer/context-menu.mjs';

// Icon names offered by the custom-command icon picker. '' means no icon.
// Unknown icon strings already present in a user config stay valid (the
// picker is a datalist, so arbitrary values remain editable).
export const COMMAND_ICON_OPTIONS = Object.freeze([null, ...Object.keys(ICONS)]);

const COMMAND_MODE_OPTIONS = Object.freeze([
  { value: 'background', label: '后台执行' },
  { value: 'terminal', label: '终端执行' },
]);

const COMMAND_SUBFIELDS = Object.freeze([
  { key: 'id', label: 'ID', type: 'text', placeholder: '唯一标识，如 downloads' },
  { key: 'label', label: '显示名称', type: 'text', placeholder: '菜单显示文字' },
  { key: 'command', label: '命令', type: 'text', placeholder: '如 xdg-open ~/Downloads' },
  { key: 'mode', label: '执行模式', type: 'enum', options: COMMAND_MODE_OPTIONS },
  { key: 'icon', label: '图标', type: 'icon' },
]);

// Ordered groups rendered in the settings window navigation and content area.
// 'external' groups do not map onto config.json (credentials live in a
// separate 0600 file); 'static' groups are informational only.
export const SETTINGS_GROUPS = Object.freeze([
  {
    id: 'basic',
    title: '基础',
    icon: 'sliders',
    fields: [
      {
        key: 'interactionEnabled',
        label: '鼠标交互',
        type: 'boolean',
        description: '是否接收鼠标并驱动视差；关闭后壁纸窗口穿透鼠标，右键菜单与设置入口不可用',
      },
    ],
  },
  {
    id: 'wallpaper',
    title: '壁纸',
    icon: 'image',
    fields: [
      {
        key: 'wallpaper.mode',
        label: '壁纸模式',
        type: 'enum',
        options: [
          { value: 'kde', label: '跟随 KDE（每台显示器同步 Plasma 静态壁纸）' },
          { value: 'manual', label: '手动图片（所有显示器使用导入的图片）' },
        ],
        description: '切换后会经配置热加载立即生效',
      },
    ],
  },
  {
    id: 'color',
    title: '颜色',
    icon: 'palette',
    fields: [
      {
        key: 'color.mode',
        label: '强调色来源',
        type: 'enum',
        options: [
          { value: 'default', label: '默认（品牌粉）' },
          { value: 'kde', label: '跟随 KDE 强调色' },
          { value: 'wallpaper', label: '从壁纸取色' },
          { value: 'hybrid', label: '混合（优先壁纸，回退 KDE）' },
        ],
      },
      {
        key: 'color.transitionDurationMs',
        label: '强调色过渡时长',
        type: 'number',
        min: 0,
        max: 5000,
        step: 50,
        unit: 'ms',
        description: '0 为立即切换；系统启用减少动态效果时强制为 0',
      },
    ],
  },
  {
    id: 'appearance',
    title: '外观',
    icon: 'moon',
    fields: [
      {
        key: 'appearance.mode',
        label: '明暗模式',
        type: 'enum',
        options: [
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
          { value: 'system', label: '跟随系统（按 KDE 窗口背景亮度）' },
        ],
      },
      {
        key: 'appearance.dark.wallpaperBrightness',
        label: '深色模式壁纸亮度',
        type: 'number',
        min: 0.2,
        max: 1,
        step: 0.01,
        description: '深色模式下壁纸的最终显示亮度倍率；1 表示不压暗',
      },
    ],
  },
  {
    id: 'audio',
    title: '音频',
    icon: 'music',
    fields: [
      { key: 'audio.enabled', label: '音频可视化', type: 'boolean', description: '启用或停止输出设备 monitor 频谱' },
      { key: 'audio.gain', label: '频谱增益', type: 'number', min: 0.25, max: 4, step: 0.05 },
      { key: 'audio.silenceDelayMs', label: '静音等待', type: 'number', min: 0, max: 5000, step: 50, unit: 'ms', description: '静音后保持曲线的等待时间' },
      { key: 'audio.fadeOutMs', label: '淡出时长', type: 'number', min: 0, max: 3000, step: 50, unit: 'ms' },
      { key: 'audio.fadeInMs', label: '淡入时长', type: 'number', min: 0, max: 3000, step: 50, unit: 'ms' },
    ],
  },
  {
    id: 'frameRate',
    title: '帧率',
    icon: 'gauge',
    fields: [
      { key: 'frameRate.interactive', label: '交互帧率', type: 'number', min: 1, max: 180, step: 1, unit: 'FPS', description: '交互、回归、面板展开与动画阶段的目标帧率' },
      { key: 'frameRate.drift', label: '漂移帧率', type: 'number', min: 1, max: 180, step: 1, unit: 'FPS', description: '面板收起且完全静止时的待机漂移帧率' },
    ],
  },
  {
    id: 'motion',
    title: '运动与视差',
    icon: 'move',
    fields: [
      { key: 'motion.interactionSpeed', label: '交互追随速度', type: 'number', min: 0.01, step: 0.05 },
      { key: 'motion.returnSpeed', label: '回归速度', type: 'number', min: 0.01, step: 0.05 },
      { key: 'motion.driftSpeed', label: '漂移速度', type: 'number', min: 0.01, step: 0.05 },
      { key: 'motion.deadZonePx', label: '指针死区', type: 'number', min: 0, step: 1, unit: 'px', description: '过滤细小指针抖动的滑动死区' },
      { key: 'motion.horizontalPanPercent', label: '水平平移上限', type: 'number', min: 0, step: 0.1, unit: '%', description: '占视口宽度的比例' },
      { key: 'motion.verticalPanPercent', label: '垂直平移上限', type: 'number', min: 0, step: 0.1, unit: '%', description: '占视口高度的比例' },
      { key: 'motion.maxRotationDegrees', label: '最大旋转角度', type: 'number', min: 0, step: 0.1, unit: '°' },
      { key: 'motion.pauseWhenFullscreen', label: '全屏覆盖时暂停', type: 'boolean', description: '显示器被全屏/最大化窗口覆盖时暂停该屏移动与渲染，窗口恢复后自动继续' },
    ],
  },
  {
    id: 'panel',
    title: '信息面板',
    icon: 'layout',
    fields: [
      { key: 'panel.autoExpandHide', label: '自动展开收起', type: 'boolean', description: '按鼠标距离自动展开并延迟收起' },
      { key: 'panel.expandTriggerDistancePx', label: '展开触发距离', type: 'number', min: 0, step: 1, unit: 'px', description: '触发下一块面板展开所需的累计指针移动' },
      { key: 'panel.collapseDelaySeconds', label: '收起等待时间', type: 'number', min: 0, step: 0.5, unit: 's', description: '无交互后开始收起的等待时间' },
      { key: 'panel.expanded', label: '固定展开', type: 'boolean', description: '禁用自动模式时使用的固定展开状态' },
      { key: 'panel.collapsedOpacity', label: '收起最低不透明度', type: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'panel.animation.staggerDelayMs', label: '动画错开时间', type: 'number', min: 0, step: 10, unit: 'ms' },
      { key: 'panel.animation.durationMs', label: '单块动画时长', type: 'number', min: 400, step: 10, unit: 'ms', description: '包含两次回弹的单块面板动画时长' },
    ],
  },
  {
    id: 'weather',
    title: '天气与定位',
    icon: 'cloud',
    fields: [
      {
        key: 'weather.location.mode',
        label: '定位模式',
        type: 'enum',
        options: [
          { value: 'auto', label: '自动（XDG Desktop Portal 定位）' },
          { value: 'fixed', label: '固定坐标' },
        ],
      },
      { key: 'weather.location.latitude', label: '纬度', type: 'number', min: -90, max: 90, step: 0.0001, nullable: true, description: 'fixed 模式必须与经度同时提供' },
      { key: 'weather.location.longitude', label: '经度', type: 'number', min: -180, max: 180, step: 0.0001, nullable: true },
      { key: 'weather.location.fallbackLocationId', label: '回退 LocationID', type: 'text', description: '自动定位与缓存均失败时使用的和风 LocationID' },
      { key: 'weather.tideStationId', label: '潮汐观测站 ID', type: 'text' },
    ],
  },
  {
    id: 'menu',
    title: '右键菜单',
    icon: 'menu',
    fields: [
      { key: 'menu.avoidObstacles', label: '避障', type: 'boolean', description: '菜单按 KWin 工作区（扣除 Plasma 面板/应用栏）钳制' },
      { key: 'menu.closeOnFocusChange', label: '聚焦其他应用时收起', type: 'boolean' },
      { key: 'menu.autoCloseMs', label: '自动收起兜底', type: 'number', min: 0, step: 100, unit: 'ms', description: '打开后无人操作超过该时长自动关闭；0 关闭此兜底' },
      { key: 'menu.customCommands', label: '自定义命令', type: 'commands', fields: COMMAND_SUBFIELDS, description: 'id 不可与内置动作重名（refresh、toggle-panel、toggle-pause、settings）' },
    ],
  },
  {
    id: 'credentials',
    title: '天气凭据',
    icon: 'key',
    external: true,
    fields: [
      { key: 'apiHost', label: 'API Host', type: 'text', placeholder: 'your-project-host.qweatherapi.com', description: '只填 HTTPS 域名，不包含协议、路径或查询参数' },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: '已保存时留空可保留现有 Key', description: '仅主进程读取，不会进入 renderer、日志或缓存' },
    ],
  },
  {
    id: 'about',
    title: '关于',
    icon: 'info',
    static: true,
  },
]);

// Dot-path access helpers shared by the renderer and tests.
export function getPath(object, key) {
  return key.split('.').reduce((value, part) => (value == null ? undefined : value[part]), object);
}

export function setPath(object, key, value) {
  const parts = key.split('.');
  const last = parts.pop();
  const target = parts.reduce((current, part) => {
    if (current[part] == null || typeof current[part] !== 'object') current[part] = {};
    return current[part];
  }, object);
  target[last] = value;
}
