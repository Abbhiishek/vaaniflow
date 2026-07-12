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
  webContents.closeDevTools = () => { devToolsClosed = true; };
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

  assert.equal(menuRemoved, true);
  assert.equal(prevented, true);
  assert.equal(devToolsClosed, true);
});

test('development windows keep DevTools behavior unchanged', () => {
  const webContents = new EventEmitter();
  let menuRemoved = false;
  const win = {
    removeMenu: () => { menuRemoved = true; },
    webContents
  };

  hardenWindowForProduction(win, false);

  assert.equal(menuRemoved, false);
  assert.equal(webContents.listenerCount('before-input-event'), 0);
  assert.equal(webContents.listenerCount('devtools-opened'), 0);
});
