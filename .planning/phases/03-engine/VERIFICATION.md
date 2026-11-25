# Phase 3 Verification — Personal Baseline & 3-Layer Detection Engine

> **Verified At:** 2026-11-25T23:20+05:30  
> **Result:** `PASS`

## Executed Checks & Observed Outputs

| Check | Command | Outcome | Notes |
| :--- | :--- | :--- | :--- |
| Python Detection Engine Tests | `Push-Location services\engine; uv run pytest -v` | PASS (`9/9` tests) | Golden scenarios (`early_infection`, `copd_exacerbation` Scale 2, `hf_decompensation`, `arrhythmia_episode`, `exercise_confounder` suppression), contamination quarantine (`excluded_periods` + tail holdout), explicit Partial NEWS2 `unavailable_from_wearable`, Hypothesis finite/deterministic property tests, causal ablation benchmark (`L1_L2_L3_full` sensitivity `>=0.85` vs fixed thresholds, `0.0` FA/patient-wk), and PMData/LifeSnaps/WESAD/MMASH schema adapters |
| TypeScript Monorepo | `pnpm typecheck` | PASS (`3/3` packages) | `@sentinel/shared`, `@sentinel/web`, `@sentinel/inbox-worker` |
| Shared Package Tests | `pnpm --filter @sentinel/shared test` | PASS (`8/8` tests) | Zod contracts, canonical units, encryption, audit hash chain |
| Web Integration Tests | `pnpm --filter @sentinel/web test` | PASS (`8/8` tests across 3 files) | Includes `engine-bridge.test.ts` verifying UTF-8 Kannada/Hindi persistence across `baseline_states`, `risk_assessments`, and `detector_decision_logs` |
| Next.js Production Build | `pnpm --filter @sentinel/web build` | PASS | Added `/api/v1/engine/evaluate`, `/api/v1/engine/benchmark`, `/api/v1/exclusions` and Detection Preview UI |
| Playwright + Axe E2E | `pnpm --filter @sentinel/web test:e2e` | PASS (`3/3` suites) | Phase 3 live UI -> Python `uvicorn` scoring verified (`68.1 warning` caught while `Partial NEWS2 = 0 pts`, proving personalized prodrome advantage), `0` console/page errors, `0` critical/serious axe violations |

## Visual Evidence Checked via `read_file`
- [engine-preview-desktop.png](file:///D:/build4manglore/docs/evidence/phase-3/engine-preview-desktop.png) — 1440×900 desktop showing live `python-engine` evaluation (`68.1 warning`, `0 / 100 / 65.73` L1/L2/L3, `Partial NEWS2 0 pts`, 4 quantified contributions, `SYNTHETIC` badge).
- [engine-preview-mobile.png](file:///D:/build4manglore/docs/evidence/phase-3/engine-preview-mobile.png) — 375×812 mobile layout cleanly stacked with zero overflow.
