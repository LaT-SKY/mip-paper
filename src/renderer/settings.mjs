// Visual settings window controller. Renders one section at a time from the
// field schema (settings-fields.mjs), edits a local draft, and persists it
// through window.settings.saveConfig() — the main process validates with the
// same rules as config.mjs and writes atomically; the config watcher then
// hot-reloads it. Section entrance uses the context-menu's spring (omega =
// 2*PI*6.5, damping 0.6) so the settings UI shares the wallpaper menu's motion
// language; CSS holds state classes and hover, JS drives container motion.

import { SETTINGS_GROUPS, getPath, setPath } from '../settings-fields.mjs';
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
let currentSection = 'basic';
let animToken = 0;
let statusTimer = null;

function iconMarkup(name) {
  const paths = ICONS[name];
  if (!paths) return '';
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
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

function ensureIconDatalist() {
  if (document.getElementById('command-icon-options')) return;
  const datalist = document.createElement('datalist');
  datalist.id = 'command-icon-options';
  for (const name of Object.keys(ICONS)) {
    const option = document.createElement('option');
    option.value = name;
    datalist.appendChild(option);
  }
  document.body.appendChild(datalist);
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

  if (field.type === 'icon') {
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.field = field.key;
    input.placeholder = '无';
    input.setAttribute('list', 'command-icon-options');
    const value = getPath(draft, field.key);
    input.value = value == null ? '' : String(value);
    wrap.appendChild(input);
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

function createCommandRow(index) {
  const row = document.createElement('div');
  row.className = 'command-row';
  row.dataset.commandIndex = String(index);
  const commands = getPath(draft, 'menu.customCommands') ?? [];
  const entry = commands[index] ?? {};
  const subfields = SETTINGS_GROUPS
    .find((group) => group.id === 'menu').fields
    .find((field) => field.type === 'commands').fields;

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
      if (subfield.type === 'icon') input.setAttribute('list', 'command-icon-options');
    }
    input.dataset.commandField = subfield.key;
    input.dataset.commandIndex = String(index);
    const value = entry[subfield.key];
    input.value = value == null ? '' : String(value);
    row.appendChild(input);
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'command-remove';
  remove.textContent = '×';
  remove.dataset.commandRemove = String(index);
  row.appendChild(remove);
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
    next.push({ id: '', label: '', command: '', mode: 'background' });
    setPath(draft, 'menu.customCommands', next);
    markDirty();
    renderSection(currentSection);
  });
  editor.appendChild(add);
  return editor;
}

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
    ? '已配置：' + (state.credentials.apiHost || '未知') + '（写入 weather-credentials.json，0600 权限）'
    : '未配置 — 在 console.qweather.com 创建项目和 API Key 后填写';
  actions.appendChild(hint);
  card.appendChild(actions);
}

function appendAboutSection(card) {
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

function renderSection(groupId) {
  const group = SETTINGS_GROUPS.find((candidate) => candidate.id === groupId);
  if (!group) return;
  currentSection = groupId;
  renderNav();

  const card = document.createElement('div');
  card.className = 'settings-card';
  const heading = document.createElement('div');
  heading.className = 'settings-card-heading';
  heading.textContent = group.title;
  card.appendChild(heading);

  if (group.id === 'credentials') {
    appendCredentialsSection(card);
  } else if (group.id === 'about') {
    appendAboutSection(card);
  } else {
    for (const field of group.fields) {
      if (field.type === 'commands') {
        const row = document.createElement('div');
        row.className = 'field-row';
        row.dataset.field = field.key;
        row.appendChild(createCopy(field.label, field.description));
        row.appendChild(createCommandsEditor());
        card.appendChild(row);
      } else {
        card.appendChild(createFieldRow(field));
      }
    }
    if (group.id === 'wallpaper') {
      const actions = document.createElement('div');
      actions.className = 'wallpaper-actions';
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'button';
      pick.textContent = '选择图片…';
      pick.addEventListener('click', importWallpaper);
      actions.appendChild(pick);
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = '导入 JPEG / PNG / WebP 并切换到手动模式（所有显示器）';
      actions.appendChild(hint);
      card.appendChild(actions);
    }
  }

  contentRoot.replaceChildren(card);
  animateSection(card);
  syncFooterState();
}

function animateSection(card) {
  if (reducedMotion.matches) return;
  const token = ++animToken;
  const start = performance.now();
  let scale = SPRING.startScale;
  let velocity = 0;
  let last = start;
  const omega = SPRING.omega;
  const damping = SPRING.damping;
  const rows = [...card.querySelectorAll('.field-row, .command-row, .wallpaper-actions, .credentials-actions, .about-list')];
  card.style.opacity = '0';
  for (const row of rows) {
    row.style.opacity = '0';
    row.style.transform = 'translateY(2px)';
  }

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
    card.style.transform = 'scale(' + scale.toFixed(4) + ')';
    rows.forEach((row, index) => {
      const delay = Math.min(index * ROW_STAGGER_MS, SECTION_TRANSITION_MS);
      const rowProgress = Math.min(1, Math.max(0, (elapsed - delay) / SECTION_TRANSITION_MS));
      row.style.opacity = String(rowProgress);
      row.style.transform = rowProgress >= 1 ? 'none' : 'translateY(2px)';
    });
    const settled = Math.abs(SPRING.targetScale - scale) < SPRING.settleEpsilon
      && Math.abs(velocity) < SPRING.settleVelocity;
    if (settled || elapsed > 600) {
      card.style.transform = 'scale(1)';
      card.style.opacity = '1';
      for (const row of rows) {
        row.style.opacity = '1';
        row.style.transform = 'none';
      }
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
  if (field.type === 'icon') return input.value.trim() === '' ? undefined : input.value;
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
  state = await window.settings.getState();
  draft = structuredClone(state.config);
  dirty = false;
  applyTheme();
  applyAccent();
  if (state.appVersion) versionEl.textContent = 'v' + state.appVersion;
  renderSection(currentSection);
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
    showStatus('ok', '已保存，实时生效');
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
    renderSection(currentSection);
    showStatus('ok', '凭据已保存（0600 权限）');
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
    }
    return;
  }
  const commandField = input.dataset && input.dataset.commandField;
  if (commandField && input.dataset.commandIndex !== undefined) {
    const index = Number(input.dataset.commandIndex);
    const commands = [...(getPath(draft, 'menu.customCommands') ?? [])];
    if (!commands[index]) commands[index] = { mode: 'background' };
    if (commandField === 'icon' && input.value.trim() === '') {
      delete commands[index].icon;
    } else {
      commands[index][commandField] = input.value;
    }
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
  const removeTarget = event.target.closest && event.target.closest('[data-command-remove]');
  if (removeTarget) {
    const index = Number(removeTarget.dataset.commandRemove);
    const commands = [...(getPath(draft, 'menu.customCommands') ?? [])];
    commands.splice(index, 1);
    setPath(draft, 'menu.customCommands', commands);
    markDirty();
    renderSection(currentSection);
  }
});

saveButton.addEventListener('click', saveConfig);
reloadButton.addEventListener('click', async () => {
  clearFieldErrors();
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
    renderSection(currentSection);
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
    ensureIconDatalist();
    await reloadState();
  } catch (error) {
    errorOutput.value = 'Settings failed to start: ' + (error && error.message ? error.message : String(error));
    errorOutput.hidden = false;
  }
}

start();
