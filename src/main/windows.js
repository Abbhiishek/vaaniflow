// Window factory: the always-on-top overlay pill and the dashboard.
'use strict';
const path = require('path');
const { BrowserWindow, screen } = require('electron');

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const OVERLAY_W = 420;
const OVERLAY_H = 170; // pill + live-caption bubble above it

function positionOverlay(win) {
  const wa = screen.getPrimaryDisplay().workArea;
  win.setBounds({
    x: Math.round(wa.x + (wa.width - OVERLAY_W) / 2),
    y: Math.round(wa.y + wa.height - OVERLAY_H - 4),
    width: OVERLAY_W,
    height: OVERLAY_H
  });
}

function createOverlayWindow() {
  const win = new BrowserWindow({
    width: OVERLAY_W,
    height: OVERLAY_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  positionOverlay(win);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));

  screen.on('display-metrics-changed', () => positionOverlay(win));
  screen.on('display-added', () => positionOverlay(win));
  screen.on('display-removed', () => positionOverlay(win));
  return win;
}

function createDashboardWindow(iconPath, settings) {
  // Acrylic needs a transparent backgroundColor; the CSS surfaces provide the
  // actual tint so the blur shows through exactly as much as the user chose.
  const acrylic = Number(settings?.windowTransparency) > 0;
  // Deliberate product decision: the dashboard is always a fixed-size window —
  // no resize, no maximize, no fullscreen. The design size is clamped to the
  // work area so it still fits on small screens.
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1120, Math.round(wa.width * 0.92));
  const height = Math.min(740, Math.round(wa.height * 0.92));
  const win = new BrowserWindow({
    width,
    height,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: acrylic ? '#00000000' : '#0f1011',
    ...(acrylic ? { backgroundMaterial: 'acrylic' } : {}),
    icon: iconPath,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f1011',
      symbolColor: '#8f9297',
      height: 40
    },
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'dashboard', 'dashboard.html'));
  win.setMenuBarVisibility(false);
  return win;
}

module.exports = { createOverlayWindow, createDashboardWindow };
