# ADR-0005 — Local agent sessions are worktree-scoped supervised PTYs

- Status: accepted
- Date: 2026-08

## Context

GitTree needs to run several external coding-agent CLIs concurrently without
giving the untrusted renderer a generic process or shell capability. Agent work
must remain isolated by Git worktrees, while credentials, model selection and
permission policy continue to belong to each installed CLI.

Interactive terminal processes are native resources. They must have explicit
ownership, bounded persistence and deterministic shutdown across Windows,
macOS and Linux. Linked worktrees share Git references, but each has an
independent working directory and index.

## Decision

1. `AgentSessionService` in the main process owns task metadata, the global
   FIFO queue and every PTY. One running task is allowed per canonical
   worktree. The default global concurrency is four and is configurable from
   one to thirty-two.
2. The renderer can choose only a built-in adapter identifier and validated
   task data. Adapter implementations select the executable and argv; IPC
   never accepts an executable, arbitrary argv or a shell command.
3. Codex, Claude Code and OpenCode run with their existing local credentials,
   model configuration and permission policy. GitTree never adds approval or
   sandbox bypass flags and never stores provider tokens.
4. New agent tasks use a main-process-authorized worktree root. Setup is
   limited to lockfile-derived, fixed argv recipes. Paths selected by the
   renderer are revalidated against managed-repository and worktree metadata.
5. Session metadata is atomically persisted below Electron `userData`.
   Initial prompts, terminal output and source content are not persisted by
   GitTree. Tasks that were active at shutdown restore as `interrupted` and
   never resume automatically.
6. The renderer receives named task events and bounded terminal data. Terminal
   input and resize messages address an existing task ID and are size-checked.
7. App shutdown asks before stopping active tasks. Accepted shutdown sends a
   graceful interrupt, waits up to five seconds, terminates remaining process
   trees and records the tasks as interrupted.

## Consequences

- GitTree remains local and privacy-first while supporting parallel work.
- A compromised renderer can operate only already-managed worktrees through
  the named capability surface; it cannot spawn an arbitrary command.
- External agent Git commands cannot participate in GitTree's in-process
  queue. Snapshot guards and periodic refresh therefore continue treating the
  filesystem as externally mutable.
- `node-pty` becomes a native runtime dependency and must be rebuilt for the
  Electron ABI and verified in every native package.

