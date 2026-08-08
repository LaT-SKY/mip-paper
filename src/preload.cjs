const { contextBridge, ipcRenderer } = require('electron');

const BOOTSTRAP_CHANNEL = 'wallpaper:get-bootstrap';
const PROBE_REPORT_CHANNEL = 'wallpaper:report-probe';

contextBridge.exposeInMainWorld('wallpaper', Object.freeze({
  getBootstrap: () => ipcRenderer.invoke(BOOTSTRAP_CHANNEL),
  reportProbe: (summary) => ipcRenderer.invoke(PROBE_REPORT_CHANNEL, summary),
}));
