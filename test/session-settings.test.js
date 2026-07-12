'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Session } = require('../src/main/session');

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('shortcut press starts the Vaani widget with live settings', async () => {
  const messages = [];
  const overlay = { isDestroyed: () => false, webContents: { send: (channel, payload) => messages.push({ channel, payload }) } };
  const session = new Session({
    store: {},
    injector: { foreground: async () => null },
    getOverlay: () => overlay,
    getRuntimeSettings: () => ({ micDeviceId: 'microphone-2', sounds: true, fastMode: true, autoStopSec: 8 }),
    systemAudio: null
  });
  const dashboardStates = [];
  session.on('ui-state', (payload) => dashboardStates.push(payload.type));

  session.onPrimaryDown();
  assert.equal(session.state, 'recording');
  assert.deepEqual(messages[0], {
    channel: 'session',
    payload: { type: 'start', mode: 'ptt', micDeviceId: 'microphone-2', sounds: true, fastMode: true, autoStopSec: 8 }
  });
  assert.deepEqual(dashboardStates, ['start']);

  session.downAt = Date.now() - 500;
  session.onPrimaryUp();
  await nextTurn();
  assert.equal(session.state, 'processing');
  assert.equal(messages.at(-1).payload.type, 'processing');
  session.onAudioError('test complete');
});

test('music mute is applied after the start cue and restored before processing', async () => {
  const actions = [];
  const overlay = { isDestroyed: () => false, webContents: { send: (channel, payload) => actions.push(payload.type) } };
  const systemAudio = {
    available: true,
    mute: async () => { actions.push('mute'); return { ok: true }; },
    restore: async () => { actions.push('restore'); return { ok: true }; }
  };
  const session = new Session({
    store: {}, injector: { foreground: async () => null }, getOverlay: () => overlay,
    getRuntimeSettings: () => ({ muteMusicWhileDictating: true, sounds: true }), systemAudio
  });

  session.onPrimaryDown();
  await new Promise((resolve) => setTimeout(resolve, 180));
  session.downAt = Date.now() - 500;
  session.onPrimaryUp();
  await nextTurn();

  assert.deepEqual(actions.slice(0, 4), ['start', 'mute', 'restore', 'processing']);
  session.onAudioError('test complete');
});
