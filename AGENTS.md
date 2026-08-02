# GitTree engineering instructions

These instructions apply to the entire repository.

## Product invariants

- Keep the stack vanilla: JavaScript, CommonJS, Electron and the native DOM.
- Do not add a framework, bundler or TypeScript without an explicit product decision.
- Preserve the named `window.gitTree` API. Never expose a generic public IPC invoke method.
- Preserve registered-repository validation, the per-repository Git queue and `{ error }` IPC envelopes.
- Keep GitTree local and privacy-first: no telemetry, repository upload or automatic diagnostics upload.
- Treat `CONTEXT.md` and the ADRs in `docs/adr/` as architectural constraints.

## Required project skills

- Use `.agents/skills/gittree-vanilla-architecture/SKILL.md` for architecture work, refactors, new modules, renderer components, dependency boundaries or maintainability reviews.
- Use `.agents/skills/gittree-test-engineering/SKILL.md` for test strategy, fixtures, coverage, Electron E2E, performance checks or flaky-test work.
- Also use `.agents/skills/gittree-design-system/SKILL.md` for every renderer-facing UI or CSS change.
- Also use `.agents/skills/gittree-release/SKILL.md` for release, packaging, signing or updater work.

Read every selected `SKILL.md` completely before changing files. Read only the referenced resource needed for the task.

## Architecture rules

- Keep `src/main/main.js` as composition and lifecycle code. Put behavior in cohesive domain modules.
- Register IPC by domain. Validate untrusted input at the IPC seam before calling domain code.
- Keep `GitService` and `HostingService` as stable public facades; deepen their internal modules instead of widening public APIs.
- Give each renderer component one complete UI responsibility. For new or extracted components, prefer explicit `mount`, `update` and `destroy` lifecycle methods.
- Inject bridge, translation, storage, dialogs and callbacks through constructors or factories. Do not add dependencies on `window.app`; access globals only in renderer composition roots.
- Prefer a deep module with a small interface over several forwarding wrappers.
- Keep domain state outside DOM nodes. Render from explicit state and make cleanup of listeners, timers and subscriptions deterministic.
- Use `textContent` for plain text and the shared HTML encoder only when markup is required.

## Change workflow

1. Map the current public behavior and applicable ADRs.
2. Add characterization tests before moving risky behavior.
3. Make one coherent, behavior-preserving extraction at a time.
4. Run the narrowest relevant tests while iterating, then `npm run quality` before checkpointing.
5. Keep intermediate commits focused, independently revertible and described with Conventional Commits.

Do not mix architectural cleanup with new product features. If a change needs a public contract change, stop and document the decision first.
