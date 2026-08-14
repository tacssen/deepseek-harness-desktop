const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  load: () => ipcRenderer.invoke('settings-load'),
  save: (value) => ipcRenderer.invoke('settings-save', value),
  testDeepSeek: () => ipcRenderer.invoke('test-deepseek'),
  testVision: () => ipcRenderer.invoke('test-vision'),
  openLogs: () => ipcRenderer.invoke('open-logs'),
  clearVisionCache: () => ipcRenderer.invoke('clear-vision-cache'),
  clearSecrets: () => ipcRenderer.invoke('clear-secrets'),
  close: () => ipcRenderer.invoke('settings-close'),
});
