// Auto-update via GitHub Releases (electron-updater). Only active in the
// packaged app; in dev it's a no-op. Updates download in the background and
// install on quit — or immediately when the user clicks the dashboard banner.
'use strict';
const { app } = require('electron');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// True when b is a strictly newer x.y.z than a. electron-updater mostly checks
// this itself, but a stale cached installer can re-fire update-downloaded for
// the version we're already running — never surface those.
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
    // Install-on-quit only once a genuinely newer version is verified below —
    // otherwise a stale cached installer can downgrade the app on exit.
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
    if (!this.autoUpdater || !this.readyVersion) return { ok: false };
    // Deferred out of the IPC handler — quitAndInstall tears the app down, and
    // doing that synchronously inside an ipcMain.handle callback stalls the
    // quit on Windows. Silent install + force-run brings the new version back.
    setImmediate(() => {
      try {
        this.autoUpdater.quitAndInstall(true, true);
      } catch (err) {
        console.error('quitAndInstall failed:', err.message);
      }
    });
    return { ok: true };
  }
}

module.exports = { Updater };
