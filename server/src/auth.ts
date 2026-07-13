import { createMiddleware } from 'hono/factory';
import type { AppBindings, AppVariables } from './types';
import { bytesToHex, sha256Hex, utf8 } from './encoding';

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const NONCE_TTL_SECONDS = 10 * 60;

async function expectedSignature(secret: string, canonical: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return bytesToHex(await crypto.subtle.sign('HMAC', key, utf8(canonical)));
}

async function constantTimeHexEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', utf8(left.toLowerCase())),
    crypto.subtle.digest('SHA-256', utf8(right.toLowerCase()))
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

export const requireDesktopSignature = createMiddleware<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>(async (c, next) => {
  const installationId = c.req.header('x-vaani-installation-id') || '';
  const timestamp = c.req.header('x-vaani-timestamp') || '';
  const nonce = c.req.header('x-vaani-nonce') || '';
  const suppliedHash = c.req.header('x-vaani-content-sha256') || '';
  const suppliedSignature = c.req.header('x-vaani-signature') || '';

  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(installationId)) return c.json({ error: 'Invalid installation identity' }, 401);
  if (!/^\d{10,16}$/.test(timestamp)) return c.json({ error: 'Invalid timestamp' }, 401);
  if (!/^[a-f0-9]{32,128}$/i.test(nonce)) return c.json({ error: 'Invalid nonce' }, 401);
  if (!/^[a-f0-9]{64}$/i.test(suppliedHash) || !/^[a-f0-9]{64}$/i.test(suppliedSignature)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const requestTime = Number(timestamp);
  if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > MAX_CLOCK_SKEW_MS) {
    return c.json({ error: 'Expired request' }, 401);
  }

  const declaredLength = Number(c.req.header('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) return c.json({ error: 'Request body is too large' }, 413);

  const bodyBytes = await c.req.raw.clone().arrayBuffer();
  if (bodyBytes.byteLength > MAX_BODY_BYTES) return c.json({ error: 'Request body is too large' }, 413);
  const actualHash = await sha256Hex(bodyBytes);
  if (!(await constantTimeHexEqual(actualHash, suppliedHash))) return c.json({ error: 'Body hash mismatch' }, 401);

  const url = new URL(c.req.url);
  const canonical = [c.req.method.toUpperCase(), url.pathname, timestamp, nonce, actualHash, installationId].join('\n');
  const expected = await expectedSignature(c.env.DESKTOP_HMAC_SECRET, canonical);
  if (!(await constantTimeHexEqual(expected, suppliedSignature))) return c.json({ error: 'Invalid signature' }, 401);

  const nonceKey = `nonce:${installationId}:${nonce}`;
  if (await c.env.PROVIDER_CONFIGS.get(nonceKey)) return c.json({ error: 'Replayed request' }, 401);
  await c.env.PROVIDER_CONFIGS.put(nonceKey, '1', { expirationTtl: NONCE_TTL_SECONDS });

  c.set('installationId', installationId);
  c.set('bodyBytes', bodyBytes);
  await next();
});
