<p align="center">
  <img src="icon.png" width="160" alt="GitTree">
</p>

<h1 align="center">GitTree</h1>

<p align="center">
  A fast, visual and concrete Git desktop client for understanding branches, commits, conflicts and code review.
</p>

<p align="center">
  <a href="https://github.com/lorenzogit98/gittree-minimal/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/lorenzogit98/gittree-minimal/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/lorenzogit98/gittree-minimal/releases"><img alt="Release" src="https://img.shields.io/github/v/release/lorenzogit98/gittree-minimal?display_name=tag"></a>
  <a href="LICENSE"><img alt="ISC license" src="https://img.shields.io/badge/license-ISC-102A4C"></a>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-43-47848F">
  <img alt="Status" src="https://img.shields.io/badge/status-beta-yellow">
</p>

> **v0.1.0 — Beta.** Alcune funzionalità sono ancora in evoluzione. Breaking changes possibili prima di v1.0.0. [Contribuisci](CONTRIBUTING.md).

---

## Why GitTree exists

Git is powerful, but its textual representation is not always the fastest way to understand a complex repository. As branches, remotes, merges and parallel commits grow, developers repeatedly need answers to simple questions:

- Which branch am I on?
- Where did this commit come from?
- Which branches have already been merged?
- What will a merge or rebase change?
- Which files are blocking an operation?
- How far ahead or behind is a branch?
- What is the real difference between the selected branch and the current branch?

GitTree answers these questions without hiding Git behind a proprietary model. It works on the local repository, calls explicit Git operations and presents the result through a visual, high-performance workspace.

The goal is not to decorate Git. The goal is to reduce the cognitive load required to work safely on a real history.

## Product vision

GitTree is designed as a modern alternative to traditional desktop Git clients:

- readable like a diagram;
- responsive like a native tool;
- explicit about every operation it performs;
- usable on repositories with large histories and hundreds of refs;
- free from mandatory GitTree accounts, telemetry and proprietary synchronization;
- consistent on Windows, macOS and Linux.

The interface combines calm, system-native clarity with a concrete bento workspace. Functional surfaces are fully opaque. There is no glassmorphism, backdrop blur, glow, neon, frosted panel, reflection or decorative effect that compromises readability or performance.

## Features

### Multi-repository workspace

- Open repositories as integrated tabs.
- Restore the active repository at startup.
- Persist repository tabs and layout state.
- Resize the branch navigator, history columns and Inspector.
- Close or maximize the Inspector.
- Keep the repository tabs as the first visible application row.
- Use native-feeling window controls for each supported platform.

### Local and remote branches

- Browse local and remote branches grouped by folders.
- Search branches instantly.
- Select a branch with one click without checking it out.
- Check out a branch only with a double click or keyboard Enter.
- Display only the leaf name inside nested folders while preserving the full ref in the tooltip.
- Distinguish the current branch from a secondary selection.
- Show ahead and behind counts against the configured upstream.
- Display the same synchronization state in the active repository tab.
- Refresh branch metadata after fetch, pull, push, checkout, merge, rebase and refresh.

### SourceTree-style branch context menu

Right-clicking a branch selects it visually and opens an opaque, keyboard-accessible context menu. No checkout is triggered by the right click.

Available actions include:

- checkout a local branch;
- create and check out a tracking branch from a remote ref;
- merge the selected branch into the current branch;
- rebase the current branch onto the selected branch;
- fetch an upstream or selected remote branch;
- pull the tracked branch;
- push to the configured upstream or a selected remote;
- track a remote branch;
- explicitly stash blocking changes;
- compare against the current branch;
- rename a local branch;
- safely delete a local branch, with an explicit second confirmation for force delete;
- delete a remote branch;
- create a pull request or merge request in the authenticated browser.

Actions that are not applicable remain visible but disabled with an explanation. Merge and rebase never stash or restore changes silently. A dirty working tree opens a preview with the blocking files and explicit View changes and Stash actions.

### SourceTree-style multi-lane graph

- Read real commit parents from Git.
- Keep the first parent on the current lane.
- Draw additional lanes and merge curves for multiple parents.
- Support octopus merges and disconnected tips.
- Include local branches, remote branches, tags, HEAD and upstream refs.
- Use an eight-token semantic lane palette in every theme.
- Load the first 500 commits and fetch more pages progressively.
- Virtualize the viewport with a fixed 38px row height and bounded overscan.
- Keep fewer than 100 commit rows in the DOM on large histories.
- Resize Graph, Message, Author, Date and Hash columns independently.
- Persist column widths per user.

The graph is derived from Git topology rather than being a decorative approximation.

### History, Changes and commit workflow

The center workspace has a persistent History / Changes / Pull Requests switch.

The Changes view provides:

- separate Unstaged and Staged sections;
- stage and unstage all files;
- stage and unstage individual files;
- stage and unstage individual text hunks;
- working-tree diffs in the Inspector;
- support for new, deleted, renamed, binary and conflicted files;
- immutable status snapshots that reject stale renderer requests;
- hunk patches regenerated in the main process;
- a repository-persistent commit composer;
- summary, body, amend and sign-off options;
- configured GPG or SSH signing;
- author override;
- guided local or global Git identity setup;
- hooks always enabled;
- normal empty commits rejected.

After a successful commit, GitTree refreshes graph, status, branches and Inspector atomically and selects the new HEAD.

GitTree never accepts arbitrary patches or raw Git commands from the renderer. Signing uses only the Git configuration and agents already installed on the system; private keys are never read or imported.

### Merge, rebase, cherry-pick and conflict recovery

- Preview merge operations before execution.
- Pass fast-forward, no-fast-forward and squash strategies to Git.
- Select one commit, multiple commits with Ctrl/Cmd, or a range with Shift.
- Preview rebase and cherry-pick targets, files, status and pending operations.
- Rebase the current branch onto a selected commit.
- Cherry-pick selected commits parent-first and oldest-first.
- Keep merge commits out of the initial cherry-pick flow until a mainline picker exists.
- Detect merge, rebase and cherry-pick operations after an application restart.
- Read base, ours and theirs from Git index stages.
- Edit text conflict results in a real three-panel resolver.
- Accept ours, accept theirs or edit the result manually.
- Resolve binary conflicts by choosing ours or theirs.
- Stage resolved files explicitly.
- Enable Continue only when no unmerged files remain.
- Provide Skip for rebase and cherry-pick.
- Protect Abort with confirmation.
- Block unrelated branch mutations while an operation is pending.

### Pull Request review

GitHub.com and GitLab.com provide an integrated review workspace:

- OAuth Device Flow without embedded client secrets;
- one active provider account in the current hosting vault;
- Open, Review requested, Authored and All filters;
- search, pagination by 50 and virtualized lists;
- normalized source/target, author, draft, mergeability and reviewer state;
- CI checks and status information;
- virtualized provider file diffs;
- inline comments, replies, threads and resolve/reopen;
- encrypted review drafts bound to provider, repository, PR and head SHA;
- stale-draft protection after a new push;
- atomic GitHub review submission;
- GitLab discussion and approval tracking with safe retry behavior;
- source branch checkout with preview and ref validation.

GitLab Request changes remains explicitly browser-assisted. Creating and merging pull requests or merge requests also remains in the authenticated browser.

### Hosting providers

GitTree recognizes GitHub, GitLab and Bitbucket Cloud remotes over SSH and HTTPS. It generates provider-specific compare, pull request or merge request URLs without handling passwords, SSH private keys or browser credentials.

### Brand and commercial use

The GitTree source code remains available under the ISC license. Commercial use, paid distributions and renamed forks are allowed by that license. Official GitTree builds are intended to remain free of charge.

The GitTree name, logo, icon and visual identity are not granted by the source-code license. A modified or commercial distribution must use a distinct product name and branding and must not imply endorsement, sponsorship or official support by GitTree.

See [TRADEMARKS.md](TRADEMARKS.md) for the branding policy.

### Settings and automation

The Settings panel contains two local, repository-aware areas.

#### Project-level automatic fetch

Automatic fetch is intentionally configured once per project rather than once per branch:

- enable or disable it with one toggle;
- choose one repository remote;
- choose an interval of 1, 5, 10, 15, 30 or 60 minutes;
- fetch the complete remote so all remote branches stay coherent;
- persist the policy per repository;
- migrate legacy per-branch settings automatically;
- prevent overlapping fetches;
- perform one refresh after a completed fetch, even when several repositories are due.

Automatic fetch runs while GitTree is open. It never checks out a branch, modifies the working tree or stashes changes.

#### Multiple Git profiles

Settings can store multiple local Git author profiles:

- profile label;
- author name;
- author email;
- automatic import of the effective repository Git identity from local or global `git config`;
- per-repository assignment;
- local repository configuration through Git's user.name and user.email;
- profile deletion without changing existing commits.

These profiles are author identities, not credential storage. GitTree does not inspect credential helpers, passwords or private SSH/GPG keys. Hosting OAuth sessions remain in the encrypted main-process vault.

### Themes and localization

- Light theme.
- Dark theme.
- Black theme with fully dark surfaces.
- English interface with fallback strings.
- Italian interface.
- Persistent theme, language and workspace state.

Every functional surface is opaque in every theme. Gradients are limited to the external application canvas.

## Performance

Performance is a product requirement, not a later optimization.

The renderer uses:

- graph virtualization;
- virtualized Changes, Pull Request lists and provider diffs;
- bounded overscan;
- requestAnimationFrame scroll handling;
- content-visibility and containment on dense lists;
- in-place selection updates;
- transform-only resize previews with one layout commit on pointer release;
- incremental history loading;
- single-process Git metadata calls where possible.

The deterministic benchmark uses a synthetic graph with 10,000 commits and verifies:

- fewer than 100 DOM rows;
- average and p95 scroll work below 1ms;
- no scroll sample above 8ms.

Run it with:

~~~powershell
npx electron . --remote-debugging-port=9222
npm run perf:renderer
~~~

## Privacy and security

GitTree works locally:

- no GitTree account;
- no built-in telemetry;
- no automatic repository upload;
- no raw Git command bridge in the renderer.

GitHub and GitLab OAuth tokens remain in the main process. They are encrypted with Electron safeStorage together with review drafts and never cross IPC, logs or localStorage. On Linux, when Electron reports the basic_text backend, credentials stay in memory and the user receives a warning.

Electron contextIsolation remains enabled and nodeIntegration remains disabled. The preload exposes explicit IPC operations, while the main process validates providers, IDs, refs, remotes, SHAs, paths, comment positions and external URLs.

For sensitive reports, read [SECURITY.md](SECURITY.md).

## Project status

GitTree is under active development. The workspace, staging, commit workflow, graph, branch context actions, real conflict recovery and GitHub/GitLab review foundation are implemented.

The following areas are intentionally still evolving:

- guided cloning from the welcome screen;
- full GitLab self-hosted review support;
- creating and merging pull requests directly in the application;
- production signing and notarization;
- separate beta channels;
- partial stash, tag and submodule workflows;
- multiple simultaneous OAuth sessions per provider.

Incomplete features are not exposed as silent or unsafe Git mutations.

## Installation

### Release builds

Download the appropriate installer from [GitHub Releases](https://github.com/lorenzogit98/gittree-minimal/releases):

- Windows: NSIS installer;
- macOS: DMG;
- Linux: AppImage or DEB.

Until production certificates are enabled, an operating system may warn about unsigned builds.

### Run from source

Requirements:

- Node.js 22 or later;
- Git;
- npm.

~~~powershell
git clone https://github.com/lorenzogit98/gittree-minimal.git
cd gittree-minimal
npm ci
npm start
~~~

## Development

| Command | Purpose |
| --- | --- |
| npm start | Start the Electron application |
| npm test | Run node:test suites |
| npm run audit:design | Verify design-system rules |
| npm run validate | Run tests and design audit |
| npm run test:renderer-ui | Verify renderer UI contracts through CDP |
| npm run perf:renderer | Run the renderer benchmark |
| npm run prepare:assets | Validate and prepare release assets |
| npm run build | Produce an unpacked application directory |
| npm run dist:win | Build the Windows installer |
| npm run dist:mac | Build macOS DMG and ZIP |
| npm run dist:linux | Build Linux AppImage and DEB |

### Repository structure

~~~text
GitTree
├── .github/                  CI and release workflows
├── build/                    prepared electron-builder assets
├── docs/                     release, update and OAuth documentation
├── scripts/                  audits, benchmarks and release checks
├── src/
│   ├── main/                 Git, hosting, vault, IPC and updates
│   ├── preload.js            explicit isolated bridge
│   └── renderer/             workspace, components, themes and i18n
├── test/                     Git, hosting, graph and UI contract tests
├── DESIGN.md                 canonical visual specification
├── electron-builder.yml      cross-platform packaging configuration
└── icon.png                  1024x1024 master application icon
~~~

## Build and release

The electron-builder configuration lives in [electron-builder.yml](electron-builder.yml). Local artifacts are written to dist/ and are not published.

The full release guide is [docs/RELEASING.md](docs/RELEASING.md). OAuth configuration is documented in [docs/OAUTH.md](docs/OAUTH.md).

~~~powershell
npm ci
npm run validate
npm run dist:win
~~~

An official release starts from a SemVer tag:

~~~powershell
npm version patch
git push origin main --follow-tags
~~~

GitHub Actions builds Windows, macOS and Linux on their native runners.

Production builds require these public OAuth client IDs:

- GITTREE_GITHUB_CLIENT_ID;
- GITTREE_GITLAB_CLIENT_ID.

release:check fails when either value is missing. prepare:assets generates build/oauth-config.json with public client IDs only; no client secret is packaged.

## OTA updates

The OTA foundation uses electron-updater:

- checks are disabled in development;
- startup checks are delayed;
- periodic checks are supported;
- downloads require explicit user action;
- progress is visible;
- installation happens after an explicit restart;
- downgrades are disabled;
- platform manifests are generated with each release.

Trustworthy distribution additionally requires signed installers and macOS notarization. See [docs/UPDATES.md](docs/UPDATES.md) for the update model and security notes.

## Design system

[DESIGN.md](DESIGN.md) is the canonical design specification:

- fully opaque functional surfaces;
- gradients only on the outer canvas;
- near-monochrome palette led by midnight blue;
- thin borders and soft neutral elevation;
- no glassmorphism, glow or neumorphism;
- Phosphor regular icons;
- platform-native system sans-serif typography;
- keyboard accessibility and WCAG 2.2 AA contrast.

## In progress

These features are being actively developed and may change or be incomplete:

- **Interactive rebase** — drag-and-drop commit reordering, squash, fixup (planned)
- **Blame view** — per-line annotation with commit details (planned)
- **Git LFS** — lock/unlock, tracking (planned)
- **Submodule management** — browse, update, recursive operations (planned)
- **Stash partial** — select files to stash (planned)
- **Git-flow helpers** — visual start/finish for feature/release/hotfix (planned)
- **Undo button** — one-click reflog-based undo (planned)
- **Reset commit UI** — soft/mixed/hard with explicit preview (planned)

See [open issues](https://github.com/lorenzogit98/gittree-minimal/issues) for current work.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

Before proposing a change:

1. Keep Git operations explicit and reversible.
2. Never expose tokens or credentials to the renderer.
3. Add English and Italian strings together.
4. Follow the design system.
5. Add tests for Git logic, graph behavior or UI regressions.
6. Run npm run validate.

Open issues and proposals in [GitHub Issues](https://github.com/lorenzogit98/gittree-minimal/issues).

## License

GitTree is distributed under the [ISC license](LICENSE).
