'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ensureEntries,
  removeEntry,
  updateEntry
} = require('../src/renderer/dashboard/snippet-model');

test('renderer repairs missing and duplicate snippet IDs', () => {
  let next = 0;
  const entries = ensureEntries([
    { trigger: 'my LinkedIn', text: 'https://linkedin.com/in/me' },
    { id: 'same', trigger: 'my GitHub', text: 'https://github.com/me' },
    { id: 'same', trigger: 'my email', text: 'me@example.com' },
    { id: '   ', trigger: 'my phone', text: '+1 555 0100' }
  ], () => `snippet-${++next}`);

  assert.deepEqual(entries.map((entry) => entry.id), ['snippet-1', 'same', 'snippet-2', 'snippet-3']);
});

test('renderer updates and deletes snippets by stable ID', () => {
  const entries = [
    { id: 'linkedin', trigger: 'my LinkedIn', text: 'old' },
    { id: 'github', trigger: 'my GitHub', text: 'keep' }
  ];
  const updated = updateEntry(entries, 'linkedin', { trigger: 'LinkedIn profile', text: 'new', id: 'wrong' });
  assert.deepEqual(updated, [
    { id: 'linkedin', trigger: 'LinkedIn profile', text: 'new' },
    { id: 'github', trigger: 'my GitHub', text: 'keep' }
  ]);
  assert.deepEqual(removeEntry(updated, 'linkedin'), [
    { id: 'github', trigger: 'my GitHub', text: 'keep' }
  ]);
});
