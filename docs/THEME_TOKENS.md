# Theme tokens — Sandstone (Theme C)

All color values live in `web/src/design.css` under `:root` / `[data-theme="light"]` / `[data-theme="dark"]` (both themes currently resolve to Sandstone light).

Components must use CSS variables — never hard-coded palette hex outside `design.css`.

## Sandstone drop-in

```css
:root {
  --bg: #F3EEE6;
  --surface: #FBF8F3;
  --surface2: #EFE8DC;
  --border: #E0D6C6;
  --text: #1F2A24;
  --text2: #4F5A52;
  --muted: #5E6B63;
  --accent: #1F5C45;
  --accentSoft: #E2EBE3;
  --side: #1F3D31;
  --sideText: #C9D6CC;
  --sideActive: #2C5242;
  --sideActiveText: #FFFFFF;
  --crit: #B23A2E;
  --high: #C8702A;
  --med: #B8902B;
  --low: #4D7F5B;
  --track: #E9E1D3;
  --chart1: #1F5C45;
  --chart2: #B8902B;
  --chart3: #A79F90;
  --shadow: 0 1px 2px rgba(60, 45, 20, 0.06);
}
```

## Rules

- Inter 400/500/600/700, `font-variant-numeric: tabular-nums`, min text 12px, radius 8px
- No glow / no glass blur
- Severity bands: Critical ≥70, High 55–69, Medium 35–54, Low <35
- Severity pills: severity color text on ~12% alpha background (`--critical-bg`, `--high-bg`, …)
- Deep green sidebar via `--side` / `--sideText` / `--sideActive` / `--sideActiveText`
- Do not invent an enterprise appetite marker or sample dates/trends without backing data
