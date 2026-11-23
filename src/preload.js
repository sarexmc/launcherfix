const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('sarex', {
  invoke: (ch, ...a) => ipcRenderer.invoke(ch, ...a),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, d) => fn(d)),
  pathOf: f => { try { return webUtils.getPathForFile(f); } catch { return ''; } }
});
