# GitTree architecture

GitTree keeps a vanilla JavaScript, CommonJS and native DOM stack. The goal is
not to create more layers: it is to make ownership obvious, keep public
contracts stable and place volatile details behind narrow Seams.

## Dependency direction

```text
Electron entry point
  -> Application runtime
    -> domain IPC registration
      -> stable service Interface
        -> internal Module or provider Adapter

Renderer entry point
  -> lifecycle and operation controllers
    -> feature views
      -> pure helpers and shared primitives

Preload whitelist
  -> named IPC channels only
```

Dependencies point inward toward stable Interfaces. An Implementation may know
its Interface; the Interface must not depend on provider payloads, Electron
globals or renderer state.

## Contributor map

| Capability | Primary owner | Verification |
| --- | --- | --- |
| Electron lifecycle, windows and deep links | `src/main/application-runtime.js`, composed by `src/main/main.js` | `test/application-runtime.test.js` and Electron E2E |
| IPC registration and error envelopes | `src/main/ipc/` plus `src/preload.js` | IPC handler, parity and preload contract tests |
| Git public operations | `src/main/git-service.js` | `test/git-service*.test.js` with deterministic real repositories |
| Repository history, graph, refs and commit diff | `src/main/git/repository-history.js` behind `GitService` | `test/git-history-repository-contracts.test.js` and graph integration tests |
| Repository status, snapshots, file and hunk operations | `src/main/git/repository-working-tree.js` plus the pure patch parser | working-tree contracts, integration tests and hardening tests |
| Repository path, Git Adapter and serialization | `src/main/git/repository-session.js` | `test/repository-session.test.js` |
| Hosting credentials, auth, retry and error policy | `src/main/hosting-service.js` and the credential vault | hosting service and IPC contract tests |
| Provider list, detail and diff behavior | `src/main/hosting/providers/` | `test/hosting-provider-adapters.test.js` and `test/hosting-provider-read-contracts.test.js` |
| Repository activation and refresh | `src/renderer/repository-load-session.js` and renderer coordinators | focused controller tests and Electron E2E |
| Remote operation feedback | `src/renderer/remote-operation-controller.js` | `test/remote-operation-controller.test.js` and Electron E2E |
| Workspace resize and panel motion | `src/renderer/workspace-resize-controller.js`, `src/renderer/workspace-panel-motion.js` | controller tests, performance benchmarks and `docs/MOTION.md` |
| Visual rules and localization | `DESIGN.md`, renderer styles and i18n resources | design audit, i18n parity and Electron E2E |
| Packaging and release integrity | `.github/workflows/`, release scripts and electron-builder config | release contract tests and package checks |

## Stable Seams

- `window.gitTree` exposes named, whitelisted methods. Do not add a generic
  `invoke(channel, ...)` escape hatch.
- IPC handlers preserve the existing argument/result contract, return
  `{ error }`, and validate managed repositories at the boundary.
- `GitService` is the public Interface. Every asynchronous repository operation
  continues through the same per-repository queue.
- `HostingService` owns cross-provider policy. Provider Adapters own endpoint,
  payload and normalized provider behavior.
- Renderer Modules receive bridge, translation, storage and callbacks
  explicitly. Do not add new reads from `window.app`.
- Use `textContent` for plain data and the shared encoder only when markup is
  necessary.
- Do not introduce a framework, bundler or TypeScript.

## What makes a good Module

A Module should provide one complete capability through a small Interface. It
earns its boundary through Depth: callers get useful behavior without knowing
the volatile Implementation. Prefer high Leverage and Locality over many
one-line wrappers.

Before extracting a Module, answer these questions:

1. What complete capability does it own?
2. Which dependencies are injected, and who owns their lifecycle or teardown?
3. Can its behavior be characterized through the intended Interface?
4. Does deleting the old path break the capability, proving that there is one
   source of truth?
5. Can the checkpoint be reverted without changing public behavior or user
   data?

## Change protocol

1. Add characterization tests at the narrowest meaningful public Seam.
2. Move one behavior group without changing names, arguments or results.
3. Run the focused tests while iterating.
4. Run lint, contract tests and `npm run quality` before committing.
5. Run Electron E2E when wiring or user workflows change; run performance
   benchmarks when renderer scheduling, DOM volume or memory can change.
6. Commit an independently reviewable and revertible checkpoint.

## Current consolidation state

- The Application runtime and domain IPC registration are extracted and
  covered behind stable contracts.
- Hosting provider Adapters own the complete normalized pull-request capability:
  list, detail, diff, thread resolution, review submission and creation.
  `HostingService` retains validation, authenticated transport, vault ownership
  and the retry journal without exposing credentials to an Adapter.
- `GitService` remains intentionally stable. Repository history and Repository
  working tree are cohesive internal Modules; all calls continue through the
  existing Repository session and per-repository queue.
- `GitTreeApp` is still a large renderer coordinator. New work should deepen
  existing controller Modules instead of adding more responsibilities to it.

This section is a status map, not permission for a broad rewrite. Behavior and
public Interfaces stay stable throughout the consolidation program.
