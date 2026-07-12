// Cleans raw Whisper output: artifacts, spoken commands, snippets, corrections.
'use strict';
const { preferredTerms } = require('./dictionary');
const {
  expandSnippets,
  restoreSnippets,
  snippetTokensPreserved
} = require('./snippets');

// non-speech annotations whisper.cpp likes to emit
const NOISE_WORDS = /^(blank[_ ]?audio|music|upbeat music|applause|laugh(ter|s|ing)?|chuckles?|noise|silence|silent|inaudible|indistinct|cough(s|ing)?|clears? throat|sigh(s|ing)?|breath(es|ing)?|sniff(s|ing)?|sneezes?|beep(s|ing)?|static|typing|clicking|door .*|footsteps|birds? chirping|wind blowing|speaking foreign language|foreign language|no audio|no speech)$/i;

// Collapse whitespace but preserve intentional newlines (spoken "new line" etc.)
function tidy(text) {
  return String(text || '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\n]+([,.!?;:])/g, '$1')
    .trim();
}

// Phrases Whisper hallucinates on near-silent audio (training-data residue from
// video captions). Dropped only when they are the ENTIRE chunk — a dictated
// "thanks for watching" inside a longer sentence survives. Deliberately does
// not include bare "thank you": people genuinely dictate that.
// entries are pre-normalized: lowercase, punctuation collapsed to single spaces
const HALLUCINATED_CHUNKS = new Set([
  'thanks for watching', 'thank you for watching', 'thanks for listening',
  'thank you for listening', 'please subscribe', 'subscribe to my channel',
  'like and subscribe', 'see you in the next video', 'see you next time',
  'subtitles by the amara org community', 'transcribed by otter ai',
  'www youtube com'
]);

function isHallucinatedChunk(text) {
  const norm = String(text || '').toLowerCase().replace(/[.!?,'’"\s]+/g, ' ').trim();
  return HALLUCINATED_CHUNKS.has(norm);
}

// Strip [BLANK_AUDIO]-style artifacts. Bracketed/asterisked segments are always
// annotations; parenthesized ones only when they match known noise words (so a
// genuinely dictated parenthetical survives).
function cleanArtifacts(text) {
  let t = String(text || '');
  t = t.replace(/\[[^\]\n]{0,60}\]/g, ' ');
  t = t.replace(/\*[^*\n]{0,60}\*/g, ' ');
  t = t.replace(/♪[^♪\n]*♪?/g, ' ');
  t = t.replace(/\(([^)\n]{0,60})\)/g, (m, inner) => (NOISE_WORDS.test(inner.trim()) ? ' ' : m));
  t = tidy(t);
  return isHallucinatedChunk(t) ? '' : t;
}

// rules: [{ from, to }] — case-insensitive; whole-word when the pattern looks word-like
function applyReplacements(text, rules) {
  let t = String(text || '');
  const ordered = [...(Array.isArray(rules) ? rules : [])]
    .sort((a, b) => String(b?.from || '').length - String(a?.from || '').length);
  for (const rule of ordered) {
    const from = String(rule?.from || '').trim();
    if (!from) continue;
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordLike = /^[\p{L}\p{N}_]/u.test(from) && /[\p{L}\p{N}_]$/u.test(from);
    try {
      const pattern = wordLike
        ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`
        : esc;
      t = t.replace(new RegExp(pattern, 'giu'), String(rule.to ?? ''));
    } catch {}
  }
  return tidy(t);
}

// "scratch that" / "strike that" — drop the sentence spoken before the marker
function applyScratchThat(text) {
  let t = String(text || '');
  const re = /\s*\b(?:scratch|strike) that\b[.,!?]?\s*/i;
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(0, m.index);
    const after = t.slice(m.index + m[0].length);
    const sentences = before.split(/(?<=[.!?])\s+/);
    while (sentences.length && !sentences[sentences.length - 1].trim()) sentences.pop();
    sentences.pop();
    t = (sentences.join(' ') + ' ' + after).trim();
  }
  return tidy(t);
}

const PUNCT_COMMANDS = [
  ['full stop', '.'],
  ['period', '.'],
  ['comma', ','],
  ['question mark', '?'],
  ['exclamation mark', '!'],
  ['exclamation point', '!'],
  ['semicolon', ';'],
  ['colon', ':']
];

// "new line", "new paragraph", spoken punctuation
function applySpokenCommands(text) {
  let t = String(text || '');
  t = t.replace(/[,.!?]?\s*\bnew paragraph\b[.,!?]?\s*/gi, '\n\n');
  t = t.replace(/[,.!?]?\s*\bnew line\b[.,!?]?\s*/gi, '\n');
  for (const [phrase, sym] of PUNCT_COMMANDS) {
    t = t.replace(new RegExp(`\\s*\\b${phrase}\\b[.,]?`, 'gi'), sym);
  }
  // capitalize after a newline for readability
  t = t.replace(/\n([a-z])/g, (m, c) => '\n' + c.toUpperCase());
  return tidy(t);
}

// Builds the Whisper `prompt` decoding hint: user vocabulary + trailing context
// from the previous chunk (keeps chunked transcriptions coherent at boundaries).
// Whisper keeps only the LAST ~224 tokens of the prompt, dropping the start —
// cap the vocabulary so a large dictionary can't push itself (or the tail) out.
function buildPrompt(dictionaryOrVocabulary, prevTail) {
  const settings = dictionaryOrVocabulary && typeof dictionaryOrVocabulary === 'object'
    ? dictionaryOrVocabulary
    : null;
  const words = settings
    ? preferredTerms(settings)
    : String(dictionaryOrVocabulary || '').split(/[,\n]/).map((word) => word.trim()).filter(Boolean);
  const parts = [];
  if (words.length) {
    const kept = [];
    let length = 0;
    for (const word of words) {
      const extra = word.length + (kept.length ? 2 : 0);
      if (length + extra > 600) break;
      kept.push(word);
      length += extra;
    }
    if (kept.length) parts.push(`Preferred spelling: ${kept.join(', ')}.`);
  }
  const snippetTriggers = (Array.isArray(settings?.snippets) ? settings.snippets : [])
    .map((snippet) => String(snippet?.trigger || '').trim())
    .filter(Boolean);
  if (snippetTriggers.length) {
    const kept = [];
    let length = 0;
    for (const trigger of snippetTriggers) {
      const extra = trigger.length + (kept.length ? 2 : 0);
      if (length + extra > 280) break;
      kept.push(trigger);
      length += extra;
    }
    if (kept.length) parts.push(`Saved snippet phrases: ${kept.join(', ')}.`);
  }
  // Whisper can omit filler words by default. A matching-style example nudges
  // it toward verbatim output when Auto Cleanup is set to None; the polish
  // stage separately validates that no words were removed or rearranged.
  if (settings?.cleanupLevel === 'none') {
    parts.push("Umm, let me think, like, hmm... okay, here's what I'm thinking.");
  }
  if (prevTail) parts.push(String(prevTail).slice(-200));
  return parts.length ? parts.join(' ') : undefined;
}

module.exports = {
  cleanArtifacts,
  applyReplacements,
  applyScratchThat,
  applySpokenCommands,
  expandSnippets,
  restoreSnippets,
  snippetTokensPreserved,
  buildPrompt,
  tidy
};
