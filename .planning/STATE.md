# Project State — SENTINEL

> **Last Updated:** 2026-11-26T00:12+05:30  
> **Active Phase:** Phase 7 Complete -> Entering **Phase 8: Evaluation Lab, Model Card & Clinical Exports**  
> **Overall Status:** `ON_TRACK`

---

## Completed Phases
- [x] **Phase 0–6:** Foundations, Data Layer, Detection Engine, Alerting/Escalation, Dashboards, Signature Visuals/i18n/PWA (`f2e85a8`..`541bbc4`).
- [x] **Phase 7: Voice Check-In, Inbox Worker, Telegram & Medications** — Multilingual EN/KN/HI Voice Check-In Companion + barge-in TTS + `OPEN_LLM_VTUBER_WS` optional bridge, `workers/inbox` Cloudflare Email Routing worker + `/api/v1/webhooks/inbox-reply` + `/api/v1/webhooks/telegram`, NLM RxNorm non-PII drug lookup & dose adherence overlay (`15/15` Vitest, `1/1` inbox worker, `7/7` Playwright/axe).

## Next Immediate Actions (Phase 8: Evaluation Lab, Model Card & Exports)
1. Author `.planning/phases/08-evaluation-exports/PLAN.md`.
2. Build **In-App Evaluation Lab (`/eval`)**: interactive causal benchmark runner calling `POST /api/v1/engine/benchmark` (showing `fixed_clinical_only` vs `L1_L2_personal` vs `L1_L2_L3_full` Sensitivity, Specificity, PPV, False Alerts / Patient-Week, Median Hours After Onset, all 11 scenario pass/fail outcomes, and PMData/LifeSnaps/WESAD/MMASH public dataset schema adapter report).
3. Build **Honest Model Card (`/model-card` + `docs/MODEL-CARD.md`)**: model architecture, intended non-diagnostic use, known limitations (dark-skin PPG attenuation, motion artifacts, missing ACVPU/O2/cuff-BP in partial NEWS2), subgroup considerations, calibration guarantees, and live link from `/clinician` & `/eval`.
4. Build **Clinician Exports (`/api/v1/export/fhir`, `/api/v1/export/clinician-report`, `/api/v1/export/cohort-deidentified`)**:
   - Real FHIR R4 `Bundle` conforming strictly to `@medplum/fhirtypes` (`Patient`, vital `Observation`s, `Flag` deterioration alerts, de-identified or consented).
   - Printable Clinician Summary HTML/PDF-ready report view & downloadable JSON/printable artifact (`window.print()` clean `@media print` stylesheet + server-generated report endpoint).
   - Org Admin / Researcher de-identified cohort dataset export (strictly stripped PII + rotated pseudonymous `studyId` + `clinician_export` consent / `org_admin` guard).
5. Verify via Vitest (`phase8-exports.test.ts` validating `@medplum/fhirtypes` schema structure & PII stripping in de-identified cohort export) + Playwright + axe E2E (`phase8.spec.ts` testing live `/eval` benchmark run, `/model-card`, FHIR R4 download, and Clinician Summary render with screenshots in `docs/evidence/phase-8/`).
