import type { AppBindings, AzureProviderProfile } from './types';
import { base64ToBytes, bytesToBase64, utf8 } from './encoding';

type EncryptedProfile = {
  version: 1;
  iv: string;
  ciphertext: string;
};

function profileKey(installationId: string): string {
  return `provider:${installationId}`;
}

async function encryptionKey(env: AppBindings): Promise<CryptoKey> {
  const raw = base64ToBytes(env.PROVIDER_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error('PROVIDER_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function saveProfile(
  env: AppBindings,
  installationId: string,
  profile: AzureProviderProfile
): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(installationId) },
    await encryptionKey(env),
    utf8(JSON.stringify(profile))
  );
  const record: EncryptedProfile = {
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext)
  };
  await env.PROVIDER_CONFIGS.put(profileKey(installationId), JSON.stringify(record));
}

export async function loadProfile(
  env: AppBindings,
  installationId: string
): Promise<AzureProviderProfile | null> {
  const record = await env.PROVIDER_CONFIGS.get<EncryptedProfile>(profileKey(installationId), 'json');
  if (!record) return null;
  if (record.version !== 1 || !record.iv || !record.ciphertext) throw new Error('Stored provider profile is invalid');
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(record.iv),
      additionalData: utf8(installationId)
    },
    await encryptionKey(env),
    base64ToBytes(record.ciphertext)
  );
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  return validateStoredProfile(parsed);
}

export async function deleteProfile(env: AppBindings, installationId: string): Promise<void> {
  await env.PROVIDER_CONFIGS.delete(profileKey(installationId));
}

function validateStoredProfile(value: unknown): AzureProviderProfile {
  if (!value || typeof value !== 'object') throw new Error('Stored provider profile is invalid');
  const source = value as Record<string, unknown>;
  const required = ['baseUrl', 'apiKey', 'apiVersion', 'whisperDeployment', 'llmDeployment'] as const;
  if (source.provider !== 'azure-openai' || required.some((key) => typeof source[key] !== 'string')) {
    throw new Error('Stored provider profile is invalid');
  }
  return {
    provider: 'azure-openai',
    baseUrl: String(source.baseUrl),
    apiKey: String(source.apiKey),
    apiVersion: String(source.apiVersion),
    whisperDeployment: String(source.whisperDeployment),
    llmDeployment: String(source.llmDeployment)
  };
}
