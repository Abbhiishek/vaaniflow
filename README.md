# VaaniFlow

<p align="center">
  <img src="assets/vaani.svg" alt="VaaniFlow logo" width="120" />
</p>

<p align="center">
  <strong>Fast, system-wide voice dictation for Windows.</strong><br />
  Speak naturally and insert polished text into any application.
</p>

The desktop app, named **Vaani**, runs from the system tray. Hold a global shortcut, speak, and release—the transcript is inserted wherever your cursor is.

## Features

- **System-wide dictation** with push-to-talk and hands-free recording modes
- **Fast transcription** through the managed Cloudflare Worker or an Azure OpenAI override
- **Optional AI polishing** with cleanup and writing styles for messages, work, email, and other apps
- **Personal dictionary** for names, jargon, acronyms, preferred spellings, and replacements
- **Voice snippets** that expand spoken trigger phrases into reusable text
- **Voice commands** for punctuation, paragraphs, and corrections such as “scratch that”
- **History and insights** for search, activity, word counts, speed, streaks, and app usage
- **Local-first app data** for settings, transcripts, dictionary entries, snippets, and profile data
- **Resilient processing** with retries, failed-audio recovery, silence trimming, and automatic updates

## Getting started

VaaniFlow currently supports Windows. The packaged app uses server-owned Azure OpenAI deployments through a Cloudflare Worker; developers can also configure a per-installation Azure OpenAI override.

```bash
git clone https://github.com/Abbhiishek/vaaniflow.git
cd vaaniflow
npm install
npm start
```

Choose **Use built-in** or **Override** in **Settings → Provider**. Override credentials are sent to the Cloudflare Worker, encrypted there, and never returned to the renderer. Local `config.json` contains only mode and non-secret provider metadata after a successful save.

```json
{
  "providerMode": "override",
  "baseUrl": "https://your-resource.openai.azure.com",
  "apiKey": "",
  "apiVersion": "2024-10-21",
  "whisperDeployment": "whisper",
  "llmDeployment": "gpt-4o",
  "overrideConfigured": true
}
```

The default shortcut is `Ctrl + Win`: hold it while speaking, then release to transcribe and paste.

## Privacy

VaaniFlow has no required account or sign-in. Settings, transcripts, dictionary entries, snippets, and profile data remain local. Audio and text are sent to the Cloudflare Worker, which forwards built-in requests to the server-owned Azure OpenAI resource or uses the user's saved override. Override credentials are encrypted server-side; see `SECURITY.md` for the current trust model.

## Development

```bash
npm test          # desktop test suite
npm run smoke     # Electron smoke test
npm run dist      # Windows installer; requires Worker build provisioning
npm run server:check
```

### Applications

- `src/` — Electron desktop application.
- `site/` — Astro website deployed to Vercel.
- `server/` — Hono API deployed to Cloudflare Workers with Wrangler.

### Marketing website

```bash
cd site
npm install
npm run dev
```

For Vercel, import this repository and set the project root directory to `site`. The `/api/download/windows` endpoint resolves the installer from the latest published GitHub release and redirects the browser to GitHub.

### Cloudflare server

```bash
cd server
npm install
npm run check
npm run deploy
```

See `server/README.md` for Worker secrets, desktop build provisioning, and the limitations of the interim signed-request scheme.

## Security

The project uses Electron sandboxing, context isolation, restrictive CSP, navigation blocking, IPC sender checks, production fuses, signed Worker requests, replay protection, and encrypted provider profiles. These controls raise the cost of tampering but cannot make a user-owned desktop binary unmodifiable. See `SECURITY.md`.

## Contributing

Bug reports, feature proposals, documentation improvements, and pull requests are welcome. Please open an issue before starting a large change so the approach can be discussed early.

## License

VaaniFlow is available under the MIT License.
