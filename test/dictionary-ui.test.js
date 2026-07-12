'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ensureEntries,
  findDuplicate,
  removeEntry,
  toggleStar,
  updateEntry
} = require('../src/renderer/dashboard/dictionary-model');

function entriesWithoutIds() {
  let nextId = 0;
  return ensureEntries([
    { from: 'vani', to: 'Vaani', starred: false },
    { from: 'Abhishek', to: 'Abhishek', starred: false },
    { from: 'BTW', to: 'by the way', starred: false }
  ], () => `entry-${++nextId}`);
}

test('renderer repairs missing IDs and stars only the selected entry', () => {
  const entries = entriesWithoutIds();
  const result = toggleStar(entries, 'entry-2');

  assert.deepEqual(result.map((entry) => entry.starred), [false, true, false]);
  assert.deepEqual(result.map((entry) => entry.id), ['entry-1', 'entry-2', 'entry-3']);
});

test('renderer edits the selected entry without treating it as a duplicate', () => {
  const entries = entriesWithoutIds();
  assert.equal(findDuplicate(entries, 'Abhishek', 'entry-2'), undefined);

  const result = updateEntry(entries, 'entry-2', { from: 'Abhishek', to: 'Abhishek Kushwaha' });
  assert.equal(result.length, 3);
  assert.equal(result[1].to, 'Abhishek Kushwaha');
  assert.equal(result[1].id, 'entry-2');
});

test('renderer deletes only the confirmed entry', () => {
  const entries = entriesWithoutIds();
  const result = removeEntry(entries, 'entry-2');

  assert.deepEqual(result.map((entry) => entry.id), ['entry-1', 'entry-3']);
  assert.deepEqual(result.map((entry) => entry.from), ['vani', 'BTW']);
});
