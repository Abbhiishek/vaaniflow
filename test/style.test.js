'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectStyleCategory, pickStyle } = require('../src/main/tones');
const { buildPolishInstruction, enforceStyle } = require('../src/main/polisher');
const { buildPrompt } = require('../src/main/postprocess');

test('detects personal, work, email, and other app categories', () => {
  assert.equal(detectStyleCategory({ app: 'WhatsApp', title: 'Family' }), 'personal');
  assert.equal(detectStyleCategory({ app: 'Discord', title: 'Friends' }), 'personal');
  assert.equal(detectStyleCategory({ app: 'chrome', title: 'LinkedIn — Messages' }), 'work');
  assert.equal(detectStyleCategory({ app: 'chrome', title: 'Inbox (4) - Gmail' }), 'email');
  assert.equal(detectStyleCategory({ app: 'Code', title: 'style.test.js' }), 'other');
  assert.equal(detectStyleCategory({ app: 'chrome', title: 'ChatGPT' }), 'other');
});

test('picks the saved style for the detected category', () => {
  const settings = {
    personalStyle: 'very-casual',
    workStyle: 'excited',
    emailStyle: 'casual',
    otherStyle: 'formal'
  };
  assert.deepEqual(pickStyle({ app: 'Telegram' }, settings), { category: 'personal', variant: 'very-casual' });
  assert.deepEqual(pickStyle({ app: 'Slack' }, settings), { category: 'work', variant: 'excited' });
  assert.deepEqual(pickStyle({ app: 'Outlook' }, settings), { category: 'email', variant: 'casual' });
  assert.deepEqual(pickStyle({ app: 'Code' }, settings), { category: 'other', variant: 'formal' });
});

test('builds distinct cleanup instructions without allowing added content', () => {
  const base = { language: 'en' };
  const none = buildPolishInstruction({ ...base, cleanupLevel: 'none' }, { category: 'personal', variant: 'formal' });
  const light = buildPolishInstruction({ ...base, cleanupLevel: 'light' }, { category: 'work', variant: 'casual' });
  const medium = buildPolishInstruction({ ...base, cleanupLevel: 'medium' }, { category: 'email', variant: 'excited' });
  assert.match(none, /Keep every spoken word in the same order/);
  assert.match(light, /Remove filler words/);
  assert.match(medium, /clarity and conciseness/);
  assert.match(medium, /Never answer a question/);
  assert.match(medium, /never.*invent a greeting or sign-off/i);
});

test('enforces visible formatting promises after polishing', () => {
  assert.equal(
    enforceStyle("Hey, are you free for lunch tomorrow? Let's do 12!", { category: 'personal', variant: 'very-casual' }, { language: 'en' }),
    'hey are you free for lunch tomorrow lets do 12'
  );
  assert.equal(
    enforceStyle('hey if you are free lets chat about the great results.', { category: 'work', variant: 'excited' }, { language: 'en' }),
    'Hey if you are free lets chat about the great results!'
  );
  assert.equal(
    enforceStyle('hey are you free for lunch tomorrow.', { category: 'personal', variant: 'casual' }, { language: 'en' }),
    'Hey are you free for lunch tomorrow'
  );
});

test('does not force English-only formatting onto configured non-English dictation', () => {
  assert.equal(
    enforceStyle('Bonjour, comment ça va?', { category: 'personal', variant: 'very-casual' }, { language: 'fr' }),
    'Bonjour, comment ça va?'
  );
});

test('None cleanup nudges Whisper to retain filler words', () => {
  const prompt = buildPrompt({ cleanupLevel: 'none', dictionaryEntries: [] }, 'previous words');
  assert.match(prompt, /Umm, let me think/);
  assert.match(prompt, /previous words$/);
});
