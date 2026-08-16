import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('renderer is a control-free full-screen Canvas page', async () => {
  const html = await readFile('src/renderer/index.html', 'utf8');
  const css = await readFile('src/renderer/styles.css', 'utf8');

  assert.match(html, /<canvas id="wallpaper"><\/canvas>/);
  assert.match(html, /<script type="module" src="\.\/renderer\.mjs"><\/script>/);
  assert.doesNotMatch(html, /<input|<button|type="range"|type="number"/);
  for (const card of ['time', 'weather', 'tide', 'calendar']) {
    assert.match(html, new RegExp(`data-panel-card="${card}"`));
  }
  assert.doesNotMatch(html, /switchBar|scanline|connector/);
  assert.match(css, /width:\s*100vw/);
  assert.match(css, /height:\s*100vh/);
  assert.match(css, /overflow:\s*hidden/);
});

test('information projection is pointer-transparent and wired to panel motion', async () => {
  const html = await readFile('src/renderer/index.html', 'utf8');
  const panelCss = await readFile('src/renderer/panel.css', 'utf8');
  const renderer = await readFile('src/renderer/renderer.mjs', 'utf8');
  const panel = await readFile('src/renderer/panel.mjs', 'utf8');
  assert.match(html, /panel\.css/);
  assert.match(panelCss, /\.information-panel[\s\S]*pointer-events:\s*none/);
  assert.match(panel, /from '\.\.\/panel-motion\.mjs'/);
  assert.match(panel, /transform\.translateXFactor/);
  assert.match(panel, /transform\.translateYFactor/);
  assert.match(panel, /transform\.brightness/);
  assert.match(panel, /transform\.saturation/);
  assert.match(renderer, /getInformationSnapshot\(\)/);
  assert.match(renderer, /onInformationUpdated/);
  assert.doesNotMatch(panelCss, /repeating-linear-gradient/);
});

test('separates frosted card surfaces from their animated 3D shells', async () => {
  const html = await readFile('src/renderer/index.html', 'utf8');
  const panelCss = await readFile('src/renderer/panel.css', 'utf8');
  const surfaces = html.match(/class="information-card-surface"/g) ?? [];
  const shellRule = panelCss.match(/\.information-card\s*\{([^}]*)\}/)?.[1] ?? '';
  const surfaceRule = panelCss.match(/\.information-card-surface\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.equal(surfaces.length, 4);
  for (const card of ['time', 'weather', 'tide', 'calendar']) {
    const cardBody = html.match(
      new RegExp(`<section\\b[^>]*data-panel-card="${card}"[^>]*>([\\s\\S]*?)</section>`),
    )?.[1] ?? '';
    assert.match(cardBody, /class="information-card-surface"/);
  }
  assert.match(shellRule, /rotateX\(var\(--panel-rx\)\)/);
  assert.match(shellRule, /rotateY\(var\(--panel-ry\)\)/);
  assert.match(shellRule, /box-shadow:/);
  assert.doesNotMatch(shellRule, /backdrop-filter|background:|border:|overflow:\s*hidden|padding:/);
  assert.match(surfaceRule, /backdrop-filter:\s*blur\(9px\)\s*saturate\(1\.08\)/);
  assert.match(surfaceRule, /background:\s*var\(--surface\)/);
  assert.match(surfaceRule, /border:\s*1px\s+solid/);
  assert.match(surfaceRule, /overflow:\s*hidden/);
  assert.match(surfaceRule, /padding:\s*var\(--card-padding\)/);
  assert.doesNotMatch(surfaceRule, /transform:|will-change:/);
  assert.doesNotMatch(panelCss, /backface-visibility|translateZ\(0\)/);
});

test('mounts the approved floating audio ribbon inside the real panel', async () => {
  const html = await readFile('src/renderer/index.html', 'utf8');
  const panelCss = await readFile('src/renderer/panel.css', 'utf8');
  const renderer = await readFile('src/renderer/renderer.mjs', 'utf8');
  assert.match(html, /<main class="information-panel"[\s\S]*data-audio-ribbon[\s\S]*<\/main>/);
  for (const pathName of ['left', 'right', 'energy']) {
    assert.match(html, new RegExp(`data-audio-path="${pathName}"`));
  }
  assert.match(
    html,
    /data-audio-path="energy"[\s\S]*data-audio-path="left"[\s\S]*data-audio-path="right"/,
  );
  assert.match(html, /linearGradient[\s\S]*offset="14%"[\s\S]*offset="86%"/);
  assert.match(html, /mask="url\(#audio-ribbon-edge-mask\)"/);
  assert.match(panelCss, /\.audio-ribbon[\s\S]*pointer-events:\s*none/);
  const ribbonRule = panelCss.match(/\.audio-ribbon\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.doesNotMatch(
    ribbonRule,
    /(?:^|\n)\s*(?:background(?:-[\w-]+)?|backdrop-filter|box-shadow|border(?:-[\w-]+)?):/,
  );
  assert.match(panelCss, /stroke-linecap:\s*round/);
  assert.match(panelCss, /stroke-linejoin:\s*round/);
  for (const [pathName, width] of [['left', '2.4'], ['right', '2.4'], ['energy', '3.4']]) {
    const pathRule = panelCss.match(new RegExp(`\\.audio-path-${pathName}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    assert.match(pathRule, new RegExp(`stroke-width:\\s*${width}`));
    assert.match(pathRule, /transition:\s*stroke\s+var\(--accent-transition-ms\)\s+ease/);
    assert.doesNotMatch(pathRule, /drop-shadow|blur\(/);
  }
  assert.match(panelCss.match(/\.audio-path-right\s*\{([^}]*)\}/)?.[1] ?? '', /var\(--accent-audio-primary\)/);
  assert.match(panelCss.match(/\.audio-path-energy\s*\{([^}]*)\}/)?.[1] ?? '', /var\(--accent-audio-neutral\)/);
  assert.match(panelCss.match(/\.audio-path-left\s*\{([^}]*)\}/)?.[1] ?? '', /var\(--accent-audio-complement\)/);
  assert.doesNotMatch(panelCss, /--accent-audio-(?:energy|aux)/);
  assert.doesNotMatch(html, /switchBar|spectrum-bar|scanline|connector/);
  assert.match(renderer, /createAudioRibbonController/);
  assert.match(renderer, /onAudioSpectrumUpdated/);
  assert.match(renderer, /onConfigUpdated/);
  assert.match(renderer, /panel\.setConfig/);
  assert.match(renderer, /audioRibbon\.setConfig/);
  assert.match(renderer, /audioRibbon\.advance/);
  assert.match(renderer, /createScheduler\('adaptive'\)/);
});

test('information cards use official weather icons and a complete month grid', async () => {
  const html = await readFile('src/renderer/index.html', 'utf8');
  const panel = await readFile('src/renderer/panel.mjs', 'utf8');
  const panelCss = await readFile('src/renderer/panel.css', 'utf8');
  assert.match(html, />LOCAL TIME<\/div>/);
  assert.doesNotMatch(html, /LOCAL TIME \/ 01|weather-mark/);
  assert.match(html, /\.\.\/\.\.\/node_modules\/qweather-icons\/font\/qweather-icons\.css/);
  assert.doesNotMatch(html, /cdn\.jsdelivr|https?:\/\//);
  assert.match(html, /data-field="weather-icon"/);
  assert.match(html, /data-field="calendar-weekdays"/);
  assert.match(html, /data-field="calendar-days"/);
  assert.match(panel, /buildMonthCalendar/);
  assert.match(panel, /qweatherIconClass/);
  assert.match(panel, /outside-month/);
  assert.match(panelCss, /grid-template-columns:\s*repeat\(7/);
  assert.doesNotMatch(panelCss, /\.weather-mark/);
});

test('renderer uses a non-alpha high-DPI Canvas with only brightness filtering', async () => {
  const script = await readFile('src/renderer/renderer.mjs', 'utf8');

  assert.match(script, /getContext\('2d',\s*\{\s*alpha:\s*false\s*\}\)/);
  assert.match(script, /devicePixelRatio/);
  assert.match(script, /Math\.min\([^\n]*devicePixelRatio[^\n]*2\)/);
  assert.match(script, /imageSmoothingEnabled\s*=\s*true/);
  assert.match(script, /imageSmoothingQuality\s*=\s*'high'/);
  assert.match(script, /context\.filter\s*=\s*`brightness\(\$\{brightness\}\)`/);
  assert.doesNotMatch(script, /motionBlur|blur\(|shadowBlur/);
});

test('renderer hot applies semantic appearance and reduced-motion changes', async () => {
  const [script, panelCss, styles] = await Promise.all([
    readFile('src/renderer/renderer.mjs', 'utf8'),
    readFile('src/renderer/panel.css', 'utf8'),
    readFile('src/renderer/styles.css', 'utf8'),
  ]);
  assert.match(script, /applyAppearanceState/);
  assert.match(script, /bootstrap\.appearance/);
  assert.match(script, /candidate\.config/);
  assert.match(script, /candidate\.appearance/);
  assert.match(script, /sampleBrightness/);
  assert.match(script, /reducedMotion\.addEventListener\(['"]change['"]/);
  assert.match(script, /reducedMotion\.removeEventListener\(['"]change['"]/);
  for (const variable of ['surface', 'surface-border', 'text-primary', 'text-secondary', 'icon', 'chip-surface', 'ambient-shadow']) {
    assert.match(panelCss, new RegExp(`--${variable}:`));
    assert.match(panelCss, new RegExp(`var\\(--${variable}\\)`));
  }
  assert.match(panelCss, /\[data-theme="light"\]/);
  assert.match(panelCss, /\[data-theme="dark"\]/);
  assert.match(styles, /color-scheme:\s*light/);
  assert.match(styles, /color-scheme:\s*dark/);
  assert.doesNotMatch(`${panelCss}\n${styles}`, /transition:\s*all/);
});

test('renderer loads only atomic user-managed wallpaper transactions', async () => {
  const script = await readFile('src/renderer/renderer.mjs', 'utf8');

  assert.match(script, /wallpaperCoordinator\.apply\(bootstrap\.wallpaper\)/);
  assert.match(script, /onWallpaperUpdated/);
  assert.match(script, /createWallpaperTransactionCoordinator/);
  assert.doesNotMatch(script, /loadedWallpaperUrl|wallpaperGeneration|analyzeIfRequested/);
  assert.doesNotMatch(script, /assets\/161-2\.jpeg/);
});

test('renderer feeds panel attention into both scheduler starts', async () => {
  const script = await readFile('src/renderer/renderer.mjs', 'utf8');
  const occurrences = script.match(/panelActive:\s*\(\)\s*=>\s*panel\.attention\(\)/g) ?? [];
  assert.equal(occurrences.length, 2);
});

test('renderer consumes the motion core and read-only preload bootstrap', async () => {
  const script = await readFile('src/renderer/renderer.mjs', 'utf8');

  assert.match(script, /from '\.\.\/motion\.mjs'/);
  assert.match(script, /window\.wallpaper\.getBootstrap\(\)/);
  assert.match(script, /applyPointerSample/);
  assert.match(script, /advanceMotion/);
  assert.match(script, /createScheduler\('adaptive'\)/);
});

test('return probe injects one interaction instead of continuous sweep input', async () => {
  const script = await readFile('src/renderer/renderer.mjs', 'utf8');
  assert.match(script, /probe\.scenario === 'return'[\s\S]*applyPointerSample/);
  assert.match(script, /probe\.scenario === 'sweep'[\s\S]*setInterval/);
});

test('renderer analyzes requested wallpapers and applies explicit accent transitions', async () => {
  const script = await readFile('src/renderer/renderer.mjs', 'utf8');
  const panelCss = await readFile('src/renderer/panel.css', 'utf8');
  assert.match(script, /analyzeWallpaperImage/);
  assert.match(script, /applyAccentState/);
  assert.match(script, /submitWallpaperAccent/);
  assert.match(script, /onColorUpdated/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(panelCss, /--accent-transition-ms/);
  assert.match(panelCss, /var\(--accent\)/);
  assert.match(panelCss, /var\(--accent-dark\)/);
  assert.match(panelCss, /transition:/);
  assert.doesNotMatch(panelCss, /transition:\s*all/);
});
