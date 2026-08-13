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
}));
