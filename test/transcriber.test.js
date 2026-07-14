'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAzureEndpoint,
  resolveTranscriptionConfig,
  createSilentWav
} = require('../src/main/transcriber');
const { polishConfig } = require('../src/main/polisher');

test('builds an Azure OpenAI Whisper deployment request', () => {
  const config = resolveTranscriptionConfig({
    baseUrl: 'https://speech-prod.openai.azure.com/',
    apiKey: 'azure-secret',
    model: 'whisper prod',
    azureApiVersion: '2024-10-21'
  });

  assert.equal(
    config.url,
    'https://speech-prod.openai.azure.com/openai/deployments/whisper%20prod/audio/transcriptions?api-version=2024-10-21'
  );
  assert.deepEqual(config.headers, { 'api-key': 'azure-secret' });
});

test('accepts a copied full Azure transcription URL', () => {
  assert.equal(
    normalizeAzureEndpoint(
      'https://speech-prod.openai.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2024-10-21'
    ),
    'https://speech-prod.openai.azure.com'
  );
});

test('reports missing Azure configuration fields', () => {
  assert.throws(
    () => resolveTranscriptionConfig({ baseUrl: '', apiKey: '', model: '' }),
    /baseUrl/
  );
});

test('creates a valid 16 kHz mono PCM WAV for the connection probe', () => {
  const wav = createSilentWav(500);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.length, 16044);
});

test('uses the configured LLM deployment on the same Azure resource', () => {
  const config = polishConfig({
    baseUrl: 'https://speech-prod.openai.azure.com',
    apiKey: 'azure-secret',
    chatModel: 'gpt40',
    azureApiVersion: '2024-10-21'
  });

  assert.equal(
    config.url,
    'https://speech-prod.openai.azure.com/openai/deployments/gpt40/chat/completions?api-version=2024-10-21'
  );
  assert.deepEqual(config.headers, { 'api-key': 'azure-secret' });
});
