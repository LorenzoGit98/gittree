# Contributing

Thanks for your interest in GitTree. Everyone is welcome to contribute.

## Getting started

1. Fork the repository.
2. Run `npm install`.
3. Run `npm start` to launch the app.

## Development

- **Architecture**: Electron main process (`src/main/`) + preload bridge (`src/preload.js`) + vanilla JS renderer (`src/renderer/`)
- **Engineering rules**: Read `AGENTS.md` before changing code; it preserves the vanilla stack and defines module and component boundaries
- **Git operations**: Keep the public `GitService` facade stable, register IPC in the matching `src/main/ipc/` domain module, bridge explicitly in `src/preload.js`, and consume it through injected renderer dependencies
- **UI components**: Each feature is a class in `src/renderer/components/`, loaded in `src/renderer/index.html`
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
- Write or update tests for backend changes (`test/` directory).
- Run `npm run validate` before submitting.
- Use conventional commit messages when possible.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be respectful and constructive.
