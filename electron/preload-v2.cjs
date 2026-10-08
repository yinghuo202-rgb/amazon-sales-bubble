const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("vision", {
  get: () => ipcRenderer.invoke("state"),
  settings: (value) => ipcRenderer.invoke("settings", value),
  demo: (type) => ipcRenderer.invoke("demo", type),
  connect: (value) => ipcRenderer.invoke("connect", value),
  reconnect: () => ipcRenderer.invoke("reconnect"),
  publicIp: () => ipcRenderer.invoke("public-ip"),
  copyText: (value) => ipcRenderer.invoke("copy-text", String(value || "")),
  openSettings: () => ipcRenderer.invoke("open-settings"),
  quick: () => ipcRenderer.invoke("quick-panel"),
  context: () => ipcRenderer.invoke("context-menu"),
  dragStart: () => ipcRenderer.send("drag-start"),
  dragMove: () => ipcRenderer.send("drag-move"),
  dragEnd: () => ipcRenderer.send("drag-end"),
  hide: () => ipcRenderer.invoke("hide"),
  exit: () => ipcRenderer.invoke("exit"),
  ready: (value) => ipcRenderer.send("renderer-ready", value),
  reportError: (message) =>
    ipcRenderer.send("renderer-error", String(message).slice(0, 1000)),
  subscribe: (callback) => {
    const handler = (_, value) => callback(value);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.removeListener("state", handler);
  },
});
