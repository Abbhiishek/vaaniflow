# Optional VaaniFlow server

This directory contains an open-source Cloudflare Worker that contributors may deploy for their own use. It is not used by official Vaani desktop builds, and the project does not provide a public Vaani model gateway.

The Worker is retained as reference infrastructure for self-hosted deployments, experiments, and future authenticated service integrations. A custom client must implement the signed request protocol in `src/auth.ts`.

## Responsibilities

- `POST /v1/audio/transcriptions` forwards to the deployer's Azure Whisper deployment or an installation's saved override.
- `POST /v1/chat/completions` forwards to the deployer's Azure chat deployment or the saved override.
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
- `AZURE_OPENAI_ENDPOINT`: the deployer's Azure OpenAI resource URL.
- `AZURE_OPENAI_API_KEY`: the deployer's Azure OpenAI API key.

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

Official desktop builds cannot be provisioned with this Worker. If you choose to integrate it into a fork or another client, keep the Worker URL and authentication design under your control and do not publish a shared HMAC secret.

## Security boundary

The signed-request scheme prevents unauthenticated calls, body tampering, and simple replay. It is an interim control, not proof that a request came from an unmodified official desktop binary: a shared secret shipped inside Electron can be recovered by a determined user. A production entitlement boundary should replace it with short-lived per-device credentials issued after account, license, or organization authentication, plus server-side revocation and rate limits.
