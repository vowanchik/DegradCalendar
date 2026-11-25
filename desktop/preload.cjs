const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('partyup', {
  getToken: () => ipcRenderer.invoke('token:get'),
  setToken: (token) => ipcRenderer.invoke('token:set', token),
  clearToken: () => ipcRenderer.invoke('token:clear'),
  connect: (data) => ipcRenderer.send('connect', data),
  disconnect: () => ipcRenderer.send('disconnect'),
  notify: (data) => ipcRenderer.send('notify', data),
  setAutoStart: (enabled) => ipcRenderer.invoke('autostart', enabled),
  configure: (data) => ipcRenderer.invoke('configure', data),
  setSound: (data) => ipcRenderer.invoke('sound:set', data),
  previewSound: (kind) => ipcRenderer.invoke('sound:preview', kind),
  onPreferences: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('preferences', handler);
    return () => ipcRenderer.removeListener('preferences', handler);
  },
  onOpen: (callback) => {
    const handler = (_event, id) => callback(id);
    ipcRenderer.on('open-event', handler);
    return () => ipcRenderer.removeListener('open-event', handler);
  },
});
