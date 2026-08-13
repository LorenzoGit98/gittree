# ADR-0007 — Local-first AI integration

- Status: accepted
- Date: 2026-08

## Context

Users want AI-assisted commit messages and pull-request descriptions that
understand the staged or in-flight changes. GitTree is privacy-first: no
telemetry, no repository upload, and credentials never leave the device. Any
AI feature must keep that promise while supporting the providers users already
run: OpenAI-compatible endpoints (DeepSeek, OpenAI, OpenRouter), Anthropic, and
the local OpenCode CLI.

## Decision

- The AI capability lives in a dedicated `AiService` in the main process.
  The renderer only talks to it through named `ai:*` IPC channels that return
  `{ error }` envelopes; there is no generic invoke surface.
- API keys are stored in the existing encrypted `CredentialVault` under the
  provider id `ai` and are never returned to the renderer — only a
  `keyConfigured` boolean is exposed. Non-secret settings (provider, base URL,
  model, output language) live in a local JSON store.
- Three provider modes:
  - **OpenAI-compatible**: base URL + model + key, `POST /chat/completions`.
  - **Anthropic**: model + key, `POST /v1/messages`.
  - **OpenCode CLI**: no key in GitTree; invokes `opencode run <prompt>
    --format json` headless through a pseudo-terminal (node-pty, the same
    seam agent sessions use — plain pipes make the CLI hang on Windows) and
    uses OpenCode's own configuration and active model. An optional model
    override (`--model provider/model`) lets users pick a working model when
    the active one is unavailable. Text is collected from JSON message parts;
    error events become normalized errors.
- Provider output is parsed from a strict `TITLE:` / `BODY:` format so every
  mode shares one parser and one prompt contract.
- Base URLs must be `https://`, with an explicit loopback exception
  (`http://127.0.0.1`, `http://localhost`, `http://[::1]`) for local models;
  the same exception lets the performance benchmark run against a local fake
  provider without weakening the production rule.
- Prompts are bounded: the diff is truncated to 24 KiB before prompting.
  Generation runs in the main process; the renderer shows an explicit loading
  state and is never blocked.
- Configured keys are exported as environment variables to agent CLI sessions
  (`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `OPENAI_BASE_URL`) so the existing OpenCode/Codex/Claude agents reuse the
  same identity.
- Nothing is transmitted anywhere except the user-initiated request to the
  configured provider. API keys and `x-api-key` headers are redacted from
  logs and diagnostics exports.

## Consequences

- AI generations are network- or CLI-bound and can take seconds; the UI must
  treat them as asynchronous with honest loading/error states.
- The OpenCode mode depends on the user's local CLI and its own
  authentication; failures surface as normalized errors with the CLI message.
- The AI performance benchmark asserts settings-open latency stays flat, the
  renderer heartbeat survives a slow generation, and prompt payloads stay
  within the documented bound.
