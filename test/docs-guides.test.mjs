import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const guides = [
  'docs/guides/quickstart.md',
  'docs/guides/quickstart.en.md',
  'docs/guides/configuration.md',
  'docs/guides/configuration.en.md',
  'docs/guides/privacy.md',
  'docs/guides/privacy.en.md',
];

async function readGuides() {
  const entries = await Promise.all(guides.map(async (pathname) => [pathname, await readFile(pathname, 'utf8')]));
  return new Map(entries);
}

const configurationFields = [
  'mouse.buttonsEnabled',
  'mouse.interactionEnabled',
  'wallpaper.mode',
  'color.mode',
  'color.transitionDurationMs',
  'appearance.mode',
  'appearance.dark.wallpaperBrightness',
  'audio.enabled',
  'audio.gain',
  'audio.silenceDelayMs',
  'audio.fadeOutMs',
  'audio.fadeInMs',
  'frameRate.interactive',
  'frameRate.drift',
  'motion.interactionSpeed',
  'motion.returnSpeed',
  'motion.driftSpeed',
  'motion.deadZonePx',
  'motion.horizontalPanPercent',
  'motion.verticalPanPercent',
  'motion.maxRotationDegrees',
  'motion.pauseWhenFullscreen',
  'panel.autoExpandHide',
  'panel.expandTriggerDistancePx',
  'panel.collapseDelaySeconds',
  'panel.expanded',
  'panel.collapsedOpacity',
  'panel.animation.staggerDelayMs',
  'panel.animation.durationMs',
  'weather.location.mode',
  'weather.location.latitude',
  'weather.location.longitude',
  'weather.location.fallbackLocationId',
  'weather.tideStationId',
  'menu.customCommands',
  'menu.avoidObstacles',
  'menu.closeOnFocusChange',
  'menu.autoCloseMs',
  'menu.terminal',
];

const BT = String.fromCharCode(96);
const EN_DASH = String.fromCharCode(8211);
const ARROW = String.fromCharCode(8594);

test('guides are bilingual pairs linked to each other and free of stale assets', async () => {
  const map = await readGuides();
  assert.ok(map.get('docs/guides/quickstart.md').includes('[English](quickstart.en.md)'));
  assert.ok(map.get('docs/guides/quickstart.en.md').includes('[中文](quickstart.md)'));
  assert.ok(map.get('docs/guides/configuration.md').includes('[English](configuration.en.md)'));
  assert.ok(map.get('docs/guides/configuration.en.md').includes('[中文](configuration.md)'));
  assert.ok(map.get('docs/guides/privacy.md').includes('[English](privacy.en.md)'));
  assert.ok(map.get('docs/guides/privacy.en.md').includes('[中文](privacy.md)'));
  for (const content of map.values()) {
    assert.ok(!/161-2\.jpeg|assets\/161-2/.test(content));
  }
});

test('quickstart covers installation, usage, wallpaper, KWin, weather, and diagnostics', async () => {
  const map = await readGuides();
  const zh = map.get('docs/guides/quickstart.md');
  const en = map.get('docs/guides/quickstart.en.md');

  assert.ok(/^## 壁纸与展示$/m.test(zh));
  assert.ok(/^## 安装与卸载$/m.test(zh));
  assert.ok(/^## 使用方法$/m.test(zh));
  assert.ok(/^## Wallpaper and Showcase$/m.test(en));
  assert.ok(/^## Installation and Removal$/m.test(en));
  assert.ok(/^## Usage$/m.test(en));

  for (const guide of [zh, en]) {
    for (const required of [
      'yay -S mip-paper',
      'paru -S mip-paper',
      'mip-paper setup --image',
      'mip-paper wallpaper set',
      'mip-paper wallpaper status',
      'mip-paper wallpaper use-kde',
      'mip-paper teardown --purge',
      'mip-paper uninstall --purge',
      'mip-paper restart',
      'mip-paper doctor',
      'mip-paper probe --duration 60',
      'journalctl --user -u mip-paper.service',
      'KWin >= 6.7',
      'org.kde.image',
      '350 ms',
      'XDG Desktop Portal',
      'https://console.qweather.com/',
      'chmod 600',
      'qweather-icons@1.8.0',
      'pw-cat',
      'pw-metadata',
      'PipeWire',
      'WirePlumber',
      'JPEG',
      'PNG',
      'WebP',
    ]) {
      assert.ok(guide.includes(required), 'quickstart is missing: ' + required);
    }
    assert.ok(/(不轮询|does not poll)/i.test(guide));
    assert.ok(/(幻灯片|slideshows).*(不支持|unsupported)/is.test(guide));
    assert.ok(/(设置界面|Settings Window)/.test(guide));
  }

  assert.ok(zh.includes('项目不附带第三方壁纸'));
  assert.ok(zh.includes('LaT-SKY 拍摄并以 CC BY 4.0'));
  assert.ok(en.includes('former third-party wallpaper is not included'));
  assert.ok(en.includes('default photograph by LaT-SKY under CC BY 4.0'));
  assert.ok(zh.includes('sudo pacman -S geoclue'));
  assert.ok(zh.includes('sudo systemctl enable --now geoclue'));
  assert.ok(zh.includes('gsettings set org.gnome.system.location enabled true'));
  assert.ok(zh.includes('重新登录'));
  assert.ok(!/release:aur|0\.2 Release|Release and AUR Workflow/i.test(en));
});

test('configuration guide documents every field with defaults and live reload', async () => {
  const map = await readGuides();
  const zh = map.get('docs/guides/configuration.md');
  const en = map.get('docs/guides/configuration.en.md');

  assert.ok(/^# 配置文件$/m.test(zh));
  assert.ok(/^# Configuration$/m.test(en));

  for (const guide of [zh, en]) {
    for (const field of configurationFields) {
      assert.ok(guide.includes(BT + field + BT), 'configuration is missing field: ' + field);
    }
    for (const required of [
      '"wallpaper": { "mode": "kde" }',
      '"mode": "hybrid"',
      '"drift": 30',
      '"enabled": true',
      '"gain": 1',
      '"silenceDelayMs": 600',
      '"fadeOutMs": 450',
      '"fadeInMs": 160',
      '"mode": "system"',
      '"wallpaperBrightness": 0.72',
      BT + '900' + BT + ' ms',
      '0.2' + EN_DASH + '1',
      '0' + EN_DASH + '5000 ms',
      '0' + EN_DASH + '3000 ms',
      '1' + EN_DASH + '180',
    ]) {
      assert.ok(guide.includes(required), 'configuration is missing: ' + required);
    }
    assert.ok(/(减少动态效果|reduced motion)/i.test(guide));
    assert.ok(/(实时热加载|live reload)/i.test(guide));
    assert.ok(/(最后一份有效配置|last valid configuration)/i.test(guide));
    assert.ok(/(未知字段会被拒绝|Unknown fields are rejected)/.test(guide));
    if (guide === en) assert.ok(guide.includes('Live reload'));
    for (const mode of ['default', 'kde', 'wallpaper', 'hybrid']) {
      assert.ok(guide.includes(BT + mode + BT));
    }
    for (const mode of ['light', 'dark', 'system']) {
      assert.ok(guide.includes(BT + mode + BT));
    }
    for (const id of ['refresh', 'toggle-panel', 'toggle-pause', 'settings']) {
      assert.ok(guide.includes(BT + id + BT));
    }
    assert.ok(guide.includes('"customCommands"'));
  }

  assert.ok(zh.includes('frameRate.interactive' + BT + ' | 整数，' + BT + '1' + EN_DASH + '180'));
  assert.ok(en.includes('frameRate.interactive' + BT + ' | integer, ' + BT + '1' + EN_DASH + '180'));
  assert.ok(zh.includes('每块屏幕独立使用其当前壁纸的强调色'));
  assert.ok(zh.includes('按壁纸内容缓存'));
  assert.ok(zh.includes('A ' + ARROW + ' B ' + ARROW + ' A'));
  assert.ok(zh.includes('重启服务后会恢复 A 原来的颜色'));
  assert.ok(zh.includes('原始壁纸'));
  assert.ok(zh.includes('跟随 KDE 窗口背景亮度'));
  assert.ok(zh.includes('0.95'));
  assert.ok(zh.includes('1.5'));
  assert.ok(zh.includes('漂移帧率'));
  assert.ok(en.includes('Each display owns an independent accent'));
  assert.ok(en.includes('cached by wallpaper content'));
  assert.ok(en.includes('A ' + ARROW + ' B ' + ARROW + ' A'));
  assert.ok(en.includes('service restart restores'));
  assert.ok(en.includes('original wallpaper'));
  assert.ok(en.includes('follow KDE window background luminance'));
  assert.ok(en.includes('0.95'));
  assert.ok(en.includes('1.5'));
  assert.ok(en.includes('drift frame rate'));
});

test('privacy guide documents media-output-only audio and third-party licenses', async () => {
  const map = await readGuides();
  const zh = map.get('docs/guides/privacy.md');
  const en = map.get('docs/guides/privacy.en.md');

  assert.ok(/^# 隐私与许可证$/m.test(zh));
  assert.ok(/^# Privacy and Licenses$/m.test(en));

  for (const guide of [zh, en]) {
    assert.ok(guide.includes('Stream/Input/Audio/Internal'));
    assert.ok(guide.includes('Plasma'));
    assert.ok(guide.includes('GPL-3.0-only'));
    assert.ok(guide.includes('CC BY 4.0'));
    assert.ok(guide.includes('LICENSE'));
    assert.ok(guide.includes('ATTRIBUTION.md'));
  }
  assert.ok(zh.includes('不会连接麦克风'));
  assert.ok(zh.includes('不会录制或保存 PCM 音频'));
  assert.ok(zh.includes('左声道'));
  assert.ok(zh.includes('右声道'));
  assert.ok(zh.includes('合并频谱'));
  assert.ok(zh.includes('共同基线'));
  assert.ok(zh.includes('三层曲线'));
  assert.ok(zh.includes('动态强调色'));
  assert.ok(zh.includes('Plasma 麦克风列表'));
  assert.ok(zh.includes('默认输出设备'));
  assert.ok(zh.includes('纯黑'));
  assert.ok(zh.includes('纯白'));
  assert.ok(en.includes('never connects to a microphone'));
  assert.ok(en.includes('never records audio'));
  assert.ok(en.includes("Plasma's microphone list"));
  assert.ok(en.includes('pure black'));
  assert.ok(en.includes('pure white'));
  assert.ok(/each display/i.test(en));
  assert.ok(en.includes('complementary'));
  assert.ok(en.includes('accent'));
});

test('every relative link inside the guides resolves', async () => {
  const map = await readGuides();
  for (const [pathname, content] of map) {
    const directory = pathname.slice(0, pathname.lastIndexOf('/'));
    const links = [...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
    for (const target of links) {
      if (target.startsWith('http')) continue;
      const resolved = directory + '/' + target;
      const file = await stat(resolved);
      assert.ok(file.isFile(), pathname + ' link does not resolve: ' + target);
    }
  }
});
