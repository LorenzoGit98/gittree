# GitTree architecture boundaries

Use this reference to decide ownership and dependency direction.

## Dependency direction

```text
Electron bootstrap -> domain registration -> application services -> adapters
Renderer bootstrap -> feature coordinators -> components -> pure render/model helpers
Preload whitelist -> named IPC channels
```

Dependencies point inward toward domain behavior. Domain modules must not import Electron UI objects or renderer globals.

## Main process placement

| Responsibility | Destination | Constraint |
| --- | --- | --- |
| App ready, windows, second instance, teardown | application runtime/bootstrap | Compose dependencies; contain no Git behavior |
| IPC argument checks and error envelopes | `src/main/ipc/` by domain | Treat renderer values as untrusted |
| Git behavior | `GitService` facade plus `src/main/git/` internals | One normalized repository session and queue |
| Hosting behavior | `HostingService` plus provider adapters | Normalize provider-specific responses internally |
| Persistence and credentials | dedicated service | Never expose storage primitives to renderer |

## Renderer placement

| Kind | Owner | Example dependency style |
| --- | --- | --- |
| App-wide composition | `GitTreeApp` or extracted coordinator | Construct and connect collaborators |
| Feature workflow | feature coordinator/service | `{ bridge, notify, refresh }` |
| Stateful visual surface | component class/factory | `{ t, dialogs, onSelect }` |
| Parsing/layout/formatting | pure helper | arguments in, value out |
| Shared platform access | narrow adapter | `{ storage, matchMedia }` |

## Extraction test

Extract a module only when all answers are clear:

1. What complete responsibility does it own?
2. What is its smallest useful public interface?
3. Which dependencies are injected?
4. Who creates and destroys it?
5. Which test proves behavior without starting the whole application?

If the new file mostly forwards calls or needs the entire `GitTreeApp`, the boundary is too shallow.

## Component contract example

```js
class RepositoryHeader {
  constructor({ bridge, t, onRefresh }) {
    this.bridge = bridge;
    this.t = t;
    this.onRefresh = onRefresh;
  }

  mount(container) {
    this.container = container;
    this.render();
  }

  update(state) {
    this.state = state;
    this.render();
  }

  destroy() {
    this.abortController?.abort();
    this.container?.replaceChildren();
  }
}
```

Adapt the shape to the feature; the important properties are explicit dependencies, a single owner and deterministic cleanup.
