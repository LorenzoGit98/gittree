# ADR-0003 — Controlled workspace motion and realtime resizing

- Status: accepted
- Date: 2026-08

## Context

Animating `grid-template-columns` for panel open/close caused a full layout and
paint pass every frame, producing visible jank on large graphs and diffs. A
transform-only resize preview avoided that cost but made direct manipulation
feel disconnected because content snapped to its final width only on release.

## Decision

- The workspace grid changes **instantly** (no `grid-template-columns`
  transition); panel open/close/maximize animate only `transform`/`opacity`
  (`will-change`-free, GPU composited).
- Closing panels become absolute overlays that fade/slide over the main
  surface while the grid reflows instantly underneath.
- Workspace resize is an explicit direct-manipulation exception: pointer events
  are coalesced through `requestAnimationFrame` and the relevant grid width CSS
  variable is updated at most once per frame.
- During resize, visible panels remain at `opacity: 1`, mounted view nodes are
  preserved, and no data refresh is triggered. The width is persisted exactly
  once on `pointerup`.
- Resize-time isolation uses layout/paint containment only. `contain: size`
  collapsed content-sized panels (the branch navigator) during drags, so size
  containment is prohibited on resize; the renderer benchmark asserts branch
  rows stay visible throughout the drag.
- Resize handles use transform-only scale feedback and never translate away
  from their grid track; stagger delays are capped so dense lists never compose
  hundreds of layers.
- Branch-switch entrance animation starts before the data load completes.

## Consequences

- Inspector/sidebar toggles are jank-free even on large repositories.
- Realtime resize intentionally performs bounded layout work once per frame in
  exchange for pointer fidelity. Containment and the renderer benchmark guard
  that cost.
- Unit tests enforce frame coalescing and single-write persistence; the Electron
  benchmark enforces live width, opaque content, and graph-row preservation.
- CSS motion remains limited to `transform` and `opacity` and is enforced by the
  design audit.
