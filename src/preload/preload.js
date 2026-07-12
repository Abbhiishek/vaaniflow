'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaani', {
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setShortcutCapture: (capturing) => ipcRenderer.invoke('shortcut:capture', !!capturing),
  testConnection: () => ipcRenderer.invoke('settings:test'),
  getConfigInfo: () => ipcRenderer.invoke('config:info'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  openConfig: () => ipcRenderer.invoke('config:open'),
  onConfigChanged: (cb) => ipcRenderer.on('config:changed', () => cb()),

  // history
  getHistory: () => ipcRenderer.invoke('history:get'),
  deleteTranscript: (id) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  onHistoryChanged: (cb) => ipcRenderer.on('history:changed', () => cb()),

  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', () => cb()),
  onMilestoneReached: (cb) => ipcRenderer.on('milestone:reached', (e, payload) => cb(payload)),

  // updates
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateReady: (cb) => ipcRenderer.on('update:ready', (e, version) => cb(version)),

  // misc
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
  toggleDictation: () => ipcRenderer.invoke('dictation:toggle'),
  getSessionState: () => ipcRenderer.invoke('session:state'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  // overlay
  onSession: (cb) => ipcRenderer.on('session', (e, payload) => cb(payload)),
  onOverlayPosition: (cb) => ipcRenderer.on('overlay:position', (e, position) => cb(position)),
  onOverlayGuide: (cb) => ipcRenderer.on('overlay-guide:update', (e, payload) => cb(payload)),
  setHover: (hovering) => ipcRenderer.send('overlay:hover', !!hovering),
  overlayAction: (action) => ipcRenderer.send('overlay:action', action),
  beginOverlayDrag: (point) => ipcRenderer.send('overlay:drag-start', point),
  moveOverlayDrag: (point) => ipcRenderer.send('overlay:drag-move', point),
  endOverlayDrag: (point) => ipcRenderer.send('overlay:drag-end', point),
  sendAudio: (arrayBuffer, meta) => ipcRenderer.send('audio:data', arrayBuffer, meta),
  sendAudioChunk: (arrayBuffer) => ipcRenderer.send('audio:chunk', arrayBuffer),
  sendAudioError: (message) => ipcRenderer.send('audio:error', message)
});
