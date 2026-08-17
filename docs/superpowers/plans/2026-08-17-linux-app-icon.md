# Linux Application Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Mip-Paper one complete Linux application identity across KDE's application launcher, taskbar/window chrome, and packaged/source installations.

**Architecture:** Reuse the existing square `assets/logo.png` as the hicolor application icon and add one shared `.desktop` resource using `Icon=mip-paper`. Source installation writes both files to the user's XDG data directories; the Arch package installs them system-wide. The existing settings BrowserWindow icon remains unchanged, while desktop-layer wallpaper windows remain excluded from task switching.

**Tech Stack:** Bash installer, Electron resources, Arch PKGBUILD generator, freedesktop Desktop Entry, Node.js tests.

---

### Task 1: Add Shared Desktop Resources and Packaging Installation

**Files:**
- Create: `resources/mip-paper.desktop`
- Modify: `scripts/generate-pkgbuild.mjs:47-69`
- Modify: `test/packaging.test.mjs:22-45,77-123`

- [ ] **Step 1: Write failing packaging/resource tests**

Extend the package-resource test to read `resources/mip-paper.desktop` and assert:

```js
assert.match(desktopEntry, /^\[Desktop Entry\]/m);
assert.match(desktopEntry, /^Type=Application$/m);
assert.match(desktopEntry, /^Name=Mip-Paper$/m);
assert.match(desktopEntry, /^Exec=mip-paper start$/m);
assert.match(desktopEntry, /^Icon=mip-paper$/m);
assert.match(desktopEntry, /^Terminal=false$/m);
```

Extend the generated PKGBUILD assertions with:

```js
assert.match(pkgbuild, /resources\/mip-paper\.desktop/);
assert.match(pkgbuild, /usr\/share\/applications\/mip-paper\.desktop/);
assert.match(pkgbuild, /assets\/logo\.png/);
assert.match(pkgbuild, /usr\/share\/icons\/hicolor\/512x512\/apps\/mip-paper\.png/);
```

- [ ] **Step 2: Run the focused packaging tests and verify RED**

Run: `node --test test/packaging.test.mjs`

Expected: the desktop resource read fails because the resource does not exist, and generated package assertions fail because no system icon files are installed.

- [ ] **Step 3: Add the shared desktop entry and package install commands**

Create `resources/mip-paper.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Mip-Paper
Name[zh_CN]=Mip-Paper
Comment=Dynamic wallpaper engine for KDE Plasma
Comment[zh_CN]=KDE Plasma 动态壁纸引擎
Exec=mip-paper start
Icon=mip-paper
Terminal=false
Categories=Utility;DesktopSettings;
X-KDE-StartupNotify=false
```

In `generatePkgbuild()`, install the shared entry and logo:

```bash
install -Dm644 resources/mip-paper.desktop \
  "$pkgdir/usr/share/applications/mip-paper.desktop"
install -Dm644 assets/logo.png \
  "$pkgdir/usr/share/icons/hicolor/512x512/apps/mip-paper.png"
```

- [ ] **Step 4: Run focused packaging tests to verify GREEN**

Run: `node --test test/packaging.test.mjs`

Expected: all packaging tests pass, including the desktop entry and generated install paths.

- [ ] **Step 5: Commit shared resource and package changes**

```bash
git add resources/mip-paper.desktop scripts/generate-pkgbuild.mjs test/packaging.test.mjs
git commit -m "feat: package Linux application icon"
```

### Task 2: Integrate Source Installation, Uninstall, and Doctor

**Files:**
- Modify: `bin/mip-paper:12-24,146-181,213-315,317-355,495-620`
- Modify: `test/installer.test.mjs` (source install, rollback, uninstall, doctor assertions)

- [ ] **Step 1: Add failing installer tests for icon resources**

In the existing source-install fixture, assert after installation:

```js
assert.equal(await readFile(path.join(xdgDataHome, 'applications/mip-paper.desktop'), 'utf8'), desktopEntry);
assert.deepEqual(await readFile(path.join(xdgDataHome, 'icons/hicolor/512x512/apps/mip-paper.png')), logoBytes);
```

Add assertions that uninstall removes only these exact files and that `doctor`
reports PASS for the desktop entry and application icon. Add a rollback case
that stages an install failure and verifies pre-existing desktop/icon files are
restored byte-for-byte.

- [ ] **Step 2: Run the focused installer tests and verify RED**

Run: `node --test test/installer.test.mjs`

Expected: the source install test cannot find the desktop entry/icon and the new doctor/rollback assertions fail.

- [ ] **Step 3: Implement user-data resource paths and transactional installation**

Add mode-aware paths:

```bash
if [[ "$INSTALL_MODE" == packaged ]]; then
  DESKTOP_ENTRY_PATH=/usr/share/applications/$APP_ID.desktop
  ICON_PATH=/usr/share/icons/hicolor/512x512/apps/$APP_ID.png
else
  DESKTOP_ENTRY_PATH="$DATA_HOME/applications/$APP_ID.desktop"
  ICON_PATH="$DATA_HOME/icons/hicolor/512x512/apps/$APP_ID.png"
fi
```

Add a `copy_desktop_resources()` helper that creates parent directories and
installs `resources/mip-paper.desktop` and `assets/logo.png` to the source
paths. Include both files in the existing install backup/rollback state,
remove them on source uninstall, and remove empty parent directories only.
Add both paths to `doctor` checks. Add `resources/mip-paper.desktop` and
`assets/logo.png` to source validation and packaged setup validation.

- [ ] **Step 4: Run focused installer tests to verify GREEN**

Run: `node --test test/installer.test.mjs`

Expected: all installer tests pass, including source install, rollback, uninstall, packaged checks, and doctor output.

- [ ] **Step 5: Commit source integration**

```bash
git add bin/mip-paper test/installer.test.mjs
git commit -m "feat: install Linux application identity"
```

### Task 3: Final Verification and Documentation Consistency

**Files:**
- Modify: `test/packaging.test.mjs` or `test/docs-guides.test.mjs` only if a missing contract is found.

- [ ] **Step 1: Run the complete verification suite**

Run: `npm test && npm run check && git diff --check`

Expected: all tests pass, syntax checks pass, and no whitespace errors are reported.

- [ ] **Step 2: Inspect resource payloads and final worktree**

Run: `file assets/logo.png resources/mip-paper.desktop && git status --short`

Expected: the logo is a readable square PNG, the desktop entry is present, and the worktree is clean after commits.

- [ ] **Step 3: Manually refresh desktop databases after installation**

After source install, KDE may need its application cache refreshed or a new
session before the launcher shows the new icon. Verify the launcher, settings
window titlebar, settings taskbar item, and package-installed application menu
entry on a live Plasma session. Do not claim this manual check passed without
observing each surface.
