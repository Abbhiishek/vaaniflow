'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, clipboard, shell, Menu, Notification, nativeImage, screen } = require('electron');
const { Store } = require('./store');
const { Injector } = require('./injector');
const { Hotkeys, HOTKEY_LABELS, uiohookAvailable, hotkeyLabel, isValidHotkeyId } = require('./hotkeys');
const { Session } = require('./session');
const { createOverlayWindow, createOverlayGuideWindow, createDashboardWindow, positionOverlay } = require('./windows');
const { nearestOverlayPosition, normalizeOverlayPosition } = require('./overlay-position');
const { createTray } = require('./tray');
const { testConnection } = require('./transcriber');
const { gatewayIsConfigured, saveProviderProfile } = require('./gateway-client');
const { Updater } = require('./updater');
const { SystemAudioMute } = require('./system-audio');
const { crossedWordMilestones, milestoneMessage } = require('./milestones');
const { PRODUCT_NAME, appUserModelId, shouldManageLoginItem } = require('./app-identity');
const dictionary = require('./dictionary');

const IS_SMOKE = process.argv.includes('--smoke');
const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'vaani.png');
// Keep the original identity stable across the VaaniFlow -> Vaani rename so
// Windows upgrades the existing install and refreshes its shortcut/taskbar icon.
const APP_USER_MODEL_ID = appUserModelId(app.isPackaged);
const MANAGES_LOGIN_ITEM = shouldManageLoginItem(app.isPackaged, IS_SMOKE);
const TRUSTED_RENDERER_ROOT = pathToFileURL(path.join(__dirname, '..', 'renderer') + path.sep).href;

app.setName(PRODUCT_NAME);

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

function isTrustedWebContents(webContents) {
  try { return String(webContents?.getURL?.() || '').startsWith(TRUSTED_RENDERER_ROOT); } catch { return false; }
}

function assertTrustedIpc(event) {
  if (!isTrustedWebContents(event?.sender)) throw new Error('Rejected IPC from an untrusted renderer');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let overlayWin = null;
  let overlayGuideWin = null;
  let overlayDrag = null;
  let dashboardWin = null;
  let tray = null;
  let store = null;
  let injector = null;
  let hotkeys = null;
  let session = null;
  let updater = null;
  let systemAudio = null;

  function openDashboard() {
    if (dashboardWin && !dashboardWin.isDestroyed()) {
      if (dashboardWin.isMinimized()) dashboardWin.restore();
      dashboardWin.show();
      dashboardWin.focus();
      return;
    }
    dashboardWin = createDashboardWindow(loadAppIcon(), store.settings);
    applyDockVisibility(store.settings.showInDock !== false);
    dashboardWin.on('closed', () => { dashboardWin = null; });
  }

  function sendToDashboard(channel, ...args) {
    if (dashboardWin && !dashboardWin.isDestroyed()) {
      dashboardWin.webContents.send(channel, ...args);
    }
  }

  function sendToOverlay(channel, ...args) {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send(channel, ...args);
    }
  }

  function overlayPointer(payload) {
    const x = Number(payload?.screenX);
    const y = Number(payload?.screenY);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function sendOverlayGuideState() {
    if (!overlayDrag || !overlayGuideWin || overlayGuideWin.isDestroyed() || overlayGuideWin.webContents.isLoading()) return;
    overlayGuideWin.webContents.send('overlay-guide:update', {
      position: overlayDrag.nearest,
      accentColor: store.settings.accentColor
    });
  }

  function showOverlayGuide(display) {
    if (!overlayGuideWin || overlayGuideWin.isDestroyed()) return;
    overlayGuideWin.setBounds(display.workArea);
    if (!overlayGuideWin.isVisible()) overlayGuideWin.showInactive();
    sendOverlayGuideState();
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.moveTop();
  }

  function finishOverlayDrag(payload) {
    if (!overlayDrag || !overlayWin || overlayWin.isDestroyed()) return;
    const point = overlayPointer(payload) || overlayDrag.lastPoint;
    const display = screen.getDisplayNearestPoint(point);
    const position = nearestOverlayPosition(display.workArea, point);
    overlayDrag = null;
    store.updateSettings({ overlayPosition: position }, { flush: true });
    positionOverlay(overlayWin, position, display);
    overlayWin.setIgnoreMouseEvents(true, { forward: true });
    if (overlayGuideWin && !overlayGuideWin.isDestroyed()) overlayGuideWin.hide();
    broadcastSettingsChanged();
  }

  function broadcastSettingsChanged() {
    sendToDashboard('settings:changed');
    sendToOverlay('settings:changed');
  }

  function applyDockVisibility(show) {
    if (process.platform === 'darwin' && app.dock) {
      if (show) app.dock.show();
      else app.dock.hide();
    }
    if (dashboardWin && !dashboardWin.isDestroyed()) dashboardWin.setSkipTaskbar(!show);
  }

  function announceMilestone(entry) {
    if (!store.settings.milestoneNotifications) return;
    const totalWords = store.history.reduce((sum, item) => sum + Number(item.words || 0), 0);
    const previousWords = Math.max(0, totalWords - Number(entry.words || 0));
    const crossed = crossedWordMilestones(previousWords, totalWords, store.settings.milestonesReached);
    if (!crossed.length) return;
    store.updateSettings({
      milestonesReached: [...new Set([...(store.settings.milestonesReached || []), ...crossed])]
    }, { flush: true });
    const milestone = crossed[crossed.length - 1];
    const message = milestoneMessage(milestone);
    sendToDashboard('milestone:reached', { words: milestone, message });
    if (Notification.isSupported()) {
      new Notification({ title: 'Vaani milestone', body: message }).show();
    }
  }

  app.on('second-instance', openDashboard);

  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_USER_MODEL_ID);
    if (app.isPackaged) Menu.setApplicationMenu(null);

    const userDataDir = app.getPath('userData');
    migrateLegacyUserData(userDataDir);
    store = new Store(userDataDir);
    if (MANAGES_LOGIN_ITEM) app.setLoginItemSettings({ openAtLogin: !!store.settings.launchAtLogin });
    injector = new Injector();
    injector.start();
    systemAudio = new SystemAudioMute();
    systemAudio.ping().then((result) => {
      if (!result.ok && systemAudio.available) console.error('system audio helper:', result.message);
    });

    // Allow mic access for our own renderers.
    const { session: electronSession } = require('electron');
    electronSession.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(permission === 'media' && isTrustedWebContents(wc));
    });
    electronSession.defaultSession.setPermissionCheckHandler((wc, permission) => (
      permission === 'media' && isTrustedWebContents(wc)
    ));

    overlayWin = createOverlayWindow(() => store.settings.overlayPosition);
    overlayGuideWin = createOverlayGuideWindow();
    overlayGuideWin.webContents.on('did-finish-load', sendOverlayGuideState);
    session = new Session({
      store,
      injector,
      getOverlay: () => overlayWin,
      getRuntimeSettings: () => store.runtimeSettings(),
      systemAudio
    });
    session.on('history-changed', () => sendToDashboard('history:changed'));
    session.on('ui-state', (payload) => sendToDashboard('session', payload));

    session.on('transcript-added', (entry) => {
      announceMilestone(entry);
      if (dictionary.learn(entry.text, store)) {
        broadcastSettingsChanged();
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
    fs.watchFile(store.configPath, { interval: 600 }, (current, previous) => {
      if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
        sendToDashboard('config:changed');
      }
    });
    openDashboard();

    if (IS_SMOKE) await runSmokeTest();
  });

  function registerIpc() {
    // ---- settings ----
    ipcMain.handle('settings:get', () => {
      const labels = { ...HOTKEY_LABELS };
      if (String(store.settings.hotkey).startsWith('custom:')) {
        labels[store.settings.hotkey] = hotkeyLabel(store.settings.hotkey) || 'Custom shortcut';
      }
      return {
        settings: store.settings,
        hotkeyLabels: labels,
        uiohookAvailable,
        capabilities: {
          audioMuting: !!systemAudio?.available,
          notifications: Notification.isSupported()
        },
        systemStatus: {
          launchAtLogin: MANAGES_LOGIN_ITEM
            ? app.getLoginItemSettings().openAtLogin
            : !!store.settings.launchAtLogin
        },
        environment: {
          isPackaged: app.isPackaged
        }
      };
    });

    ipcMain.handle('settings:set', (e, patch) => {
      const prev = { ...store.settings };
      const nextPatch = patch && typeof patch === 'object' ? { ...patch } : {};
      if ('overlayPosition' in nextPatch) nextPatch.overlayPosition = normalizeOverlayPosition(nextPatch.overlayPosition);
      if (nextPatch.hotkey && !isValidHotkeyId(nextPatch.hotkey)) delete nextPatch.hotkey;
      if (nextPatch.hotkey && nextPatch.hotkey !== prev.hotkey && !hotkeys.setHotkey(nextPatch.hotkey)) {
        delete nextPatch.hotkey;
      }
      if (nextPatch.hotkey) hotkeys.setSuspended(false);
      const immediatePersistence = ['hotkey', 'profileFirstName', 'profileLastName', 'profileEmail', 'profilePicture', 'onboardingCompleted']
        .some((key) => Object.prototype.hasOwnProperty.call(nextPatch, key));
      const next = store.updateSettings(nextPatch, { flush: immediatePersistence });
      if ('launchAtLogin' in nextPatch && MANAGES_LOGIN_ITEM) {
        app.setLoginItemSettings({ openAtLogin: !!next.launchAtLogin });
      }
      if ('showInDock' in nextPatch) applyDockVisibility(next.showInDock !== false);
      if ('overlayPosition' in nextPatch) positionOverlay(overlayWin, next.overlayPosition);
      if ('windowTransparency' in nextPatch && dashboardWin && !dashboardWin.isDestroyed()) {
        const acrylic = Number(next.windowTransparency) > 0;
        try {
          dashboardWin.setBackgroundMaterial(acrylic ? 'acrylic' : 'none');
          dashboardWin.setBackgroundColor(acrylic ? '#00000000' : '#0f1011');
        } catch (err) {
          console.error('background material:', err.message);
        }
      }
      sendToOverlay('settings:changed');
      return next;
    });

    ipcMain.handle('shortcut:capture', (e, capturing) => {
      hotkeys.setSuspended(!!capturing);
      return { ok: true };
    });

    ipcMain.handle('session:state', () => session.uiState());

    ipcMain.handle('settings:test', (event) => {
      try {
        assertTrustedIpc(event);
        return testConnection(store.runtimeSettings());
      } catch (err) {
        return { ok: false, message: err.message };
      }
    });

    // ---- editable Azure config ----
    ipcMain.handle('config:info', (event) => {
      try {
        assertTrustedIpc(event);
        const info = store.configInfo();
        const gatewayReady = gatewayIsConfigured(store.runtimeSettings());
        const missing = gatewayReady ? info.missing : ['built-in server provisioning', ...info.missing];
        return { ok: true, ...info, configured: gatewayReady && info.configured, gatewayReady, missing };
      } catch (err) {
        return { ok: false, path: store.configPath, message: err.message };
      }
    });
    ipcMain.handle('config:get', (event) => {
      try {
        assertTrustedIpc(event);
        const config = store.getConfig();
        return { ok: true, config: { ...config, apiKey: '' } };
      } catch (err) {
        return { ok: false, message: err.message };
      }
    });
    ipcMain.handle('config:set', async (e, patch) => {
      try {
        assertTrustedIpc(e);
        const current = store.getConfig();
        const next = patch && typeof patch === 'object' ? { ...patch } : {};
        const providerMode = next.providerMode === 'override' ? 'override' : 'builtin';
        if (providerMode === 'override') {
          const profile = {
            provider: 'azure-openai',
            baseUrl: String(next.baseUrl || current.baseUrl || '').trim(),
            apiKey: String(next.apiKey || '').trim(),
            apiVersion: String(next.apiVersion || current.apiVersion || '2024-10-21').trim(),
            whisperDeployment: String(next.whisperDeployment || current.whisperDeployment || '').trim(),
            llmDeployment: String(next.llmDeployment ?? current.llmDeployment ?? '').trim()
          };
          await saveProviderProfile(profile, { ...store.runtimeSettings(), providerMode });
          next.overrideConfigured = true;
        }
        next.providerMode = providerMode;
        next.apiKey = '';
        const config = store.updateConfig(next);
        return { ok: true, config: { ...config, apiKey: '' } };
      } catch (err) {
        return { ok: false, message: err.message };
      }
    });
    ipcMain.handle('config:open', async (event) => {
      try {
        assertTrustedIpc(event);
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
      try {
        const target = new URL(String(url));
        if (target.protocol === 'https:') shell.openExternal(target.toString());
      } catch {}
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
    ipcMain.on('overlay:drag-start', (e, payload) => {
      if (!overlayWin || overlayWin.isDestroyed() || e.sender !== overlayWin.webContents) return;
      const point = overlayPointer(payload);
      if (!point) return;
      const bounds = overlayWin.getBounds();
      const display = screen.getDisplayNearestPoint(point);
      overlayDrag = {
        offsetX: point.x - bounds.x,
        offsetY: point.y - bounds.y,
        displayId: display.id,
        nearest: nearestOverlayPosition(display.workArea, point),
        lastPoint: point
      };
      overlayWin.setIgnoreMouseEvents(false);
      showOverlayGuide(display);
    });
    ipcMain.on('overlay:drag-move', (e, payload) => {
      if (!overlayDrag || !overlayWin || overlayWin.isDestroyed() || e.sender !== overlayWin.webContents) return;
      const point = overlayPointer(payload);
      if (!point) return;
      overlayDrag.lastPoint = point;
      overlayWin.setPosition(Math.round(point.x - overlayDrag.offsetX), Math.round(point.y - overlayDrag.offsetY), false);
      const display = screen.getDisplayNearestPoint(point);
      const nearest = nearestOverlayPosition(display.workArea, point);
      const displayChanged = display.id !== overlayDrag.displayId;
      const targetChanged = nearest !== overlayDrag.nearest;
      overlayDrag.displayId = display.id;
      overlayDrag.nearest = nearest;
      if (displayChanged) showOverlayGuide(display);
      else if (targetChanged) sendOverlayGuideState();
    });
    ipcMain.on('overlay:drag-end', (e, payload) => {
      if (e.sender === overlayWin?.webContents) finishOverlayDrag(payload);
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
    try { systemAudio?.stop(); } catch {}
    try { store?.flush(); } catch {}
    try { if (store) fs.unwatchFile(store.configPath); } catch {}
    try { fs.unwatchFile(ICON_PATH); } catch {}
    if (overlayGuideWin && !overlayGuideWin.isDestroyed()) overlayGuideWin.destroy();
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.destroy(); // closable:false — must destroy explicitly
    }
  });
}
