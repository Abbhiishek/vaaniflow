'use strict';
const crypto = require('node:crypto');

class GatewayError extends Error {
  constructor(message, { status, transient } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.transient = !!transient;
  }
}

function isGatewayProvider(settings) {
  return settings?.providerMode === 'builtin' || settings?.providerMode === 'override';
}

function gatewayIsConfigured(settings) {
  return !!(String(settings?.gatewayUrl || '').trim()
    && String(settings?.gatewayAccessKey || '').trim()
    && String(settings?.installationId || '').trim());
}

function gatewayConfig(settings) {
  const baseUrl = String(settings?.gatewayUrl || '').trim().replace(/\/+$/, '');
  const accessKey = String(settings?.gatewayAccessKey || '').trim();
  const installationId = String(settings?.installationId || '').trim();
  if (!baseUrl || !accessKey || !installationId) {
    throw new GatewayError('The built-in provider is not provisioned in this build. Configure VAANI_GATEWAY_URL and VAANI_GATEWAY_ACCESS_KEY before packaging.');
  }
  const parsed = new URL(baseUrl);
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (parsed.protocol !== 'https:' && !local) throw new GatewayError('The Vaani server must use HTTPS.');
  return { baseUrl, accessKey, installationId };
}

function bodyBuffer(body) {
  if (body == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  return Buffer.from(String(body), 'utf8');
}

async function signedFetch(settings, pathname, { method = 'GET', body, headers = {}, timeoutMs = 15000 } = {}) {
  const config = gatewayConfig(settings);
  const payload = bodyBuffer(body);
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('hex');
  const contentHash = crypto.createHash('sha256').update(payload).digest('hex');
  const canonical = [method.toUpperCase(), pathname, timestamp, nonce, contentHash, config.installationId].join('\n');
  const signature = crypto.createHmac('sha256', config.accessKey).update(canonical).digest('hex');
  let response;
  try {
    response = await fetch(`${config.baseUrl}${pathname}`, {
      method,
      headers: {
        ...headers,
        'x-vaani-installation-id': config.installationId,
        'x-vaani-timestamp': timestamp,
        'x-vaani-nonce': nonce,
        'x-vaani-content-sha256': contentHash,
        'x-vaani-signature': signature
      },
      body: method === 'GET' || method === 'HEAD' ? undefined : payload,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new GatewayError(`Vaani server timed out after ${Math.round(timeoutMs / 1000)}s`, { transient: true });
    }
    throw new GatewayError(`Could not reach the Vaani server: ${error.cause?.code || error.message}`, { transient: true });
  }
  if (!response.ok) {
    let detail = '';
    try {
      const text = await response.text();
      try { detail = JSON.parse(text).error || text; } catch { detail = text; }
    } catch {}
    throw new GatewayError(`Vaani server error ${response.status}${detail ? `: ${String(detail).slice(0, 240)}` : ''}`, {
      status: response.status,
      transient: response.status >= 500
    });
  }
  return response;
}

async function transcribeViaGateway(wavBuffer, settings, { prompt } = {}) {
  const response = await signedFetch(settings, '/v1/audio/transcriptions', {
    method: 'POST',
    body: wavBuffer,
    timeoutMs: Math.max(5, Number(settings.timeoutSec) || 60) * 1000,
    headers: {
      'Content-Type': 'audio/wav',
      'x-vaani-provider-mode': settings.providerMode,
      'x-vaani-language': String(settings.language || 'auto').slice(0, 32),
      'x-vaani-prompt': Buffer.from(String(prompt || ''), 'utf8').toString('base64')
    }
  });
  const data = await response.json().catch(() => ({}));
  return String(data.text || '').trim();
}

async function chatViaGateway(body, settings) {
  return signedFetch(settings, '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: Math.max(2, Number(settings.polishTimeoutSec) || 8) * 1000,
    headers: {
      'Content-Type': 'application/json',
      'x-vaani-provider-mode': settings.providerMode
    }
  });
}

async function saveProviderProfile(profile, settings) {
  const response = await signedFetch(settings, '/v1/provider', {
    method: 'PUT',
    body: JSON.stringify(profile),
    timeoutMs: 15000,
    headers: { 'Content-Type': 'application/json' }
  });
  return response.json();
}

function warmupGateway(settings) {
  if (!gatewayIsConfigured(settings)) return;
  fetch(`${String(settings.gatewayUrl).replace(/\/+$/, '')}/health`, {
    method: 'GET',
    signal: AbortSignal.timeout(4000)
  }).catch(() => {});
}

module.exports = {
  GatewayError,
  isGatewayProvider,
  gatewayIsConfigured,
  transcribeViaGateway,
  chatViaGateway,
  saveProviderProfile,
  warmupGateway
};
