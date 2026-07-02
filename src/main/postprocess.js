// Cleans raw Whisper output: artifacts, spoken commands, snippets, corrections.
'use strict';

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

// Strip [BLANK_AUDIO]-style artifacts. Bracketed/asterisked segments are always
// annotations; parenthesized ones only when they match known noise words (so a
// genuinely dictated parenthetical survives).
function cleanArtifacts(text) {
  let t = String(text || '');
  t = t.replace(/\[[^\]\n]{0,60}\]/g, ' ');
  t = t.replace(/\*[^*\n]{0,60}\*/g, ' ');
  t = t.replace(/♪[^♪\n]*♪?/g, ' ');
  t = t.replace(/\(([^)\n]{0,60})\)/g, (m, inner) => (NOISE_WORDS.test(inner.trim()) ? ' ' : m));
  return tidy(t);
}

// rules: [{ from, to }] — case-insensitive; whole-word when the pattern looks word-like
function applyReplacements(text, rules) {
  let t = String(text || '');
  for (const rule of rules || []) {
    const from = String(rule?.from || '').trim();
    if (!from) continue;
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordLike = /^\w/.test(from) && /\w$/.test(from);
    try {
      t = t.replace(new RegExp(wordLike ? `\\b${esc}\\b` : esc, 'gi'), String(rule.to ?? ''));
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

// If the whole utterance is a snippet trigger ("my signature" / "insert my signature"),
// return the snippet body instead of the transcript.
function expandSnippets(text, snippets) {
  const norm = tidy(text).toLowerCase().replace(/[.!?,]+$/, '').trim();
  if (!norm) return { matched: false };
  for (const sn of snippets || []) {
    const trig = String(sn?.trigger || '').toLowerCase().trim();
    if (!trig) continue;
    if (norm === trig || norm === `insert ${trig}`) {
      return { matched: true, text: String(sn.text || '') };
    }
  }
  return { matched: false };
}

// Builds the Whisper `prompt` decoding hint: user vocabulary + trailing context
// from the previous chunk (keeps chunked transcriptions coherent at boundaries).
function buildPrompt(vocabulary, prevTail) {
  const words = String(vocabulary || '')
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);
  const parts = [];
  if (words.length) parts.push(words.join(', ') + '.');
  if (prevTail) parts.push(String(prevTail).slice(-200));
  return parts.length ? parts.join(' ') : undefined;
}

module.exports = {
  cleanArtifacts,
  applyReplacements,
  applyScratchThat,
  applySpokenCommands,
  expandSnippets,
  buildPrompt,
  tidy
};
