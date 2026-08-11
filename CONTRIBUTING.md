# Contributing

Thanks for your interest in GitTree. Everyone is welcome to contribute.

## Getting started

1. Fork the repository.
2. Run `npm install`.
3. Run `npm start` to launch the app.

## Development

- **Architecture**: Start with the ownership map in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the domain language in [`CONTEXT.md`](CONTEXT.md)
- **Engineering rules**: Read `AGENTS.md` before changing code; it preserves the vanilla stack and defines module and component boundaries
- **Git operations**: Keep the public `GitService` facade stable. `RepositoryOperations` owns the entire merge/rebase/cherry-pick cycle—preflight, execution, conflicts and recovery—so do not split individual commands into shallow modules
- **Git tests**: Characterize operation workflows through `test/repository-operations-contracts.test.js` with isolated real repositories before changing the internal implementation
- **Git IPC**: Register IPC in the matching `src/main/ipc/` domain module, bridge explicitly in `src/preload.js`, and consume it through injected renderer dependencies
- **Repository workspace**: Keep admission, canonical paths, persisted entries, GitService reuse and linked-worktree queue identity in `src/main/repository-workspace.js`; add contracts in `test/repository-workspace.test.js` before changing this Seam
- **Application runtime**: Keep `src/main/main.js` as a minimal Electron entry point; compose owned services and teardown in `main-application.js`, with lifecycle contracts in `test/main-application.test.js` and `test/application-runtime.test.js`
- **UI modules**: Keep views in `src/renderer/components/` and lifecycle or operation policy in focused renderer controllers; do not add responsibilities to `GitTreeApp` when an existing Module owns the capability
- **Styling**: CSS custom properties in `src/renderer/styles/variables.css`, component styles in `src/renderer/styles/`
- **i18n**: Add translations in `src/renderer/i18n.js` under the appropriate locale

Project-local skills under `.agents/skills/` provide the detailed architecture, testing, design-system and release workflows. Use the relevant skill instead of introducing a new local convention.

## Running tests

```bash
npm test              # unit and integration tests
npm run test:e2e      # Electron end-to-end tests
npm run quality       # complete local quality gate
```

## Pull requests

- Keep changes focused. One feature or fix per PR.
- Characterize existing behavior before a refactor and update tests at the
  narrowest meaningful Interface.
- Run `npm run quality` before submitting. Also run `npm run test:e2e` when
  Electron wiring or user-visible workflows change.
- Use conventional commit messages when possible.

## Licensing contributions

By submitting a contribution, you confirm that you have the right to provide
it and agree that it is licensed under the project's [MIT License](LICENSE).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be respectful and constructive.
