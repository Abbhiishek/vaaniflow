import type { AppBindings, AzureProviderProfile, ChatRequest } from './types';
import { BUILTIN_AZURE_DEPLOYMENTS } from './builtin-provider';

export class BuiltInProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuiltInProviderConfigurationError';
  }
}

function normalizeAzureEndpoint(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:') throw new Error('Provider endpoint must use HTTPS');
  if (!url.hostname.endsWith('.openai.azure.com')
    && !url.hostname.endsWith('.services.ai.azure.com')
    && !url.hostname.endsWith('.cognitiveservices.azure.com')) {
    throw new Error('This server supports Azure OpenAI endpoints only');
  }
  url.pathname = url.pathname.replace(
    /\/openai(?:\/deployments\/[^/]+(?:\/(?:audio\/transcriptions|chat\/completions))?)?\/?$/i,
    ''
  );
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function validateProfile(value: unknown, existing: AzureProviderProfile | null): AzureProviderProfile {
  if (!value || typeof value !== 'object') throw new Error('Provider profile must be a JSON object');
  const source = value as Record<string, unknown>;
  const apiKey = typeof source.apiKey === 'string' && source.apiKey.trim()
    ? source.apiKey.trim()
    : existing?.apiKey || '';
  const profile: AzureProviderProfile = {
    provider: 'azure-openai',
    baseUrl: normalizeAzureEndpoint(String(source.baseUrl || existing?.baseUrl || '')),
    apiKey,
    apiVersion: String(source.apiVersion || existing?.apiVersion || '2024-10-21').trim(),
    whisperDeployment: String(source.whisperDeployment || existing?.whisperDeployment || '').trim(),
    llmDeployment: String(source.llmDeployment ?? existing?.llmDeployment ?? '').trim()
  };
  if (!profile.apiKey) throw new Error('API key is required the first time an override is saved');
  if (!profile.whisperDeployment) throw new Error('Whisper deployment is required');
  if (!/^20\d{2}-\d{2}-\d{2}(?:-preview)?$/.test(profile.apiVersion)) throw new Error('Invalid Azure API version');
  return profile;
}

function builtInAzureProfile(env: AppBindings): AzureProviderProfile {
  const baseUrl = String(env.AZURE_OPENAI_ENDPOINT || '').trim();
  const apiKey = String(env.AZURE_OPENAI_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    throw new BuiltInProviderConfigurationError('Built-in Azure provider secrets are not configured');
  }
  return {
    provider: 'azure-openai',
    baseUrl,
    apiKey,
    apiVersion: BUILTIN_AZURE_DEPLOYMENTS.apiVersion,
    whisperDeployment: BUILTIN_AZURE_DEPLOYMENTS.whisper,
    llmDeployment: BUILTIN_AZURE_DEPLOYMENTS.chat
  };
}

export async function transcribeManagedAzure(
  env: AppBindings,
  audio: ArrayBuffer,
  language: string,
  prompt: string
): Promise<Response> {
  return transcribeAzure(builtInAzureProfile(env), audio, language, prompt);
}

export async function transcribeAzure(
  profile: AzureProviderProfile,
  audio: ArrayBuffer,
  language: string,
  prompt: string
): Promise<Response> {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (language && language !== 'auto') form.append('language', language);
  if (prompt) form.append('prompt', prompt);
  const base = normalizeAzureEndpoint(profile.baseUrl);
  const url = `${base}/openai/deployments/${encodeURIComponent(profile.whisperDeployment)}/audio/transcriptions?api-version=${encodeURIComponent(profile.apiVersion)}`;
  const upstream = await fetch(url, { method: 'POST', headers: { 'api-key': profile.apiKey }, body: form });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' }
  });
}

export function validateChatRequest(value: unknown): ChatRequest {
  if (!value || typeof value !== 'object') throw new Error('Chat body must be a JSON object');
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.messages) || source.messages.length === 0 || source.messages.length > 64) {
    throw new Error('messages must contain between 1 and 64 entries');
  }
  const messages = source.messages.map((message) => {
    if (!message || typeof message !== 'object') throw new Error('Invalid chat message');
    const entry = message as Record<string, unknown>;
    if (typeof entry.role !== 'string' || typeof entry.content !== 'string') throw new Error('Invalid chat message');
    return { role: entry.role.slice(0, 32), content: entry.content.slice(0, 64_000) };
  });
  const temperature = Number(source.temperature);
  const maxTokens = Number(source.max_tokens);
  return {
    messages,
    ...(Number.isFinite(temperature) ? { temperature: Math.max(0, Math.min(2, temperature)) } : {}),
    ...(Number.isFinite(maxTokens) ? { max_tokens: Math.max(1, Math.min(4096, Math.round(maxTokens))) } : {})
  };
}

export async function chatManagedAzure(env: AppBindings, body: ChatRequest): Promise<Response> {
  return chatAzure(builtInAzureProfile(env), body);
}

export async function chatAzure(profile: AzureProviderProfile, body: ChatRequest): Promise<Response> {
  if (!profile.llmDeployment) return Response.json({ error: 'No LLM deployment is configured' }, { status: 409 });
  const base = normalizeAzureEndpoint(profile.baseUrl);
  const url = `${base}/openai/deployments/${encodeURIComponent(profile.llmDeployment)}/chat/completions?api-version=${encodeURIComponent(profile.apiVersion)}`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': profile.apiKey },
    body: JSON.stringify(body)
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' }
  });
}
