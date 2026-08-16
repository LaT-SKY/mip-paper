# Packaged KWin Coordinator Loading Plan

1. Add failing helper tests that require packaged `enable` to load its system
   source path and propagate a `loadScript` failure.
2. Split KWin activation and deactivation so each command has explicit runtime
   behavior and add a runtime loaded-state check.
3. Add a failing doctor test for an enabled but unloaded coordinator, then make
   doctor distinguish configuration health from runtime health.
4. Run focused tests, the complete test suite, syntax checks, and packaging
   checks.
5. Use the fixed helper against the installed system package and verify the
   live dual-display assignments and screenshot.
