'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SystemAudioMute } = require('../src/main/system-audio');

test('Windows system audio helper compiles and reads the endpoint mute state', { skip: process.platform !== 'win32' }, async (t) => {
  const audio = new SystemAudioMute();
  t.after(() => audio.stop());
  assert.deepEqual(await audio.ping(), { ok: true, payload: null });
  const status = await audio.status();
  assert.equal(status.ok, true);
  assert.match(status.payload, /^(muted|unmuted)$/);
});
