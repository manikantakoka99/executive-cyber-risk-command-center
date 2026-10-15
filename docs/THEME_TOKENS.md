# Theme tokens (designer drop-in)

All color values live in `web/src/design.css` under `:root` / `[data-theme="dark"]` and `[data-theme="light"]`.

Components must use CSS variables (`var(--bg)`, `var(--accent)`, `var(--crit)`, …) — never hard-coded hex in TSX/CSS rules outside `design.css`.

## Hold (still in force)

Do **not** apply the rejected palette from the Pixel design direction:

- `#0B0F17` (bg)
- `#111827` (card / surface)
- `#4FA3FF` (accent)

Quiet Command layout, type, severity, and nav are implemented; surface/accent hexes stay provisional until design ships a replacement block for `design.css`.

## Active (non-color) direction

- Inter body/head + IBM Plex Mono
- `font-variant-numeric: tabular-nums`
- Minimum text size 12px (`--font-size-min`)
- No glow / no glass blur
- Role-capped merged nav
