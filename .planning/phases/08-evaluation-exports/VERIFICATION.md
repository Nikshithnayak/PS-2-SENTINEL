# Phase 8 Verification — Evaluation Lab, Model Card & Clinical Exports

> **Verified At:** 2026-11-26T00:21+05:30  
> **Result:** `PASS`

## Executed Checks & Observed Outputs

| Check | Command | Outcome | Notes |
| :--- | :--- | :--- | :--- |
| TypeScript Monorepo | `pnpm typecheck` | PASS (`3/3` packages) | Strictly typed `@medplum/fhirtypes` Bundle builder, pseudonymized cohort route, Evaluation Lab UI, Model Card, and Printable Report |
| Web Unit Integration | `pnpm --filter @sentinel/web test` | PASS (`17/17` tests across 8 files) | `phase8-exports.test.ts` verified `@medplum/fhirtypes` LOINC Observation/Flag/SYNTHETIC tagging + deterministic HMAC cohort pseudonymization |
| Next.js Production Build | `pnpm --filter @sentinel/web build` | PASS | Built 48 routes including `/eval`, `/model-card`, `/clinician/report`, `/api/v1/export/fhir`, `/api/v1/export/cohort-deidentified`, `/api/v1/datasets` |
| Playwright + Axe E2E | `pnpm --filter @sentinel/web test:e2e` | PASS (`8/8` suites) | Live `/eval` causal ablation run measured `L1_L2_L3_full` Sensitivity **`87.5%`** vs `fixed_clinical_only` **`62.5%`**, Specificity **`100.0%`**, **`0`** False Alerts/patient-wk across 11 scenarios (`fall_event` honestly reported as `21.3` / missed under static cutoff); `/model-card` & `/clinician/report` + FHIR/cohort `200 OK`; `0` console/page errors; `0` critical/serious axe violations |

## Visual Evidence Checked via `read_file`
- [eval-lab-desktop.png](file:///D:/build4manglore/docs/evidence/phase-8/eval-lab-desktop.png) — Live measured ablation table (`fixed_clinical_only` 62.5% vs `L1_L2_L3_full` 87.5% sensitivity, 0 false alerts), all 11 scenario scores, and 4 public dataset adapters.
- [model-card-desktop.png](file:///D:/build4manglore/docs/evidence/phase-8/model-card-desktop.png) — Safety scope, PPG skin-tone/perfusion bias disclosure, partial NEWS2 limitations.
- [clinician-report-desktop.png](file:///D:/build4manglore/docs/evidence/phase-8/clinician-report-desktop.png) — Print/PDF & FHIR R4 clinical report layout.
