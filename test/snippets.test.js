'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');
const { buildPrompt } = require('../src/main/postprocess');
const { buildPolishInstruction, enforceStyle } = require('../src/main/polisher');
const {
  DEFAULT_SNIPPETS,
  expandSnippets,
  normalizeSnippets,
  restoreSnippets,
  snippetTokensPreserved
} = require('../src/main/snippets');

function tempUserData(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaaniflow-snippets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('seeds starter snippets once and preserves a user-deleted empty list', (t) => {
  const dir = tempUserData(t);
  const first = new Store(dir);
  assert.equal(first.settings.snippetSchemaVersion, 1);
  assert.deepEqual(first.settings.snippets.map((snippet) => snippet.trigger), DEFAULT_SNIPPETS.map((snippet) => snippet.trigger));

  first.updateSettings({ snippets: [] });
  first.flush();
  const reloaded = new Store(dir);
  assert.equal(reloaded.settings.snippets.length, 0);
});

test('adds starter snippets without replacing an existing legacy snippet', (t) => {
  const dir = tempUserData(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    snippets: [{ trigger: 'my GitHub', text: 'https://github.com/me' }]
  }));
  const store = new Store(dir);
  assert.equal(store.settings.snippets.length, DEFAULT_SNIPPETS.length + 1);
  assert.equal(store.settings.snippets[0].trigger, 'my GitHub');
  assert.ok(store.settings.snippets.every((snippet) => snippet.id));
});

test('repairs missing, blank, and duplicate persisted snippet IDs', () => {
  const repaired = normalizeSnippets([
    { trigger: 'one', text: 'First' },
    { id: 'same', trigger: 'two', text: 'Second' },
    { id: 'same', trigger: 'three', text: 'Third' },
    { id: '   ', trigger: 'four', text: 'Fourth' }
  ]);
  assert.equal(repaired.length, 4);
  assert.ok(repaired.every((snippet) => snippet.id && snippet.id.trim()));
  assert.equal(new Set(repaired.map((snippet) => snippet.id)).size, 4);
});

test('repairs persisted snippet IDs even when the schema is already current', (t) => {
  const dir = tempUserData(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    snippetSchemaVersion: 1,
    snippets: [
      { trigger: 'my LinkedIn', text: 'https://linkedin.com/in/me' },
      { id: 'duplicate', trigger: 'my GitHub', text: 'https://github.com/me' },
      { id: 'duplicate', trigger: 'my email', text: 'me@example.com' }
    ]
  }));

  const store = new Store(dir);
  assert.ok(store.settings.snippets.every((snippet) => snippet.id));
  assert.equal(new Set(store.settings.snippets.map((snippet) => snippet.id)).size, 3);
});

test('expands standalone snippets despite casing, punctuation, and camel-case spacing', () => {
  const result = expandSnippets('Insert my linked in.', [
    { id: 'linkedin', trigger: 'my LinkedIn', text: 'https://linkedin.com/in/me' }
  ]);
  assert.equal(result.standalone, true);
  assert.equal(result.text, 'https://linkedin.com/in/me');
});

test('protects inline snippets during polish and restores expansions verbatim', () => {
  const result = expandSnippets('Please send my LinkedIn and my email address.', [
    { id: 'linkedin', trigger: 'my LinkedIn', text: 'https://linkedin.com/in/me' },
    { id: 'email', trigger: 'my email address', text: 'me@example.com' }
  ]);
  assert.equal(result.standalone, false);
  assert.equal(result.matches.length, 2);
  assert.equal(snippetTokensPreserved(result.text, result.matches), true);

  const polished = result.text.replace(/^Please/, 'Could you').replace(/\.$/, '?');
  assert.deepEqual(restoreSnippets(polished, result.matches), {
    text: 'Could you send https://linkedin.com/in/me and me@example.com?',
    complete: true
  });
});

test('removes explicit paste commands and prefers the longest trigger', () => {
  const result = expandSnippets('Paste my email address here.', [
    { id: 'short', trigger: 'my email', text: 'wrong@example.com' },
    { id: 'long', trigger: 'my email address', text: 'right@example.com' }
  ]);
  assert.equal(result.text, '[[VAANI_SNIPPET_0]] here.');
  assert.equal(restoreSnippets(result.text, result.matches).text, 'right@example.com here.');
});

test('falls back safely when polishing drops a protected token', () => {
  const result = expandSnippets('Send my signature please.', [
    { id: 'signature', trigger: 'my signature', text: 'Best,\nAbhishek' }
  ]);
  assert.equal(snippetTokensPreserved('Send it please.', result.matches), false);
  assert.equal(restoreSnippets('Send it please.', result.matches).complete, false);
  assert.equal(restoreSnippets(result.text, result.matches).text, 'Send Best,\nAbhishek please.');
});

test('feeds snippet triggers to Whisper and protects markers in polish instructions', () => {
  const settings = {
    snippets: [{ trigger: 'my LinkedIn', text: 'https://linkedin.com/in/me' }],
    cleanupLevel: 'light',
    otherStyle: 'formal'
  };
  assert.match(buildPrompt(settings, ''), /Saved snippet phrases: my LinkedIn\./);
  assert.match(buildPolishInstruction(settings, { category: 'other', variant: 'formal' }), /\[\[VAANI_SNIPPET_0\]\]/);
  assert.equal(
    enforceStyle('Send [[VAANI_SNIPPET_0]] please.', { category: 'personal', variant: 'very-casual' }, { language: 'en' }),
    'send [[VAANI_SNIPPET_0]] please'
  );
});
