# Minimized Window Pause Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release Mip-Paper 0.3.9 with minimized fullscreen/maximized windows excluded from per-display wallpaper pause detection.

**Architecture:** Keep the behavior in the KWin display coordinator, where fullscreen and maximize state are already evaluated. Add minimized state to the pure covering predicate and subscribe to KWin's minimized-state signal so the existing deduplicated D-Bus push path reacts immediately.

**Tech Stack:** JavaScript (KWin scripting), Node.js built-in test runner, JSON package metadata, Keep a Changelog.

---

### Task 1: Exclude Minimized Covering Windows

**Files:**
- Modify: `test/kwin-coordinator.test.mjs:22-63`
- Modify: `test/kwin-coordinator.test.mjs:300-370`
- Modify: `kwin/mip-paper/contents/code/main.js:144-156`
- Modify: `kwin/mip-paper/contents/code/main.js:248-263`

- [ ] **Step 1: Extend the KWin window fixtures and write failing regression tests**

Add `minimized` state and its signal to both window fixtures:

```js
minimized: false,
minimizedChanged: new Signal(),
```

Add these tests near the existing fullscreen/maximized coverage tests:

```js
test('does not pause for a fullscreen window that starts minimized', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const video = appWindow('video', primary, true);
  video.minimized = true;

  const result = await runCoordinator({ outputs: [primary], windows: [video] });

  assert.equal(pushArgs(result.dbusCalls[0]).fullscreen, false);
});

test('re-evaluates a maximized window when it is minimized and restored', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const app = appWindow('app', primary, false);
  app.maximizeMode = 3;
  const result = await runCoordinator({ outputs: [primary], windows: [app] });
  result.dbusCalls.length = 0;

  app.minimized = true;
  app.minimizedChanged.emit();
  assert.equal(pushArgs(result.dbusCalls[0]).fullscreen, false);

  app.minimized = false;
  app.minimizedChanged.emit();
  assert.equal(pushArgs(result.dbusCalls[1]).fullscreen, true);
});
```

- [ ] **Step 2: Run the focused test file and verify RED**

Run: `node --test test/kwin-coordinator.test.mjs`

Expected: the startup-minimized test reports `true !== false`, and the transition test has no fullscreen D-Bus call after `minimizedChanged.emit()`.

- [ ] **Step 3: Implement the minimal coordinator fix**

In `windowCoversOutput()`, exclude minimized windows:

```js
if (window.minimized === true) return false;
```

In `track()`, connect the KWin signal using the existing guarded pattern:

```js
if (window.minimizedChanged && typeof window.minimizedChanged.connect === 'function') {
  window.minimizedChanged.connect(() => pushState());
}
```

Update the nearby comments so they state that only visible, non-minimized fullscreen/maximized windows count as covering.

- [ ] **Step 4: Run focused and full tests to verify GREEN**

Run: `node --test test/kwin-coordinator.test.mjs`

Expected: all coordinator tests pass.

Run: `npm test`

Expected: 406 tests pass, with zero failures.

- [ ] **Step 5: Commit the behavior fix**

```bash
git add kwin/mip-paper/contents/code/main.js test/kwin-coordinator.test.mjs
git commit -m "fix: ignore minimized covering windows"
```

### Task 2: Prepare Release 0.3.9

**Files:**
- Modify: `test/packaging.test.mjs:9-18`
- Modify: `package.json:3`
- Modify: `package-lock.json:3-9`
- Modify: `kwin/mip-paper/metadata.json:7`
- Modify: `CHANGELOG.md:7`

- [ ] **Step 1: Update the release consistency test first**

Change the packaging test to read all release metadata and expect 0.3.9:

```js
test('declares the 0.3.9 release version consistently', async () => {
  const [packageJson, lockfile, kwinMetadata] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('package-lock.json', 'utf8').then(JSON.parse),
    readFile('kwin/mip-paper/metadata.json', 'utf8').then(JSON.parse),
  ]);

  assert.equal(packageJson.version, '0.3.9');
  assert.equal(lockfile.version, '0.3.9');
  assert.equal(lockfile.packages[''].version, '0.3.9');
  assert.equal(kwinMetadata.KPlugin.Version, '0.3.9');
});
```

- [ ] **Step 2: Run the packaging test and verify RED**

Run: `node --test test/packaging.test.mjs`

Expected: FAIL because package metadata still declares 0.3.8.

- [ ] **Step 3: Update release metadata and changelog**

Set the version to `0.3.9` in `package.json`, both root package locations in
`package-lock.json`, and `KPlugin.Version` in
`kwin/mip-paper/metadata.json`.

Add this changelog entry above 0.3.8:

```markdown
## [0.3.9] - 2026-08-17

### Fixed

- Minimized fullscreen or maximized windows no longer pause the wallpaper;
  minimizing a covering window resumes that display immediately, and restoring
  it pauses the display again while it remains fullscreen or maximized.
```

- [ ] **Step 4: Run release and full tests to verify GREEN**

Run: `node --test test/packaging.test.mjs`

Expected: all packaging tests pass.

Run: `npm test && npm run check && git diff --check`

Expected: 406 tests pass, syntax checks pass, and no whitespace errors are reported.

- [ ] **Step 5: Commit release preparation**

```bash
git add CHANGELOG.md package.json package-lock.json kwin/mip-paper/metadata.json test/packaging.test.mjs
git commit -m "release: prepare v0.3.9"
```

### Task 3: Runtime-Facing Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Re-run final repository verification from a clean index**

Run: `git status --short && npm test && npm run check && git diff --check`

Expected: clean status, 406 tests pass, syntax checks pass, and no whitespace errors.

- [ ] **Step 2: Record the manual Plasma acceptance scenario**

On a live Plasma session with the updated coordinator installed:

1. Maximize or fullscreen an application and confirm that display pauses.
2. Minimize it and confirm the wallpaper resumes on that display.
3. Restore it and confirm the wallpaper pauses again.
4. Switch to a workspace without a covering window and confirm the wallpaper runs.

If installation or live desktop mutation is outside the requested scope, report this check as pending rather than claiming it passed.
