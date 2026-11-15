# Newbot v1 integration lab

Isolated G1 integration, with an exact dependency lock. Root production does not import this directory. Codex remains the sole execution loop; CopilotKit Runtime calls the same Newbot command service as the existing run route.

```sh
cd labs/v1-integration
npm ci
npm run check
npm test
npm run test:runtime
npm run test:render
npm run build
```

`npm test` exercises five upstream-package contracts (Runtime discovery, run/connect routing, ownership enforcement, A2UI 1.0 updates/deletion, catalog rejection). `test:runtime` uses real loopback HTTP, official HttpAgent and FakeCodex for seven concurrency/authentication/recovery/failure cases. `test:render` verifies that trusted math survives while untrusted HTML and script URLs remain blocked. Fixtures do not prove real service compatibility.

For explicit local verification against the existing default Provider:

```sh
npm run verify:model
npm run serve:browser
```

These commands read the repository's existing Provider configuration and copy only its encrypted credential records/key into a private temporary instance. They create a separate native Home and workspace; they do not copy conversations/plugins, print keys, migrate data, or restart production. The model check sends a no-tools marker prompt, reconnects, repeats the same operation ID, and asserts exactly one native `turn/start`. It cleans up afterwards.

The browser lab binds **127.0.0.1:3161**, uses its own random password in the ignored `.data/v1-browser-login` file, and removes that file and its temporary data on normal shutdown. A second launch cannot overwrite a live lab's login file. All native approval requests are rejected in this verification instance. Do not expose this ephemeral launcher publicly or use it as a production replacement. A forced process kill may require cleaning the corresponding isolated directory after verifying the process is gone.

For an explicitly authorized online preview, `serve-online.ts` is a separate launcher on **127.0.0.1:3162**. Set `PREVIEW_ORIGIN` to the exact HTTPS reverse-proxy origin and run `COPILOTKIT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 node --import tsx serve-online.ts` from this directory. It bootstraps `.data/v1-online` once with the encrypted default Provider credentials and original login hash, then preserves its own conversations and login sessions across application restarts. It never copies original conversations or sessions. Its API allowlist permits only login/session/logout, thread creation/read and the designated Copilot agent's info/run/connect/stop. Configuration, plugin, file and alternate execution routes are unavailable; native approval requests are denied. Eight runtime tests now also cover this restricted surface. This authenticated preview is not production signoff; use a supervising service and retain the data directory. A Cloudflare quick-tunnel URL can change when its tunnel is recreated.

The page uses real Apps SDK UI login/header controls and CopilotChat-owned messages. Newbot owns only login, selected native thread and connection/theme state. Refresh restores server history; reconnect does not resubmit an operation. Unsupported tools, files and transcription controls are omitted. Text-only scope means tool/reasoning/attachment presentation, Actions and trusted approvals are still incomplete.

The installed SDK requires AG-UI 1.0.2/RxJS 7.8.1. Strict peer checking stays enabled. Official `@a2ui/react@0.15.0` currently fails strict peer resolution through markdown-it 0.2.2; the candidate CopilotKit renderer/core probe is not yet a browser acceptance test. See [compatibility ADR](../../.issue/2026-11-14/newbot-v1-g1-compatibility-adr.md).

Apps SDK UI's KaTeX font URLs are rewritten at build time to the locked KaTeX package's local font assets. Its package license is retained in installed dependencies. CopilotKit's existing Streamdown renderer is retained; its public plugin list is reordered to sanitize untrusted HTML before generating trusted math, preserving both upstream safety filters. No vendor package is patched, no unsafe HTML filter is disabled, and no second Agent frontend is introduced.

The UI is a G1 proof of integration in the user-pinned ChatGPT/Apps SDK direction. It does not replace the deployed Grok-era product design documentation. Performance, full G1 Actions/A2UI/MCP Apps, product migration, multiple Bots and production deployment remain separate acceptance gates. In particular the default chat bundle is currently too large to claim the lightweight target has passed.

Plans, failures and real versus simulated evidence: [runtime progress](../../.issue/2026-11-14/newbot-v1-g1-runtime-progress.md), [browser plan](../../.issue/2026-11-14/newbot-v1-g1-browser-plan.md).
