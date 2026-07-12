'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Updater, isNewerVersion } = require('../src/main/updater');

test('accepts only strictly newer release versions', () => {
  assert.equal(isNewerVersion('1.0.1', '1.0.2'), true);
  assert.equal(isNewerVersion('1.0.1', 'v1.1.0'), true);
  assert.equal(isNewerVersion('1.0.1', '1.0.1'), false);
  assert.equal(isNewerVersion('1.0.2', '1.0.1'), false);
});

test('automatically installs a downloaded update after flushing data', async () => {
  let flushed = false;
  let installed = false;
  const updater = new Updater({
    canAutoInstall: () => true,
    beforeInstall: () => { flushed = true; }
  });
  updater.autoUpdater = {
    quitAndInstall(silent, forceRun) {
      installed = silent && forceRun;
    }
  };
  updater.readyVersion = '1.0.2';

  updater._scheduleAutoInstall(0);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(flushed, true);
  assert.equal(installed, true);
  assert.equal(updater.installing, true);
});
