'use strict';

const DEVTOOLS_KEYS = new Set(['i', 'j', 'c']);

function isDevToolsShortcut(input = {}) {
  const key = String(input.key || '').toLowerCase();
  if (key === 'f12') return true;

  const windowsOrLinuxShortcut = input.control && input.shift && DEVTOOLS_KEYS.has(key);
  const macShortcut = input.meta && input.alt && DEVTOOLS_KEYS.has(key);
  return !!(windowsOrLinuxShortcut || macShortcut);
}

function hardenWindowForProduction(win, isPackaged) {
  win.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  if (!isPackaged) return;

  win.removeMenu();
  win.webContents.on('before-input-event', (event, input) => {
    if (isDevToolsShortcut(input)) event.preventDefault();
  });
  win.webContents.on('devtools-opened', () => {
    win.webContents.closeDevTools();
  });
}

module.exports = { hardenWindowForProduction, isDevToolsShortcut };
