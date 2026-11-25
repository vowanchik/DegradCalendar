const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('partyupWidget', {
  getState: () => ipcRenderer.invoke('widget:get'),
  onState: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('widget-state', handler);
    return () => ipcRenderer.removeListener('widget-state', handler);
  },
  openEvent: (id) => ipcRenderer.send('widget:open', id),
  hide: () => ipcRenderer.send('widget:hide'),
});
