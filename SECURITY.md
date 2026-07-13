# Security model

Vaani treats the renderer as untrusted and keeps network credentials and provider operations in the Electron main process or the Cloudflare Worker.

## Implemented desktop controls

- Renderer windows use context isolation, disabled Node integration, Chromium sandboxing, web security, and restrictive Content Security Policy headers.
- New windows and renderer navigation are denied.
- Microphone permission is granted only to Vaani's local renderer files.
- Sensitive provider IPC verifies that the sender is a trusted local renderer.
- Production builds disable DevTools shortcuts and apply Electron fuses that disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, and CLI inspect flags, while forcing the application entry point to load from ASAR.
- Provider override API keys are uploaded over HTTPS, encrypted with AES-256-GCM in the Worker, and never returned to the renderer or persisted after a successful save.

## Release controls still required

- Sign Windows executables and installers with a protected code-signing identity.
- Publish updates only from the controlled GitHub release workflow and keep updater signing verification enabled.
- Protect Cloudflare deployment credentials with least privilege and environment separation.
- Add account/license-based device enrollment, revocation, quotas, and abuse monitoring before treating the built-in model service as a paid public entitlement.

## Important limitation

Electron is software running on a user's machine. Fuses, ASAR, disabled DevTools, obfuscation, and embedded encryption keys increase the cost of tampering but cannot prevent an owner of the machine from extracting code, patching checks, recompiling the app, or replaying recovered credentials. Authorization for valuable server resources must ultimately be enforced by the server using revocable identities, not by trusting the desktop binary.
