// Auto-update via GitHub Releases (electron-updater). Only active in the
// packaged app; in dev it's a no-op. Updates download in the background and
// install on quit — or immediately when the user clicks the dashboard banner.
'use strict';
const { app } = require('electron');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

class Updater {
  constructor({ onUpdateReady }) {
    this.onUpdateReady = onUpdateReady;
    this.readyVersion = null;
    this.autoUpdater = null;
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
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-downloaded', (info) => {
      this.readyVersion = info?.version || 'new version';
      this.onUpdateReady?.(this.readyVersion);
    });
    autoUpdater.on('error', (err) => {
      // e.g. repo private / offline — never bother the user about it
      console.error('updater:', err.message);
    });

    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    setTimeout(check, 10000); // let startup settle first
    setInterval(check, CHECK_INTERVAL_MS);
  }

  state() {
    return { ready: !!this.readyVersion, version: this.readyVersion };
  }

  install() {
    if (this.autoUpdater && this.readyVersion) {
      this.autoUpdater.quitAndInstall();
    }
  }
}

module.exports = { Updater };
