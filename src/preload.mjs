import { contextBridge, ipcRenderer } from 'electron';

import { BOOTSTRAP_CHANNEL, CONFIG_UPDATED_CHANNEL } from './window-manager.mjs';
import { COLOR_SUBMIT_CHANNEL, COLOR_UPDATED_CHANNEL } from './window-manager.mjs';

contextBridge.exposeInMainWorld('wallpaper', Object.freeze({
  getBootstrap: () => ipcRenderer.invoke(BOOTSTRAP_CHANNEL),
  onConfigUpdated: (listener) => {
    const wrapper = (_event, payload) => listener(payload);
    ipcRenderer.on(CONFIG_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(CONFIG_UPDATED_CHANNEL, wrapper);
  },
  submitWallpaperAccent: (submission) => ipcRenderer.invoke(COLOR_SUBMIT_CHANNEL, submission),
  onColorUpdated: (listener) => {
    const wrapper = (_event, color) => listener(color);
    ipcRenderer.on(COLOR_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(COLOR_UPDATED_CHANNEL, wrapper);
  },
}));
