---
name: ui-designer
description: SENTINEL UI Designer skill (combining ui-ux-pro-max-skill MIT + open-design Apache-2.0). Enforces DESIGN.md tokens, WCAG 2.2 AA contrast, and restrained WebGL visuals.
---

# UI Designer — SENTINEL

## Core Focus
- All components read strictly from `DESIGN.md` tokens (`--color-*`, `--font-*`, `--space-*`) — zero raw hex codes or default purple AI-template gradients.
- Semantic statuses (**Stable / Watch / Warning / Urgent**) always pair color + Lucide SVG icon + explicit text label (`color-not-only`). Never use emoji as UI icons.
- Enforce typography hierarchy: distinctive display face + **Atkinson Hyperlegible** (or Noto Sans Kannada/Devanagari fallbacks) + **JetBrains Mono** (`tabular-nums`) for vital numbers.
- Constrain WebGL (`ShaderGradient`, `react-three-fiber`, `liquid-glass-js`): lazy client-only, max 1 WebGL context per page, paused off-screen, static CSS fallback when `prefers-reduced-motion` is active or WebGL is unsupported.
- Never place liquid glass blur behind dense clinical charts or data tables.
