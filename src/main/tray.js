'use strict';
const { Tray, Menu, nativeImage } = require('electron');

function createTray({ icon, onToggleDictation, onOpenDashboard, onQuit }) {
  const tray = new Tray(icon && !icon.isEmpty() ? icon : nativeImage.createEmpty());
  tray.setToolTip('Vaani — voice dictation');

  const menu = Menu.buildFromTemplate([
    { label: 'Start / stop dictation', click: onToggleDictation },
    { label: 'Open dashboard', click: onOpenDashboard },
    { type: 'separator' },
    { label: 'Quit Vaani', click: onQuit }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', onOpenDashboard);
  tray.on('double-click', onOpenDashboard);
  return tray;
}

module.exports = { createTray };
