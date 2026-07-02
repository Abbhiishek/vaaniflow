// Client for a LocalAI / OpenAI-compatible Whisper server.
// POST {baseUrl}/v1/audio/transcriptions  (multipart: file, model, [language])
'use strict';

function normalizeBaseUrl(baseUrl) {
  let url = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/v1$/.test(url)) url = url.slice(0, -3);
  return url;
}

class TranscriptionError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'TranscriptionError';
    this.status = status;
  }
}

async function transcribe(wavBuffer, settings, { prompt } = {}) {
  const base = normalizeBaseUrl(settings.baseUrl);
  if (!base) {
    throw new TranscriptionError('No server URL configured. Open Settings and add your Whisper server URL.');
  }

  const form = new FormData();
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', settings.model || 'whisper-1');
  form.append('response_format', 'json');
  if (settings.language && settings.language !== 'auto') {
    form.append('language', settings.language);
  }
  if (prompt) form.append('prompt', prompt);

  const headers = {};
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const timeoutMs = Math.max(5, Number(settings.timeoutSec) || 60) * 1000;
  let res;
  try {
    res = await fetch(`${base}/v1/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new TranscriptionError(`Server timed out after ${timeoutMs / 1000}s`);
    }
    throw new TranscriptionError(`Could not reach server: ${err.cause?.code || err.message}`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.text();
      detail = body.slice(0, 200);
      try { detail = JSON.parse(body).error?.message || detail; } catch {}
    } catch {}
    if (res.status === 401 || res.status === 403) {
      throw new TranscriptionError('Server rejected the API key (check Settings)', { status: res.status });
    }
    throw new TranscriptionError(`Server error ${res.status}${detail ? `: ${detail}` : ''}`, { status: res.status });
  }

  const data = await res.json().catch(() => ({}));
  return String(data.text || '').trim();
}

// Connectivity probe for the Settings "Test connection" button.
async function testConnection(settings) {
  const base = normalizeBaseUrl(settings.baseUrl);
  if (!base) return { ok: false, message: 'No server URL set' };
  const headers = {};
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  try {
    const res = await fetch(`${base}/v1/models`, { headers, signal: AbortSignal.timeout(10000) });
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Reached server, but the API key was rejected' };
    if (!res.ok) return { ok: false, message: `Server responded with HTTP ${res.status}` };
    const data = await res.json().catch(() => null);
    const models = (data?.data || []).map((m) => m.id).filter(Boolean);
    return {
      ok: true,
      message: models.length ? `Connected. Models: ${models.slice(0, 8).join(', ')}` : 'Connected.',
      models
    };
  } catch (err) {
    return { ok: false, message: `Could not reach server: ${err.cause?.code || err.message}` };
  }
}

// Fire-and-forget: open the TCP/TLS connection while the user is still speaking,
// so the first transcription request doesn't pay the handshake.
function warmup(settings) {
  const base = normalizeBaseUrl(settings.baseUrl);
  if (!base) return;
  const headers = {};
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  fetch(`${base}/readyz`, { headers, signal: AbortSignal.timeout(4000) })
    .catch(() => fetch(`${base}/v1/models`, { headers, signal: AbortSignal.timeout(4000) }))
    .catch(() => {});
}

module.exports = { transcribe, testConnection, warmup, normalizeBaseUrl, TranscriptionError };
