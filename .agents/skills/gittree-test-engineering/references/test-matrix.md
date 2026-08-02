# GitTree test matrix

## Layer selection

| Risk | Layer | Fixture | Avoid |
| --- | --- | --- | --- |
| Parser, validator, graph layout, state reducer | Unit | plain values | Electron startup |
| Renderer model or component lifecycle | Unit | injected fakes and minimal DOM seam | global `window.app` |
| Git command behavior | Integration | isolated real repository | mocking `simple-git` internals |
| Hosting provider mapping and failures | Integration | local HTTP server | live APIs and tokens |
| IPC registration and validation | Integration | fake Electron adapter | string-only source inspection |
| Window lifecycle, deep link, preload wiring | E2E | Playwright Electron + temp `userData` | manual CDP scripts |
| Full user workflow | E2E | deterministic repository | checking private methods |
| 10k-commit graph, DOM rows, resize timing | Performance | synthetic benchmark | PR functional gate based on wall time |

## Required assertions by boundary

### Git

- Clean, dirty and conflicting working trees.
- Queue ordering and recovery after a rejected operation.
- Missing identity, hook failure and operation-state guards.
- Paths with spaces, Unicode and malicious-looking arguments.

### Hosting

- Pagination and normalized results.
- Expired authentication, rate limit and timeout.
- Incomplete or malformed payloads.
- Partial reviews and retry without duplicate comments.
- Unsupported provider capability.

### Renderer

- Initial, loading, empty, populated and error states.
- Focus entry, keyboard navigation, Escape and focus restoration.
- Listener/timer/subscription cleanup on destroy.
- Long names, long paths, English/Italian and light/dark where visual.

### Release

- Stable versus prerelease metadata.
- Signed and unsigned Windows paths.
- Signed OTA versus unsigned manual-only macOS.
- Linux AppImage and DEB asset completeness.
- Manifest name, size and hashes against the exact uploaded asset.

## Flakiness rules

Wait on observable state, events or explicit readiness signals. Do not add sleeps to hide races. Capture Playwright trace, screenshot and redacted logs only on failure. A deterministic failure is more valuable than a retry that turns the gate green.
