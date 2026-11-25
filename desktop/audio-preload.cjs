const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('partyupAudio', {
  onRequest: (callback) => ipcRenderer.on('audio-request', (_event, data) => callback(data)),
  respond: (data) => ipcRenderer.send('audio-result', data),
});
