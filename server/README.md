# VaaniFlow server

This is the Cloudflare Worker application that sits between the Electron app and model providers. It is a sibling of `site/`: `site/` remains the Astro/Vercel application, while `server/` is a Hono application deployed with Wrangler.

## Responsibilities

- `POST /v1/audio/transcriptions` forwards to the server-owned Azure Whisper deployment or the installation's saved override.
- `POST /v1/chat/completions` forwards to the server-owned Azure chat deployment or the saved override.
- `PUT /v1/provider` encrypts an override provider profile before storing it in Workers KV.
- `GET /v1/provider` returns only redacted provider metadata.
- `DELETE /v1/provider` removes an installation's override.
- `GET /health` is the only unauthenticated route and exposes no configuration.

All `/v1/*` requests require an HMAC signature over the method, path, timestamp, nonce, body hash, and installation ID. Nonces are recorded briefly in KV to reject replayed requests.

## Local setup

```powershell
cd server
npm install
Copy-Item .dev.vars.example .dev.vars
npm run dev
```

Set all four values in `.dev.vars` before starting:

- `DESKTOP_HMAC_SECRET`: a high-entropy shared signing secret.
- `PROVIDER_ENCRYPTION_KEY`: exactly 32 random bytes encoded as base64.
- `AZURE_OPENAI_ENDPOINT`: the server-owned Azure OpenAI resource URL.
- `AZURE_OPENAI_API_KEY`: the server-owned Azure OpenAI API key.

The built-in deployment names and API version are hardcoded in `src/builtin-provider.ts`. Update that file to match the deployment names in your Azure resource.

## Cloudflare deployment

```powershell
cd server
npx wrangler login
npm run check
npm run deploy
npx wrangler secret put DESKTOP_HMAC_SECRET
npx wrangler secret put PROVIDER_ENCRYPTION_KEY
npx wrangler secret put AZURE_OPENAI_ENDPOINT
npx wrangler secret put AZURE_OPENAI_API_KEY
```

Wrangler provisions the `PROVIDER_CONFIGS` KV namespace from `wrangler.jsonc`. Put secret values through Wrangler's interactive prompt; never commit them to `.dev.vars`, source files, or `wrangler.jsonc`.

After deployment, provision the desktop build with the Worker URL and the same HMAC secret:

```powershell
$env:VAANI_GATEWAY_URL = 'https://vaaniflow-server.<account>.workers.dev'
$env:VAANI_GATEWAY_ACCESS_KEY = '<same value as DESKTOP_HMAC_SECRET>'
npm run gateway:config
npm run dist
```

`gateway-config.generated.json` is ignored by Git and packaged only into the Electron main process.

## Security boundary

The signed-request scheme prevents unauthenticated calls, body tampering, and simple replay. It is an interim control, not proof that a request came from an unmodified official desktop binary: a shared secret shipped inside Electron can be recovered by a determined user. A production entitlement boundary should replace it with short-lived per-device credentials issued after account, license, or organization authentication, plus server-side revocation and rate limits.
