'use strict';
const path = require('path');
const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const { Store } = require('./store');
const { Injector } = require('./injector');
const { Hotkeys, HOTKEY_LABELS, uiohookAvailable } = require('./hotkeys');
const { Session } = require('./session');
const { createOverlayWindow, createDashboardWindow } = require('./windows');
const { createTray } = require('./tray');
const { testConnection } = require('./transcriber');
const { Updater } = require('./updater');

const IS_SMOKE = process.argv.includes('--smoke');
const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'icon.png');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let overlayWin = null;
  let dashboardWin = null;
  let tray = null;
  let store = null;
  let injector = null;
  let hotkeys = null;
  let session = null;
  let updater = null;

  function openDashboard() {
    if (dashboardWin && !dashboardWin.isDestroyed()) {
      if (dashboardWin.isMinimized()) dashboardWin.restore();
      dashboardWin.show();
      dashboardWin.focus();
      return;
    }
    dashboardWin = createDashboardWindow(ICON_PATH);
    dashboardWin.on('closed', () => { dashboardWin = null; });
  }

  function sendToDashboard(channel, ...args) {
    if (dashboardWin && !dashboardWin.isDestroyed()) {
      dashboardWin.webContents.send(channel, ...args);
    }
  }

  app.on('second-instance', openDashboard);

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.vaani.flow');

    store = new Store(app.getPath('userData'));
    injector = new Injector();
    injector.start();

    // Allow mic access for our own renderers.
    const { session: electronSession } = require('electron');
    electronSession.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(permission === 'media');
    });

    overlayWin = createOverlayWindow();
    session = new Session({ store, injector, getOverlay: () => overlayWin });
    session.on('history-changed', () => sendToDashboard('history:changed'));

    hotkeys = new Hotkeys();
    hotkeys.on('primary-down', () => session.onPrimaryDown());
    hotkeys.on('primary-up', () => session.onPrimaryUp());
    hotkeys.on('space', () => session.onSpace());
    hotkeys.on('escape', () => session.onEscape());
    hotkeys.on('intrude', () => session.onIntrude());
    hotkeys.start(store.settings.hotkey);

    tray = createTray({
      onToggleDictation: () => session.toggle(),
      onOpenDashboard: openDashboard,
      onQuit: () => app.quit()
    });

    updater = new Updater({
      onUpdateReady: (version) => sendToDashboard('update:ready', version)
    });
    updater.start();

    registerIpc();
    openDashboard();

    if (IS_SMOKE) await runSmokeTest();
  });

  function registerIpc() {
    // ---- settings ----
    ipcMain.handle('settings:get', () => ({
      settings: store.settings,
      hotkeyLabels: HOTKEY_LABELS,
      uiohookAvailable
    }));

    ipcMain.handle('settings:set', (e, patch) => {
      const prev = { ...store.settings };
      const next = store.updateSettings(patch);
      if (patch.hotkey && patch.hotkey !== prev.hotkey) hotkeys.setHotkey(patch.hotkey);
      if ('launchAtLogin' in patch) {
        app.setLoginItemSettings({ openAtLogin: !!next.launchAtLogin });
      }
      return next;
    });

    ipcMain.handle('settings:test', () => testConnection(store.settings));

    // ---- history ----
    ipcMain.handle('history:get', () => store.history);
    ipcMain.handle('history:delete', (e, id) => {
      store.deleteTranscript(id);
      return store.history;
    });
    ipcMain.handle('history:clear', () => {
      store.clearHistory();
      return store.history;
    });

    // ---- updates ----
    ipcMain.handle('update:state', () => updater.state());
    ipcMain.handle('update:install', () => updater.install());

    // ---- misc ----
    ipcMain.handle('clipboard:copy', (e, text) => clipboard.writeText(String(text ?? '')));
    ipcMain.handle('dictation:toggle', () => session.toggle());
    ipcMain.handle('app:openExternal', (e, url) => {
      if (/^https?:\/\//i.test(String(url))) shell.openExternal(url);
    });

    // ---- overlay ----
    ipcMain.on('overlay:hover', (e, hovering) => {
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.setIgnoreMouseEvents(!hovering, { forward: true });
      }
    });
    ipcMain.on('overlay:action', (e, action) => {
      if (action === 'toggle') session.toggle();
      else if (action === 'stop') session.stop();
      else if (action === 'cancel') session.cancel();
    });
    ipcMain.on('audio:chunk', (e, wavArrayBuffer) => session.onAudioChunk(wavArrayBuffer));
    ipcMain.on('audio:data', (e, wavArrayBuffer, meta) => session.onAudioData(wavArrayBuffer, meta || {}));
    ipcMain.on('audio:error', (e, message) => session.onAudioError(message));
  }

  async function runSmokeTest() {
    const results = {
      settingsLoaded: !!store.settings,
      overlayCreated: !!overlayWin && !overlayWin.isDestroyed(),
      uiohookAvailable,
      injectorReady: false
    };
    try {
      results.injectorReady = (await injector.ping()).ok;
    } catch {}
    // let renderers finish loading so load errors surface
    await new Promise((r) => setTimeout(r, 2500));
    results.overlayLoaded = overlayWin && !overlayWin.webContents.isLoading();
    results.dashboardLoaded = dashboardWin && !dashboardWin.webContents.isLoading();
    console.log('SMOKE_RESULTS ' + JSON.stringify(results));
    const ok = Object.values(results).every(Boolean);
    console.log(ok ? 'SMOKE_OK' : 'SMOKE_FAIL');
    app.exit(ok ? 0 : 1);
  }

  // Tray app: keep running when windows close.
  app.on('window-all-closed', (e) => {
    // main.js keeps the overlay alive, so this fires only if overlay dies too
  });

  app.on('before-quit', () => {
    try { hotkeys?.stop(); } catch {}
    try { injector?.stop(); } catch {}
    try { store?.flush(); } catch {}
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.destroy(); // closable:false — must destroy explicitly
    }
  });
}
