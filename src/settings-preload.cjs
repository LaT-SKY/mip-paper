// Sandboxed preload for the settings window. Exposes a minimal, read/write
// bridge (window.settings) for editing configuration, weather credentials, and
// importing wallpaper images. The wallpaper import dialog is opened by the main
// process only; this preload never accepts file paths from the renderer. All
// writes are validated in the main process before they reach disk.

const { contextBridge, ipcRenderer } = require('electron');

const SETTINGS_STATE_CHANNEL = 'settings:get-state';
const SETTINGS_SAVE_CONFIG_CHANNEL = 'settings:save-config';
const SETTINGS_SAVE_CREDENTIALS_CHANNEL = 'settings:save-credentials';
const SETTINGS_IMPORT_WALLPAPER_CHANNEL = 'settings:import-wallpaper';
// Reuse the runtime broadcast so the settings UI live-updates when the config
// changes through any writer (its own save, the CLI, or an external editor).
const CONFIG_UPDATED_CHANNEL = 'wallpaper:config-updated';

contextBridge.exposeInMainWorld('settings', Object.freeze({
  getState: () => ipcRenderer.invoke(SETTINGS_STATE_CHANNEL),
  saveConfig: (candidate) => ipcRenderer.invoke(SETTINGS_SAVE_CONFIG_CHANNEL, candidate),
  saveCredentials: (payload) => ipcRenderer.invoke(SETTINGS_SAVE_CREDENTIALS_CHANNEL, payload),
  importWallpaper: () => ipcRenderer.invoke(SETTINGS_IMPORT_WALLPAPER_CHANNEL),
  onConfigUpdated: (listener) => {
    const wrapper = (_event, payload) => listener(payload);
    ipcRenderer.on(CONFIG_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(CONFIG_UPDATED_CHANNEL, wrapper);
  },
}));
