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

test('Space locks an active shortcut without emitting an intrusion', () => {
  const hotkeys = new Hotkeys();
  hotkeys.hotkeyId = 'right-ctrl';
  const combo = resolveHotkey(hotkeys.hotkeyId);
  const spaceCode = resolveHotkey('custom:Alt+Space').slots.at(-1)[0];
  const events = [];
  hotkeys.on('primary-down', () => events.push('down'));
  hotkeys.on('space', () => events.push('space'));
  hotkeys.on('intrude', () => events.push('intrude'));
  hotkeys.on('primary-up', () => events.push('up'));

  hotkeys._onKey(combo.slots[0][0], true);
  hotkeys._onKey(spaceCode, true);
  assert.deepEqual(events, ['down', 'space'], 'Space is handled immediately on key-down');
  hotkeys._onKey(combo.slots[0][0], false);
  hotkeys._onKey(spaceCode, false);

  assert.deepEqual(events, ['down', 'space', 'up']);
});

test('Space remains usable as the primary key in a custom shortcut', () => {
  const hotkeys = new Hotkeys();
  hotkeys.hotkeyId = 'custom:Alt+Space';
  const combo = resolveHotkey(hotkeys.hotkeyId);
  const events = [];
  hotkeys.on('primary-down', () => events.push('down'));
  hotkeys.on('primary-up', () => events.push('up'));
  hotkeys.on('space', () => events.push('space'));

  for (const slot of combo.slots) hotkeys._onKey(slot[0], true);
  hotkeys._onKey(combo.slots.at(-1)[0], false);

  assert.deepEqual(events, ['down', 'up']);
});
