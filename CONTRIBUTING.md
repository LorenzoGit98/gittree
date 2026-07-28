# Contributing

Thanks for your interest in GitTree. Everyone is welcome to contribute.

## Getting started

1. Fork the repository.
2. Run `npm install`.
3. Run `npm start` to launch the app.

## Development

- **Architecture**: Electron main process (`src/main/`) + preload bridge (`src/preload.js`) + vanilla JS renderer (`src/renderer/`)
- **Git operations**: Add methods to `src/main/git-service.js`, expose via `src/main/main.js` IPC handlers, bridge in `src/preload.js`, consume in renderer components
- **UI components**: Each feature is a class in `src/renderer/components/`, loaded in `src/renderer/index.html`
- **Styling**: CSS custom properties in `src/renderer/styles/variables.css`, component styles in `src/renderer/styles/`
- **i18n**: Add translations in `src/renderer/i18n.js` under the appropriate locale

## Running tests

```bash
npm test           # unit tests
npm run audit:design  # design system audit
npm run test:renderer-ui  # UI regression tests (requires running app)
```

## Pull requests

- Keep changes focused. One feature or fix per PR.
- Write or update tests for backend changes (`test/` directory).
- Run `npm run validate` before submitting.
- Use conventional commit messages when possible.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be respectful and constructive.
