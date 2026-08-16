import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

test('publishes a slim landing page with linked Chinese and English guides', async () => {
  const [chinese, english] = await Promise.all([
    readFile('README.md', 'utf8'),
    readFile('README.en.md', 'utf8'),
  ]);
  assert.match(chinese, /^# Mip-Paper$/m);
  assert.match(english, /^# Mip-Paper$/m);
  assert.match(chinese, /\[English\]\(README\.en\.md\)/);
  assert.match(english, /\[中文\]\(README\.md\)/);

  for (const readme of [chinese, english]) {
    assert.ok(readme.includes('docs/guides/quickstart'));
    assert.ok(readme.includes('docs/guides/configuration'));
    assert.ok(readme.includes('docs/guides/privacy'));
    assert.ok(readme.includes('docs/README.md'));
    assert.ok(readme.includes('CHANGELOG.md'));
    assert.ok(readme.includes('GPL-3.0-only'));
    assert.ok(readme.includes('JPEG'));
    assert.ok(readme.includes('PNG'));
    assert.ok(readme.includes('WebP'));
    assert.match(readme, /assets\/default-wallpaper\.jpg/);
    assert.doesNotMatch(readme, /161-2\.jpeg|assets\/161-2/);
    const screenshotMentions = [...readme.matchAll(/docs\/images\/mip-paper-desktop\.webp/g)];
    assert.equal(screenshotMentions.length, 1);
    for (const mention of screenshotMentions) {
      const lineStart = readme.lastIndexOf('\n', mention.index) + 1;
      const lineEnd = readme.indexOf('\n', mention.index);
      assert.match(readme.slice(lineStart, lineEnd === -1 ? readme.length : lineEnd), /^\s*<!--.*-->\s*$/);
    }
  }

  assert.match(chinese, /LaT-SKY.{0,20}CC BY 4\.0/);
  assert.match(chinese, /不附带.{0,8}第三方壁纸/);
  assert.match(english, /default photograph by LaT-SKY under CC BY 4\.0/i);
  assert.match(english, /former third-party wallpaper is not included/i);
});

test('bundled showcase image exists and every README link resolves', async () => {
  const [chinese, english, bundledImage] = await Promise.all([
    readFile('README.md', 'utf8'),
    readFile('README.en.md', 'utf8'),
    stat('assets/default-wallpaper.jpg'),
  ]);
  assert.ok(bundledImage.isFile());
  assert.ok(bundledImage.size > 0);
  for (const readme of [chinese, english]) {
    const links = [...readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
    assert.ok(links.length >= 5);
    for (const target of links) {
      if (target.startsWith('http')) continue;
      const file = await stat(target);
      assert.ok(file.isFile(), `README link does not resolve: ${target}`);
    }
  }
});

test('declares the application license in package metadata', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(packageJson.license, 'GPL-3.0-only');
});
