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
