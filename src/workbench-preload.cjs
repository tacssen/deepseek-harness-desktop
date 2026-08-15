const { contextBridge, ipcRenderer } = require('electron');

// The workbench is intentionally a thin shell. It never talks to the loopback
// Harness directly; the host owns the connection and exposes only these
// narrow, feature-detectable IPC methods.
const channel = (name) => `workbench:${name}`;
const invoke = (name, payload) => ipcRenderer.invoke(channel(name), payload);

contextBridge.exposeInMainWorld('workbench', {
  getSnapshot: () => invoke('getSnapshot'),
  setLayout: (layout) => invoke('setLayout', layout),
  setMode: (mode) => invoke('setMode', mode),
  runTerminal: (input) => invoke('runTerminal', input),
  listFiles: (input) => invoke('listFiles', input),
  attachFiles: () => invoke('attachFiles'),
  insertReference: (input) => invoke('insertReference', input),
  createCheckpoint: () => invoke('createCheckpoint'),
  restoreCheckpoint: (input) => invoke('restoreCheckpoint', input),
  openSettings: () => invoke('openSettings'),
  openPath: (input) => invoke('openPath', input),
  invokeSkill: (input) => invoke('invokeSkill', input),
  revertDiff: (input) => invoke('revertDiff', input),
  acceptDiff: (input) => invoke('acceptDiff', input),
  openProject: () => invoke('openProject'),
  initializeSharedProject: () => invoke('initializeSharedProject'),
  continueFromCodex: (input) => invoke('continueFromCodex', input),
  prepareHandoffForCodex: (input) => invoke('prepareHandoffForCodex', input),
  openMarketplace: () => invoke('openMarketplace'),
  onState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, nextState) => {
      try { callback(nextState); } catch { /* renderer owns callback errors */ }
    };
    ipcRenderer.on(channel('state'), listener);
    return () => ipcRenderer.removeListener(channel('state'), listener);
  },
  onLayout: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, nextLayout) => {
      try { callback(nextLayout); } catch { /* renderer owns callback errors */ }
    };
    ipcRenderer.on(channel('layout'), listener);
    return () => ipcRenderer.removeListener(channel('layout'), listener);
  },
});
