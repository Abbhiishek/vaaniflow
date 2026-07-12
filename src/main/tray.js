'use strict';
const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

function createTray({ onToggleDictation, onOpenDashboard, onQuit }) {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'vaani.png');
  let image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) image = image.resize({ width: 32, height: 32, quality: 'best' });
  if (image.isEmpty()) image = nativeImage.createEmpty();
  const tray = new Tray(image);
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
