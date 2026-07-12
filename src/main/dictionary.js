// Personal dictionary shared by transcription, AI polishing, and the dashboard.
// Each entry says what speech-to-text may produce (`from`) and the exact text
// VaaniFlow should write (`to`). A name can map to itself to preserve its casing.
'use strict';

const crypto = require('crypto');

const DICTIONARY_SCHEMA_VERSION = 1;
const AUTO_ADD_COUNT = 3;
const MAX_ENTRIES = 500;
const MAX_PENDING_CANDIDATES = 80;
const MAX_FROM_LENGTH = 120;
const MAX_TO_LENGTH = 180;

// Capitalized-but-ordinary words we should never auto-learn.
const STOP_WORDS = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'i', "i'm", "i'll", "i've", "i'd", 'ok', 'okay', 'yeah', 'yes', 'no', 'hey',
  'hello', 'hi', 'thanks', 'thank', 'please', 'sorry', 'god', 'internet',
  'english', 'the', 'and', 'but', 'not', 'you', 'your', 'this', 'that', 'was',
  'are', 'is', 'it', 'its', "it's", 'we', 'our', 'us', 'they', 'them', 'their',
  'he', 'she', 'his', 'her', 'him', 'a', 'an', 'of', 'to', 'in', 'on', 'at',
  'so', 'if', 'or', 'as', 'be', 'by', 'do', 'go', 'me', 'my', 'up', 'am',
  'also', 'just', 'like', 'well', 'now', 'then', 'there', 'here', 'what',
  'when', 'where', 'which', 'who', 'why', 'how', 'because', 'right', 'today',
  'tomorrow', 'yesterday', 'new', 'first', 'second', 'next', 'last'
]);

function cleanValue(value, maxLength) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function entryKey(value) {
  return cleanValue(value, MAX_FROM_LENGTH).toLocaleLowerCase();
}

function normalizeEntry(entry, fallbackSource = 'manual') {
  if (!entry || typeof entry !== 'object') return null;
  const from = cleanValue(entry.from ?? entry.term ?? entry.phrase, MAX_FROM_LENGTH);
  if (!from) return null;
  const hasTarget = Object.prototype.hasOwnProperty.call(entry, 'to')
    || Object.prototype.hasOwnProperty.call(entry, 'replacement');
  const to = cleanValue(hasTarget ? (entry.to ?? entry.replacement) : from, MAX_TO_LENGTH);
  return {
    id: cleanValue(entry.id, 80) || crypto.randomUUID(),
    from,
    to,
    starred: !!entry.starred,
    source: ['manual', 'learned', 'imported'].includes(entry.source) ? entry.source : fallbackSource,
    createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now()
  };
}

function normalizeEntries(entries, fallbackSource = 'manual') {
  const normalized = [];
  const seen = new Set();
  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = normalizeEntry(raw, fallbackSource);
    if (!entry) continue;
    const key = entryKey(entry.from);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(entry);
    if (normalized.length >= MAX_ENTRIES) break;
  }
  return normalized;
}

function upsertEntry(entries, raw, fallbackSource = 'manual') {
  const entry = normalizeEntry(raw, fallbackSource);
  if (!entry) return entries;
  const key = entryKey(entry.from);
  const index = entries.findIndex((item) => entryKey(item.from) === key);
  if (index >= 0) entries[index] = { ...entries[index], ...entry, id: entries[index].id };
  else if (entries.length < MAX_ENTRIES) entries.push(entry);
  return entries;
}

function entriesFromSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const entries = normalizeEntries(source.dictionaryEntries);
  if (entries.length) return entries;

  // Runtime fallback for settings created by older VaaniFlow versions.
  for (const term of String(source.vocabulary || '').split(/[,\n]/)) {
    const value = cleanValue(term, MAX_FROM_LENGTH);
    if (value) upsertEntry(entries, { from: value, to: value, source: 'imported' }, 'imported');
  }
  for (const rule of Array.isArray(source.replacements) ? source.replacements : []) {
    upsertEntry(entries, {
      from: rule?.from,
      to: rule?.to,
      source: 'imported'
    }, 'imported');
  }
  return entries;
}

function preferredTerms(entriesOrSettings) {
  const entries = Array.isArray(entriesOrSettings)
    ? normalizeEntries(entriesOrSettings)
    : entriesFromSettings(entriesOrSettings);
  const seen = new Set();
  const sorted = [...entries].sort((a, b) => Number(b.starred) - Number(a.starred));
  return sorted.map((entry) => entry.to || entry.from).filter((term) => {
    const key = term.toLocaleLowerCase();
    if (!term || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function replacementRules(entriesOrSettings) {
  const entries = Array.isArray(entriesOrSettings)
    ? normalizeEntries(entriesOrSettings)
    : entriesFromSettings(entriesOrSettings);
  return entries
    .map((entry) => ({ id: entry.id, from: entry.from, to: entry.to }))
    .filter((rule) => rule.from);
}

function dictionarySettingsPatch(entries) {
  const normalized = normalizeEntries(entries);
  const terms = preferredTerms(normalized);
  return {
    dictionarySchemaVersion: DICTIONARY_SCHEMA_VERSION,
    dictionaryEntries: normalized,
    // Keep these derived legacy fields so older installs can still read data.
    vocabulary: terms.join(', '),
    replacements: normalized
      .filter((entry) => entry.from !== entry.to)
      .map((entry) => ({ from: entry.from, to: entry.to }))
  };
}

function migrateLegacyDictionary(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  let entries = normalizeEntries(source.dictionaryEntries);
  const needsMigration = Number(source.dictionarySchemaVersion) < DICTIONARY_SCHEMA_VERSION;

  if (needsMigration) {
    for (const term of String(source.vocabulary || '').split(/[,\n]/)) {
      const value = cleanValue(term, MAX_FROM_LENGTH);
      if (value) upsertEntry(entries, { from: value, to: value, source: 'imported' }, 'imported');
    }
    for (const rule of Array.isArray(source.replacements) ? source.replacements : []) {
      upsertEntry(entries, {
        from: rule?.from,
        to: rule?.to,
        source: 'imported'
      }, 'imported');
    }
  }

  const patch = dictionarySettingsPatch(entries);
  const changed = needsMigration || JSON.stringify(source.dictionaryEntries || []) !== JSON.stringify(patch.dictionaryEntries);
  return { changed, patch };
}

// Tokens worth learning: proper nouns mid-sentence, ALL-CAPS acronyms, camelCase.
function extractCandidates(text) {
  const candidates = [];
  const seen = new Set();
  const sentences = String(text || '').split(/(?<=[.!?\n])\s+|\n/);
  for (const sentence of sentences) {
    const tokens = sentence.match(/[\p{L}][\p{L}'’-]{1,39}/gu) || [];
    tokens.forEach((token, index) => {
      const lower = token.toLocaleLowerCase();
      if (STOP_WORDS.has(lower) || seen.has(lower)) return;
      const isAcronym = /^[A-Z]{2,8}$/.test(token);
      const isCamel = /^[a-zA-Z]+[A-Z][a-z]/.test(token) && !/^[A-Z]+$/.test(token);
      const isProperMidSentence = index > 0 && /^\p{Lu}[\p{Ll}’'-]+$/u.test(token) && token.length >= 3;
      if (isAcronym || isCamel || isProperMidSentence) {
        seen.add(lower);
        candidates.push(token);
      }
    });
  }
  return candidates;
}

// Learns quietly in the background. Candidates are counted internally and are
// imported directly after repeated use; there is no separate suggestion inbox.
// Returns true only when the visible dictionary gained a new entry.
function learn(text, store) {
  const settings = store.settings;
  if (settings.autoLearnVocabulary === false) return false;

  const entries = entriesFromSettings(settings);
  const known = new Set(entries.flatMap((entry) => [entryKey(entry.from), entryKey(entry.to)]));
  const dismissed = new Set((settings.dictionaryDismissed || []).map(entryKey));
  const counts = { ...(settings.dictionarySuggestions || {}) };
  let imported = false;
  let changed = false;

  for (const word of extractCandidates(text)) {
    const lower = entryKey(word);
    if (known.has(lower) || dismissed.has(lower)) continue;
    const key = Object.keys(counts).find((item) => entryKey(item) === lower) || word;
    counts[key] = (Number(counts[key]) || 0) + 1;
    changed = true;
    if (counts[key] >= AUTO_ADD_COUNT) {
      upsertEntry(entries, { from: word, to: word, source: 'learned' }, 'learned');
      known.add(lower);
      delete counts[key];
      imported = true;
    }
  }

  if (!changed) return false;
  const trimmed = Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, MAX_PENDING_CANDIDATES)
  );
  store.updateSettings({ ...dictionarySettingsPatch(entries), dictionarySuggestions: trimmed });
  return imported;
}

module.exports = {
  DICTIONARY_SCHEMA_VERSION,
  dictionarySettingsPatch,
  entriesFromSettings,
  extractCandidates,
  learn,
  migrateLegacyDictionary,
  normalizeEntries,
  preferredTerms,
  replacementRules
};
