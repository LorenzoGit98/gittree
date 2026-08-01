# ADR-0003 — Compositor-only workspace motion

- Status: accepted
- Date: 2026-08

## Context

Animating `grid-template-columns` on the three-panel workspace caused a full
layout + paint pass every frame (graph with hundreds of rows, diffs, branch
list), producing visible jank on inspector expand/collapse and sidebar toggle.

## Decision

- The workspace grid changes **instantly** (no `grid-template-columns`
  transition); panel open/close/maximize animate only `transform`/`opacity`
  (`will-change`-free, GPU composited).
- Closing panels become absolute overlays that fade/slide over the main
  surface while the grid reflows instantly underneath.
- Resize handles animate with `scaleY`; stagger delays are capped so dense
  lists never compose hundreds of layers.
- Branch-switch entrance animation starts before the data load completes.

## Consequences

- Inspector/sidebar toggles are jank-free even on large repositories.
- The design contract "animate only transform and opacity" is enforced by the
  design audit.
