# Newbot v1 integration lab

Isolated compatibility work for NB-V1 G1. This directory has its own exact dependency lock; it is not included in the root TypeScript project or production build.

```sh
cd labs/v1-integration
npm ci
npm test
```

The five probes exercise the **installed upstream packages**: self-hosted Runtime discovery, run/connect routing without another agent loop, rejection of an identity-enabled runner lacking ownership enforcement, A2UI 1.0 incremental state/deletion, and refusal of an unregistered catalog. Telemetry is disabled; a fetch guard rejects outbound calls during the probes. This guard is not a complete network sandbox.

The recording runner is a test fixture. These checks do **not** prove Codex integration, Fastify cookie/Origin handling, browser rendering, user actions, Apps SDK UI interaction, MCP Apps hosting, persistence or multi-Bot isolation. No production credentials are loaded. Do not mount this fixture as a server endpoint.

`@a2ui/react@0.15.0` currently fails strict peer resolution against core 0.15.0 through markdown-it 0.2.2. The lab tests `@copilotkit/a2ui-renderer@1.88.0` with official core 0.15.0 as a candidate; a successful protocol probe is not approval to switch production rendering. See [compatibility ADR](../../.issue/2026-11-14/newbot-v1-g1-compatibility-adr.md).
