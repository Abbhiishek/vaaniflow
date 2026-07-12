'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Hotkeys, hotkeyLabel, isValidHotkeyId, resolveHotkey } = require('../src/main/hotkeys');

test('accepts and labels recorded custom shortcuts', () => {
  const id = 'custom:Control+Alt+KeyK';
  assert.equal(isValidHotkeyId(id), true);
  assert.equal(hotkeyLabel(id), 'Ctrl + Alt + K');
  assert.equal(resolveHotkey(id).fallbackAccelerator, 'Control+Alt+K');
  assert.equal(isValidHotkeyId('custom:Shift+KeyK'), false, 'typing shortcuts require Ctrl, Alt, or Win');
  assert.equal(isValidHotkeyId('custom:Alt+KeyV'), true);
  assert.equal(hotkeyLabel('custom:Alt+KeyV'), 'Alt + V');
});

test('Alt+V emits live press and release events', () => {
  const hotkeys = new Hotkeys();
  hotkeys.hotkeyId = 'custom:Alt+KeyV';
  const combo = resolveHotkey(hotkeys.hotkeyId);
  const events = [];
  hotkeys.on('primary-down', () => events.push('down'));
  hotkeys.on('primary-up', () => events.push('up'));
  for (const slot of combo.slots) hotkeys._onKey(slot[0], true);
  hotkeys._onKey(combo.slots.at(-1)[0], false);
  assert.deepEqual(events, ['down', 'up']);
});

test('custom shortcut emits live press and release events', () => {
  const hotkeys = new Hotkeys();
  hotkeys.hotkeyId = 'custom:Control+Alt+KeyK';
  const combo = resolveHotkey(hotkeys.hotkeyId);
  const events = [];
  hotkeys.on('primary-down', () => events.push('down'));
  hotkeys.on('primary-up', () => events.push('up'));

  for (const slot of combo.slots) hotkeys._onKey(slot[0], true);
  hotkeys._onKey(combo.slots.at(-1)[0], false);

  assert.deepEqual(events, ['down', 'up']);
});

test('shortcut capture suspension prevents accidental dictation', () => {
  const hotkeys = new Hotkeys();
  hotkeys.hotkeyId = 'custom:Control+Alt+KeyK';
  const combo = resolveHotkey(hotkeys.hotkeyId);
  let triggered = false;
  hotkeys.on('primary-down', () => { triggered = true; });
  hotkeys.setSuspended(true);
  for (const slot of combo.slots) hotkeys._onKey(slot[0], true);
  assert.equal(triggered, false);
});
