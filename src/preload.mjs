import { contextBridge, ipcRenderer } from 'electron';

import { BOOTSTRAP_CHANNEL } from './window-manager.mjs';

contextBridge.exposeInMainWorld('wallpaper', Object.freeze({
  getBootstrap: () => ipcRenderer.invoke(BOOTSTRAP_CHANNEL),
}));
