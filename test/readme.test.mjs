import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('documents GeoClue setup and QWeather Icons attribution', async () => {
  const readme = await readFile('README.md', 'utf8');

  for (const required of [
    'sudo pacman -S geoclue',
    'sudo systemctl enable --now geoclue',
    'gsettings set org.gnome.system.location enabled true',
    '重新登录',
    'qweather-icons@1.8.0',
    'MIT',
    'CC BY 4.0',
  ]) {
    assert.ok(readme.includes(required), `README is missing: ${required}`);
  }

  assert.match(readme, /XDG Desktop Portal/);
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
    '没有辉光',
    'animated-ocean-wallpaper doctor',
  ]) {
    assert.ok(readme.includes(required), `README is missing: ${required}`);
  }
  assert.match(readme, /不会.{0,12}麦克风/);
  assert.match(readme, /不会.{0,12}(录制|保存).{0,12}(PCM|音频)/);
  assert.match(readme, /audio.{0,30}(实时|热加载)/i);
  assert.match(readme, /其他.{0,20}配置.{0,20}重启/);
  assert.doesNotMatch(readme, /上曲线表示左声道[\s\S]{0,80}下曲线表示右声道/);
});
