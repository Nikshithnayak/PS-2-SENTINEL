# Phase 8 Plan — Evaluation Lab, Model Card & Clinical Exports

## Objectives
1. **In-App Evaluation Lab (`/eval` + `GET /api/v1/datasets`):**
   - Live benchmark execution via `POST /api/v1/engine/benchmark` displaying measured ablations (`fixed_clinical_only` vs `L1_L2_personal` vs `L1_L2_L3_full`) with exact Sensitivity, Specificity, PPV, False Alerts / Patient-Week, Median Detection Latency/Lead Hours, per-scenario breakdown across all 11 seeded physiological trajectories, and honest disclosure that synthetic scenarios carry `SYNTHETIC` badges while public datasets (`PMData`, `LifeSnaps`, `WESAD`, `MMASH`) require user-supplied archives under `_data/`.
2. **Transparent Model Card (`/model-card` & `docs/MODEL-CARD.md`):**
   - Follows `technical-writer` + `ml-engineer` fairness/safety guidance: intended use, training/priors, deterministic L1/L2/L3 math, PPG skin-tone/perfusion & motion limitations, NEWS2 wearable gaps, and auditability invariants.
3. **Clinical & Research Exports:**
   - `GET /api/v1/export/fhir`: valid FHIR R4 `Bundle` (`@medplum/fhirtypes`) containing `Patient`, `Observation` (vital rollups with LOINC codes: `8867-4` HR, `40443-4` RHR, `59408-5` SpO2, `9279-1` RR), and `Flag` deterioration alerts.
   - `GET /api/v1/export/cohort-deidentified`: strips direct PII, masks ages to bands (`70-79`), assigns HMAC pseudonymous cohort IDs, excludes patients who did not consent or are `deletedAt`, and appends an audit log entry.
   - `/clinician/report` printable `@media print` Clinical Summary & PDF print export cleanly reachable from `/clinician`.
4. **Verification:**
   - Vitest integration suite (`phase8-exports.test.ts` on port `5440`) testing FHIR R4 bundle structure + LOINC codes, de-identified cohort PII-zero guarantee, and audit logging.
   - Playwright + axe E2E (`phase8.spec.ts`) opening `/eval`, executing live Python ablation benchmark, checking `/model-card` and `/clinician/report`, validating FHIR endpoint `200 OK`, `0` console/page errors, `0` critical/serious axe violations, and saving screenshots to `docs/evidence/phase-8/`.
