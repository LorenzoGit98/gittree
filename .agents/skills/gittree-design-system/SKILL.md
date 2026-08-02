---
name: gittree-design-system
description: Implement and review GitTree renderer UI changes using the repository's opaque premium bento design system, light/dark themes, Phosphor icons, and i18next localization. Use for any task that adds or changes HTML, CSS, user-facing renderer JavaScript, layout, components, icons, themes, responsive behavior, or translated copy in GitTree Minimal.
---

# GitTree Design System

Apply the repository design system to every renderer UI change.

## Workflow

1. Read `DESIGN.md` at the repository root before changing UI code. For motion or resize work, also read `MOTION.md` and ADR-0003.
2. Inspect the existing semantic tokens in `src/renderer/styles/variables.css`.
3. Reuse an existing component contract before creating a new local pattern.
4. Keep functional surfaces opaque. Apply `--canvas-gradient` only to the outer canvas.
5. Use Phosphor regular icons and semantic token names.
6. Add English and Italian i18next entries together for user-facing copy.
7. Cover default, hover, focus-visible, active, disabled, loading, empty, error, and overflow states as relevant.
8. Run `npm run audit:design`, then smoke-test the Electron app in both themes and languages.
9. For layout, scrolling, list, diff, or resize changes, launch `npx electron . --remote-debugging-port=9222` and run `npm run perf:renderer`.

## Implementation rules

- Treat `DESIGN.md` as the canonical specification.
- Prefer shared classes in `styles/components.css` over inline styling.
- Add new raw color values only as semantic tokens in `variables.css`, for both themes.
- Keep bento panels resizable without reducing the center workspace below its usable minimum.
- Preserve the frameless window contract: repository tabs first, no native menu/title bar, and draggable empty space around the integrated window controls.
- Preserve balanced developer density: 34–40px data rows and 34px minimum controls.
- Preserve the performance contracts in `DESIGN.md` and `MOTION.md`: offscreen row containment, realtime workspace resize with one grid write per animation frame, fully opaque mounted content, one persistence write on release, and in-place selection updates.
- Use `data-i18n` for static markup and `t()` for runtime content.
- Keep English as i18next fallback.
- Use complete Phosphor classes such as `ph ph-git-branch`; never substitute emoji or Unicode pictograms.

## Validation

Run:

```powershell
npm run audit:design
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" .agents\skills\gittree-design-system
```

Read [review-checklist.md](references/review-checklist.md) when performing a design-system review or diagnosing an audit failure.
