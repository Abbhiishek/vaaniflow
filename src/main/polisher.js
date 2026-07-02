// LLM cleanup pass over the raw transcript, using a chat model on the same
// LocalAI server (/v1/chat/completions). Always fails open: any error returns
// the original text so dictation never blocks on the polish stage.
'use strict';
const { normalizeBaseUrl } = require('./transcriber');

const SYSTEM_PROMPT = [
  'You clean up raw speech-to-text transcripts.',
  'Remove filler words (um, uh, you know, like, I mean).',
  'Resolve self-corrections, keeping only the final intent — e.g. "send it Tuesday, no wait, Wednesday" becomes "send it Wednesday".',
  'Fix punctuation, capitalization, and sentence breaks. Preserve existing line breaks.',
  'Keep the speaker\'s own words and meaning. Do not add content, do not answer questions that appear in the transcript, do not summarize, do not translate.',
  'Reply with ONLY the cleaned text — no preamble, no quotes, no explanations.'
].join(' ');

const TONE_HINTS = {
  casual: 'Match a relaxed, conversational tone.',
  formal: 'Match a polished, professional tone.',
  technical: 'Match a precise, technical tone; keep code identifiers and jargon exactly as spoken.'
};

function shouldPolish(text, settings) {
  if (settings.polishEnabled === false) return false;
  if (!String(settings.chatModel || '').trim()) return false;
  if (!normalizeBaseUrl(settings.baseUrl)) return false;
  const words = String(text).split(/\s+/).filter(Boolean);
  return text.length >= 15 && words.length >= 4; // "yes" doesn't need an LLM round-trip
}

async function polishText(text, settings, tone) {
  if (!shouldPolish(text, settings)) return { text, polished: false };

  const base = normalizeBaseUrl(settings.baseUrl);
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const system = SYSTEM_PROMPT + (TONE_HINTS[tone] ? ' ' + TONE_HINTS[tone] : '');
  const body = {
    model: settings.chatModel.trim(),
    temperature: 0.2,
    max_tokens: Math.min(2048, Math.ceil(text.length / 2) + 200),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text }
    ]
  };

  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    let reply = String(data?.choices?.[0]?.message?.content || '').trim();
    // strip wrappers a small model sometimes adds
    reply = reply.replace(/^```[a-z]*\n?|```$/g, '').trim();
    if (/^".*"$/s.test(reply) && !/^".*"$/s.test(text.trim())) reply = reply.slice(1, -1).trim();
    // sanity: reject empty or wildly inflated output
    if (!reply || reply.length > text.length * 3) return { text, polished: false };
    return { text: reply, polished: true };
  } catch (err) {
    console.error('polish failed (using raw transcript):', err.message);
    return { text, polished: false };
  }
}

module.exports = { polishText, shouldPolish };
