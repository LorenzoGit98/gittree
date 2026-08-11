# GitTree — Context

GitTree is a desktop Git client (Electron) that presents a local repository's
history as a multi-lane graph and runs **explicit, reversible git operations**.
Privacy-first: no accounts, no telemetry, no repository upload.

## Domain language

- **Application runtime** — the Electron lifecycle, dependency composition,
  deep-link routing and window teardown owned by `application-runtime.js`; the
  entry point only constructs and starts it.
- **Repository** — a git working tree registered in the workspace (the app only
  operates on registered repositories; `assertManagedRepo`).
- **Repository session** — the internal Git unit that owns a normalized path,
  the `simple-git` Adapter and one per-repository queue while `GitService`
  remains the stable public Interface.
- **Repository history** — the read-only Git capability for log, graph, refs,
  commit comparisons and commit diff/detail queries within one Repository
  session.
- **Repository working tree** — the Git capability that observes status,
  creates Working tree snapshots and owns safe file/hunk stage, unstage and
  discard operations.
- **Repository operations** — the Git capability that owns the complete
  preflight, execution, conflict and recovery cycle for merge, rebase and
  cherry-pick, including operation-state detection and conflict resolution.
- **Working tree snapshot** — a content-addressed fingerprint (sha256 of branch,
  per-file status, sizes, mtimes and index state) that guards stage/unstage/
  discard operations against concurrent changes.
- **Operation state** — an in-progress merge/rebase/cherry-pick detected from
  git state files; blocks destructive actions until continued, skipped or aborted.
- **Per-repo queue** — every async git operation on a `GitService` runs
  serialized through a promise chain (`AsyncLocalStorage` marks re-entrant
  internal calls so they don't deadlock).
- **Conflict block** — a `<<<<<<<`/`=======`/`>>>>>>>` region parsed from a
  conflicted file for the visual resolver.
- **Hosting provider adapter** — the provider-specific Implementation of the
  normalized pull-request Interface. GitHub, GitLab and Azure endpoint details,
  payloads and fallbacks stay behind this Seam.

## Architecture

- **Main process** (`src/main/`) — `main.js` is a composition root;
  `application-runtime.js` owns lifecycle and windows, and domain handlers live
  in `src/main/ipc/`. `GitService` and `HostingService` are stable Interfaces
  over deeper internal Modules and provider Adapters.
- **Git implementation** — `git-service.js` exposes the public capability while
  `src/main/git/` owns Repository sessions, Repository history, Repository
  working tree, Repository operations and cohesive Implementations. Git
  commands use `simple-git` or `execFile` argv arrays, never a shell string.
- **Hosting implementation** — `hosting-service.js` orchestrates credentials,
  authentication, retries and normalized errors. `src/main/hosting/providers/`
  owns provider-specific pull-request behavior.
- **Preload** (`src/preload.js`) — the only bridge: an explicit, whitelisted
  `window.gitTree` API. The inspector window uses a dedicated minimal preload.
- **Renderer** (`src/renderer/`) — bento workspace with components per surface
  and small controller Modules for repository loading, remote operations,
  workspace state and motion. Prefer `textContent`; when markup is required,
  use the shared HTML encoder. CSP is `default-src 'self'`.
- **IPC contract** — handlers return `{ error }` instead of rejecting with
  strings; every git/hosting/terminal handler validates the repository path
  against the registered repo set.

The contributor-facing ownership map and dependency direction live in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Conventions

- Conventional Commits (`feat`/`fix`/`perf`/`refactor`/`style` bump; `feat` and
  breaking → minor on the 0.x line, the rest → patch).
- ESLint flat config, error-level rules, enforced in CI.
- Every feature ships English + Italian i18n keys (enforced by
  `test/i18n-parity.test.js`).
- Design rules live in `DESIGN.md` and are audited by `npm run audit:design`
  (opaque surfaces, semantic tokens, transform/opacity-only motion).
- Refactors start with characterization tests, move one complete capability at
  a time, and end with `npm run quality`. Each checkpoint must remain
  independently revertible.
- Decision records: `docs/adr/`.
