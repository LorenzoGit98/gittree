# UI review checklist

## Foundations

- Confirm all raw colors live in `styles/variables.css`.
- Confirm light and dark token values are both defined.
- Confirm gradients appear only in `--canvas-gradient` and only the outer app canvas consumes it.
- Reject `backdrop-filter`, blur, glow, translucent component backgrounds, neumorphism, and reflective effects.

## Components

- Check shared button, input, icon-control, card, tab, badge, dialog, toast, and empty-state contracts first.
- Check every relevant interaction state, including keyboard focus.
- Check long repository names, branch names, file paths, and commit messages.
- Check loading, empty, error, disabled, and destructive states.

## Responsive and workspace behavior

- Verify both resize handles follow the pointer in realtime, coalesce movement to one grid write per frame, and persist once on release.
- Verify visible workspace content remains fully opaque and mounted during resize; reject fades, dimming layers, overlays, and view refreshes.
- Verify handle hover/drag feedback uses `transform` only and the handle remains in its grid track.
- Verify the inspector hides before the branch navigator at narrow widths.
- Verify the commit history keeps a usable minimum width.
- Verify merge, search, and conflict workflows remain fully opaque.

## Themes, icons, and copy

- Test light and dark themes.
- Use only Phosphor regular icons.
- Require accessible names for icon-only controls.
- Add matching English and Italian i18next keys.
- Keep product copy concise and literal.

## Commands

```powershell
npm run audit:design
npm start
```
