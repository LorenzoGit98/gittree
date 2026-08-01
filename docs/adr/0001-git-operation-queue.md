# ADR-0001 — Per-repository git operation queue

- Status: accepted
- Date: 2026-08

## Context

The renderer fires many git operations concurrently (2s working-tree polls,
background refreshes, user actions). simple-git runs up to 5 processes per
instance by default, so `checkout`, `merge`, `commit`, `push`, `stage` and
reads could interleave, producing `index.lock` failures, torn snapshots and
operations racing a mid-checkout repository.

## Decision

Every async method of `GitService` runs serialized through a per-instance
promise chain. Internal cross-method calls (e.g. `commitChanges` →
`getIdentity` → `getConfigValue`) are detected with `AsyncLocalStorage` and
run inline in the current queued task, avoiding self-deadlock. Repository
paths are normalized (case-insensitive on Windows) so one repo always maps to
one queue.

## Consequences

- Mutating and reading operations on the same repository are strictly
  serialized; different repositories stay fully parallel.
- Synchronous helpers (`parseNameStatus`, validation) are not queued.
- The renderer's 2s poll waits behind a push — locally this is milliseconds.
