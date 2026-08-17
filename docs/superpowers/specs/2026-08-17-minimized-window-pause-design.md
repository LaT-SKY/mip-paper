# 0.3.9 Minimized Fullscreen/Maximized Window Pause Fix

## Context

The KWin coordinator pauses each display when a non-wallpaper window on the
display and current virtual desktop is fullscreen or fully maximized. A
minimized window can retain its `fullScreen` or `maximizeMode` state, so the
coordinator currently continues reporting the display as covered after the
window is minimized.

## Goals

- A minimized fullscreen or maximized application must not pause the wallpaper.
- Minimizing an already-covering window must publish an unpaused state promptly.
- Restoring that window while it remains fullscreen or fully maximized must
  publish a paused state promptly.
- Existing display assignment, current-desktop filtering, wallpaper exclusion,
  and manual pause behavior remain unchanged.

## Design

`kwin/mip-paper/contents/code/main.js` will extend `windowCoversOutput()` with
an early `window.minimized === true` exclusion before the fullscreen/maximized
state check. `track()` will subscribe to the KWin `minimizedChanged` signal,
guarded in the same way as the existing window signals. The existing
change-deduplicated `pushState()` path will carry both transitions over D-Bus.

No active-window-only rule, geometry/stacking analysis, or renderer-side change
is needed. The coordinator will continue to treat any non-minimized covering
window on the current desktop as covering the output, even if another window
has focus.

## Verification

Add coordinator tests for:

1. A fullscreen window that starts minimized reports `fullscreen: false`.
2. A fullscreen/maximized window changing to minimized reports `false`, and
   restoring it reports `true` through `minimizedChanged`.

The full Node test suite and syntax checks must remain green. Release metadata
will be updated from 0.3.8 to 0.3.9 in the package, lockfile, KWin metadata,
and changelog after the behavior change is verified.

## Non-goals

- Changing what counts as fullscreen or fully maximized.
- Restricting pause detection to the active window.
- Changing renderer scheduling or manual pause state.
