/**
 * Preload script for Connect Support Agent
 * Provides a secure bridge between renderer and main process
 */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronBridge", {
  configure: (supportCode) => ipcRenderer.invoke("configure-agent", supportCode),
  saveConsent: (enabled) => ipcRenderer.invoke("save-consent", enabled),
  respondToApproval: (approved) => ipcRenderer.invoke("approval-response", approved),
  onMessage: (channel, callback) => {
    const validChannels = ["update-status", "toggle-lock-banner"];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },
});
