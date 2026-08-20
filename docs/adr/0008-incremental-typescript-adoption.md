# ADR-0008 — Incremental TypeScript adoption

- Status: accepted
- Date: 2026-08
- Supersedes (in part): the "no TypeScript" reading of the vanilla-stack
  invariant in `AGENTS.md`.

## Context

GitTree is ~25k lines of vanilla CommonJS JavaScript across 94 modules
(main process, preload, renderer) with 81 test files. The IPC seam between an
untrusted renderer and the main process, the `{ error }` envelope contract and
the service facades are all implicit: their shapes live in convention and
characterization tests, not in types. As the surface grows, refactors rely on
runtime tests to catch contract drift that a compiler would reject statically.

The original invariant banned TypeScript together with frameworks and bundlers
to keep the stack boring and directly inspectable. The product owner has now
made the explicit decision to adopt TypeScript, incrementally, without
sacrificing the operational properties that motivated the invariant.

## Decision

1. **Incremental, opt-in per module.** No big-bang rewrite. Each module moves
   to TypeScript in its own focused, independently revertible checkpoint while
   its characterization tests stay green.
2. **Typecheck-first ramp.** Phase 0 adds `tsc --noEmit` with `allowJs` and
   `strict`. Existing `.js` files keep running unchanged; modules opt into
   checking with `// @ts-check` and JSDoc until they convert to `.ts`.
3. **One build step, no bundler.** When an area starts converting to `.ts`
   (Phase 1 cutover), `tsc` emits CommonJS to `dist/` and Electron, tests,
   coverage and packaging read from there. No bundler, no runtime transpiler,
   no dual module systems; emitted output stays reviewable CommonJS.
4. **Scope order follows dependency direction.** Shared IPC contracts first,
   then main-process leaves (parsers, small utilities), domain internals,
   facades and composition, preload last among converted areas. Tests convert
   alongside the module they cover.
5. **Renderer stays directly loadable.** `index.html` loads renderer scripts
   without a build step, so renderer `.ts` is out of scope for this ADR.
   Renderer code gets JSDoc types under the same typecheck gate; a renderer
   build step requires a new ADR.
6. **Public contracts freeze during migration.** `window.gitTree`, `{ error }`
   envelopes, registered-repo validation, queue semantics, storage formats and
   keyboard behavior do not change as a side effect of typing.
7. **Vanilla discipline survives.** No framework, no decorators, no
   `any`-typed escape hatches at boundaries: IPC seams get explicit interfaces;
   untrusted input stays validated at the seam regardless of types.

## Consequences

- Two new dev dependencies (`typescript`, `@types/node`); Electron already
  ships its own type definitions.
- `npm run typecheck` joins the quality gate; mixed `.js`/`.ts` coexists for
  the duration, tracked by `docs/ts-migration-plan.md`.
- Phase 1's emit cutover touches packaging and script paths once, atomically,
  before any runtime module renames.
- Renderer remains plain JavaScript for now; it still benefits from typed main
  contracts through JSDoc-referenced definitions.
