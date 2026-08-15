const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usage', {
  load: () => ipcRenderer.invoke('usage-snapshot'),
  clear: () => ipcRenderer.invoke('usage-clear'),
  billing: () => ipcRenderer.invoke('usage-open-billing'),
  close: () => ipcRenderer.invoke('usage-close'),
});
