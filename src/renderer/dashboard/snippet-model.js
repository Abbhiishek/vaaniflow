'use strict';

(function exposeSnippetModel(root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.VaaniSnippetModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function createId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `snippet-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function ensureEntries(entries, createSnippetId = createId) {
    const usedIds = new Set();
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && entry.trigger && entry.text)
      .map((entry) => {
        let id = String(entry.id || '').trim();
        while (!id || usedIds.has(id)) id = String(createSnippetId());
        usedIds.add(id);
        return { ...entry, id };
      });
  }

  function updateEntry(entries, id, value) {
    return entries.map((entry) => entry.id === id ? { ...entry, ...value, id } : entry);
  }

  function removeEntry(entries, id) {
    return entries.filter((entry) => entry.id !== id);
  }

  return { createId, ensureEntries, removeEntry, updateEntry };
});
