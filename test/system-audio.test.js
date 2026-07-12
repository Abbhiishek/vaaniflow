'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SystemAudioMute } = require('../src/main/system-audio');

test('Windows system audio helper compiles and reports endpoint status', { skip: process.platform !== 'win32' }, async (t) => {
  const audio = new SystemAudioMute();
  t.after(() => audio.stop());
  assert.deepEqual(await audio.ping(), { ok: true, payload: null });
  const status = await audio.status();
  if (!status.ok) {
    // Headless Windows runners may not expose a default render endpoint.
    assert.equal(typeof status.message, 'string');
    assert.ok(status.message.length > 0);
    return;
  }
  assert.match(status.payload, /^(muted|unmuted)$/);
});
