'use strict';

(function exposeDictionaryModel(root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.VaaniDictionaryModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function defaultCreateId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `dictionary-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function ensureEntries(entries, createId = defaultCreateId) {
    const usedIds = new Set();
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && entry.from)
      .map((entry) => {
        let id = String(entry.id || '').trim();
        while (!id || usedIds.has(id)) id = String(createId());
        usedIds.add(id);
        return { ...entry, id, to: String(entry.to ?? entry.from) };
      });
  }

  function toggleStar(entries, id) {
    return entries.map((entry) => entry.id === id
      ? { ...entry, starred: !entry.starred }
      : entry);
  }

  function updateEntry(entries, id, value) {
    return entries.map((entry) => entry.id === id ? { ...entry, ...value, id } : entry);
  }

  function removeEntry(entries, id) {
    return entries.filter((entry) => entry.id !== id);
  }

  function findDuplicate(entries, from, excludeId = null) {
    const key = String(from || '').toLocaleLowerCase();
    return entries.find((entry) => entry.id !== excludeId
      && String(entry.from || '').toLocaleLowerCase() === key);
  }

  return { ensureEntries, findDuplicate, removeEntry, toggleStar, updateEntry };
});
