---
# sentinel: design-md-format=spec
name: Sachet (SENTINEL)
typography:
  display:
    fontFamily: Fraunces
  body:
    fontFamily: Atkinson Hyperlegible
  indic:
    fontFamily: Noto Sans Kannada, Noto Sans Devanagari
  mono:
    fontFamily: JetBrains Mono
    fontFeature: tnum
colors:
  primary-light-mode: "#1B3C53"
  primary-dark-mode: "#5EEAD4"
  primary-text-accent-light-mode: "#164E63"
  primary-text-accent-dark-mode: "#5EEAD4"
  base-light: "#F1F7FA"
  rail-light: "#D5EFEC"
  mint-panel-light: "#CBEAE5"
  surface-light: "#FFFFFF"
  surface-elevated-light: "#E3EEF5"
  border-light: "#C4DDE2"
  text-light: "#0F293A"
  muted-light: "#3B586A"
  base-dark: "#0B1117"
  surface-dark: "#121B24"
  surface-elevated-dark: "#1A2633"
  border-dark: "#263545"
  text-dark: "#F8FAFC"
  muted-dark: "#94A3B8"
  stable-light: "#047857"
  stable-dark: "#34D399"
  watch-light: "#B45309"
  watch-dark: "#FBBF24"
  warning-light: "#C2410C"
  warning-dark: "#FB923C"
  urgent-light: "#B91C1C"
  urgent-dark: "#F87171"
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
rounded:
  sm: 6px
  md: 12px
  lg: 16px
  full: 9999px
---

# Design System — Sachet (SENTINEL)

> Category: Clinical Wearable Early-Awareness & Elder Home Monitoring
> Calm, legible, high-contrast clinical typography and semantic safety cues designed for 72-year-old home users, remote family caregivers, and busy physicians.

## 1. Visual Theme & Atmosphere
- **Direction:** Clinical-Warm Editorial — trustworthy hospital clarity softened by warm paper-slate neutrals (`#F6F9FC` light / `#0B1117` dark), avoiding cold sterile blue-on-white or generic SaaS purple gradients.
- **Accessibility Baseline:** WCAG 2.2 AA minimum across all screens (4.5:1 text, 3:1 UI/focus contrast). **Elder Mode (`/today`)** enforces `>= 18px` body text and `>= 48px` touch targets with `>= 8px` gaps.
- **Anti-Patterns Explicitly Avoided:** No low-contrast Neumorphic gray-on-gray shadows (flagged as high a11y risk during Phase 0 `ui-ux-pro-max-skill` check), no emoji as UI icons (strictly Lucide SVG icons), no nested cards-inside-cards clutter, no liquid-glass blur behind charts or tables.

## 2. Color Palette & Semantic Roles
- **Primary Brand Accent:** Deep Clinical Teal (`#0F766E` light / `#2DD4BF` dark) — calm, restorative, distinct from urgent crimson alerts.
- **Neutrals (Light):** Base `#F6F9FC`, Card `#FFFFFF`, Elevated `#EFF5F8`, Text `#0F172A`, Muted `#475569`, Border `#CBD5E1`.
- **Neutrals (Dark):** Base `#0B1117`, Card `#121B24`, Elevated `#1A2633`, Text `#F8FAFC`, Muted `#94A3B8`, Border `#263545`.
- **Semantic Statuses (Always Paired with Icon + Text Label):**
  - **Stable:** `#047857` (light) / `#34D399` (dark) — `CheckCircle2` + `"Stable"`
  - **Watch:** `#B45309` (light) / `#FBBF24` (dark) — `Eye` + `"Watch"`
  - **Warning:** `#C2410C` (light) / `#FB923C` (dark) — `AlertTriangle` + `"Warning"`
  - **Urgent:** `#B91C1C` (light) / `#F87171` (dark) — `Siren` + `"Urgent"`
  - **Synthetic Mode:** `#0369A1` / `#38BDF8` badge with explicit `SYNTHETIC` text stamp.

## 3. Typography
- **Display / Headings:** `Fraunces` (warm optical-size editorial serif) — humanizes clinical reassurance on landing & elder headers.
- **Body & UI Controls:** `Atkinson Hyperlegible` (Braille Institute typeface, surfaced by `ui-ux-pro-max-skill`) for unambiguous `1/I/l` and `0/O` letterforms under presbyopia, falling back to `Noto Sans Kannada` and `Noto Sans Devanagari` for Kannada (`kn`) and Hindi (`hi`).
- **Numeric Telemetry & Logs:** `JetBrains Mono` with `font-variant-numeric: tabular-nums` so live heart-rate/SpO₂ updates never cause horizontal layout jitter.

## 4. Layout & Spacing
- **4px Grid:** `4 / 8 / 16 / 24 / 32 / 48px`.
- **Elder Today:** Single-column mobile-first max-width `680px`, single calm status headline, 3 vital tiles, 3 full-width `>= 56px` action buttons.
- **Caregiver & Clinician:** Responsive 12-column grid (`max-w-7xl`), crisp `1px` borders instead of heavy drop shadows, generous table row heights (`>= 44px`).

## 5. Components & Five Required States
Every data-driven list, chart, and vital tile must render explicit:
1. **Loading:** Dimension-locked skeleton (`CLS < 0.05`).
2. **Empty:** Plain-language onboarding action (e.g., *"Import Apple Health XML or enable Synthetic scenario"*).
3. **Learning (Days 1–13):** Progress badge (`"Learning personal normal · Day X of 14"`).
4. **Error:** Non-technical explanation + retry action (never silent failure).
5. **Offline:** Persistent PWA banner showing last synced timestamp.

## 6. Signature Visuals & Motion Restraint
- **Landing Only:** Lazy-loaded `ShaderGradient` hero backdrop + 1 React Three Fiber (`@react-three/fiber`) physiological waveform (1 WebGL context max per page, paused off-screen).
- **Elder Status Aura:** Subtle low-contrast gradient shift tied to state (`Stable -> Urgent`), automatically replaced by static CSS wash under `prefers-reduced-motion: reduce` or WebGL unavailability.
- **Floating Chrome Only:** CSS `backdrop-filter` glass treatment restricted to floating nav bars, sheets, and toast notifications — **never** behind charts or clinical tables.
- **Motion:** `motion` library wrapped in `<MotionConfig reducedMotion="user">`; transitions `150–250ms` ease-out.

## 7. Iconography & Voice Tone
- **Iconography:** Lucide React (`1.75px` stroke); decorative icons receive `aria-hidden="true"`.
- **Clinical Copy:** Always *"changes from your personal normal"*, never *"you have [diagnosis]"*. Alerts always state **What changed**, **Since when**, and **What to do next**.
