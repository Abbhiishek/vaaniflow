import { Hono } from 'hono';
import { requireDesktopSignature } from './auth';
import { deleteProfile, loadProfile, saveProfile } from './profile-store';
import {
  BuiltInProviderConfigurationError,
  chatAzure,
  chatManagedAzure,
  transcribeAzure,
  transcribeManagedAzure,
  validateChatRequest,
  validateProfile
} from './providers';
import type { AppBindings, AppVariables, ProviderMode } from './types';
import { base64ToBytes } from './encoding';

const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
});

app.get('/health', (c) => c.json({ ok: true, service: 'vaaniflow-server' }));
app.use('/v1/*', requireDesktopSignature);

app.get('/v1/provider', async (c) => {
  const profile = await loadProfile(c.env, c.get('installationId'));
  return c.json({
    configured: !!profile,
    provider: profile?.provider || null,
    baseUrl: profile?.baseUrl || '',
    apiVersion: profile?.apiVersion || '',
    whisperDeployment: profile?.whisperDeployment || '',
    llmDeployment: profile?.llmDeployment || ''
  });
});

app.put('/v1/provider', async (c) => {
  const installationId = c.get('installationId');
  const existing = await loadProfile(c.env, installationId);
  const value: unknown = JSON.parse(new TextDecoder().decode(c.get('bodyBytes')) || '{}');
  const profile = validateProfile(value, existing);
  await saveProfile(c.env, installationId, profile);
  return c.json({ ok: true, configured: true });
});

app.delete('/v1/provider', async (c) => {
  await deleteProfile(c.env, c.get('installationId'));
  return c.json({ ok: true });
});

app.post('/v1/audio/transcriptions', async (c) => {
  const mode = providerMode(c.req.header('x-vaani-provider-mode'));
  const audio = c.get('bodyBytes');
  if (!audio.byteLength) return c.json({ error: 'Audio body is required' }, 400);
  const language = (c.req.header('x-vaani-language') || 'auto').slice(0, 32);
  let prompt = '';
  try { prompt = new TextDecoder().decode(base64ToBytes(c.req.header('x-vaani-prompt') || '')).slice(0, 2000); } catch {}
  if (mode === 'builtin') return transcribeManagedAzure(c.env, audio, language, prompt);
  const profile = await loadProfile(c.env, c.get('installationId'));
  if (!profile) return c.json({ error: 'Override provider is not configured' }, 409);
  return transcribeAzure(profile, audio, language, prompt);
});

app.post('/v1/chat/completions', async (c) => {
  const mode = providerMode(c.req.header('x-vaani-provider-mode'));
  const value: unknown = JSON.parse(new TextDecoder().decode(c.get('bodyBytes')) || '{}');
  const body = validateChatRequest(value);
  if (mode === 'builtin') return chatManagedAzure(c.env, body);
  const profile = await loadProfile(c.env, c.get('installationId'));
  if (!profile) return c.json({ error: 'Override provider is not configured' }, 409);
  return chatAzure(profile, body);
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => {
  console.error(JSON.stringify({ message: 'request failed', path: c.req.path, error: error.message }));
  if (error instanceof BuiltInProviderConfigurationError) return c.json({ error: error.message }, 503);
  const status = error instanceof SyntaxError || /required|invalid|must|supports/i.test(error.message) ? 400 : 500;
  return c.json({ error: status === 400 ? error.message : 'Internal server error' }, status);
});

function providerMode(value: string | undefined): ProviderMode {
  return value === 'override' ? 'override' : 'builtin';
}

export default app;
