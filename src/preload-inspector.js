const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitTree', {
  onInspectorRender: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('inspector:render', listener);
    return () => ipcRenderer.removeListener('inspector:render', listener);
  },

  onInspectorClosed: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('inspector:closed', listener);
    return () => ipcRenderer.removeListener('inspector:closed', listener);
  }
});
