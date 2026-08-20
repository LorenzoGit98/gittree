# GitTree performance

Performance is a product requirement, not a reason to remove behavior or motion. GitTree keeps its current features, 140/220 ms interaction language, and `prefers-reduced-motion` support while reducing avoidable JavaScript, layout, paint, Git, and IPC work.

## Reproducible renderer benchmark

`npm run perf:renderer` launches its own isolated Electron application, temporary Git repository, and temporary `userData` directory through Playwright. It does not use the developer's repositories or persistent application data.

The benchmark records:

- process launch, first-window, and repository-ready time;
- Electron process working set and renderer JavaScript heap;
- initial rendering of 10,000 synthetic commits;
- virtualized DOM row count;
- synchronous viewport rendering and real animation-frame latency for both progressive scrolling and distant history jumps;
- in-place commit selection cost and DOM preservation;
- workspace and history-column resize preview cost;
- resize contracts: transform-only preview and one persisted commit on release.
- Branches and Inspector open/close trigger cost and animation-frame cadence on the 10,000-commit graph.

Run a quick local sample:

```powershell
npm run test:performance
```

Record five runs for a baseline or comparison:

```powershell
node scripts/renderer-perf-benchmark.js --runs=5 --output=performance-results/renderer.json
node scripts/workspace-perf-benchmark.js --runs=3 --output=performance-results/workspace.json
```

For memory investigation with deliberately oversized renderer fixtures, use:

```powershell
npm run perf:memory -- --profile=aggressive --scenario=all --runs=3
```

The stress benchmark measures graph retention, rendered diff lines, agent cards
and terminal scrollback separately. It records renderer working set, JavaScript
heap and DOM counters before stress, after clearing the surfaces, and after an
explicit diagnostic garbage collection. `normal`, `aggressive` and `extreme`
profiles are reproducible presets; individual dimensions can be overridden with
`--commits`, `--subject-bytes`, `--diff-lines`, `--agent-cards` and
`--terminal-lines`, plus `--diff-mode=unified|split` and
`--navigate-file=true|false` for diff navigation coverage. These measurements
are investigation aids, not functional quality gates.

The workspace benchmark uses two real isolated Git repositories and a local bare remote to measure repeated tab switching at three milestones: graph data ready, primary workspace interactive, and all supporting panels settled. It also measures a real Fetch and verifies that the operation does not trigger a global repository reload, enter the workspace-wide loading state, or replace an already visible graph row. Its memory protocol records a stable welcome baseline, one settled repository, two settled repositories, ten switches, and post-switch idle. It reports working set, Windows private bytes, JavaScript heaps, DOM counters, and Electron browser, renderer, GPU, and utility processes separately. `--diagnostic-gc=true` is an opt-in investigation aid and is never used by the application.

Timing values are observations, not functional assertions. The command fails only when a deterministic renderer contract is broken. Approved nightly baselines compare the same machine, operating system, build mode, fixture, and run count.

## Optimization loop

1. Record at least five baseline runs.
2. Select one measured bottleneck.
3. Add a functional characterization test when behavior could change.
4. Make one focused optimization without removing UI states, animations, or Git capabilities.
5. Record the same benchmark again on the same machine.
6. Accept the change only when the target metric improves without a material regression elsewhere.

Investigate a nightly regression above 20% against the approved median. Do not hide it with retries or by lowering a functional gate.

## Non-negotiable contracts

- Keep fewer than 100 commit rows in the DOM for the 10,000-commit fixture.
- Update selection in place; do not rebuild the commit list.
- Refresh Fetch, Pull, and Push incrementally without blanking the workspace or losing viewport and filters.
- Preview panel and history-column resize with `transform` only.
- Commit and persist a resized width once, on pointer release.
- Animate only `transform` and `opacity`, using the design-system durations.
- Open and close Branches and Inspector with compositor-only motion; never animate workspace grid columns.
- Preserve all loading, empty, error, disabled, focus, keyboard, theme, and language states.
