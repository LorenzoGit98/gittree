# GitTree Motion Contract

## Purpose

Motion in GitTree communicates continuity, state changes, and direct manipulation. It must never hide delayed work, replace loading feedback, or make dense Git data harder to track.

`DESIGN.md` defines the visual system. This document defines how movement is implemented and measured. ADR-0003 records the architectural decision behind the workspace behavior.

## Core rules

- Keep functional surfaces opaque. During workspace resize, visible content remains at `opacity: 1`; there is no fade, dimming layer, or temporary overlay.
- Preserve mounted views and their DOM nodes across panel motion and resize. A visual transition must not trigger a data refresh or rebuild the commit graph.
- Use `140ms` for control feedback and `220ms` for panel/state changes.
- CSS animations and transitions may change only `transform` and `opacity`.
- Realtime resize is the deliberate exception to compositor-only movement: it updates a grid width CSS variable at most once per animation frame so the panel follows the pointer.
- Honor `prefers-reduced-motion`. Direct manipulation remains realtime, but decorative transition duration becomes effectively immediate.
- Do not add permanent `will-change`; promote layers only when profiling proves it necessary.

## Interaction contracts

| Interaction | Visual behavior | Performance invariant | Completion |
| --- | --- | --- | --- |
| Sidebar/inspector open and close | Short lateral `transform` with opacity transition | Workspace grid does not animate; mounted graph rows survive | State and focus are correct after animation or cancellation |
| Workspace panel resize | Panels follow the pointer in realtime | Pointer events are coalesced to one grid CSS-variable write per `requestAnimationFrame`; content stays opaque; no view refresh | Final width is persisted exactly once on `pointerup` |
| Vertical resize handle | Solid bar stretches subtly on hover and drag | `transform` feedback only; no handle translation and no layout contribution | Drag class is removed on release or cancellation |
| History column resize | Separator preview follows the pointer | Preview uses `transform`; column layout commits on release | Column widths persist once |
| Dense-list selection | Immediate state change | Existing row nodes update in place | Selection and inspector agree |

## Realtime workspace resize lifecycle

1. On `pointerdown`, capture the initial pointer coordinate and measured panel width.
2. On `pointermove`, retain only the latest coordinate and request a frame if none is pending.
3. In the frame callback, clamp the width and write the corresponding grid CSS variable once.
4. Keep visible panels fully opaque and reuse the existing content throughout the drag.
5. On `pointerup`, flush the final coordinate, persist the final width once, and remove drag state.
6. On `pointercancel`, clean up without writing persistent state.

The controller for this lifecycle is `WorkspaceResizeController`. It receives DOM, storage, and frame scheduling dependencies explicitly so frame coalescing and persistence can be tested without Electron.

## Measurement

- Unit tests own frame coalescing, clamping, cleanup, and the single persistence write.
- The renderer benchmark owns real Electron frame timing, visible-panel opacity, graph-row identity, and the live-width contract.
- Timing thresholds remain separate from functional assertions. Compare approved benchmark baselines on the same class of machine and investigate regressions above 20%.
- Run `npm run perf:renderer` after changes to workspace layout, resize, graph rendering, or motion.

## Review checklist

- Does the movement explain a state change or direct manipulation?
- Does the content remain readable, opaque, and mounted?
- Are pointer updates bounded to one write per frame?
- Is persistence deferred until the interaction completes?
- Are rapid reversal, cancellation, reduced motion, both themes, and both languages still correct?
- Are the functional tests and renderer benchmark green?
