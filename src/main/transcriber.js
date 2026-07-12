// Azure OpenAI Whisper transcription client.
'use strict';

const DEFAULT_AZURE_API_VERSION = '2024-10-21';

// Azure's portal normally shows the resource root. Also accept a copied full
// transcription URL so users do not accidentally end up with the path twice.
function normalizeAzureEndpoint(baseUrl) {
  let url = String(baseUrl || '').trim().replace(/\/+$/, '');
  url = url.replace(
    /\/openai(?:\/deployments\/[^/?]+(?:\/audio\/transcriptions)?)?(?:\?.*)?$/i,
    ''
  );
  return url;
}

class TranscriptionError extends Error {
  constructor(message, { status, transient } = {}) {
    super(message);
    this.name = 'TranscriptionError';
    this.status = status;
    this.transient = !!transient; // network blip / timeout / 5xx — worth one retry
  }
}

function resolveTranscriptionConfig(settings) {
  const base = normalizeAzureEndpoint(settings.baseUrl);
  const apiKey = String(settings.apiKey || '').trim();
  const deployment = String(settings.model || '').trim();
  const apiVersion = String(settings.azureApiVersion || DEFAULT_AZURE_API_VERSION).trim();
  if (!base) throw new TranscriptionError('Set baseUrl in config.json.');
  if (!apiKey) throw new TranscriptionError('Set apiKey in config.json.');
  if (!deployment) throw new TranscriptionError('Set whisperDeployment in config.json.');
  return {
    base,
    deployment,
    apiVersion,
    url: `${base}/openai/deployments/${encodeURIComponent(deployment)}/audio/transcriptions?api-version=${encodeURIComponent(apiVersion)}`,
    headers: { 'api-key': apiKey }
  };
}

function buildTranscriptionForm(wavBuffer, settings, prompt) {
  const form = new FormData();
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (settings.language && settings.language !== 'auto') {
    form.append('language', settings.language);
  }
  if (prompt) form.append('prompt', prompt);
  return form;
}

async function transcribe(wavBuffer, settings, opts = {}) {
  try {
    return await transcribeOnce(wavBuffer, settings, opts);
  } catch (err) {
    if (!err.transient) throw err;
    await new Promise((r) => setTimeout(r, 300));
    return transcribeOnce(wavBuffer, settings, opts);
  }
}

async function transcribeOnce(wavBuffer, settings, { prompt } = {}) {
  const config = resolveTranscriptionConfig(settings);
  const form = buildTranscriptionForm(wavBuffer, settings, prompt);
  const timeoutMs = Math.max(5, Number(settings.timeoutSec) || 60) * 1000;
  let res;
  try {
    res = await fetch(config.url, {
      method: 'POST',
      headers: config.headers,
      body: form,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new TranscriptionError(`Transcription timed out after ${timeoutMs / 1000}s`, { transient: true });
    }
    throw new TranscriptionError(`Could not reach Azure OpenAI: ${err.cause?.code || err.message}`, {
      transient: true
    });
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.text();
      detail = body.slice(0, 240);
      try { detail = JSON.parse(body).error?.message || detail; } catch {}
    } catch {}
    if (res.status === 401 || res.status === 403) {
      throw new TranscriptionError('Azure OpenAI rejected apiKey from config.json.', { status: res.status });
    }
    if (res.status === 404) {
      throw new TranscriptionError(
        `Azure deployment "${config.deployment}" was not found. Check baseUrl, whisperDeployment, and apiVersion in config.json.`,
        { status: res.status }
      );
    }
    throw new TranscriptionError(`Azure OpenAI error ${res.status}${detail ? `: ${detail}` : ''}`, {
      status: res.status,
      transient: res.status >= 500
    });
  }

  const data = await res.json().catch(() => ({}));
  return String(data.text || '').trim();
}

function createSilentWav(durationMs = 500) {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = Math.max(1, Math.round(sampleRate * durationMs / 1000)) * bytesPerSample;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}

// Azure has no data-plane model-list probe for an API key. A tiny silent WAV
// verifies the endpoint, key, API version, and deployment together.
async function testConnection(settings) {
  let config;
  try {
    config = resolveTranscriptionConfig(settings);
    await transcribeOnce(createSilentWav(), settings);
    return { ok: true, message: `Connected to Azure deployment "${config.deployment}".` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// Open the TCP/TLS connection while the user is still speaking.
function warmup(settings) {
  let config;
  try {
    config = resolveTranscriptionConfig(settings);
  } catch {
    return;
  }
  fetch(config.base, { method: 'HEAD', signal: AbortSignal.timeout(4000) }).catch(() => {});
}

module.exports = {
  DEFAULT_AZURE_API_VERSION,
  transcribe,
  testConnection,
  warmup,
  normalizeAzureEndpoint,
  resolveTranscriptionConfig,
  createSilentWav,
  TranscriptionError
};
