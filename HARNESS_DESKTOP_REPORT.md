# DeepSeek Harness Desktop Report

## Scope and official source

This project is a separate Electron desktop shell; the upstream web application is not rewritten. The official runtime is pinned to `@deepseek-ai/dsh@0.1.0-rc.6` from [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). The desktop wrapper is maintained under this project and loads the official loopback Web UI at runtime.

- Project root: this DeepSeekHarnessDesktop folder under the user Documents workspace.
- Default workspace: `<user-home>\Documents\DeepSeekHarnessWorkspace\` (verified on this Windows account).
- DSH home: `<workspace>\.dsh\`
- Secure settings: Electron `safeStorage`/Windows DPAPI under the app user-data directory (the JSON stores ciphertext and preferences only).
- Logs: Electron log directory, normally `%APPDATA%\DeepSeek Harness Desktop\logs\desktop.log`.
- Vision response cache: `%APPDATA%\DeepSeek Harness Desktop\cache\vision\`; images are never written to this cache.

## Versions and launch

- Node.js used to start the official dsh child: system Node.js (`C:\Program Files\nodejs\node.exe` when present), Node 24.x. This avoids Electron's internal Node module-loader restriction in dsh HMR. Electron 43.4.0 is used for the desktop shell.
- npm dependencies are locked in `package-lock.json`; `yaml@2.8.1` and the local Vision plugin are fixed.
- Development: `npm start` (or `npx electron . --no-sandbox` in a restricted test environment).
- Production: launch the installed `DeepSeek Harness Desktop.exe`; the wrapper chooses a free 127.0.0.1 port, starts dsh, waits for HTTP readiness, then loads the UI. No CMD/PowerShell console is kept visible.
- Single-instance behavior focuses the existing window. On exit the child receives SIGTERM; taskkill is used only after a five-second timeout.

## Provider configuration

DeepSeek defaults to base `https://api.deepseek.com` and model `deepseek-v4-flash`; `deepseek-v4-pro` is selectable. Settings calls `/models` first, verifies the selected ID when advertised, then makes a minimal non-streaming chat request. API keys are entered through the settings window or the one-time stdin seam:

`electron . --no-sandbox --import-deepseek-key-stdin`

The seam reads stdin only, stores through Electron safeStorage/DPAPI, emits the fixed token `CREDENTIAL_SAVED` (or `CREDENTIAL_NOT_SAVED`) and never logs or prints the key. Do not put keys in argv, source, ordinary JSON, git, or reports.

## Vision Bridge

The independent `vision_analyze` tool is registered with the official dsh tool/credentials seams and mounted in a derived desktop agent preset. It calls only the configured GLM endpoint (default `https://open.bigmodel.cn/api/paas/v4/chat/completions`, model `glm-4.6v-flash`), never DeepSeek. Both Electron IPC and the Agent tool enforce PNG/JPEG MIME, 20..6000 pixel dimensions, and <=5 MB. Data URLs are SHA-256 keyed together with prompt/provider/model/base URL; no image bytes are persisted. With Vision enabled but no key, status is explicit `Awaiting API Key` and DeepSeek remains usable. Vision API key can be entered tomorrow in Settings > Vision Bridge; it is DPAPI-backed and can be removed with Clear both API keys.

## Build and verification

Commands run from the project root:

- `npm run lint`  Node syntax checks, including `src/settings-renderer.js`.
- `npm test`  3 passing tests (Vision bounds/data URL, logger redaction, DPAPI ciphertext persistence).
- `npm run build`  verified 9 files and dsh rc.6.
- `npm run prove:tool`  offline dsh RPC proof passed: `routable=true`, `toolVisible=true`, `turnCompleted=true`; mock server listens on the same configured 19193 endpoint and history reads `events` (with compatibility fallback).
- `npm run dist` - Windows NSIS + portable targets are configured; native npm rebuild is disabled because the official child runs on system Node. A production-only npm --omit=dev runtime is staged in `resources\dsh-runtime\node_modules` so all dsh peer dependencies are present. Artifacts are under `dist`.

The log scanner and code paths redact bearer/API-key-like values. The report intentionally contains no complete credential.

## Installation and shortcut

Installation was exercised with the generated NSIS installer using the per-user target `%LOCALAPPDATA%\Programs\DeepSeek Harness Desktop\`. The installed executable exists at `DeepSeek Harness Desktop.exe`, and `Desktop\DeepSeek Harness.lnk` resolves to that executable. The shortcut is created by the NSIS configuration (`createDesktopShortcut=true`). The packaged app was started with `--no-sandbox` after the production runtime staging fix. The final installed smoke test passed: `desktop.log` recorded `dsh web: http://127.0.0.1:63003` and `Harness ready at http://127.0.0.1:63003/`; no `ERR_MODULE_NOT_FOUND` appeared after that run. The installer also produces a portable artifact in `dist`.

## Known limitations and recovery

- A Vision provider key is not included; enter it later in Settings. Without one, Agent and IPC paths return `Awaiting API Key` without blocking DeepSeek.
- The wrapper expects a compatible system Node.js for the official dsh child; if absent, Electron's Node fallback is attempted and emits a startup diagnostic if HMR cannot load.
- If a generated settings file is malformed, it is not overwritten; repair or remove `<workspace>\.dsh\settings.yaml` after preserving custom namespaces.
- To recover, uninstall via Windows Apps or run the generated uninstaller, remove only the project workspace and app user-data after backing up settings, then reinstall from the pinned installer. Credentials should be cleared from Settings before deleting user-data.
