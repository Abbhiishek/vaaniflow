# Security model

Vaani treats the renderer as untrusted and keeps provider requests in the Electron main process. Official desktop builds communicate directly with the Azure OpenAI resource configured by the user.

## Implemented desktop controls

- Renderer windows use context isolation, disabled Node integration, Chromium sandboxing, web security, and restrictive Content Security Policy headers.
- New windows and renderer navigation are denied.
- Microphone permission is granted only to Vaani's local renderer files.
- Sensitive provider IPC verifies that the sender is a trusted local renderer.
- Production builds disable DevTools shortcuts and apply Electron fuses that disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, and CLI inspect flags, while forcing the application entry point to load from ASAR.
- Azure OpenAI credentials are stored in the local user-editable `config.json` file and sent only to the configured Azure endpoint. Users must protect this file like any other local secret.
- Official releases do not embed a Vaani-owned Worker URL, shared HMAC secret, or Azure API key.

## Release controls still required

- Sign Windows executables and installers with a protected code-signing identity.
- Publish updates only from the controlled GitHub release workflow and keep updater signing verification enabled.
- If deploying the optional Worker, protect Cloudflare and Azure credentials with least privilege and environment separation.
- Add revocable device identities, quotas, and abuse monitoring before exposing any self-hosted Worker as a public service.

## Important limitation

Electron is software running on a user's machine. Fuses, ASAR, disabled DevTools, and obfuscation increase the cost of tampering but cannot prevent an owner of the machine from extracting code, patching checks, or recompiling the app. Any optional hosted service must enforce authorization with revocable identities rather than trusting a shared secret embedded in a desktop binary.
