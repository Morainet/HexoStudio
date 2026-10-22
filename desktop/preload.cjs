const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hexoStudio', {
  selectDirectory: () => ipcRenderer.invoke('select-directory')
});
