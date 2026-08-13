# ADR-0006 — Resizable modals over a flat translucent backdrop

- Status: accepted
- Date: 2026-08

## Context

Dialog and full-screen surfaces previously hid the whole application behind an
opaque `--surface-overlay` fill, and none of them could be resized. In
practice the settings and merge dialogs blocked the workspace for large
operations with no escape hatch while open, and users asked to keep the app
visible behind a light dim and to be able to adjust each dialog to their
window.

## Decision

- Modal overlays (`#modal-overlay` and the merge preview shell) use a new flat,
  translucent semantic token `--modal-backdrop` (no blur, no gradient). Dialog
  cards themselves remain fully opaque `--surface-primary` surfaces.
- `--surface-overlay` stays the opaque full-screen surface for search,
  repository discovery, branch compare, commit compare, reflog and conflict
  resolution.
- Dialog surfaces are resizable through native `resize` with explicit
  min/max clamps so no surface can shrink below its usable minimum or overflow
  the viewport.
- The merge preview moves from an opaque full-screen shell to a centered,
  resizable modal card with a close control and Escape handling.
- `DESIGN.md` is amended to permit the translucent backdrop token as the only
  exception to the opaque-surface rule.

## Consequences

- The app remains visible but dimmed behind settings, merge and confirm
  dialogs; functional content never becomes translucent.
- Resizing is browser-native and deterministic; no custom drag controller is
  maintained for modal surfaces.
- The design audit still rejects blur, gradients and raw rgba values outside
  `variables.css`, so the exception stays scoped to the `--modal-backdrop`
  token.
