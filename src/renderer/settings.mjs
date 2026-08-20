// Visual settings window controller. Renders one section at a time from the
// field schema (settings-fields.mjs), edits a local draft, and persists it
// through window.settings.saveConfig() — the main process validates with the
// same rules as config.mjs and writes atomically; the config watcher then
// hot-reloads it. Section entrance uses the context-menu's spring (omega =
// 2*PI*6.5, damping 0.6) so the settings UI shares the wallpaper menu's motion
// language; CSS holds state classes and hover, JS drives container motion.

import { SETTINGS_GROUPS, SETTINGS_ICONS, getPath, setPath } from '../settings-fields.mjs';
import { ICONS } from './context-menu.mjs';

// Mirrors context-menu.mjs SPRING (small control surface, one subtle bounce).
const SPRING = Object.freeze({
  omega: Math.PI * 2 * 6.5,
  damping: 0.6,
  startScale: 0.985,
  targetScale: 1,
  settleEpsilon: 0.002,
  settleVelocity: 0.01,
});
const SECTION_TRANSITION_MS = 180;
const ROW_STAGGER_MS = 24;

// Built-in context-menu command ids a custom command must not shadow; the
// auto-generated ids (cmd-1, cmd-2, …) never collide with them.
const RESERVED_COMMAND_IDS = new Set(['refresh', 'toggle-panel', 'toggle-pause', 'settings']);

const navRoot = document.getElementById('settings-nav');
const contentRoot = document.getElementById('settings-content');
const versionEl = document.getElementById('app-version');
const statusEl = document.getElementById('status');
const saveButton = document.getElementById('action-save');
const reloadButton = document.getElementById('action-reload');
const resetButton = document.getElementById('action-reset');
const errorOutput = document.getElementById('error');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let state = null;
let draft = null;
let dirty = false;
let currentSection = 'interaction';
let animToken = 0;
let statusTimer = null;
// Shared visual icon picker for the custom-command rows.
let iconPicker = null;
// Shared per-command "more" action menu.
let commandMenu = null;
// Gallery remove confirmation bubble
let galleryConfirm = null;

function iconMarkup(name) {
  const paths = SETTINGS_ICONS[name];
  if (!paths) return '';
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
}

function commandIconMarkup(name) {
  const paths = ICONS[name];
  if (!paths) return '';
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
}

// Small stroke icons for the per-command "more" menu (move, delete, auto-exit).
const MENU_ACTION_ICONS = Object.freeze({
  more: '<path d="M5 12h.01"/><path d="M12 12h.01"/><path d="M19 12h.01"/>',
  'chevron-up': '<path d="M6 15l6-6 6 6"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/><path d="M9 7V4h6v3"/>',
  check: '<path d="M5 12l4 4L19 6"/>',
});

function menuActionIcon(name) {
  const paths = MENU_ACTION_ICONS[name];
  if (!paths) return '';
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
}

// Build a file:// URL from an absolute path (Linux paths only). Used for the
// wallpaper preview and the About logo; returns null for missing input.
function fileUrlFor(pathname) {
  if (!pathname || typeof pathname !== 'string') return null;
  return 'file://' + encodeURI(pathname.replace(/\\/g, '/'));
}

// Next auto-managed command id: cmd-1, cmd-2, … skipping ids already in use
// (including arbitrary ids a user config carried over) and reserved ids.
function nextCommandId(commands) {
  const ids = new Set((commands ?? []).map((command) => command && command.id));
  let index = 1;
  while (ids.has('cmd-' + index) || RESERVED_COMMAND_IDS.has('cmd-' + index)) index += 1;
  return 'cmd-' + index;
}

function commandSubfields() {
  return SETTINGS_GROUPS
    .find((group) => group.id === 'menu').fields
    .find((field) => field.type === 'commands').fields;
}

function findField(key) {
  for (const group of SETTINGS_GROUPS) {
    for (const field of group.fields) {
      if (field.key === key) return field;
    }
  }
  return null;
}

function showStatus(kind, text) {
  if (statusTimer !== null) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
  statusEl.hidden = false;
  statusTimer = setTimeout(() => {
    statusEl.hidden = true;
    statusTimer = null;
  }, 3200);
}

function applyTheme() {
  const theme = state && state.appearance && state.appearance.resolvedTheme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
}

function applyAccent() {
  if (!state || !state.accent) return;
  const [r, g, b] = state.accent;
  document.documentElement.style.setProperty('--accent', 'rgb(' + r + ' ' + g + ' ' + b + ')');
  document.documentElement.style.setProperty(
    '--accent-dark',
    'rgb(' + Math.round(r * 0.76) + ' ' + Math.round(g * 0.76) + ' ' + Math.round(b * 0.76) + ')',
  );
}

function renderBrand() {
  const mark = document.getElementById('app-mark');
  if (mark) mark.innerHTML = iconMarkup('settings');
}

function renderNav() {
  navRoot.replaceChildren();
  for (const group of SETTINGS_GROUPS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item';
    button.dataset.section = group.id;
    button.setAttribute('aria-current', group.id === currentSection ? 'page' : 'false');
    const icon = iconMarkup(group.icon);
    if (icon) button.insertAdjacentHTML('afterbegin', icon);
    const label = document.createElement('span');
    label.textContent = group.title;
    button.appendChild(label);
    button.addEventListener('click', () => selectSection(group.id));
    navRoot.appendChild(button);
  }
}

function createControl(field) {
  const wrap = document.createElement('div');
  wrap.className = 'field-control';

  if (field.type === 'boolean') {
    const label = document.createElement('label');
    label.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.field = field.key;
    input.checked = Boolean(getPath(draft, field.key));
    const track = document.createElement('span');
    track.className = 'track';
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    label.append(input, track, thumb);
    wrap.appendChild(label);
    return wrap;
  }

  if (field.type === 'enum') {
    const select = document.createElement('select');
    select.dataset.field = field.key;
    for (const option of field.options) {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      select.appendChild(opt);
    }
    const value = getPath(draft, field.key);
    select.value = value == null ? '' : String(value);
    wrap.appendChild(select);
    return wrap;
  }

  if (field.type === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.dataset.field = field.key;
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    if (field.step !== undefined) input.step = String(field.step);
    const value = getPath(draft, field.key);
    input.value = value == null ? '' : String(value);
    wrap.appendChild(input);
    if (field.unit) {
      const unit = document.createElement('span');
      unit.className = 'field-unit';
      unit.textContent = field.unit;
      wrap.appendChild(unit);
    }
    return wrap;
  }

  const input = document.createElement('input');
  input.type = field.type === 'password' ? 'password' : 'text';
  input.dataset.field = field.key;
  if (field.placeholder) input.placeholder = field.placeholder;
  const value = getPath(draft, field.key);
  input.value = value == null ? '' : String(value);
  wrap.appendChild(input);
  return wrap;
}

function createFieldRow(field) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.dataset.field = field.key;

  const copy = document.createElement('div');
  copy.className = 'field-copy';
  const label = document.createElement('div');
  label.className = 'field-label';
  label.textContent = field.label;
  copy.appendChild(label);
  if (field.description) {
    const desc = document.createElement('div');
    desc.className = 'field-description';
    desc.textContent = field.description;
    copy.appendChild(desc);
  }
  const error = document.createElement('div');
  error.className = 'field-error';
  error.dataset.errorFor = field.key;
  copy.appendChild(error);
  row.appendChild(copy);

  row.appendChild(createControl(field));

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'field-reset';
  reset.textContent = '重置';
  reset.dataset.resetFor = field.key;
  row.appendChild(reset);
  return row;
}

// --- Custom command list editor ---------------------------------------------

function ensureIconPicker() {
  if (iconPicker) return iconPicker;
  const popover = document.createElement('div');
  popover.className = 'command-icon-popover';
  popover.hidden = true;
  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'command-icon-tile command-icon-tile--none';
  none.textContent = '无图标';
  none.addEventListener('click', () => pickIcon(null));
  popover.appendChild(none);
  for (const name of Object.keys(ICONS)) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'command-icon-tile';
    tile.dataset.iconName = name;
    tile.title = name;
    tile.innerHTML = commandIconMarkup(name);
    tile.addEventListener('click', () => pickIcon(name));
    popover.appendChild(tile);
  }
  document.body.appendChild(popover);
  iconPicker = { popover, index: -1 };
  return iconPicker;
}

function openIconPicker(anchor, index) {
  const picker = ensureIconPicker();
  picker.index = index;
  const rect = anchor.getBoundingClientRect();
  picker.popover.style.left = rect.left + 'px';
  picker.popover.style.top = rect.bottom + 6 + 'px';
  picker.popover.hidden = false;
  const commands = getPath(draft, 'menu.customCommands') ?? [];
  const current = commands[index] && commands[index].icon;
  for (const tile of picker.popover.querySelectorAll('[data-icon-name]')) {
    tile.classList.toggle('selected', tile.dataset.iconName === current);
  }
}

function closeIconPicker() {
  if (iconPicker) {
    iconPicker.popover.hidden = true;
    iconPicker.index = -1;
  }
}

// --- Per-command "more" action menu ----------------------------------------

function ensureCommandMenu() {
  if (commandMenu) return commandMenu;
  const popover = document.createElement('div');
  popover.className = 'command-more-popover';
  popover.hidden = true;
  document.body.appendChild(popover);
  commandMenu = { popover, index: -1 };
  return commandMenu;
}

function closeCommandMenu() {
  if (commandMenu) {
    commandMenu.popover.hidden = true;
    commandMenu.index = -1;
  }
}

function ensureGalleryConfirm() {
  if (galleryConfirm) return galleryConfirm;
  const popover = document.createElement('div');
  popover.className = 'gallery-confirm-popover';
  popover.hidden = true;
  document.body.appendChild(popover);
  galleryConfirm = { popover, entryId: null, anchor: null };
  return galleryConfirm;
}

function closeGalleryConfirm() {
  if (galleryConfirm) {
    galleryConfirm.popover.hidden = true;
    galleryConfirm.entryId = null;
    galleryConfirm.anchor = null;
  }
}

function openGalleryConfirm(anchor, entryId) {
  const c = ensureGalleryConfirm();
  c.entryId = entryId;
  c.anchor = anchor;
  c.popover.replaceChildren();
  const text = document.createElement('div');
  text.className = 'gallery-confirm-text';
  text.textContent = '移除该图片？收藏的图片也会被删除';
  const actions = document.createElement('div');
  actions.className = 'gallery-confirm-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button';
  cancel.textContent = '取消';
  cancel.addEventListener('click', closeGalleryConfirm);
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'button primary';
  confirm.textContent = '移除';
  confirm.addEventListener('click', async () => {
    const id = c.entryId;
    closeGalleryConfirm();
    try {
      await window.settings.removeGalleryImage(id);
      await reloadState();
      showStatus('ok', '已移除');
    } catch (err) {
      showStatus('error', '移除失败：' + (err?.message || err));
    }
  });
  actions.append(cancel, confirm);
  c.popover.append(text, actions);
  const rect = anchor.getBoundingClientRect();
  c.popover.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';
  c.popover.style.top = rect.bottom + 8 + 'px';
  c.popover.hidden = false;
}

function openCommandMenu(anchor, index) {
  const menu = ensureCommandMenu();
  const commands = getPath(draft, 'menu.customCommands') ?? [];
  const entry = commands[index] ?? {};
  const lastIndex = commands.length - 1;

  menu.index = index;
  menu.popover.replaceChildren();

  const actions = [
    { id: 'move-up', label: '上移', icon: 'chevron-up', disabled: index === 0 },
    { id: 'move-down', label: '下移', icon: 'chevron-down', disabled: index === lastIndex },
    { id: 'remove', label: '删除', icon: 'trash' },
  ];
  for (const action of actions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'command-more-item';
    item.disabled = Boolean(action.disabled);
    item.dataset.commandMenuAction = action.id;
    item.innerHTML = menuActionIcon(action.icon) + '<span class="command-more-label">' + action.label + '</span>';
    item.addEventListener('click', () => runCommandMenuAction(action.id));
    menu.popover.appendChild(item);
  }

  // autoExit only matters for terminal-mode commands; default is auto-exit.
  if (entry.mode === 'terminal') {
    const separator = document.createElement('div');
    separator.className = 'command-more-separator';
    menu.popover.appendChild(separator);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'command-more-item';
    toggle.dataset.commandMenuAction = 'auto-exit';
    toggle.innerHTML = '<span class="command-more-label">自动退出</span>'
      + (entry.autoExit !== false ? '<span class="command-more-check">' + menuActionIcon('check') + '</span>' : '');
    toggle.addEventListener('click', () => runCommandMenuAction('auto-exit'));
    menu.popover.appendChild(toggle);
  }

  const rect = anchor.getBoundingClientRect();
  menu.popover.style.left = rect.right - 168 + 'px';
  menu.popover.style.top = rect.bottom + 6 + 'px';
  menu.popover.hidden = false;
}

function runCommandMenuAction(action) {
  if (!commandMenu || commandMenu.index < 0) return;
  const index = commandMenu.index;
  const commands = [...(getPath(draft, 'menu.customCommands') ?? [])];
  if (action === 'auto-exit') {
    if (!commands[index]) commands[index] = { mode: 'background' };
    commands[index].autoExit = !commands[index].autoExit;
  } else if (action === 'move-up' || action === 'move-down') {
    const direction = action === 'move-up' ? -1 : 1;
    const target = index + direction;
    if (target < 0 || target >= commands.length) return;
    const [entry] = commands.splice(index, 1);
    commands.splice(target, 0, entry);
  } else if (action === 'remove') {
    commands.splice(index, 1);
  }
  setPath(draft, 'menu.customCommands', commands);
  markDirty();
  closeCommandMenu();
  renderSection(currentSection);
}

function pickIcon(name) {
  if (!iconPicker || iconPicker.index < 0) return;
  const index = iconPicker.index;
  const commands = [...(getPath(draft, 'menu.customCommands') ?? [])];
  if (!commands[index]) commands[index] = { mode: 'background' };
  if (name === null || name === undefined) delete commands[index].icon;
  else commands[index].icon = name;
  setPath(draft, 'menu.customCommands', commands);
  markDirty();
  closeIconPicker();
  renderSection(currentSection);
}

function createCommandRow(index) {
  const row = document.createElement('div');
  row.className = 'command-row';
  row.dataset.commandIndex = String(index);
  const commands = getPath(draft, 'menu.customCommands') ?? [];
  const entry = commands[index] ?? {};
  const subfields = commandSubfields();

  // Icon picker: visual glyph in the first column (the menu shows the same
  // glyph, not a name).
  const picker = document.createElement('button');
  picker.type = 'button';
  picker.className = 'command-icon-picker';
  picker.dataset.commandIconPicker = String(index);
  picker.title = entry.icon ? '图标：' + entry.icon : '选择图标';
  if (entry.icon && ICONS[entry.icon]) {
    picker.innerHTML = commandIconMarkup(entry.icon);
  } else {
    picker.textContent = '＋';
    picker.classList.add('command-icon-picker--empty');
  }
  picker.addEventListener('click', () => openIconPicker(picker, index));
  row.appendChild(picker);

  for (const subfield of subfields) {
    let input;
    if (subfield.type === 'enum') {
      input = document.createElement('select');
      for (const option of subfield.options) {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        input.appendChild(opt);
      }
    } else {
      input = document.createElement('input');
      input.type = 'text';
      if (subfield.placeholder) input.placeholder = subfield.placeholder;
    }
    input.dataset.commandField = subfield.key;
    input.dataset.commandIndex = String(index);
    const value = entry[subfield.key];
    input.value = value == null ? '' : String(value);
    row.appendChild(input);
  }

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'command-more';
  more.dataset.commandMore = String(index);
  more.title = '更多操作';
  more.innerHTML = menuActionIcon('more');
  more.addEventListener('click', () => openCommandMenu(more, index));
  row.appendChild(more);
  return row;
}

function createCommandsEditor() {
  const editor = document.createElement('div');
  editor.className = 'commands-editor';
  const commands = getPath(draft, 'menu.customCommands') ?? [];
  commands.forEach((_command, index) => editor.appendChild(createCommandRow(index)));
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'button command-add';
  add.textContent = '添加命令';
  add.addEventListener('click', () => {
    const next = [...(getPath(draft, 'menu.customCommands') ?? [])];
    next.push({ id: nextCommandId(next), label: '', command: '', mode: 'background', autoExit: true });
    setPath(draft, 'menu.customCommands', next);
    markDirty();
    renderSection(currentSection);
  });
  editor.appendChild(add);
  return editor;
}

// --- Shared copy row + credentials / about ----------------------------------

function createCopy(labelText, description) {
  const copy = document.createElement('div');
  copy.className = 'field-copy';
  const label = document.createElement('div');
  label.className = 'field-label';
  label.textContent = labelText;
  copy.appendChild(label);
  if (description) {
    const desc = document.createElement('div');
    desc.className = 'field-description';
    desc.textContent = description;
    copy.appendChild(desc);
  }
  return copy;
}

function appendCredentialsSection(card) {
  const configured = Boolean(state.credentials && state.credentials.configured);

  const hostRow = document.createElement('div');
  hostRow.className = 'field-row';
  hostRow.appendChild(createCopy('API Host', '只填 HTTPS 域名，不包含协议、路径或查询参数'));
  const hostControl = document.createElement('div');
  hostControl.className = 'field-control';
  const hostInput = document.createElement('input');
  hostInput.type = 'text';
  hostInput.id = 'credentials-host';
  hostInput.placeholder = 'your-project-host.qweatherapi.com';
  hostInput.value = state.credentials && state.credentials.apiHost ? state.credentials.apiHost : '';
  hostControl.appendChild(hostInput);
  hostRow.appendChild(hostControl);
  card.appendChild(hostRow);

  const keyRow = document.createElement('div');
  keyRow.className = 'field-row';
  keyRow.appendChild(createCopy(
    'API Key',
    '已保存时留空可保留现有 Key；仅主进程读取，不会进入 renderer、日志或缓存',
  ));
  const keyControl = document.createElement('div');
  keyControl.className = 'field-control';
  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.id = 'credentials-key';
  keyInput.placeholder = configured ? '已保存（留空保留）' : '必填';
  keyControl.appendChild(keyInput);
  keyRow.appendChild(keyControl);
  card.appendChild(keyRow);

  const actions = document.createElement('div');
  actions.className = 'credentials-actions';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'button primary';
  save.textContent = '保存凭据';
  save.addEventListener('click', saveCredentials);
  actions.appendChild(save);
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = configured
    ? '已配置：' + (state.credentials.apiHost || '未知')
    : '未配置 — 在 console.qweather.com 创建项目和 API Key 后填写';
  actions.appendChild(hint);
  card.appendChild(actions);
}

function appendAboutSection(card) {
  if (state.logoPath) {
    const logo = document.createElement('img');
    logo.className = 'about-logo';
    logo.alt = 'Mip-Paper Logo';
    logo.src = fileUrlFor(state.logoPath);
    logo.addEventListener('error', () => { logo.hidden = true; });
    card.appendChild(logo);
  }
  const list = document.createElement('dl');
  list.className = 'about-list';
  const items = [
    ['版本', state.appVersion ? 'v' + state.appVersion : '开发版'],
    ['配置文件', state.configPath || '未知'],
    ['壁纸模式', state.wallpaper && state.wallpaper.mode === 'manual' ? '手动图片' : '跟随 KDE'],
  ];
  if (state.wallpaper && state.wallpaper.path) items.push(['壁纸文件', state.wallpaper.path]);
  for (const [term, detail] of items) {
    const item = document.createElement('div');
    item.className = 'about-item';
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = detail;
    item.append(dt, dd);
    list.appendChild(item);
  }
  card.appendChild(list);
}

// --- Section rendering ------------------------------------------------------

function coverInfoFor(entry) {
  if (!entry || !state.displays || state.displays.length === 0) return `${entry.width}×${entry.height}`;
  // Show cover scale for primary display as smart-crop hint
  const d = state.displays[0];
  const scale = Math.max(d.bounds.width / entry.width, d.bounds.height / entry.height);
  const sw = Math.round(entry.width * scale);
  const sh = Math.round(entry.height * scale);
  return `${entry.width}×${entry.height} → ${sw}×${sh} cover`;
}

function appendWallpaperSection(card) {
  const actions = document.createElement('div');
  actions.className = 'wallpaper-actions';
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'button primary';
  pick.id = 'wallpaper-pick';
  pick.textContent = '选择图片…';
  pick.title = '导入 JPEG / PNG / WebP 并切换到手动模式';
  pick.addEventListener('click', importWallpaper);
  actions.appendChild(pick);
  const hintText = document.createElement('span');
  hintText.className = 'hint';
  hintText.textContent = '画廊按内容去重，收藏永久保留，历史自动清理';
  actions.appendChild(hintText);
  card.appendChild(actions);

  // Gallery grid
  const gallery = state.gallery ?? [];
  const grid = document.createElement('div');
  grid.className = 'gallery-grid';
  grid.id = 'gallery-grid';
  if (gallery.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = '画廊为空，导入图片后会保留历史，收藏的图片不会被自动清理';
    grid.appendChild(empty);
  } else {
    const activeContentKey = gallery.find((e) => e.file === state.wallpaper.path)?.contentKey;
    for (const entry of gallery) {
      const item = document.createElement('div');
      item.className = 'gallery-item' + (entry.contentKey === activeContentKey ? ' is-active' : '');
      const thumb = document.createElement('img');
      thumb.className = 'gallery-thumb';
      thumb.alt = entry.id;
      thumb.loading = 'lazy';
      const url = fileUrlFor(entry.file);
      if (url) thumb.src = url + '?v=' + (entry.mtimeMs || entry.size);
      thumb.style.cursor = entry.contentKey === activeContentKey ? 'default' : 'pointer';
      thumb.addEventListener('click', async () => {
        if (entry.contentKey === activeContentKey) return;
        try {
          await window.settings.setGalleryActive(entry.id);
          await reloadState();
          showStatus('ok', '已设为当前壁纸');
        } catch (err) {
          showStatus('error', '切换失败：' + (err?.message || err));
        }
      });
      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'gallery-thumb-wrap';
      const fav = document.createElement('button');
      fav.type = 'button';
      fav.className = 'gallery-fav' + (entry.favorite ? ' is-fav' : '');
      fav.title = entry.favorite ? '已收藏（永久保留）' : '收藏（永久保留）';
      fav.setAttribute('aria-label', entry.favorite ? '已收藏' : '收藏');
      fav.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8l2.1 4.3 4.7 0.7-3.4 3.3 0.8 4.7-4.2-2.2-4.2 2.2 0.8-4.7-3.4-3.3 4.7-0.7z"></path></svg>';
      fav.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await window.settings.toggleGalleryFavorite(entry.id);
          await reloadState();
          showStatus('ok', entry.favorite ? '已取消收藏' : '已收藏 · 永久保留');
        } catch (err) {
          showStatus('error', '收藏失败：' + (err?.message || err));
        }
      });
      const row = document.createElement('div');
      row.className = 'gallery-actions';
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'button primary';
      useBtn.textContent = '设为当前';
      useBtn.disabled = entry.contentKey === activeContentKey;
      useBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await window.settings.setGalleryActive(entry.id);
          await reloadState();
          showStatus('ok', '已设为当前壁纸');
        } catch (err) {
          showStatus('error', '切换失败：' + (err?.message || err));
        }
      });
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'button';
      delBtn.textContent = '移除';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openGalleryConfirm(delBtn, entry.id);
      });
      row.append(useBtn, delBtn);
      thumbWrap.append(thumb, fav, row);
      const meta = document.createElement('div');
      meta.className = 'gallery-meta';
      const title = document.createElement('div');
      title.className = 'gallery-title';
      title.textContent = entry.id;
      const sub = document.createElement('div');
      sub.className = 'gallery-subtitle';
      sub.textContent = coverInfoFor(entry) + (entry.favorite ? ' · 收藏' : '');
      meta.append(title, sub);
      item.append(thumbWrap, meta);
      grid.appendChild(item);
    }
  }
  card.appendChild(grid);


}

// Keep the wallpaper section's interactive state in sync with the draft mode
// without re-rendering the whole section (the mode select would lose focus).
function updateWallpaperSectionControls() {
  const card = contentRoot.querySelector('.settings-card');
  if (!card) return;
  const kde = getPath(draft, 'wallpaper.mode') === 'kde';
  const pick = card.querySelector('#wallpaper-pick');
  if (pick) {
    pick.disabled = kde;
    pick.title = kde ? '跟随 KDE 模式下不可用，切换到手动模式后可导入' : '导入 JPEG / PNG / WebP 并切换到手动模式';
  }
  const grid = card.querySelector('#gallery-grid');
  if (grid) grid.classList.toggle('is-dimmed', kde);
}

function renderSection(groupId, { animate = true } = {}) {
  const group = SETTINGS_GROUPS.find((candidate) => candidate.id === groupId);
  if (!group) return;
  const sectionChanged = groupId !== currentSection;
  currentSection = groupId;
  renderNav();

  const card = document.createElement('div');
  card.className = 'settings-card';
  const heading = document.createElement('div');
  heading.className = 'settings-card-heading';
  heading.textContent = group.title;
  card.appendChild(heading);

  if (group.id === 'about') {
    appendAboutSection(card);
  } else {
    for (const field of group.fields) {
      if (field.external) continue;
      if (field.type === 'commands') {
        const row = document.createElement('div');
        row.className = 'field-row field-row--stacked';
        row.dataset.field = field.key;
        row.appendChild(createCopy(field.label, field.description));
        row.appendChild(createCommandsEditor());
        card.appendChild(row);
      } else {
        card.appendChild(createFieldRow(field));
      }
    }
    if (group.id === 'wallpaper') {
      appendWallpaperSection(card);
    }
    if (group.id === 'weather') {
      appendCredentialsSection(card);
    }
  }

  contentRoot.replaceChildren(card);
  // The card must be attached before the control state is synced; otherwise
  // the initial KDE/manual mode would never grey out the pick button.
  if (group.id === 'wallpaper') updateWallpaperSectionControls();
  if (animate && sectionChanged) animateSection(card);
  else if (animate && !sectionChanged) {
    // Same-section refresh (e.g. gallery favorite/setActive) — keep steady, no flash
    card.style.opacity = '1';
    card.style.transform = 'none';
  } else {
    card.style.opacity = '1';
    card.style.transform = 'none';
  }
  syncFooterState();
}

function animateSection(card) {
  if (reducedMotion.matches) {
    card.style.opacity = '1';
    card.style.transform = 'none';
    return;
  }
  const token = ++animToken;
  const start = performance.now();
  let scale = SPRING.startScale;
  let velocity = 0;
  let last = start;
  const omega = SPRING.omega;
  const damping = SPRING.damping;
  // Only animate the container — rows stay visible to avoid staged flash (matches context-menu language)
  card.style.opacity = '0';
  card.style.transform = `scale(${scale})`;
  function frame(now) {
    if (token !== animToken) return;
    const dt = Math.min(0.032, Math.max(0, (now - last) / 1000));
    last = now;
    const elapsed = now - start;
    const opacityProgress = Math.min(1, elapsed / SECTION_TRANSITION_MS);
    card.style.opacity = String(1 - (1 - opacityProgress) * (1 - opacityProgress));
    const acceleration = omega * omega * (SPRING.targetScale - scale) - 2 * damping * omega * velocity;
    velocity += acceleration * dt;
    scale += velocity * dt;
    card.style.transform = `scale(${scale.toFixed(4)})`;
    const settled = Math.abs(SPRING.targetScale - scale) < SPRING.settleEpsilon
      && Math.abs(velocity) < SPRING.settleVelocity;
    if (settled || elapsed > 600) {
      card.style.transform = 'scale(1)';
      card.style.opacity = '1';
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function parseControlValue(input, field) {
  if (field.type === 'boolean') return input.checked;
  if (field.type === 'number') {
    if (input.value.trim() === '') return field.nullable ? null : undefined;
    const parsed = Number.parseFloat(input.value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return input.value;
}

function markDirty() {
  dirty = true;
  syncFooterState();
}

function syncFooterState() {
  saveButton.disabled = !dirty;
}

function clearFieldErrors() {
  for (const row of contentRoot.querySelectorAll('[data-invalid]')) {
    delete row.dataset.invalid;
  }
  for (const errorEl of contentRoot.querySelectorAll('[data-error-for]')) {
    errorEl.textContent = '';
  }
}

function fieldKeyForError(message) {
  let path = message;
  const prefix = 'Unknown configuration field: ';
  if (path.startsWith(prefix)) path = path.slice(prefix.length);
  const mustIndex = path.indexOf(' must ');
  if (mustIndex !== -1) path = path.slice(0, mustIndex);
  path = path.trim();
  const fields = SETTINGS_GROUPS.flatMap((group) => group.fields);
  return fields.find((field) => (
    field.key === path || path.startsWith(field.key + '.') || path.startsWith(field.key + '[')
  ))?.key ?? null;
}

function highlightFieldError(message) {
  clearFieldErrors();
  const key = fieldKeyForError(message);
  if (!key) return;
  const row = contentRoot.querySelector('[data-field="' + key + '"]');
  if (!row) return;
  row.dataset.invalid = '';
  const errorEl = row.querySelector('[data-error-for="' + key + '"]');
  if (errorEl) errorEl.textContent = message;
  row.scrollIntoView({ block: 'nearest' });
}

async function reloadState() {
  const previousDirty = dirty;
  const previousDraft = draft ? structuredClone(draft) : null;
  state = await window.settings.getState();
  // Preserve pending wallpaper.mode change if user switched KDE↔manual without saving;
  // any gallery operation (favorite/remove) must not revert the dropdown.
  if (!previousDirty || !previousDraft) {
    draft = structuredClone(state.config);
    dirty = false;
  } else {
    // Keep the user's pending draft, but sync gallery/displays and clear dirty if file now matches
    const stillDirty = JSON.stringify(previousDraft) !== JSON.stringify(state.config);
    // If file caught up (e.g. setActive saved manual), draft now equals file → clear dirty
    if (!stillDirty) dirty = false;
    else {
      // Keep draft as is; do not overwrite with stale file
      // state.config remains file's version for reference, draft is user's intent
    }
    // If we kept draft, ensure draft is still the object we render from
    if (stillDirty) draft = previousDraft;
    else draft = structuredClone(state.config);
  }
  applyTheme();
  applyAccent();
  if (state.appVersion) versionEl.textContent = 'v' + state.appVersion;
  renderSection(currentSection, { animate: false });
}

async function saveConfig() {
  clearFieldErrors();
  try {
    const saved = await window.settings.saveConfig(draft);
    state.config = saved;
    draft = structuredClone(saved);
    dirty = false;
    syncFooterState();
    applyTheme();
    showStatus('ok', '修改成功');
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    showStatus('error', '保存失败');
    highlightFieldError(message);
  }
}

async function saveCredentials() {
  const host = document.getElementById('credentials-host').value;
  const key = document.getElementById('credentials-key').value;
  if (state.credentials && state.credentials.configured && key.trim() === '') {
    showStatus('ok', 'Key 留空，保留现有凭据');
    return;
  }
  try {
    const result = await window.settings.saveCredentials({ apiHost: host, apiKey: key });
    state.credentials = result;
    renderSection(currentSection, { animate: false });
    showStatus('ok', '凭据已保存');
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    showStatus('error', '凭据保存失败：' + message);
  }
}

async function importWallpaper() {
  try {
    const result = await window.settings.importWallpaper();
    if (result && result.ok) {
      await reloadState();
      showStatus('ok', '已导入壁纸并切换到手动模式');
    } else if (!result || result.canceled) {
      // Dialog cancelled — keep the current wallpaper.
    } else {
      showStatus('error', '导入失败');
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    showStatus('error', '导入失败：' + message);
  }
}

function selectSection(groupId) {
  if (groupId === currentSection) return;
  clearFieldErrors();
  closeIconPicker();
  closeCommandMenu();
  closeGalleryConfirm();
  renderSection(groupId);
}

// Event delegation: every control writes straight into the draft.
contentRoot.addEventListener('input', (event) => {
  const input = event.target;
  const fieldKey = input.dataset && input.dataset.field;
  if (fieldKey) {
    const field = findField(fieldKey);
    if (field) {
      setPath(draft, fieldKey, parseControlValue(input, field));
      markDirty();
      if (fieldKey === 'wallpaper.mode') updateWallpaperSectionControls();
    }
    return;
  }
  const commandField = input.dataset && input.dataset.commandField;
  if (commandField && input.dataset.commandIndex !== undefined) {
    const index = Number(input.dataset.commandIndex);
    const commands = [...(getPath(draft, 'menu.customCommands') ?? [])];
    if (!commands[index]) commands[index] = { mode: 'background' };
    commands[index][commandField] = input.value;
    setPath(draft, 'menu.customCommands', commands);
    markDirty();
  }
});

contentRoot.addEventListener('click', (event) => {
  const resetTarget = event.target.closest && event.target.closest('[data-reset-for]');
  if (resetTarget) {
    const key = resetTarget.dataset.resetFor;
    setPath(draft, key, getPath(state.defaults, key));
    markDirty();
    renderSection(currentSection);
    return;
  }
  const menuAction = event.target.closest && event.target.closest('[data-command-menu-action]');
  if (menuAction) {
    // Actions are handled by their own listeners (built per open), so the
    // popover stays closed here — the delegation branch is a safety net.
    return;
  }
});

// The icon picker, command "more" and gallery confirm are floating popovers: close
// them on outside clicks, Escape, or when the section scrolls under them.
document.addEventListener('pointerdown', (event) => {
  if (iconPicker && !iconPicker.popover.hidden) {
    if (iconPicker.popover.contains(event.target)) return;
    const pickerButton = event.target.closest && event.target.closest('.command-icon-picker');
    if (pickerButton) return;
    closeIconPicker();
  }
  if (commandMenu && !commandMenu.popover.hidden) {
    if (commandMenu.popover.contains(event.target)) return;
    const moreButton = event.target.closest && event.target.closest('.command-more');
    if (moreButton) return;
    closeCommandMenu();
  }
  if (galleryConfirm && !galleryConfirm.popover.hidden) {
    if (galleryConfirm.popover.contains(event.target)) return;
    const delButton = event.target.closest && event.target.closest('.gallery-actions .button');
    if (delButton && delButton.textContent === '移除') return;
    closeGalleryConfirm();
  }
});
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (iconPicker && !iconPicker.popover.hidden) {
    event.preventDefault();
    closeIconPicker();
  } else if (commandMenu && !commandMenu.popover.hidden) {
    event.preventDefault();
    closeCommandMenu();
  } else if (galleryConfirm && !galleryConfirm.popover.hidden) {
    event.preventDefault();
    closeGalleryConfirm();
  }
});
contentRoot.addEventListener('scroll', () => {
  closeIconPicker();
  closeCommandMenu();
  closeGalleryConfirm();
}, { passive: true });

saveButton.addEventListener('click', saveConfig);
reloadButton.addEventListener('click', async () => {
  clearFieldErrors();
  closeIconPicker();
  closeCommandMenu();
  closeGalleryConfirm();
  await reloadState();
  showStatus('ok', '已重新加载配置');
});
resetButton.addEventListener('click', async () => {
  if (!window.confirm('恢复所有设置为默认值并保存？')) return;
  try {
    const saved = await window.settings.saveConfig(structuredClone(state.defaults));
    state.config = saved;
    draft = structuredClone(saved);
    dirty = false;
    syncFooterState();
    applyTheme();
    renderSection(currentSection);
    showStatus('ok', '已恢复默认设置');
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    showStatus('error', '恢复默认失败：' + message);
  }
});

window.settings.onConfigUpdated((payload) => {
  if (!payload || !payload.config) return;
  if (!dirty) {
    state.config = payload.config;
    draft = structuredClone(payload.config);
    renderSection(currentSection, { animate: false });
  }
  if (payload.appearance) {
    state.appearance = payload.appearance;
    applyTheme();
  }
});

async function start() {
  if (!window.settings) {
    errorOutput.value = 'Settings bridge unavailable';
    errorOutput.hidden = false;
    return;
  }
  try {
    renderBrand();
    await reloadState();
  } catch (error) {
    errorOutput.value = 'Settings failed to start: ' + (error && error.message ? error.message : String(error));
    errorOutput.hidden = false;
  }
}

start();
