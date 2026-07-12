'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, clipboard, shell, nativeImage } = require('electron');
const { Store } = require('./store');
const { Injector } = require('./injector');
const { Hotkeys, HOTKEY_LABELS, uiohookAvailable } = require('./hotkeys');
const { Session } = require('./session');
const { createOverlayWindow, createDashboardWindow } = require('./windows');
const { createTray } = require('./tray');
const { testConnection } = require('./transcriber');
const { Updater } = require('./updater');
const dictionary = require('./dictionary');

const IS_SMOKE = process.argv.includes('--smoke');
const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'vaani.png');
// Keep the original identity stable across the VaaniFlow -> Vaani rename so
// Windows upgrades the existing install and refreshes its shortcut/taskbar icon.
const APP_USER_MODEL_ID = 'com.vaani.flow';

function loadAppIcon(size) {
  try {
    let image = nativeImage.createFromBuffer(fs.readFileSync(ICON_PATH));
    if (size && !image.isEmpty()) image = image.resize({ width: size, height: size, quality: 'best' });
    return image;
  } catch (err) {
    console.error('icon: failed to load', err.message);
    return nativeImage.createEmpty();
  }
}

function migrateLegacyUserData(userDataDir) {
  const appDataDir = app.getPath('appData');
  const legacyDirs = ['vaaniflow', 'VaaniFlow'].map((name) => path.join(appDataDir, name));
  const files = ['config.json', 'settings.json', 'history.json'];

  fs.mkdirSync(userDataDir, { recursive: true });
  for (const legacyDir of legacyDirs) {
    if (path.resolve(legacyDir) === path.resolve(userDataDir) || !fs.existsSync(legacyDir)) continue;
    for (const file of files) {
      const source = path.join(legacyDir, file);
      const destination = path.join(userDataDir, file);
      if (fs.existsSync(source) && !fs.existsSync(destination)) fs.copyFileSync(source, destination);
    }
    const failedAudioSource = path.join(legacyDir, 'failed-audio');
    const failedAudioDestination = path.join(userDataDir, 'failed-audio');
    if (fs.existsSync(failedAudioSource) && !fs.existsSync(failedAudioDestination)) {
      fs.cpSync(failedAudioSource, failedAudioDestination, { recursive: true });
    }
  }
}

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
    dashboardWin = createDashboardWindow(loadAppIcon(), store.settings);
    dashboardWin.on('closed', () => { dashboardWin = null; });
  }

  function sendToDashboard(channel, ...args) {
    if (dashboardWin && !dashboardWin.isDestroyed()) {
      dashboardWin.webContents.send(channel, ...args);
    }
  }

  app.on('second-instance', openDashboard);

  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_USER_MODEL_ID);

    const userDataDir = app.getPath('userData');
    migrateLegacyUserData(userDataDir);
    store = new Store(userDataDir);
    injector = new Injector();
    injector.start();

    // Allow mic access for our own renderers.
    const { session: electronSession } = require('electron');
    electronSession.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(permission === 'media');
    });

    overlayWin = createOverlayWindow();
    session = new Session({
      store,
      injector,
      getOverlay: () => overlayWin,
      getRuntimeSettings: () => store.runtimeSettings()
    });
    session.on('history-changed', () => sendToDashboard('history:changed'));

    session.on('transcript-added', (entry) => {
      if (dictionary.learn(entry.text, store)) {
        sendToDashboard('settings:changed');
      }
    });

    hotkeys = new Hotkeys();
    hotkeys.on('primary-down', () => session.onPrimaryDown());
    hotkeys.on('primary-up', () => session.onPrimaryUp());
    hotkeys.on('space', () => session.onSpace());
    hotkeys.on('escape', () => session.onEscape());
    hotkeys.on('intrude', () => session.onIntrude());
    hotkeys.start(store.settings.hotkey);

    tray = createTray({
      icon: loadAppIcon(32),
      onToggleDictation: () => session.toggle(),
      onOpenDashboard: openDashboard,
      onQuit: () => app.quit()
    });

    // Main-process hot reload does not recreate Tray/BrowserWindow instances.
    // Refresh the live icons when the source asset changes during development.
    if (!app.isPackaged) {
      fs.watchFile(ICON_PATH, { interval: 500 }, (current, previous) => {
        if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
        const windowIcon = loadAppIcon();
        const trayIcon = loadAppIcon(32);
        if (tray && !tray.isDestroyed() && !trayIcon.isEmpty()) tray.setImage(trayIcon);
        if (dashboardWin && !dashboardWin.isDestroyed() && !windowIcon.isEmpty()) dashboardWin.setIcon(windowIcon);
      });
    }

    updater = new Updater({
      onUpdateReady: (version) => sendToDashboard('update:ready', version),
      canAutoInstall: () => session?.uiState?.()?.state === 'idle',
      beforeInstall: () => store?.flush()
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
      if ('windowTransparency' in patch && dashboardWin && !dashboardWin.isDestroyed()) {
        const acrylic = Number(next.windowTransparency) > 0;
        try {
          dashboardWin.setBackgroundMaterial(acrylic ? 'acrylic' : 'none');
          dashboardWin.setBackgroundColor(acrylic ? '#00000000' : '#0f1011');
        } catch (err) {
          console.error('background material:', err.message);
        }
      }
      return next;
    });

    ipcMain.handle('settings:test', () => {
      try {
        return testConnection(store.runtimeSettings());
      } catch (err) {
        return { ok: false, message: err.message };
      }
    });

    // ---- editable Azure config ----
    ipcMain.handle('config:info', () => {
      try {
        return { ok: true, ...store.configInfo() };
      } catch (err) {
        return { ok: false, path: store.configPath, message: err.message };
      }
    });
    ipcMain.handle('config:open', async () => {
      try {
        const configPath = store.ensureConfigFile();
        const message = await shell.openPath(configPath);
        return message ? { ok: false, message } : { ok: true, path: store.configPath };
      } catch (err) {
        return { ok: false, message: err.message, path: store.configPath };
      }
    });

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
    try { fs.unwatchFile(ICON_PATH); } catch {}
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.destroy(); // closable:false — must destroy explicitly
    }
  });
}
