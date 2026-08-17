#!/usr/bin/env bash
set -euo pipefail

readonly APP_ID='mip-paper'
readonly SCRIPT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
readonly SOURCE="${KWIN_SCRIPT_SOURCE:-$SCRIPT_DIRECTORY/../kwin/$APP_ID}"
readonly DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
readonly DESTINATION="$DATA_HOME/kwin/scripts/$APP_ID"
readonly KWINRC="${KWIN_CONFIG_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/kwinrc}"

check_loaded_script() {
  [[ "$(qdbus6 org.kde.KWin /Scripting \
    org.kde.kwin.Scripting.isScriptLoaded "$APP_ID" 2>/dev/null)" == true ]]
}

load_script() {
  if [[ "${KWIN_SCRIPT_NO_RELOAD:-0}" == 1 ]]; then
    return 0
  fi
  # KWin's plugin manager does not reliably apply a newly written Enabled=true
  # value until the plugin makes a complete false -> reconfigure -> true ->
  # reconfigure transition. This mirrors Plasma's checkbox Apply action and
  # lets KWin load the script from its registered system or user data path.
  kwriteconfig6 --file "$KWINRC" --group Plugins \
    --key "${APP_ID}Enabled" --type bool false
  if ! qdbus6 org.kde.KWin /KWin reconfigure; then
    kwriteconfig6 --file "$KWINRC" --group Plugins \
      --key "${APP_ID}Enabled" --type bool true
    qdbus6 org.kde.KWin /KWin reconfigure >/dev/null 2>&1 || true
    return 1
  fi
  kwriteconfig6 --file "$KWINRC" --group Plugins \
    --key "${APP_ID}Enabled" --type bool true
  if ! qdbus6 org.kde.KWin /KWin reconfigure; then
    qdbus6 org.kde.KWin /KWin reconfigure >/dev/null 2>&1 || true
    return 1
  fi
  qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start >/dev/null
  check_loaded_script
}

unload_script() {
  if [[ "${KWIN_SCRIPT_NO_RELOAD:-0}" == 1 ]]; then
    return 0
  fi
  qdbus6 org.kde.KWin /KWin reconfigure
  qdbus6 org.kde.KWin /Scripting \
    org.kde.kwin.Scripting.unloadScript "$APP_ID" >/dev/null 2>&1 || true
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
  load_script
}

remove_script() {
  kwriteconfig6 --file "$KWINRC" --group Plugins --key "${APP_ID}Enabled" --type bool false
  rm -rf -- "$DESTINATION"
  unload_script
}

check_script() {
  [[ -f "$DESTINATION/metadata.json" ]]
  [[ -f "$DESTINATION/contents/code/main.js" ]]
  [[ "$(kreadconfig6 --file "$KWINRC" --group Plugins --key "${APP_ID}Enabled" --default false)" == true ]]
}

case "${1:-}" in
  install) install_script ;;
  remove) remove_script ;;
  check) check_script ;;
  check-loaded) check_loaded_script ;;
  *)
    printf 'Usage: %s {install|remove|check|check-loaded}\n' "$0" >&2
    exit 2
    ;;
esac
