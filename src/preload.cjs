const { contextBridge, ipcRenderer } = require('electron');

const BOOTSTRAP_CHANNEL = 'wallpaper:get-bootstrap';
const PROBE_REPORT_CHANNEL = 'wallpaper:report-probe';
const INFORMATION_CHANNEL = 'wallpaper:get-information';
const INFORMATION_UPDATED_CHANNEL = 'wallpaper:information-updated';
const AUDIO_SPECTRUM_UPDATED_CHANNEL = 'wallpaper:audio-spectrum-updated';
const AUDIO_CONFIG_UPDATED_CHANNEL = 'wallpaper:audio-config-updated';
const WALLPAPER_UPDATED_CHANNEL = 'wallpaper:wallpaper-updated';

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
  onAudioConfigUpdated: (listener) => {
    const wrapper = (_event, audioConfig) => listener(audioConfig);
    ipcRenderer.on(AUDIO_CONFIG_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(AUDIO_CONFIG_UPDATED_CHANNEL, wrapper);
  },
  onWallpaperUpdated: (listener) => {
    const wrapper = (_event, payload) => listener(payload);
    ipcRenderer.on(WALLPAPER_UPDATED_CHANNEL, wrapper);
    return () => ipcRenderer.removeListener(WALLPAPER_UPDATED_CHANNEL, wrapper);
  },
}));
