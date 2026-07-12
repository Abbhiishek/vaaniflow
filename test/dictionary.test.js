'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dictionarySettingsPatch,
  learn,
  migrateLegacyDictionary,
  preferredTerms,
  replacementRules
} = require('../src/main/dictionary');
const { applyReplacements, buildPrompt } = require('../src/main/postprocess');
const { dictionaryInstruction } = require('../src/main/polisher');

test('migrates vocabulary and corrections into unified dictionary entries', () => {
  const { changed, patch } = migrateLegacyDictionary({
    dictionarySchemaVersion: 0,
    vocabulary: 'Abhishek, Vaani, whisper flow',
    replacements: [
      { from: 'whisper flow', to: 'Wispr Flow' },
      { from: 'BTW', to: 'by the way' }
    ]
  });

  assert.equal(changed, true);
  assert.equal(patch.dictionarySchemaVersion, 1);
  assert.deepEqual(
    patch.dictionaryEntries.map(({ from, to }) => ({ from, to })),
    [
      { from: 'Abhishek', to: 'Abhishek' },
      { from: 'Vaani', to: 'Vaani' },
      { from: 'whisper flow', to: 'Wispr Flow' },
      { from: 'BTW', to: 'by the way' }
    ]
  );
});

test('stars prioritize spelling hints without changing deterministic rules', () => {
  const settings = dictionarySettingsPatch([
    { from: 'vani', to: 'Vaani' },
    { from: 'abhishek', to: 'Abhishek', starred: true },
    { from: 'BTW', to: 'by the way' }
  ]);

  assert.deepEqual(preferredTerms(settings).slice(0, 3), ['Abhishek', 'Vaani', 'by the way']);
  assert.match(buildPrompt(settings, ''), /^Preferred spelling: Abhishek, Vaani, by the way\./);
  assert.deepEqual(replacementRules(settings).map(({ from, to }) => ({ from, to })), [
    { from: 'vani', to: 'Vaani' },
    { from: 'abhishek', to: 'Abhishek' },
    { from: 'BTW', to: 'by the way' }
  ]);
});

test('applies personal spellings and expansions after polishing', () => {
  const text = applyReplacements('Btw, whisper flow is for abhishek.', [
    { from: 'BTW', to: 'by the way' },
    { from: 'whisper flow', to: 'Wispr Flow' },
    { from: 'abhishek', to: 'Abhishek' }
  ]);
  assert.equal(text, 'by the way, Wispr Flow is for Abhishek.');
});

test('includes exact dictionary rules in the polish system instruction', () => {
  const instruction = dictionaryInstruction({
    dictionaryEntries: [
      { from: 'abhishek', to: 'Abhishek', starred: true },
      { from: 'BTW', to: 'by the way' }
    ]
  });
  assert.match(instruction, /"abhishek" -> "Abhishek"/);
  assert.match(instruction, /"BTW" -> "by the way"/);
  assert.match(instruction, /authoritative/);
});

test('auto-learning imports repeated high-confidence names directly', () => {
  const store = {
    settings: {
      autoLearnVocabulary: true,
      dictionarySchemaVersion: 1,
      dictionaryEntries: [],
      dictionarySuggestions: {},
      dictionaryDismissed: []
    },
    updateSettings(patch) {
      Object.assign(this.settings, patch);
      return this.settings;
    }
  };

  assert.equal(learn('I met Abhishek today.', store), false);
  assert.equal(learn('I met Abhishek today.', store), false);
  assert.equal(learn('I met Abhishek today.', store), true);
  assert.deepEqual(
    store.settings.dictionaryEntries.map(({ from, to, source }) => ({ from, to, source })),
    [{ from: 'Abhishek', to: 'Abhishek', source: 'learned' }]
  );
});
