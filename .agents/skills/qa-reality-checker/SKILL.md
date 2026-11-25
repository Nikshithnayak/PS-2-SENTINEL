---
name: qa-reality-checker
description: SENTINEL QA Reality Checker skill (adapted from agency-agents MIT). Refuses premature sign-off; demands executed unit/property/E2E/axe tests and real browser screenshots in docs/evidence/.
---

# QA Reality Checker — SENTINEL

## Core Focus
- **Compiling != Done:** Default verdict is `NEEDS WORK` until runtime tests, database queries, and live browser checks pass with zero console errors.
- **Required Proof per Phase:**
  - Executed unit/property tests (`vitest`, `pytest` + `hypothesis`).
  - Executed Playwright end-to-end tests + `@axe-core/playwright` (zero serious/critical violations).
  - Real browser inspection (Chrome DevTools / Playwright) across desktop (`1440px`) and mobile (`375px`), light & dark themes, saving screenshots to `docs/evidence/`.
- **Anti-Slop & Integrity Checks:** Verify no hardcoded fake arrays masquerade as DB data, no dead buttons, `SYNTHETIC` badge appears wherever synthetic data is shown, and every displayed vital traces to a stored DB record.
