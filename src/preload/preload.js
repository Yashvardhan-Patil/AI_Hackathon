const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  setAlwaysOnTop: (value) => ipcRenderer.send('set-always-on-top', value),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  selectProjectDialog: () => ipcRenderer.invoke('select-project-dialog'),
  openInVSCode: (targetPath) => ipcRenderer.invoke('open-in-vscode', targetPath),
});
