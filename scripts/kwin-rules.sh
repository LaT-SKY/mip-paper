#!/usr/bin/env bash
set -euo pipefail

readonly RULE_ID='mip-paper'
readonly RULE_DESCRIPTION='Mip-Paper'

config_args=()
if [[ -n "${KWIN_RULES_FILE:-}" ]]; then
  config_args+=(--file "$KWIN_RULES_FILE")
else
  config_args+=(--file "${XDG_CONFIG_HOME:-$HOME/.config}/kwinrulesrc")
fi

require_commands() {
  local command_name
  for command_name in kreadconfig6 kwriteconfig6; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      printf 'Required command is missing: %s\n' "$command_name" >&2
      exit 2
    fi
  done
}

read_key() {
  local group=$1 key=$2 default_value=${3:-}
  kreadconfig6 "${config_args[@]}" --group "$group" --key "$key" --default "$default_value"
}

write_key() {
  local group=$1 key=$2 value=$3
  shift 3
  kwriteconfig6 "${config_args[@]}" --group "$group" --key "$key" "$@" "$value"
}

delete_key() {
  local group=$1 key=$2
  kwriteconfig6 "${config_args[@]}" --group "$group" --key "$key" --delete ''
}

read_rule_ids() {
  local raw item
  raw=$(read_key General rules '')
  RULE_IDS=()
  IFS=',' read -ra candidates <<< "$raw"
  for item in "${candidates[@]}"; do
    item=${item//[[:space:]]/}
    if [[ -n "$item" ]]; then
      RULE_IDS+=("$item")
    fi
  done
}

write_rule_ids() {
  local joined=''
  if ((${#RULE_IDS[@]} > 0)); then
    joined=$(IFS=,; printf '%s' "${RULE_IDS[*]}")
  fi
  write_key General rules "$joined"
  write_key General count "${#RULE_IDS[@]}"
}

has_rule_id() {
  local item
  for item in "${RULE_IDS[@]}"; do
    if [[ "$item" == "$RULE_ID" ]]; then
      return 0
    fi
  done
  return 1
}

reload_kwin() {
  if [[ "${KWIN_RULES_NO_RELOAD:-0}" == '1' ]]; then
    return
  fi
  if command -v qdbus6 >/dev/null 2>&1; then
    qdbus6 org.kde.KWin /KWin reconfigure >/dev/null 2>&1 \
      || qdbus6 org.kde.KWin /KWin reloadConfig >/dev/null 2>&1 \
      || true
  fi
}

install_rule() {
  read_rule_ids
  if ! has_rule_id; then
    RULE_IDS+=("$RULE_ID")
  fi
  write_rule_ids

  write_key "$RULE_ID" Description "$RULE_DESCRIPTION"
  write_key "$RULE_ID" wmclass "$RULE_ID"
  write_key "$RULE_ID" wmclasscomplete false --type bool
  write_key "$RULE_ID" wmclassmatch 1
  delete_key "$RULE_ID" title
  delete_key "$RULE_ID" titlematch
  # The wallpaper window must never take keyboard focus: the context menu is
  # mouse-driven and other windows must keep focus. Accepting focus caused the
  # window to be resized on focus changes, overflowing into neighbouring
  # displays.
  write_key "$RULE_ID" acceptfocus false --type bool
  write_key "$RULE_ID" acceptfocusrule 2
  write_key "$RULE_ID" types 1
  write_key "$RULE_ID" noborder true --type bool
  write_key "$RULE_ID" noborderrule 2
  write_key "$RULE_ID" fullscreen true --type bool
  write_key "$RULE_ID" fullscreenrule 2
  write_key "$RULE_ID" below true --type bool
  write_key "$RULE_ID" belowrule 2
  write_key "$RULE_ID" skiptaskbar true --type bool
  write_key "$RULE_ID" skiptaskbarrule 2
  write_key "$RULE_ID" skippager true --type bool
  write_key "$RULE_ID" skippagerrule 2
  write_key "$RULE_ID" skipswitcher true --type bool
  write_key "$RULE_ID" skipswitcherrule 2
  write_key "$RULE_ID" desktops '*'
  write_key "$RULE_ID" desktopsrule 2
  reload_kwin
  printf 'Installed KWin rule: %s\n' "$RULE_ID"
}

remove_rule() {
  read_rule_ids
  local item
  local -a retained=()
  for item in "${RULE_IDS[@]}"; do
    if [[ "$item" != "$RULE_ID" ]]; then
      retained+=("$item")
    fi
  done
  RULE_IDS=("${retained[@]}")
  write_rule_ids

  local key
  for key in \
    Description wmclass wmclasscomplete wmclassmatch title titlematch types \
    noborder noborderrule fullscreen fullscreenrule below belowrule \
    skiptaskbar skiptaskbarrule \
    skippager skippagerrule skipswitcher skipswitcherrule acceptfocus \
    acceptfocusrule desktops desktopsrule; do
    delete_key "$RULE_ID" "$key"
  done
  reload_kwin
  printf 'Removed KWin rule: %s\n' "$RULE_ID"
}

check_rule() {
  read_rule_ids
  if has_rule_id && [[ "$(read_key "$RULE_ID" Description '')" == "$RULE_DESCRIPTION" ]]; then
    printf 'KWin rule is installed: %s\n' "$RULE_ID"
    return 0
  fi
  printf 'KWin rule is not installed: %s\n' "$RULE_ID"
  return 1
}

usage() {
  printf 'Usage: %s {install|remove|check}\n' "${0##*/}" >&2
  exit 2
}

require_commands
case "${1:-}" in
  install) install_rule ;;
  remove) remove_rule ;;
  check) check_rule ;;
  *) usage ;;
esac
