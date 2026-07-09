// LLM cleanup pass over the raw transcript via any OpenAI-compatible
// /v1/chat/completions endpoint. The polish provider can be separate from the
// Whisper server (settings.polishBaseUrl/polishApiKey) — e.g. Whisper on your
// own cluster, polish on Groq/Cerebras for sub-second rewrites. Always fails
// open: any error, timeout, or suspicious output returns the original text so
// dictation never blocks on the polish stage.
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
  technical: 'Match a precise, technical tone; keep code identifiers and jargon exactly as spoken.',
  chat: 'This is a chat message. Keep it relaxed and concise; contractions are fine; no greetings or sign-offs unless spoken.',
  email: 'This will be sent as an email. Professional, courteous tone; complete sentences; break into short paragraphs where natural.',
  prompt: 'This is an instruction for an AI assistant. Keep it imperative, precise, and unambiguous; preserve technical terms, file names, and identifiers exactly as spoken.'
};

// Resolve which endpoint/key/model the polish stage talks to. A dedicated
// polish endpoint uses only its own key (never leak the Whisper key to a
// third-party provider); otherwise fall back to the Whisper server.
function polishConfig(settings) {
  const ownBase = normalizeBaseUrl(settings.polishBaseUrl);
  const base = ownBase || normalizeBaseUrl(settings.baseUrl);
  const apiKey = ownBase
    ? String(settings.polishApiKey || '').trim()
    : String(settings.polishApiKey || settings.apiKey || '').trim();
  const model = String(settings.chatModel || '').trim();
  return base && model ? { base, apiKey, model } : null;
}

function shouldPolish(text, settings) {
  if (settings.polishEnabled === false) return false;
  if (!polishConfig(settings)) return false;
  const words = String(text).split(/\s+/).filter(Boolean);
  return text.length >= 15 && words.length >= 4; // "yes" doesn't need an LLM round-trip
}

// Cheap similarity guard: fraction of the original's words that survive into
// the reply. Filler removal drops some, but a model that answered a question
// or rewrote from scratch shares almost nothing.
function wordOverlap(original, reply) {
  const tokenize = (s) => String(s).toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
  const src = tokenize(original);
  if (!src.length) return 1;
  const replySet = new Set(tokenize(reply));
  let kept = 0;
  for (const w of src) if (replySet.has(w)) kept++;
  return kept / src.length;
}

async function polishText(text, settings, tone) {
  if (!shouldPolish(text, settings)) return { text, polished: false };
  const config = polishConfig(settings);

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  let system = SYSTEM_PROMPT + (TONE_HINTS[tone] ? ' ' + TONE_HINTS[tone] : '');
  const style = String(settings.styleInstructions || '').trim().slice(0, 600);
  if (style) system += ` The user's writing style preferences: ${style}`;
  const body = {
    model: config.model,
    temperature: 0.2,
    max_tokens: Math.min(4096, Math.ceil(text.length / 2) + 256),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text }
    ]
  };

  // Hard deadline: fail-open must also fail fast — a slow polish model should
  // cost at most this budget, then the raw transcript is pasted instead.
  const timeoutMs = Math.max(2, Number(settings.polishTimeoutSec) || 8) * 1000;

  try {
    const res = await fetch(`${config.base}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const choice = data?.choices?.[0];
    // length-truncated output would paste the user's words cut off mid-sentence
    if (choice?.finish_reason && choice.finish_reason !== 'stop') {
      throw new Error(`finish_reason=${choice.finish_reason}`);
    }
    let reply = String(choice?.message?.content || '').trim();
    // strip wrappers a small model sometimes adds
    reply = reply.replace(/^```[a-z]*\n?|```$/g, '').trim();
    if (/^".*"$/s.test(reply) && !/^".*"$/s.test(text.trim())) reply = reply.slice(1, -1).trim();
    // sanity: reject empty, wildly inflated, gutted, or unrelated output
    if (!reply || reply.length > text.length * 3) return { text, polished: false };
    if (text.length > 80 && reply.length < text.length * 0.25) return { text, polished: false };
    if (text.length > 40 && wordOverlap(text, reply) < 0.5) return { text, polished: false };
    return { text: reply, polished: true };
  } catch (err) {
    console.error('polish failed (using raw transcript):', err.message);
    return { text, polished: false };
  }
}

// Fire-and-forget: open the TCP/TLS connection to the polish provider while
// the user is still speaking. Skipped when polish shares the Whisper server
// (the transcriber warmup already covers it).
function polishWarmup(settings) {
  if (settings.polishEnabled === false) return;
  const config = polishConfig(settings);
  if (!config || config.base === normalizeBaseUrl(settings.baseUrl)) return;
  const headers = {};
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  fetch(`${config.base}/v1/models`, { headers, signal: AbortSignal.timeout(4000) }).catch(() => {});
}

module.exports = { polishText, shouldPolish, polishConfig, polishWarmup };
