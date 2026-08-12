import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlasmaWallpaperConfig } from '../src/plasma-wallpaper.mjs';

const fixture = `
[Containments][1]
formfactor=0
location=0
lastScreen=0
wallpaperplugin=org.kde.image
[Containments][1][Wallpaper][org.kde.image][General]
Image=file:///home/tester/Pictures/one%20wallpaper.png

[Containments][2]
formfactor=0
location=0
lastScreen=1
wallpaperplugin=org.kde.image
[Containments][2][Wallpaper][org.kde.image][General]
Image=/home/tester/Pictures/two.webp

[Containments][3]
formfactor=2
location=4
lastScreen=0
wallpaperplugin=org.kde.image
[Containments][4]
formfactor=0
location=0
lastScreen=2
wallpaperplugin=third.party.wallpaper
`;

test('parses static desktop wallpaper sources per screen', () => {
  assert.deepEqual(parsePlasmaWallpaperConfig(fixture), [
    {
      screenIndex: 0, containmentId: 1, plugin: 'org.kde.image',
      sourcePath: '/home/tester/Pictures/one wallpaper.png', status: 'supported', reason: null,
      activityId: '',
    },
    {
      screenIndex: 1, containmentId: 2, plugin: 'org.kde.image',
      sourcePath: '/home/tester/Pictures/two.webp', status: 'supported', reason: null,
      activityId: '',
    },
    {
      screenIndex: 2, containmentId: 4, plugin: 'third.party.wallpaper',
      sourcePath: null, status: 'unsupported', reason: 'unsupported wallpaper plugin: third.party.wallpaper',
      activityId: '',
    },
  ]);
});

test('ignores panels and chooses the lowest duplicate containment id', () => {
  const text = `${fixture}
[Containments][9]
formfactor=0
location=0
lastScreen=1
wallpaperplugin=org.kde.image
[Containments][9][Wallpaper][org.kde.image][General]
Image=/home/tester/Pictures/duplicate.jpg
`;
  assert.equal(parsePlasmaWallpaperConfig(text).find((item) => item.screenIndex === 1).containmentId, 2);
});

test('rejects remote and missing static images without throwing', () => {
  const text = `[Containments][8]\nformfactor=0\nlocation=0\nlastScreen=0\nwallpaperplugin=org.kde.image\n[Containments][8][Wallpaper][org.kde.image][General]\nImage=https://example.invalid/wallpaper.png\n`;
  assert.equal(parsePlasmaWallpaperConfig(text)[0].status, 'invalid');
});
