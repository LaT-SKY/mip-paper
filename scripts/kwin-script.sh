#!/usr/bin/env bash
set -euo pipefail

readonly APP_ID='mip-paper'
readonly SCRIPT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
readonly SOURCE="${KWIN_SCRIPT_SOURCE:-$SCRIPT_DIRECTORY/../kwin/$APP_ID}"
readonly DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
readonly DESTINATION="$DATA_HOME/kwin/scripts/$APP_ID"
readonly KWINRC="${KWIN_CONFIG_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/kwinrc}"

reload_kwin() {
  if [[ "${KWIN_SCRIPT_NO_RELOAD:-0}" == 1 ]]; then
    return 0
  fi
  qdbus6 org.kde.KWin /KWin reconfigure
  # KWin keeps running an already-loaded script instance, so an upgrade only
  # takes effect after the script is unloaded and loaded again. These reload
  # steps are best-effort; the reconfigure above is the failure checkpoint.
  qdbus6 org.kde.KWin /Scripting \
    org.kde.kwin.Scripting.unloadScript "$APP_ID" >/dev/null 2>&1 || true
  qdbus6 org.kde.KWin /Scripting \
    org.kde.kwin.Scripting.loadScript "$DESTINATION/contents/code/main.js" "$APP_ID" >/dev/null 2>&1 || true
  qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start >/dev/null 2>&1 || true
}

install_script() {
  [[ -f "$SOURCE/metadata.json" ]] || exit 1
  [[ -f "$SOURCE/contents/code/main.js" ]] || exit 1
  mkdir -p "$(dirname -- "$DESTINATION")" "$(dirname -- "$KWINRC")"

  local stage
  stage=$(mktemp -d "$(dirname -- "$DESTINATION")/.${APP_ID}.XXXXXX")
  trap 'rm -rf -- "${stage:-}"' EXIT
  cp -a "$SOURCE/." "$stage/"
  rm -rf -- "$DESTINATION"
  mv -- "$stage" "$DESTINATION"
  stage=''

  kwriteconfig6 --file "$KWINRC" --group Plugins --key "${APP_ID}Enabled" --type bool true
  reload_kwin
}

remove_script() {
  kwriteconfig6 --file "$KWINRC" --group Plugins --key "${APP_ID}Enabled" --type bool false
  rm -rf -- "$DESTINATION"
  reload_kwin
}

check_script() {
  [[ -f "$DESTINATION/metadata.json" ]]
  [[ -f "$DESTINATION/contents/code/main.js" ]]
  [[ "$(kreadconfig6 --file "$KWINRC" --group Plugins --key "${APP_ID}Enabled" --default false)" == true ]]
}

enable_script() {
  [[ -f "$SOURCE/metadata.json" ]] || exit 1
  [[ -f "$SOURCE/contents/code/main.js" ]] || exit 1
  mkdir -p "$(dirname -- "$KWINRC")"
  kwriteconfig6 --file "$KWINRC" --group Plugins \
    --key "${APP_ID}Enabled" --type bool true
  reload_kwin
}

disable_script() {
  kwriteconfig6 --file "$KWINRC" --group Plugins \
    --key "${APP_ID}Enabled" --type bool false
  reload_kwin
}

check_enabled_script() {
  [[ -f "$SOURCE/metadata.json" ]]
  [[ -f "$SOURCE/contents/code/main.js" ]]
  [[ "$(kreadconfig6 --file "$KWINRC" --group Plugins \
    --key "${APP_ID}Enabled" --default false)" == true ]]
}

case "${1:-}" in
  install) install_script ;;
  remove) remove_script ;;
  check) check_script ;;
  enable) enable_script ;;
  disable) disable_script ;;
  check-enabled) check_enabled_script ;;
  *)
    printf 'Usage: %s {install|remove|check|enable|disable|check-enabled}\n' "$0" >&2
    exit 2
    ;;
esac
