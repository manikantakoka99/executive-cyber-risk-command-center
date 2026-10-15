# Theme tokens (designer drop-in)

All color values live in `web/src/design.css` under `:root` / `[data-theme="dark"]` and `[data-theme="light"]`.

Components must use CSS variables (`var(--bg)`, `var(--accent)`, `var(--crit)`, …) — never hard-coded hex in TSX/CSS rules outside `design.css`.

## Hold

Do **not** apply the rejected palette:

- `#0B0F17` (bg)
- `#111827` (card)
- `#4FA3FF` (accent)

A new palette from design can replace the token block in `design.css` without touching layout or RBAC code.

## Active (non-color) direction

- Inter body/head + IBM Plex Mono
- `font-variant-numeric: tabular-nums`
- Minimum text size 12px (`--font-size-min`)
- No glow / no glass blur
- Role-capped merged nav
