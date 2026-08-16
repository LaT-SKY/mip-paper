import { contextBridge, ipcRenderer } from 'electron';

import { BOOTSTRAP_CHANNEL, CONFIG_UPDATED_CHANNEL } from './window-manager.mjs';
import { COLOR_SUBMIT_CHANNEL, COLOR_UPDATED_CHANNEL } from './window-manager.mjs';
import { FULLSCREEN_UPDATED_CHANNEL, GET_WORK_AREA_CHANNEL, IS_POINTER_OVER_APP_UI_CHANNEL, MENU_CLOSE_CHANNEL, MENU_COMMAND_CHANNEL, MENU_OPENED_CHANNEL, NOTIFY_MENU_OPENED_CHANNEL, SETTINGS_OPEN_CHANNEL, WORK_AREA_UPDATED_CHANNEL } from './window-manager.mjs';

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
