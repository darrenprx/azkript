/* Azkript — narrow, context-isolated desktop bridge. */
"use strict";

const { contextBridge, ipcRenderer, webUtils } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge = {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  getInfo: () => invoke("app:get-info"),
  projectOpen: (options) => invoke('project:open', options || {}),
  projectSave: (payload) => invoke('project:save', payload),
  projectRead: (relative, root) => invoke('project:read', relative, root),
  stageUpdate: (options) => invoke('release:stage', options || {}),
  setInterfaceScale: (scale) => invoke("app:set-interface-scale", scale),
  openFile: () => invoke("dialog:open-file"),
  readFile: (filePath) => invoke("file:read", filePath),
  saveFile: (options) => invoke("file:save", options || {}),
  getFileIdentity: (filePath) => invoke("file:identity", filePath),
  watchFile: (options) => invoke("file:watch", options || {}),
  unwatchFile: () => invoke("file:unwatch"),
  onFileChanged: (callback) => subscribe("desktop:file-changed", callback),
  listBackups: (query) => invoke("backups:list", query || {}),
  readBackup: (id) => invoke("backups:read", id),
  createBackup: (payload) => invoke("backups:create", payload || {}),
  exportPdf: (options) => invoke("document:export-pdf", options || {}),
  exportAudio: (options) => invoke('document:export-audio', options || {}),
  print: (options) => invoke("document:print", options || {}),
  reveal: (filePath) => invoke("file:reveal", filePath),
  openExternal: (url) => invoke("external:open", url),
  recent: () => invoke("recent:list"),
  clearRecent: () => invoke("recent:clear"),
  touchRecent: (filePath, title) => invoke("recent:touch", { filePath, title }),
  readRecovery: (options) => invoke("recovery:read", options),
  writeRecovery: (payload) => invoke("recovery:write", payload),
  clearRecovery: (options) => invoke("recovery:clear", options),
  updateState: (payload) => ipcRenderer.send("desktop:update-state", payload || {}),
  confirmClose: () => ipcRenderer.send("desktop:close-confirmed"),
  cancelClose: () => ipcRenderer.send("desktop:close-cancelled"),
  printFinished: () => ipcRenderer.send("desktop:print-finished"),
  showInFolder: (target) => invoke("app:show-in-folder", target),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  onCommand: (callback) => subscribe("desktop:command", callback),
  onRequestSave: (callback) => subscribe("desktop:request-save", callback),
};

/* `azkript` is the current bridge name. `fdDesktop` is kept as an alias for
 * one release so an old cached renderer, or a user script that reached for the
 * pre-rename global, still works. Remove the alias after the migration window. */
contextBridge.exposeInMainWorld("azkript", bridge);
contextBridge.exposeInMainWorld("fdDesktop", bridge);
