const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  openSettings: () => ipcRenderer.invoke('open-settings'),
  getStatus: () => ipcRenderer.invoke('get-status'),
});
