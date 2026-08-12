import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const configurationFields = [
  'interactionEnabled',
  'wallpaper.mode',
  'color.mode',
  'color.transitionDurationMs',
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
];

test('publishes complete linked Chinese and English guides', async () => {
  const [chinese, english] = await Promise.all([
    readFile('README.md', 'utf8'),
    readFile('README.en.md', 'utf8'),
  ]);
  assert.match(chinese, /\[English\]\(README\.en\.md\)/);
  assert.match(english, /\[中文\]\(README\.md\)/);

  for (const readme of [chinese, english]) {
    for (const required of [
      'yay -S mip-paper',
      'paru -S mip-paper',
      'mip-paper setup --image',
      'mip-paper wallpaper set',
      'mip-paper wallpaper status',
      'mip-paper wallpaper use-kde',
      'GPL-3.0-only',
      'JPEG',
      'PNG',
      'WebP',
    ]) {
      assert.ok(readme.includes(required), `README is missing: ${required}`);
    }
    for (const field of configurationFields) {
      assert.ok(readme.includes(`\`${field}\``), `README is missing configuration field: ${field}`);
    }
    assert.doesNotMatch(readme, /161-2\.jpeg|assets\/161-2/);
  }

  assert.match(chinese, /LaT-SKY.{0,20}CC BY 4\.0/);
  assert.match(chinese, /不附带.{0,8}第三方壁纸/);
  assert.match(english, /default photograph by LaT-SKY under CC BY 4\.0/i);
  assert.match(english, /former third-party wallpaper is not included/i);
});

test('keeps the guides organized around the user workflows and bundled showcase', async () => {
  const [chinese, english, bundledImage] = await Promise.all([
    readFile('README.md', 'utf8'),
    readFile('README.en.md', 'utf8'),
    stat('assets/default-wallpaper.jpg'),
  ]);
  assert.ok(bundledImage.isFile());
  assert.ok(bundledImage.size > 0);
  for (const heading of ['## 壁纸与展示', '## 安装与卸载', '## 使用方法', '## 配置文件']) {
    assert.match(chinese, new RegExp(`^${heading}$`, 'm'));
  }
  for (const heading of ['## Wallpaper and Showcase', '## Installation and Removal', '## Usage', '## Configuration']) {
    assert.match(english, new RegExp(`^${heading}$`, 'm'));
  }
  for (const readme of [chinese, english]) {
    assert.match(readme, /assets\/default-wallpaper\.jpg/);
    assert.doesNotMatch(readme, /<img[^>]+(?:docs\/images\/mip-paper-desktop\.webp|assets\/default-wallpaper\.jpg)/i);
    const screenshotMentions = [...readme.matchAll(/docs\/images\/mip-paper-desktop\.webp/g)];
    assert.equal(screenshotMentions.length, 1);
    for (const mention of screenshotMentions) {
      const lineStart = readme.lastIndexOf('\n', mention.index) + 1;
      const lineEnd = readme.indexOf('\n', mention.index);
      assert.match(readme.slice(lineStart, lineEnd === -1 ? readme.length : lineEnd), /^\s*<!--.*-->\s*$/);
    }
  }
});

test('documents safe runtime defaults and purge commands', async () => {
  const [chinese, english] = await Promise.all([readFile('README.md', 'utf8'), readFile('README.en.md', 'utf8')]);
  for (const readme of [chinese, english]) {
    assert.match(readme, /"mode":\s*"hybrid"/);
    assert.match(readme, /"drift":\s*12/);
    assert.match(readme, /`frameRate\.drift`[^\n]*1[–-]180/);
    assert.match(readme, /mip-paper teardown --purge/);
    assert.match(readme, /mip-paper uninstall --purge/);
  }
});

test('documents default per-display KDE wallpaper synchronization', async () => {
  const [chinese, english] = await Promise.all([readFile('README.md', 'utf8'), readFile('README.en.md', 'utf8')]);
  for (const readme of [chinese, english]) {
    assert.match(readme, /org\.kde\.image/);
    assert.match(readme, /350 ms/);
    assert.match(readme, /mip-paper wallpaper use-kde/);
    assert.match(readme, /(不轮询|does not poll)/i);
    assert.match(readme, /(幻灯片|slideshows).*(不支持|unsupported)/is);
  }
});

test('declares the application license in package metadata', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(packageJson.license, 'GPL-3.0-only');
});

test('documents GeoClue setup and QWeather Icons attribution', async () => {
  const readme = await readFile('README.md', 'utf8');

  assert.match(readme, /^# Mip-Paper$/m);

  for (const required of [
    'sudo pacman -S geoclue',
    'sudo systemctl enable --now geoclue',
    'gsettings set org.gnome.system.location enabled true',
    '重新登录',
    'qweather-icons@1.8.0',
    'MIT',
    'CC BY 4.0',
    'https://console.qweather.com/',
    'chmod 600',
    'mip-paper restart',
  ]) {
    assert.ok(readme.includes(required), `README is missing: ${required}`);
  }

  assert.match(readme, /XDG Desktop Portal/);
});

test('documents the supported KWin version', async () => {
  const [chinese, english] = await Promise.all([
    readFile('README.md', 'utf8'),
    readFile('README.en.md', 'utf8'),
  ]);
  for (const readme of [chinese, english]) {
    assert.match(readme, /KWin\s*(?:>=|≥)\s*6\.7/);
  }
  assert.doesNotMatch(english, /release:aur|0\.2 Release|Release and AUR Workflow/i);
});

test('documents live accent modes, transition timing, and reduced motion', async () => {
  const [chinese, english] = await Promise.all([readFile('README.md', 'utf8'), readFile('README.en.md', 'utf8')]);
  for (const readme of [chinese, english]) {
    for (const mode of ['default', 'kde', 'wallpaper', 'hybrid']) assert.ok(readme.includes(`\`${mode}\``));
    assert.match(readme, /900`?\s*ms/i);
    assert.match(readme, /(减少动态效果|reduced motion)/i);
    assert.match(readme, /(实时热加载|live reload)/i);
  }
});

test('documents PipeWire audio visualization, live timing config and privacy boundaries', async () => {
  const readme = await readFile('README.md', 'utf8');
  for (const required of [
    'PipeWire',
    'WirePlumber',
    'pw-cat',
    'pw-metadata',
    '"enabled": true',
    '"gain": 1',
    '"silenceDelayMs": 600',
    '"fadeOutMs": 450',
    '"fadeInMs": 160',
    '0–5000 ms',
    '0–3000 ms',
    '默认输出设备',
    '左声道',
    '右声道',
    '合并频谱',
    '共同基线',
    '白色曲线向上',
    '粉色曲线向下',
    '青色合并频谱',
    'Stream/Input/Audio/Internal',
    'Plasma 麦克风列表',
    'mip-paper doctor',
  ]) {
    assert.ok(readme.includes(required), `README is missing: ${required}`);
  }
  assert.match(readme, /不会.{0,12}麦克风/);
  assert.match(readme, /不会.{0,12}(录制|保存).{0,12}(PCM|音频)/);
  assert.match(readme, /audio.{0,30}(实时|热加载)/i);
  assert.match(readme, /其他.{0,20}配置.{0,20}重启/);
  assert.doesNotMatch(readme, /上曲线表示左声道[\s\S]{0,80}下曲线表示右声道/);
});
