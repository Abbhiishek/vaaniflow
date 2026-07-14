# VaaniFlow

<p align="center">
  <img src="assets/vaani.svg" alt="VaaniFlow logo" width="120" />
</p>

<p align="center">
  <strong>Fast, system-wide voice dictation for Windows.</strong><br />
  Speak naturally and insert polished text into any application.
</p>

VaaniFlow started as a side project to make everyday typing faster and more natural. It is open source so others can use it, improve it, and deploy the optional infrastructure for themselves.

The desktop app, named **Vaani**, runs from the system tray. Hold a global shortcut, speak, and release—the transcript is inserted wherever your cursor is.

## Features

- **System-wide dictation** with push-to-talk and hands-free recording modes
- **Fast transcription** using your own Azure OpenAI Whisper deployment
- **Optional AI polishing** with cleanup and writing styles for messages, work, email, and other apps
- **Personal dictionary** for names, jargon, acronyms, preferred spellings, and replacements
- **Voice snippets** that expand spoken trigger phrases into reusable text
- **Voice commands** for punctuation, paragraphs, and corrections such as “scratch that”
- **History and insights** for search, activity, word counts, speed, streaks, and app usage
- **Local-first app data** for settings, transcripts, dictionary entries, snippets, and profile data
- **Resilient processing** with retries, failed-audio recovery, silence trimming, and automatic updates

## Getting started

VaaniFlow currently supports Windows and requires your own Azure OpenAI resource with a Whisper deployment.

```bash
git clone https://github.com/Abbhiishek/vaaniflow.git
cd vaaniflow
npm install
npm start
```

Add your provider details from **Settings → Provider**, or edit the configuration created at `%APPDATA%/Vaani/config.json`:

```json
{
  "baseUrl": "https://your-resource.openai.azure.com",
  "apiKey": "your-api-key",
  "apiVersion": "2024-10-21",
  "whisperDeployment": "whisper",
  "llmDeployment": "gpt-4o"
}
```

`llmDeployment` is optional and is only needed for AI cleanup and style formatting. The default shortcut is `Ctrl + Win`: hold it while speaking, then release to transcribe and paste.

## Privacy

VaaniFlow has no required account, sign-in, or hosted backend. Settings, transcripts, dictionary entries, snippets, profile data, and provider credentials remain on your device. Audio and optional polishing requests are sent directly to the Azure OpenAI resource you configure. Keep your local `config.json` private.

## Development

```bash
npm test          # desktop test suite
npm run smoke     # Electron smoke test
npm run dist      # Windows installer
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

### Optional self-hosted Cloudflare server

The `server/` directory is retained as open-source reference infrastructure for contributors who want to deploy their own authenticated proxy. Official desktop builds do not connect to it and do not contain a Vaani-owned server URL or access key.

```bash
cd server
npm install
npm run check
npm run deploy
```

See `server/README.md` for deployment details and the limitations of its interim signed-request scheme.

## Security

The desktop app uses Electron sandboxing, context isolation, restrictive CSP, navigation blocking, IPC sender checks, and production fuses. The optional Worker implements signed requests, replay protection, and encrypted provider profiles for self-hosted deployments. See `SECURITY.md`.

## Contributing

Bug reports, feature proposals, documentation improvements, and pull requests are welcome. Please open an issue before starting a large change so the approach can be discussed early.

## License

VaaniFlow is available under the MIT License.
