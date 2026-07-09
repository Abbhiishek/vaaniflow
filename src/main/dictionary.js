// Learns the user's unique words automatically: after each dictation, proper
// nouns / acronyms / camelCase tokens that aren't common English are counted.
// Frequent candidates either surface as suggestions on the Dictionary page or,
// with auto-learn on, graduate straight into the vocabulary.
'use strict';

const AUTO_ADD_COUNT = 3; // seen this many times → auto-add (when enabled)
const MAX_SUGGESTIONS = 60;

// capitalized-but-ordinary words we should never suggest
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

// tokens worth learning: proper nouns mid-sentence, ALL-CAPS acronyms, camelCase
function extractCandidates(text) {
  const candidates = [];
  const sentences = String(text || '').split(/(?<=[.!?\n])\s+|\n/);
  for (const sentence of sentences) {
    const tokens = sentence.match(/[\p{L}][\p{L}'’-]{1,29}/gu) || [];
    tokens.forEach((tok, i) => {
      const lower = tok.toLowerCase();
      if (STOP_WORDS.has(lower)) return;
      const isAcronym = /^[A-Z]{2,6}$/.test(tok);
      const isCamel = /^[a-zA-Z]+[A-Z][a-z]/.test(tok) && !/^[A-Z]+$/.test(tok);
      const isProperMidSentence = i > 0 && /^[A-Z][a-z’'-]+$/.test(tok) && tok.length >= 3;
      if (isAcronym || isCamel || isProperMidSentence) candidates.push(tok);
    });
  }
  return candidates;
}

// Returns true when settings changed (suggestions updated or vocab grew).
function learn(text, store) {
  const settings = store.settings;
  if (settings.autoLearnVocabulary === false) return false;

  const vocab = new Set(
    String(settings.vocabulary || '')
      .split(/[,\n]/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
  );
  const dismissed = new Set((settings.dictionaryDismissed || []).map((w) => w.toLowerCase()));

  const counts = { ...(settings.dictionarySuggestions || {}) };
  const autoAdded = [];
  let changed = false;

  for (const word of extractCandidates(text)) {
    const lower = word.toLowerCase();
    if (vocab.has(lower) || dismissed.has(lower)) continue;
    // count under the first-seen casing
    const key = Object.keys(counts).find((k) => k.toLowerCase() === lower) || word;
    counts[key] = (counts[key] || 0) + 1;
    changed = true;
    if (counts[key] >= AUTO_ADD_COUNT && !autoAdded.includes(key)) {
      autoAdded.push(key);
    }
  }
  if (!changed) return false;

  let vocabulary = settings.vocabulary || '';
  for (const word of autoAdded) {
    delete counts[word];
    vocabulary = vocabulary.trim() ? `${vocabulary.trim()}, ${word}` : word;
    vocab.add(word.toLowerCase());
  }

  // keep the suggestion list bounded, highest counts win
  const trimmed = Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, MAX_SUGGESTIONS)
  );

  store.updateSettings({ dictionarySuggestions: trimmed, vocabulary });
  return true;
}

module.exports = { learn, extractCandidates };
