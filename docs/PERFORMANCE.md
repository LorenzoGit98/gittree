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

Run a quick local sample:

```powershell
npm run test:performance
```

Record five runs for a baseline or comparison:

```powershell
node scripts/renderer-perf-benchmark.js --runs=5 --output=performance-results/renderer.json
node scripts/workspace-perf-benchmark.js --runs=3 --output=performance-results/workspace.json
```

The workspace benchmark uses two real isolated Git repositories to measure repeated tab switching, individual loader duration, and process memory before and after ten switches. Memory is reported separately for Electron browser, renderer, GPU, and utility processes.

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
- Preview panel and history-column resize with `transform` only.
- Commit and persist a resized width once, on pointer release.
- Animate only `transform` and `opacity`, using the design-system durations.
- Preserve all loading, empty, error, disabled, focus, keyboard, theme, and language states.
