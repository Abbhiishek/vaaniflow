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
    if (!presets()[hotkeyId]) return;
    this.hotkeyId = hotkeyId;
    this.pressed.clear();
    this.comboActive = false;
    if (this.usingFallback) {
      globalShortcut.unregisterAll();
      this._registerFallback();
    }
  }

  _combo() {
    return presets()[this.hotkeyId] || presets()['ctrl+win'];
  }

  _comboSatisfied() {
    return this._combo().slots.every((slot) => slot.some((code) => code != null && this.pressed.has(code)));
  }

  _isComboKey(code) {
    return this._combo().slots.some((slot) => slot.includes(code));
  }

  _onKey(code, down) {
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
      globalShortcut.register(acc, () => {
        this.emit('primary-down');
        setTimeout(() => this.emit('primary-up'), 10);
      });
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

module.exports = { Hotkeys, HOTKEY_LABELS, uiohookAvailable: !!uIOhook };
