<p align="center">
  <img src="icon.png" width="128" alt="GitTree">
</p>

<h1 align="center">GitTree</h1>

<p align="center">
  <strong>A fast, visual, privacy-first Git desktop client.</strong><br>
  SourceTree-style graph. Explicit operations. Local-first. No accounts.
</p>

<p align="center">
  <a href="https://github.com/lorenzogit98/gittree-minimal/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/lorenzogit98/gittree-minimal/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/lorenzogit98/gittree-minimal/releases"><img alt="Release" src="https://img.shields.io/github/v/release/lorenzogit98/gittree-minimal?display_name=tag"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-ISC-102A4C"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-102A4C">
</p>

<p align="center">
  <a href="#installation">Install</a> ·
  <a href="docs/USER_GUIDE.md">User Guide</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://github.com/lorenzogit98/gittree-minimal/releases">Releases</a>
</p>

---

## Why GitTree

Git is powerful, but text is not always the fastest way to understand a busy repository. GitTree answers the questions you ask every day — which branch am I on, where did this commit come from, what will this merge change — without hiding Git behind a proprietary model.

It works on the **local repository**, runs **explicit Git operations**, and presents the result in a high-performance visual workspace.

No mandatory accounts. No telemetry. No proprietary sync.

## Features

- **Multi-repo workspace** — tabs, recursive folder import, worktree-aware discovery, restored layout
- **Branch navigator** — local/remote folders, instant search, ahead/behind, SourceTree-style context menu
- **Multi-lane commit graph** — real parents, octopus merges, virtualized history, progressive paging
- **Staging & commit** — hunks, amend, sign-off, GPG/SSH signing, identity setup, hooks always on
- **Merge / rebase / cherry-pick** — previews, conflict editor (Incoming / Current / Result), Continue / Skip / Abort
- **Pull request review** — GitHub & GitLab OAuth device flow, diffs, inline comments, encrypted drafts
- **Hosting awareness** — GitHub, GitLab, Bitbucket Cloud, Azure DevOps compare/PR URLs
- **Themes & i18n** — light, dark, black; English and Italian
- **Keyboard-first** — fetch, pull, push, create branch shortcuts on every platform

Full workflow: [User Guide](docs/USER_GUIDE.md).

## Installation

Download the installer from [GitHub Releases](https://github.com/lorenzogit98/gittree-minimal/releases):

| Platform | Artifact |
| --- | --- |
| Windows | NSIS installer |
| macOS | DMG |
| Linux | AppImage or DEB |

Until production certificates are enabled, the OS may warn about unsigned builds.

### Run from source

Requires **Node.js 22+**, **Git**, and **npm**.

```bash
git clone https://github.com/lorenzogit98/gittree-minimal.git
cd gittree-minimal
npm ci
npm start
```

## Privacy & security

- No GitTree account
- No built-in telemetry
- No automatic repository upload
- No raw Git command bridge from the renderer
- OAuth tokens stay in the main process, encrypted with Electron `safeStorage`
- `contextIsolation` on, `nodeIntegration` off

Sensitive reports: [SECURITY.md](SECURITY.md).

## Development

| Command | Purpose |
| --- | --- |
| `npm start` | Launch the app |
| `npm test` | Run tests |
| `npm run validate` | Tests + design audit |
| `npm run audit:design` | Design-system rules |
| `npm run perf:renderer` | Renderer benchmark |
| `npm run dist:win` / `dist:mac` / `dist:linux` | Platform installers |

```text
src/
├── main/        Git, hosting, vault, IPC, updates
├── preload.js   Explicit isolated bridge
└── renderer/    Workspace, components, themes, i18n
```

Release guide: [docs/RELEASING.md](docs/RELEASING.md) · OAuth: [docs/OAUTH.md](docs/OAUTH.md) · Updates: [docs/UPDATES.md](docs/UPDATES.md) · Design: [DESIGN.md](DESIGN.md)

## Brand

Source code is ISC-licensed. The GitTree name, logo, and visual identity are not. Modified or commercial distributions must use distinct branding. See [TRADEMARKS.md](TRADEMARKS.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Before opening a PR:

1. Keep Git operations explicit and reversible
2. Never expose tokens or credentials to the renderer
3. Add English and Italian strings together
4. Follow the [design system](DESIGN.md)
5. Run `npm run validate`

## License

[ISC](LICENSE)
