'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { hardenWindowForProduction, isDevToolsShortcut } = require('../src/main/window-security');

test('recognizes Chromium DevTools shortcuts', () => {
  assert.equal(isDevToolsShortcut({ key: 'F12' }), true);
  assert.equal(isDevToolsShortcut({ key: 'I', control: true, shift: true }), true);
  assert.equal(isDevToolsShortcut({ key: 'j', control: true, shift: true }), true);
  assert.equal(isDevToolsShortcut({ key: 'c', control: true, shift: true }), true);
  assert.equal(isDevToolsShortcut({ key: 'i', meta: true, alt: true }), true);
  assert.equal(isDevToolsShortcut({ key: 'i', control: true }), false);
});

test('production windows block shortcuts and close DevTools if they are opened', () => {
  const webContents = new EventEmitter();
  let menuRemoved = false;
  let devToolsClosed = false;
  let openHandler = null;
  webContents.closeDevTools = () => { devToolsClosed = true; };
  webContents.setWindowOpenHandler = (handler) => { openHandler = handler; };
  const win = {
    removeMenu: () => { menuRemoved = true; },
    webContents
  };

  hardenWindowForProduction(win, true);
  let prevented = false;
  webContents.emit('before-input-event', { preventDefault: () => { prevented = true; } }, {
    key: 'I',
    control: true,
    shift: true
  });
  webContents.emit('devtools-opened');
  let navigationPrevented = false;
  webContents.emit('will-navigate', { preventDefault: () => { navigationPrevented = true; } });

  assert.equal(menuRemoved, true);
  assert.equal(prevented, true);
  assert.equal(devToolsClosed, true);
  assert.deepEqual(openHandler(), { action: 'deny' });
  assert.equal(navigationPrevented, true);
});

test('development keeps DevTools while still blocking navigation and popups', () => {
  const webContents = new EventEmitter();
  let menuRemoved = false;
  let openHandler = null;
  webContents.setWindowOpenHandler = (handler) => { openHandler = handler; };
  const win = {
    removeMenu: () => { menuRemoved = true; },
    webContents
  };

  hardenWindowForProduction(win, false);

  assert.equal(menuRemoved, false);
  assert.equal(webContents.listenerCount('before-input-event'), 0);
  assert.equal(webContents.listenerCount('devtools-opened'), 0);
  assert.equal(webContents.listenerCount('will-navigate'), 1);
  assert.deepEqual(openHandler(), { action: 'deny' });
});

test('all renderer windows enable Chromium sandboxing', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'windows.js'), 'utf8');
  assert.equal((source.match(/sandbox:\s*true/g) || []).length, 3);
  assert.equal((source.match(/nodeIntegration:\s*false/g) || []).length, 3);
  assert.equal((source.match(/contextIsolation:\s*true/g) || []).length, 3);
});

test('production fuses do not require an unbundled browser V8 snapshot', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'after-pack.js'), 'utf8');
  assert.match(source, /LoadBrowserProcessSpecificV8Snapshot\]:\s*false/);
  assert.doesNotMatch(source, /LoadBrowserProcessSpecificV8Snapshot\]:\s*true/);
});
