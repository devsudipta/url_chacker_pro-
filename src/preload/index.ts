import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopApi, Progress } from "../../shared/types";
const api: DesktopApi = {
  monitorStart: (id, interval, settings) =>
    ipcRenderer.invoke("monitor:start", id, interval, settings),
  monitorStop: () => ipcRenderer.invoke("monitor:stop"),
  monitorState: (id) => ipcRenderer.invoke("monitor:state", id),
  monitorExport: (id) => ipcRenderer.invoke("monitor:export", id),
  settings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (s) => ipcRenderer.invoke("settings:save", s),
  importFiles: () => ipcRenderer.invoke("import:files"),
  importDrop: (files) =>
    ipcRenderer.invoke(
      "import:drop",
      files.map((f) => webUtils.getPathForFile(f)),
    ),
  preview: (text) => ipcRenderer.invoke("import:preview", text),
  start: (input) => ipcRenderer.invoke("scan:start", input),
  control: (action) => ipcRenderer.invoke("scan:control", action),
  history: () => ipcRenderer.invoke("scan:history"),
  results: (query) => ipcRenderer.invoke("scan:results", query),
  detail: (id) => ipcRenderer.invoke("scan:detail", id),
  dashboard: (id) => ipcRenderer.invoke("scan:dashboard", id),
  deleteScan: (id) => ipcRenderer.invoke("scan:delete", id),
  exportScan: (id, format) => ipcRenderer.invoke("scan:export", id, format),
  compare: (a, b) => ipcRenderer.invoke("scan:compare", a, b),
  openUrl: (url) => ipcRenderer.invoke("url:open", url),
  onProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: Progress,
    ): void => callback(progress);
    ipcRenderer.on("scan:progress", listener);
    return () => ipcRenderer.removeListener("scan:progress", listener);
  },
};
contextBridge.exposeInMainWorld("desktop", api);
