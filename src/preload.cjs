const { contextBridge, ipcRenderer } = require('electron');

const BOOTSTRAP_CHANNEL = 'wallpaper:get-bootstrap';
const PROBE_REPORT_CHANNEL = 'wallpaper:report-probe';
const INFORMATION_CHANNEL = 'wallpaper:get-information';
const INFORMATION_UPDATED_CHANNEL = 'wallpaper:information-updated';

contextBridge.exposeInMainWorld('wallpaper', Object.freeze({
  getBootstrap: () => ipcRenderer.invoke(BOOTSTRAP_CHANNEL),
  reportProbe: (summary) => ipcRenderer.invoke(PROBE_REPORT_CHANNEL, summary),
  getInformationSnapshot: () => ipcRenderer.invoke(INFORMATION_CHANNEL),
  onInformationUpdated: (listener) => {
    const wrapper = (_event, snapshot) => listener(snapshot);
    ipcRenderer.on(INFORMATION_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(INFORMATION_UPDATED_CHANNEL, wrapper);
  },
}));
