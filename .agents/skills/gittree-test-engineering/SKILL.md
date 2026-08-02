---
name: gittree-test-engineering
description: Design, implement, and review deterministic automated tests for GitTree using node:test, real isolated Git repositories, local HTTP provider fixtures, fake Electron adapters, Playwright Electron E2E, honest coverage, and separate performance benchmarks. Use when adding tests, fixing flaky tests, creating fixtures, choosing unit versus integration versus E2E coverage, changing CI quality gates, or characterizing behavior before a refactor.
---

# GitTree Test Engineering

Protect behavior with the cheapest test layer that exercises the real risk.

## Select the layer

Read [test-matrix.md](references/test-matrix.md) when selecting fixtures, deciding whether Electron is necessary, or reviewing missing coverage.

- Use unit tests for parsers, validators, state transitions, layout and pure renderer helpers.
- Use integration tests for Git behavior, IPC registration and hosting adapters.
- Use Playwright Electron E2E only for application wiring, native lifecycle and user workflows.
- Keep temporal benchmarks under performance tests; never turn a timing target into a functional assertion.

## Work characterization-first

1. State the public behavior and failure mode.
2. Write a failing or characterization test before a risky refactor.
3. Use production-shaped inputs and assert observable results, not private implementation calls.
4. Make the smallest implementation change.
5. Run the narrow test, then the full applicable gate.

## Keep fixtures deterministic

- Use `test/helpers/git-repository.js` for isolated repositories and local Git identity.
- Create temporary `userData` and repository directories per test; clean them with `t.after` even after failure.
- Use known commits, branches, tags, remotes, stash and conflicts. Never depend on the developer's global Git config.
- Simulate GitHub, GitLab and Azure with local HTTP fixtures. Do not use live network calls or real tokens.
- Inject fake Electron adapters for main-process tests. Launch Electron only when the native boundary is the behavior under test.
- Avoid fixed sleeps, wall-clock assumptions, random ports without reservation and automatic retries.

## Test contracts, not structure

- Assert preload-to-main channel parity and managed-repository validation.
- Assert stable `window.gitTree` arguments, results and `{ error }` envelopes.
- Apply one provider contract suite to each hosting adapter.
- Characterize Git results before extracting an internal domain module.
- For renderer components, inject bridge, translation and callbacks; assert rendered state, focus and cleanup through the public lifecycle.
- Cover success, empty, loading, error, disabled, cancellation and malicious input where relevant.

## Keep coverage honest

- Include production files explicitly so unloaded files remain in the denominator.
- Treat thresholds as ratchets. Do not lower one to make a change pass.
- Prefer meaningful branch and failure-path tests over line-only coverage.
- Never ignore or retry a flaky test without a linked issue, reason and expiry.

## Validate

Run the narrowest command first, then the relevant sequence:

```powershell
npm test
npm run test:coverage
npm run test:contracts
npm run test:e2e
```

Run `npm run test:performance` separately for performance work. Finish a checkpoint with `npm run quality`.
