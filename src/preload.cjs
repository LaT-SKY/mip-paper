const { contextBridge, ipcRenderer } = require('electron');

const BOOTSTRAP_CHANNEL = 'wallpaper:get-bootstrap';

contextBridge.exposeInMainWorld('wallpaper', Object.freeze({
  getBootstrap: () => ipcRenderer.invoke(BOOTSTRAP_CHANNEL),
}));
