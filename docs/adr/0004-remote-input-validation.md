# ADR-0004 — Validation at the IPC boundary for remote input

- Status: accepted
- Date: 2026-08

## Context

Repository URLs, remote names, tag names and clone destinations reach git
through renderer-controlled strings. Untrusted values can become git options
(leading `-`), escape the repository (path traversal), or point the app at
unexpected hosts (Azure org spoofing, `github.com.evil.com`).

## Decision

- **Clone** accepts only remote transports (`https://`, `ssh://`,
  `git+ssh://`, scp-style `git@host:path`); `file:`, `git:` and local paths
  are rejected, along with control characters.
- **Remotes** validate names with `check-ref-format` and URLs without
  CRLF/NUL/leading dash.
- **Tags** are validated with the same rules used for creation before
  deletion or push.
- **External URLs** (`openExternal`) must be HTTPS and match an exact host
  allowlist (`github.com`, `gitlab.com`, `dev.azure.com`, `bitbucket.org`).
- **Azure remotes** validate organization and project against the documented
  identifier rules before any API call.

## Consequences

- Option injection, path traversal and phishing-style host confusion are
  blocked at the boundary; the renderer cannot widen the surface by
  constructing URLs itself.
