# ADR-0002 — Renderer is untrusted; defense in depth

- Status: accepted
- Date: 2026-08

## Context

An Electron renderer may be compromised through any future XSS, and malicious
repositories can ship hostile branch names, file names, submodules and hooks.
The app must not grant the renderer arbitrary capabilities, and git input
must be validated before reaching argv.

## Decision

1. **No raw git bridge** — the preload exposes a whitelisted API; every
   `git:*`/`hosting:*`/`auth:*` handler validates that `repoPath` is a
   registered repository (`assertManagedRepo`).
   Repository admission is owned by `RepositoryWorkspace`: arbitrary renderer
   paths are rejected unless they came from a native directory picker, an
   approved scan, a completed clone or a validated main-process deep link.
2. **Git input validation** — branch names via `check-ref-format`, revisions
   via `assertCommitish`/`assertSafeRef` (reject leading `-`, whitespace,
   control chars), paths via `validateRepositoryPath` (rejects `..`,
   absolute paths and symlink traversal), stashes via numeric index.
3. **Window lockdown** — `contextIsolation` + `sandbox`, navigation restricted
   to the app renderer directory, popups denied, all permission requests
   denied, `openExternal` limited to a host allowlist over HTTPS.
4. **Secrets** — tokens live in the main process, encrypted with `safeStorage`,
   never returned to the renderer, redacted from logs.

## Consequences

- A compromised renderer cannot touch repositories outside the workspace or
  expand the workspace without a native user-authorized path, nor inject git
  options; it can still issue operations the user could do on managed repos.
- Malicious repo content is treated as data, escaped with `esc()` (quotes
  included) and validated again at the boundary.
