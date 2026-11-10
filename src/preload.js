"use strict";
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  openAudioDialog: () => ipcRenderer.invoke("dialog:openAudio"),
  openAudioPath: (filePath) => ipcRenderer.invoke("file:openAudioPath", filePath),
  openImageDialog: () => ipcRenderer.invoke("dialog:openImage"),
  openImagePath: (filePath) => ipcRenderer.invoke("file:openImagePath", filePath),
  saveFile: (payload) => ipcRenderer.invoke("file:save", payload),
  // Resolves the real on-disk path of a File dropped onto the window
  // (only available from Electron 32+; guarded so the renderer can feature-detect).
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (e) {
      return null;
    }
  },
});
