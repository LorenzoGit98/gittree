# GitTree — Context

GitTree is a desktop Git client (Electron) that presents a local repository's
history as a multi-lane graph and runs **explicit, reversible git operations**.
Privacy-first: no accounts, no telemetry, no repository upload.

## Domain language

- **Repository** — a git working tree registered in the workspace (the app only
  operates on registered repositories; `assertManagedRepo`).
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

## Architecture

- **Main process** (`src/main/`) — git operations via `git-service.js`
  (simple-git + `execFile` argv arrays, no shell), hosting APIs
  (`hosting-service.js`), encrypted credential vault (`credential-vault.js`,
  Electron `safeStorage`), OTA updates, repo manager, IPC surface in `main.js`.
- **Preload** (`src/preload.js`) — the only bridge: an explicit, whitelisted
  `window.gitTree` API. The inspector window uses a dedicated minimal preload.
- **Renderer** (`src/renderer/`) — bento workspace with components per surface
  (graph, branch list, changes, pull requests, conflict resolver, merge
  workspace, settings, search, reflog). All DOM rendering escapes data with
  `esc()` (quotes included); CSP `default-src 'self'`.
- **IPC contract** — handlers return `{ error }` instead of rejecting with
  strings; every git/hosting/terminal handler validates the repository path
  against the registered repo set.

## Conventions

- Conventional Commits (`feat`/`fix`/`perf`/`refactor`/`style` bump; `feat` and
  breaking → minor on the 0.x line, the rest → patch).
- ESLint flat config, error-level rules, enforced in CI.
- Every feature ships English + Italian i18n keys (enforced by
  `test/i18n-parity.test.js`).
- Design rules live in `DESIGN.md` and are audited by `npm run audit:design`
  (opaque surfaces, semantic tokens, transform/opacity-only motion).
- Decision records: `docs/adr/`.
