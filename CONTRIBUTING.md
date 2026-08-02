# Contributing

Thanks for your interest in GitTree. Everyone is welcome to contribute.

## Getting started

1. Fork the repository.
2. Run `npm install`.
3. Run `npm start` to launch the app.

## Development

- **Architecture**: Start with the ownership map in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the domain language in [`CONTEXT.md`](CONTEXT.md)
- **Engineering rules**: Read `AGENTS.md` before changing code; it preserves the vanilla stack and defines module and component boundaries
- **Git operations**: Keep the public `GitService` facade stable, register IPC in the matching `src/main/ipc/` domain module, bridge explicitly in `src/preload.js`, and consume it through injected renderer dependencies
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

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be respectful and constructive.
