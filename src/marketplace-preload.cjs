const { contextBridge, ipcRenderer } = require('electron');

const channel = (name) => `marketplace:${name}`;
const invoke = (name, payload) => ipcRenderer.invoke(channel(name), payload);

contextBridge.exposeInMainWorld('marketplace', {
  listInstalled: () => invoke('listInstalled'),
  searchMarketplace: (input) => invoke('searchMarketplace', input),
  inspectPlugin: (input) => invoke('inspectPlugin', input),
  installPlugin: (input) => invoke('installPlugin', input),
  uninstallPlugin: (input) => invoke('uninstallPlugin', input),
  openExternal: (input) => invoke('openExternal', input),
  openPluginFolder: (input) => invoke('openPluginFolder', input),
  onProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, progress) => {
      try { callback(progress); } catch { /* renderer owns callback errors */ }
    };
    ipcRenderer.on(channel('progress'), listener);
    return () => ipcRenderer.removeListener(channel('progress'), listener);
  },
});
