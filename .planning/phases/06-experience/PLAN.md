# Phase 6 Plan — Experience, Signature Visuals, i18n & PWA Performance

## Objectives
1. **Restrained Signature Visuals (Max 1 WebGL context/page, paused off-screen, reduced-motion static fallback):**
   - `PulseHeroVisual` (`apps/web/src/components/visuals/pulse-hero.tsx`): Lazy client-only WebGL hero card featuring `@paper-design/shaders-react` / Three.js harmonic physiological pulse wave with `IntersectionObserver` off-screen pause and automatic static SVG baseline waveform when `prefers-reduced-motion: reduce` matches or WebGL is unsupported.
   - `MotionConfig reducedMotion="user"` global wrapper in `providers.tsx` + smooth number ticker (`AnimatedMetricNumber`) + subtle calm transitions in `/today` and `/`.
   - Floating frosted chrome strictly on navigation bars only (`backdrop-blur-md bg-[var(--bg-surface)]/85`), never obscuring clinical tables or ECharts surfaces.

2. **Structured i18n Catalogs (`en`, `kn`, `hi`):**
   - Complete structured dictionaries (`apps/web/src/messages/{en,kn,hi}.json`) and `apps/web/src/lib/i18n/catalog.ts` powering Patient Today & navigation copy cleanly across English, Kannada (`kn`), and Hindi (`hi`).

3. **PWA & Offline Readiness:**
   - `apps/web/public/manifest.webmanifest` + `apps/web/public/sw.js` (offline shell fallback + Web Push notification handler).
   - `PwaOfflineBanner` inside global `providers.tsx` registering `/sw.js` safely and displaying calm offline notice + `112`/`108` reminder when offline.

4. **Verification:**
   - Playwright `phase6.spec.ts`: verifies single WebGL/reduced-motion static SVG fallback under emulated `reducedMotion: 'reduce'`, Kannada & Hindi live UI rendering, PWA `manifest.webmanifest` + `/sw.js` `200 OK`, web-vitals performance timings (`DOMContentLoaded` / paint checks), `0` console/page errors, `0` critical/serious axe violations, and desktop/mobile/reduced-motion screenshots in `docs/evidence/phase-6/`.
