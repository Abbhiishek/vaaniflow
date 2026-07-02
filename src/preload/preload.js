'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaani', {
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  testConnection: () => ipcRenderer.invoke('settings:test'),

  // history
  getHistory: () => ipcRenderer.invoke('history:get'),
  deleteTranscript: (id) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  onHistoryChanged: (cb) => ipcRenderer.on('history:changed', () => cb()),

  // updates
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateReady: (cb) => ipcRenderer.on('update:ready', (e, version) => cb(version)),

  // misc
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
  toggleDictation: () => ipcRenderer.invoke('dictation:toggle'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  // overlay
  onSession: (cb) => ipcRenderer.on('session', (e, payload) => cb(payload)),
  setHover: (hovering) => ipcRenderer.send('overlay:hover', !!hovering),
  overlayAction: (action) => ipcRenderer.send('overlay:action', action),
  sendAudio: (arrayBuffer, meta) => ipcRenderer.send('audio:data', arrayBuffer, meta),
  sendAudioChunk: (arrayBuffer) => ipcRenderer.send('audio:chunk', arrayBuffer),
  sendAudioError: (message) => ipcRenderer.send('audio:error', message)
});
