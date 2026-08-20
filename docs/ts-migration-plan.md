# TypeScript migration plan

Companion to [ADR-0008](adr/0008-incremental-typescript-adoption.md).
Tracks the incremental conversion of all 94 JavaScript modules to TypeScript.
Every checkpoint is behavior-preserving, independently revertible and ends with
`npm run quality` green.

## Rules for every converted module

1. Public names, arguments, results and side effects do not change.
2. The module is `strict`-clean under `npx tsc --noEmit`.
3. Its characterization tests pass unchanged (renames only if the whole area
   converts together).
4. Untrusted input stays validated at the IPC seam regardless of types.
5. No `any` at boundaries: IPC payloads, service results and preload methods
   get explicit interfaces or typedefs.

## Wave 0 — Decision, toolchain, pilot (this branch)

- [x] ADR-0008 accepted; `AGENTS.md` and `CONTEXT.md` updated.
- [x] `typescript` + `@types/node` dev dependencies; `tsconfig.json`
      (`noEmit`, `allowJs`, `strict`, opt-in checking via `// @ts-check`).
- [x] `npm run typecheck` wired into `scripts/quality.js` (scoped + full).
- [x] Pilot: `src/main/git-version.js` fully typed under `@ts-check`.

## Wave 1 — Emit cutover (single atomic infrastructure commit)

Before any `.ts` file exists at runtime:

- [ ] `tsconfig.json`: `noEmit: false`, `outDir: dist/`, declaration off,
      source maps on; `.js` passthrough emit keeps mixed trees runnable.
- [ ] `package.json`: `main` → `dist/main/main.js`; scripts that read `src/**`
      (tests, coverage includes, benchmarks) read `dist/**`; `dist/` gitignored.
- [ ] Test imports switch mechanically from `../../src/…` to `../../dist/…`.
- [ ] `electron-builder` packaging globs ship `dist/**` instead of `src/**`;
      release smoke test verifies the packaged app boots.
- [ ] Full quality gate + `npm run test:e2e` green before moving on.

## Wave 2 — Main-process pure leaves

Parsers, formatters and small utilities with no I/O fan-out. Convert to
`.ts` with explicit input/result types.

- [ ] `src/main/git-version.js` (rename of the typed pilot)
- [ ] `src/main/conflict-model.js`
- [ ] `src/main/git/blame-parser.js`
- [ ] `src/main/git/patch-parser.js`
- [ ] `src/main/provider-links.js`
- [ ] `src/main/oauth-config.js`
- [ ] `src/main/workspace-profile-conversion.js`
- [ ] `src/main/deep-link.js`
- [ ] `src/main/ai/ai-output.js`
- [ ] `src/main/agents/setup-recipes.js`
- [ ] `src/main/ai/ai-env.js`
- [ ] `src/main/ai/ai-providers.js`

## Wave 3 — Stateful domain internals

Modules owning state, queues, vaults and provider adapters, behind stable
facades.

- [ ] `src/main/git/repository-queue.js`
- [ ] `src/main/git/repository-session.js`
- [ ] `src/main/logger.js`
- [ ] `src/main/credential-vault.js`
- [ ] `src/main/diagnostics-exporter.js`
- [ ] `src/main/repository-scanner.js`
- [ ] `src/main/ai/ai-store.js`
- [ ] `src/main/agents/agent-session-store.js`
- [ ] `src/main/agents/pty-factory.js`
- [ ] `src/main/hosting/providers/index.js`
- [ ] `src/main/hosting/providers/github-provider.js`
- [ ] `src/main/hosting/providers/gitlab-provider.js`
- [ ] `src/main/hosting/providers/azure-provider.js`

## Wave 4 — Git domain capabilities and facades

- [ ] `src/main/git/repository-history.js`
- [ ] `src/main/git/repository-working-tree.js`
- [ ] `src/main/git/repository-worktrees.js`
- [ ] `src/main/git/repository-operations.js`
- [ ] `src/main/git-service.js`
- [ ] `src/main/hosting-service.js`
- [ ] `src/main/ai/ai-opencode.js`
- [ ] `src/main/ai/ai-service.js`
- [ ] `src/main/agents/agent-adapters.js`
- [ ] `src/main/agents/agent-session-service.js`
- [ ] `src/main/repository-workspace.js`
- [ ] `src/main/repo-manager.js`
- [ ] `src/main/working-tree-repository.js`
- [ ] `src/main/update-service.js`
- [ ] `src/main/inspector-window-controller.js`

## Wave 5 — IPC seam, shared contracts, composition, preload

Shared IPC payload types land first so handlers and preload share one
definition; renderer consumes them via JSDoc references only.

- [ ] Shared contract types for `{ error }` envelopes and `window.gitTree`
      (new `src/shared/` type definitions)
- [ ] `src/main/ipc/handler-registry.js`
- [ ] `src/main/ipc/git-handlers.js`
- [ ] `src/main/ipc/hosting-handlers.js`
- [ ] `src/main/ipc/repository-handlers.js`
- [ ] `src/main/ipc/window-application-handlers.js`
- [ ] `src/main/ipc/ai-handlers.js`
- [ ] `src/main/ipc/agent-handlers.js`
- [ ] `src/main/application-runtime.js`
- [ ] `src/main/main-application.js`
- [ ] `src/main/main.js`
- [ ] `src/preload.js`
- [ ] `src/preload-inspector.js`

## Wave 6 — Renderer typing without a build step (JSDoc ramp)

Renderer stays directly loadable vanilla JavaScript (ADR-0008). These files
get `// @ts-check` + JSDoc under the same gate; converting them to `.ts`
requires a new ADR introducing a renderer build step.

- [ ] `src/renderer/html-encoder.js`
- [ ] `src/renderer/i18n.js`
- [ ] `src/renderer/localized-date-formatter.js`
- [ ] `src/renderer/dialog-service.js`
- [ ] `src/renderer/theme.js`
- [ ] `src/renderer/repository-load-session.js`
- [ ] `src/renderer/remote-operation-controller.js`
- [ ] `src/renderer/repository-workspace-controller.js`
- [ ] `src/renderer/workspace-state-controller.js`
- [ ] `src/renderer/workspace-resize-controller.js`
- [ ] `src/renderer/workspace-panel-motion.js`
- [ ] `src/renderer/shortcut-controller.js`
- [ ] `src/renderer/pr-create-prefill.js`
- [ ] `src/renderer/inspector-window.js`
- [ ] `src/renderer/app.js`
- [ ] `src/renderer/components/*.js` (27 components, one checkpoint each)

## Tests and scripts

- Tests keep running as CommonJS `.js` against emitted output; renaming test
  files to `.ts` is optional and happens last, area by area, only if
  `node --test` keeps running them without extra loaders.
- `scripts/*.js` convert opportunistically after Wave 5; they are not on the
  critical path.

## Exit criteria

- Every checkbox above ticked, `npm run quality:full` and
  `npm run test:e2e` green, no `// @ts-check`-less main-process module left,
  and `docs/ts-migration-plan.md` archived into the ADR as completed.
