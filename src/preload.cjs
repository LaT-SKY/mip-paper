const { contextBridge, ipcRenderer } = require('electron');

const BOOTSTRAP_CHANNEL = 'wallpaper:get-bootstrap';
const PROBE_REPORT_CHANNEL = 'wallpaper:report-probe';
const INFORMATION_CHANNEL = 'wallpaper:get-information';
const INFORMATION_UPDATED_CHANNEL = 'wallpaper:information-updated';
const AUDIO_SPECTRUM_UPDATED_CHANNEL = 'wallpaper:audio-spectrum-updated';
const CONFIG_UPDATED_CHANNEL = 'wallpaper:config-updated';
const WALLPAPER_UPDATED_CHANNEL = 'wallpaper:wallpaper-updated';
const COLOR_UPDATED_CHANNEL = 'wallpaper:color-updated';
const COLOR_SUBMIT_CHANNEL = 'wallpaper:submit-color';
const FULLSCREEN_UPDATED_CHANNEL = 'wallpaper:fullscreen-updated';
const MENU_COMMAND_CHANNEL = 'wallpaper:menu-command';
const WORK_AREA_UPDATED_CHANNEL = 'wallpaper:work-area-updated';
const GET_WORK_AREA_CHANNEL = 'wallpaper:get-work-area';
const MENU_OPENED_CHANNEL = 'wallpaper:menu-opened';
const NOTIFY_MENU_OPENED_CHANNEL = 'wallpaper:notify-menu-opened';
const MENU_CLOSE_CHANNEL = 'wallpaper:menu-close';
const IS_POINTER_OVER_APP_UI_CHANNEL = 'wallpaper:is-pointer-over-app-ui';
const SETTINGS_OPEN_CHANNEL = 'settings:open';

contextBridge.exposeInMainWorld('wallpaper', Object.freeze({
  getBootstrap: () => ipcRenderer.invoke(BOOTSTRAP_CHANNEL),
  reportProbe: (summary) => ipcRenderer.invoke(PROBE_REPORT_CHANNEL, summary),
  getInformationSnapshot: () => ipcRenderer.invoke(INFORMATION_CHANNEL),
  onInformationUpdated: (listener) => {
    const wrapper = (_event, snapshot) => listener(snapshot);
    ipcRenderer.on(INFORMATION_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(INFORMATION_UPDATED_CHANNEL, wrapper);
  },
  onAudioSpectrumUpdated: (listener) => {
    const wrapper = (_event, snapshot) => listener(snapshot);
    ipcRenderer.on(AUDIO_SPECTRUM_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(AUDIO_SPECTRUM_UPDATED_CHANNEL, wrapper);
  },
  onConfigUpdated: (listener) => {
    const wrapper = (_event, payload) => listener(payload);
    ipcRenderer.on(CONFIG_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(CONFIG_UPDATED_CHANNEL, wrapper);
  },
  onWallpaperUpdated: (listener) => {
    const wrapper = (_event, payload) => listener(payload);
    ipcRenderer.on(WALLPAPER_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(WALLPAPER_UPDATED_CHANNEL, wrapper);
  },
  onColorUpdated: (listener) => {
    const wrapper = (_event, color) => listener(color);
    ipcRenderer.on(COLOR_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(COLOR_UPDATED_CHANNEL, wrapper);
  },
  submitWallpaperAccent: (submission) => ipcRenderer.invoke(COLOR_SUBMIT_CHANNEL, submission),
  onFullscreenUpdated: (listener) => {
    const wrapper = (_event, payload) => listener(payload);
    ipcRenderer.on(FULLSCREEN_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(FULLSCREEN_UPDATED_CHANNEL, wrapper);
  },
  runMenuCommand: (request) => ipcRenderer.invoke(MENU_COMMAND_CHANNEL, request),
  getWorkArea: () => ipcRenderer.invoke(GET_WORK_AREA_CHANNEL),
  notifyMenuOpened: () => ipcRenderer.send(NOTIFY_MENU_OPENED_CHANNEL),
  onMenuOpened: (listener) => {
    const wrapper = () => listener();
    ipcRenderer.on(MENU_OPENED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(MENU_OPENED_CHANNEL, wrapper);
  },
  onWorkAreaUpdated: (listener) => {
    const wrapper = (_event, rect) => listener(rect);
    ipcRenderer.on(WORK_AREA_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(WORK_AREA_UPDATED_CHANNEL, wrapper);
  },
  onMenuCloseRequest: (listener) => {
    const wrapper = () => listener();
    ipcRenderer.on(MENU_CLOSE_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(MENU_CLOSE_CHANNEL, wrapper);
  },
  isPointerOverAppUi: () => ipcRenderer.invoke(IS_POINTER_OVER_APP_UI_CHANNEL),
  openSettings: () => ipcRenderer.invoke(SETTINGS_OPEN_CHANNEL),
}));
