// Auto-update via GitHub Releases (electron-updater). Only active in the
// packaged app; in dev it is a no-op. Updates download in the background and
// install automatically once dictation is idle, on quit, or immediately when
// the user clicks the dashboard banner.
'use strict';
const { app } = require('electron');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const AUTO_INSTALL_DELAY_MS = 60 * 1000;
const AUTO_INSTALL_RETRY_MS = 15 * 1000;

// True when candidate is a strictly newer x.y.z than current. electron-updater
// also checks this, but a stale cached installer must never be surfaced or run.
function isNewerVersion(current, candidate) {
  const parse = (v) => String(v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(current), parse(candidate)];
  for (let i = 0; i < 3; i++) {
    if ((b[i] || 0) > (a[i] || 0)) return true;
    if ((b[i] || 0) < (a[i] || 0)) return false;
  }
  return false;
}

class Updater {
  constructor({ onUpdateReady, canAutoInstall, beforeInstall } = {}) {
    this.onUpdateReady = onUpdateReady;
    this.canAutoInstall = canAutoInstall || (() => true);
    this.beforeInstall = beforeInstall || (() => {});
    this.readyVersion = null;
    this.autoUpdater = null;
    this.installing = false;
    this.autoInstallTimer = null;
  }

  start() {
    if (!app.isPackaged) return;
    let autoUpdater;
    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch (err) {
      console.error('electron-updater unavailable:', err.message);
      return;
    }
    this.autoUpdater = autoUpdater;
    autoUpdater.autoDownload = true;
    // Enable install-on-quit only after a genuinely newer download is verified.
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('update-downloaded', (info) => {
      const version = info?.version || '';
      if (!isNewerVersion(app.getVersion(), version)) {
        console.log(`updater: ignoring non-newer download ${version} (running ${app.getVersion()})`);
        return;
      }
      this.readyVersion = version;
      autoUpdater.autoInstallOnAppQuit = true;
      this.onUpdateReady?.(this.readyVersion);
      this._scheduleAutoInstall(AUTO_INSTALL_DELAY_MS);
    });
    autoUpdater.on('error', (err) => {
      // Offline/private-repository failures must not interrupt the application.
      console.error('updater:', err.message);
    });

    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    const firstCheck = setTimeout(check, 10000);
    const recurringCheck = setInterval(check, CHECK_INTERVAL_MS);
    firstCheck.unref?.();
    recurringCheck.unref?.();
  }

  state() {
    return {
      ready: !!this.readyVersion,
      version: this.readyVersion,
      installing: this.installing,
      autoInstall: true
    };
  }

  install() {
    return { ok: this._installNow() };
  }

  _scheduleAutoInstall(delay) {
    clearTimeout(this.autoInstallTimer);
    this.autoInstallTimer = setTimeout(() => {
      if (!this.autoUpdater || !this.readyVersion || this.installing) return;
      let safeToInstall = false;
      try {
        safeToInstall = !!this.canAutoInstall();
      } catch (err) {
        console.error('updater: idle check failed:', err.message);
      }
      if (!safeToInstall) {
        this._scheduleAutoInstall(AUTO_INSTALL_RETRY_MS);
        return;
      }
      this._installNow();
    }, delay);
    this.autoInstallTimer.unref?.();
  }

  _installNow() {
    if (!this.autoUpdater || !this.readyVersion || this.installing) return false;
    clearTimeout(this.autoInstallTimer);
    this.installing = true;
    try {
      this.beforeInstall();
    } catch (err) {
      this.installing = false;
      console.error('updater: pre-install flush failed:', err.message);
      this._scheduleAutoInstall(AUTO_INSTALL_RETRY_MS);
      return false;
    }

    // Deferred out of the IPC handler: quitAndInstall tears the app down, and
    // doing that synchronously inside ipcMain.handle can stall quit on Windows.
    setImmediate(() => {
      try {
        this.autoUpdater.quitAndInstall(true, true);
      } catch (err) {
        this.installing = false;
        console.error('quitAndInstall failed:', err.message);
        this._scheduleAutoInstall(AUTO_INSTALL_RETRY_MS);
      }
    });
    return true;
  }
}

module.exports = { Updater, isNewerVersion };
