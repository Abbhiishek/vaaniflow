// Global keyboard listening via uiohook-napi (N-API — works in Electron without rebuild).
// Emits: 'primary-down', 'primary-up', 'space', 'escape'.
// Falls back to Electron globalShortcut (toggle-only) if the native hook can't load.
'use strict';
const { EventEmitter } = require('events');
const { globalShortcut } = require('electron');

let uIOhook = null;
let UiohookKey = null;
try {
  ({ uIOhook, UiohookKey } = require('uiohook-napi'));
} catch (err) {
  console.error('uiohook-napi failed to load, falling back to globalShortcut:', err.message);
}

const MODIFIER_CODES = {
  Control: ['Ctrl', 'CtrlRight'],
  Shift: ['Shift', 'ShiftRight'],
  Alt: ['Alt', 'AltRight'],
  Meta: ['Meta', 'MetaRight']
};

const MODIFIER_LABELS = {
  Control: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
  Meta: process.platform === 'darwin' ? 'Command' : 'Win'
};

const MODIFIER_ACCELERATORS = {
  Control: 'Control',
  Shift: 'Shift',
  Alt: 'Alt',
  Meta: 'Super'
};

function customKeyName(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const names = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
    Semicolon: 'Semicolon', Equal: 'Equal', Comma: 'Comma', Minus: 'Minus', Period: 'Period', Slash: 'Slash',
    Backquote: 'Backquote', BracketLeft: 'BracketLeft', Backslash: 'Backslash', BracketRight: 'BracketRight', Quote: 'Quote'
  };
  return names[code] || null;
}

function keyLabel(code) {
  const key = customKeyName(code);
  if (!key) return '';
  const labels = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    PageUp: 'Page Up', PageDown: 'Page Down', Insert: 'Insert', Delete: 'Delete',
    Semicolon: ';', Equal: '=', Comma: ',', Minus: '-', Period: '.', Slash: '/',
    Backquote: '`', BracketLeft: '[', Backslash: '\\', BracketRight: ']', Quote: "'"
  };
  return labels[key] || key;
}

function keyAccelerator(code) {
  const key = customKeyName(code);
  if (!key) return null;
  const names = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
    Semicolon: ';', Equal: '=', Comma: ',', Minus: '-', Period: '.', Slash: '/',
    Backquote: '`', BracketLeft: '[', Backslash: '\\', BracketRight: ']', Quote: "'"
  };
  return names[key] || key;
}

function keyUiohookCodes(code) {
  if (!UiohookKey) return [];
  const name = customKeyName(code);
  if (!name) return [];
  const value = UiohookKey[name];
  return value == null ? [] : [value];
}

function parseCustomHotkey(id) {
  if (typeof id !== 'string' || !id.startsWith('custom:')) return null;
  const parts = id.slice(7).split('+').filter(Boolean);
  const code = parts.pop();
  const modifiers = [...new Set(parts)];
  if (!code || !customKeyName(code)) return null;
  if (modifiers.some((modifier) => !MODIFIER_CODES[modifier])) return null;
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(code);
  if (!functionKey && !modifiers.some((modifier) => ['Control', 'Alt', 'Meta'].includes(modifier))) return null;
  return { modifiers, code };
}

function hotkeyLabel(id) {
  const preset = presets()[id];
  if (preset) return preset.label;
  const custom = parseCustomHotkey(id);
  if (!custom) return '';
  return [...custom.modifiers.map((modifier) => MODIFIER_LABELS[modifier]), keyLabel(custom.code)].join(' + ');
}

function resolveHotkey(id) {
  const preset = presets()[id];
  if (preset) return preset;
  const custom = parseCustomHotkey(id);
  if (!custom) return null;
  const slots = custom.modifiers.map((modifier) => MODIFIER_CODES[modifier]
    .map((name) => UiohookKey?.[name])
    .filter((code) => code != null));
  const keyCodes = keyUiohookCodes(custom.code);
  if (UiohookKey && !keyCodes.length) return null;
  slots.push(keyCodes);
  return {
    label: hotkeyLabel(id),
    slots,
    fallbackAccelerator: [
      ...custom.modifiers.map((modifier) => MODIFIER_ACCELERATORS[modifier]),
      keyAccelerator(custom.code)
    ].join('+')
  };
}

function isValidHotkeyId(id) {
  return !!resolveHotkey(id);
}

// Each preset is a list of "slots"; a slot is satisfied when any of its keycodes is held.
function presets() {
  const K = UiohookKey || {};
  return {
    'ctrl+win': { label: 'Ctrl + Win', slots: [[K.Ctrl, K.CtrlRight], [K.Meta, K.MetaRight]], fallbackAccelerator: 'Control+Super+D' },
    'ctrl+shift': { label: 'Ctrl + Shift', slots: [[K.Ctrl, K.CtrlRight], [K.Shift, K.ShiftRight]], fallbackAccelerator: 'F9' },
    'ctrl+alt': { label: 'Ctrl + Alt', slots: [[K.Ctrl, K.CtrlRight], [K.Alt, K.AltRight]], fallbackAccelerator: 'F9' },
    'right-ctrl': { label: 'Right Ctrl', slots: [[K.CtrlRight]], fallbackAccelerator: 'F9' },
    'right-alt': { label: 'Right Alt', slots: [[K.AltRight]], fallbackAccelerator: 'F9' },
    f9: { label: 'F9', slots: [[K.F9]], fallbackAccelerator: 'F9' }
  };
}

const HOTKEY_LABELS = Object.fromEntries(
  Object.entries(presets()).map(([id, p]) => [id, p.label])
);

class Hotkeys extends EventEmitter {
  constructor() {
    super();
    this.hotkeyId = 'ctrl+win';
    this.pressed = new Set();
    this.comboActive = false;
    this.started = false;
    this.usingFallback = !uIOhook;
    this.suspended = false;
  }

  start(hotkeyId) {
    this.hotkeyId = hotkeyId || this.hotkeyId;
    if (this.started) return;
    this.started = true;

    if (!uIOhook) {
      this._registerFallback();
      return;
    }

    uIOhook.on('keydown', (e) => this._onKey(e.keycode, true));
    uIOhook.on('keyup', (e) => this._onKey(e.keycode, false));
    try {
      uIOhook.start();
    } catch (err) {
      console.error('uiohook start failed, using fallback:', err.message);
      this.usingFallback = true;
      this._registerFallback();
    }
  }

  setHotkey(hotkeyId) {
    if (!isValidHotkeyId(hotkeyId)) return false;
    this.hotkeyId = hotkeyId;
    this.pressed.clear();
    this.comboActive = false;
    if (this.usingFallback) {
      globalShortcut.unregisterAll();
      this._registerFallback();
    }
    return true;
  }

  setSuspended(suspended) {
    this.suspended = !!suspended;
    this.pressed.clear();
    this.comboActive = false;
  }

  _combo() {
    return resolveHotkey(this.hotkeyId) || presets()['ctrl+win'];
  }

  _comboSatisfied() {
    return this._combo().slots.every((slot) => slot.some((code) => code != null && this.pressed.has(code)));
  }

  _isComboKey(code) {
    return this._combo().slots.some((slot) => slot.includes(code));
  }

  _onKey(code, down) {
    if (this.suspended) return;
    if (down) {
      // uiohook repeats keydown while held; only track transitions
      if (this.pressed.has(code)) return;
      this.pressed.add(code);
      if (!this.comboActive && this._isComboKey(code) && this._comboSatisfied()) {
        this.comboActive = true;
        this.emit('primary-down');
      } else if (this.comboActive && !this._isComboKey(code)) {
        // combo+other key = an app shortcut (e.g. Ctrl+Shift+T), not dictation
        this.emit('intrude');
      }
    } else {
      this.pressed.delete(code);
      if (this.comboActive && this._isComboKey(code) && !this._comboSatisfied()) {
        this.comboActive = false;
        this.emit('primary-up');
      }
      if (UiohookKey) {
        if (code === UiohookKey.Space) this.emit('space');
        if (code === UiohookKey.Escape) this.emit('escape');
      }
    }
  }

  // Fallback: no key-up events available, so emulate a "tap" (down+up) —
  // the session layer turns taps into hands-free toggle.
  _registerFallback() {
    const acc = this._combo().fallbackAccelerator || 'F9';
    try {
      const registered = globalShortcut.register(acc, () => {
        this.emit('primary-down');
        setTimeout(() => this.emit('primary-up'), 10);
      });
      if (!registered) console.error(`globalShortcut fallback could not register ${acc}`);
    } catch (err) {
      console.error('globalShortcut fallback failed:', err.message);
    }
  }

  stop() {
    if (uIOhook && !this.usingFallback) {
      try { uIOhook.stop(); } catch {}
    }
    globalShortcut.unregisterAll();
    this.started = false;
  }
}

module.exports = {
  Hotkeys,
  HOTKEY_LABELS,
  uiohookAvailable: !!uIOhook,
  hotkeyLabel,
  isValidHotkeyId,
  parseCustomHotkey,
  resolveHotkey
};
