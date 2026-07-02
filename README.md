# VaaniFlow

Wispr Flow–style voice dictation for Windows, powered by your own self-hosted Whisper
server (LocalAI / any OpenAI-compatible `/v1/audio/transcriptions` endpoint — e.g. the
model running in your AKS cluster).

Hold a hotkey anywhere in Windows, speak, release — your words are typed into whatever
app has focus.

## Setup

```bash
npm install
npm start
```

On first launch the dashboard opens on the Settings page:

1. **Server URL** — your LocalAI endpoint, e.g. `https://whisper.yourcluster.example.com`
   (with or without `/v1`, both work).
2. **API key** — if your server requires one (sent as `Authorization: Bearer …`).
3. **Model** — the model name your server exposes (default `whisper-1`).
4. Click **Test connection** — it probes `/v1/models` and lists what the server offers.

## Using it

| Action | How |
| --- | --- |
| Push-to-talk | **Hold** the hotkey (default `Ctrl + Win`), speak, release |
| Hands-free | **Tap** the hotkey, speak freely |
| End hands-free | Tap the hotkey again, press **Space**, or click ✓ on the widget |
| Cancel | **Esc**, or click ✕ on the widget |
| Start from the widget | Hover the small bar at the bottom of the screen and click |

While recording, the floating widget at the bottom-center shows a live waveform and a
timer. When transcription finishes, the text is pasted at your cursor and saved to
History in the dashboard.

**Note on ending with Space:** the space keypress also lands in the focused app; by
default VaaniFlow sends one Backspace before pasting to remove it ("Remove the space…"
toggle in Settings → Behavior).

## Dashboard

- **Home** — words dictated, dictation count, average words/minute, day streak, recent transcripts
- **History** — searchable transcript log with copy/delete
- **Settings** — server, dictionary, microphone, hotkey, behavior toggles, launch at startup

## AI polish (optional)

Add a chat model to the same LocalAI server (e.g. `qwen2.5-3b-instruct`) and set it in
Settings → AI polish. Every transcript is then cleaned by the LLM: filler words removed,
self-corrections resolved ("Tuesday, no wait, Wednesday" → "Wednesday"), punctuation
fixed. Tone can be set globally or per app ("slack" → casual, "outlook" → formal).
The stage fails open — if the model is slow or down, the raw transcript is used.

## Voice commands & snippets

- **"new line" / "new paragraph"** and spoken punctuation ("period", "comma", …)
- **"scratch that"** — deletes the sentence you just said
- **Snippets** — say a saved trigger phrase ("insert my signature") and the snippet
  body is inserted instead
- **Hands-free auto-stop** — dictation ends by itself after a configurable silence

## Per-app behavior

The foreground app is detected when recording starts: transcripts are tagged with it in
History (and on the Home "Top apps" card), terminals get Ctrl+Shift+V instead of
Ctrl+V, and tone profiles pick the right register for the polish stage.

## Accuracy & speed

- **Custom vocabulary** (Settings → Dictionary) — names and jargon are sent to Whisper as
  a decoding hint (`prompt`), so "VaaniFlow" stops coming back as "vani flow".
- **Corrections** — find→replace rules applied to every transcript for words the model
  consistently gets wrong.
- **Artifact cleanup** — whisper.cpp noise markers (`[BLANK_AUDIO]`, `(laughs)`, `♪…♪`)
  are stripped automatically.
- **Fast mode** (default on) — long dictations are cut at natural pauses and transcribed
  in the background *while you keep speaking*; on stop, only the last few seconds still
  need processing. Each chunk gets the previous chunk's tail as context so boundaries
  stay coherent.
- Silence is trimmed before upload and the server connection is warmed up the moment
  recording starts.

The app lives in the system tray; closing the dashboard keeps dictation active.

## Architecture

```
src/
  main/
    main.js         app entry, IPC, tray, single-instance
    session.js      dictation state machine (idle → recording → processing)
    hotkeys.js      global key hook (uiohook-napi), hold/tap detection
    transcriber.js  LocalAI /v1/audio/transcriptions client
    injector.js     clipboard + Ctrl+V via persistent PowerShell SendInput helper
    windows.js      overlay + dashboard window factories
    store.js        JSON persistence (settings + history) in %APPDATA%/vaaniflow
  preload/preload.js
  renderer/
    overlay/        always-on-top waveform pill (mic capture, 16 kHz WAV encoding)
    dashboard/      history / stats / settings UI
```

No bundler, no frameworks — plain Electron. The only native dependency is
`uiohook-napi` (prebuilt N-API, used for global hold/release key detection). If it
fails to load, the app falls back to an F9 toggle via Electron's `globalShortcut`.

## Packaging & releases

```bash
npm run dist   # local build: NSIS installer in dist/
```

Releases are automated: push a version tag and GitHub Actions builds the installer and
publishes it to [GitHub Releases](https://github.com/Abbhiishek/vaaniflow/releases).

```bash
npm version patch        # bumps package.json + creates the tag
git push --follow-tags   # CI builds and publishes the release
```

The installed app checks for updates on startup (and every 4 hours), downloads them in
the background, and shows a "Restart to update" banner in the dashboard. Updates also
apply automatically on the next app restart.

> Auto-update reads release assets anonymously, so it requires the repo to be public.
> While the repo is private, updates fail silently and the app keeps working.
