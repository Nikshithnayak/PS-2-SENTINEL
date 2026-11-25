# Delivery Roadmap — SENTINEL (GSD Phases 1–9)

> Every phase follows **Discuss -> Plan -> Execute -> Verify**, creates `.planning/phases/0N-*/PLAN.md` and `VERIFICATION.md`, ends with executed automated tests + real browser Playwright/axe inspection + screenshots in `docs/evidence/`, and advances automatically upon passing all gates.

---

## Phase 0: Understand (Current — Complete at Commit)
- **Deliverables:** `_refs/` digest (`REPO-DIGEST.md`), `CREDITS.md`, `DOMAIN.md`, `DECISIONS.md` (6-persona panel), `ASSUMPTIONS.md`, `.agents/workflows/` + `.agents/skills/` (<=10), `GSTACK-PRESSURE-TEST.md`, `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `RISKS.md`, `UNDERSTANDING.md`, `STATE.md`, `MCP-CONFIG.md`.
- **Gate:** Zero application code; all Phase 0 docs committed cleanly.

---

## Phase 1: Foundations
- **Scope:** Monorepo (`pnpm` + Turborepo: `apps/web`, `services/engine`, `packages/shared`), CI workflow (`.github/workflows/ci.yml`), brand identity (`Sachet · SENTINEL`), `DESIGN.md` (Open Design schema) + CSS/Tailwind design tokens, PostgreSQL schema + Drizzle migrations (partitioned vitals, rollups, RLS, hash-chained audit log, consent ledger, outbox), local `embedded-postgres` dev runner + `docker-compose.yml` + seed script, Better Auth RBAC (`patient`, `caregiver`, `clinician`, `org_admin`), Next.js 16 `proxy.ts` security headers/CSP, `docs/SETUP-NEEDED.md`, `.env.example`.
- **Verification Gate:** Vitest schema/crypto/audit-chain tests pass; Drizzle migration + seed succeeds against live PostgreSQL; Playwright renders auth/consent & token preview with 0 console errors + screenshots in `docs/evidence/phase-1/`.

## Phase 2: Data Layer
- **Scope:** `ProviderAdapter` contract, Open Ingestion API (`/api/v1/ingest` with API keys + idempotency), streaming Apple Health `export.xml` importer, Google/Fitbit Takeout + interactive CSV column-mapper importer, `OpenWearablesAdapter` & `GoogleHealthAdapter`, Data Quality pipeline (UTC normalization, bounds, wear-time, motion artifact, `device_silent` signal), Open-Meteo environmental context adapter (no PII), seeded Synthetic Data generator (`services/engine/sim`) with 8 labeled physiological scenarios.
- **Verification Gate:** Real sample Apple `export.xml` & Takeout/CSV upload tests pass; deduplication & `%` scaling unit tests pass; Playwright upload wizard + `SYNTHETIC` badge verified with screenshots in `docs/evidence/phase-2/`.

## Phase 3: Detection Engine (`services/engine`, Python 3.12)
- **Scope:** Feature aggregator (hourly/daily, nocturnal/sedentary RHR, HRV RMSSD, SpO₂, RR, skin temp delta, steps, sleep metrics, check-in/med events); Personal Baseline fitter (median/MAD, exponential forgetting, circadian/weekday adjustment, prior shrinkage `Learning day X of 14 -> Calibrated`, quarantine/exclusions); L1 clinical rules + L2 (robust z-score, EWMA, CUSUM/Page-Hinkley, `ruptures`) + L3 (robust Mahalanobis `MinCovDet`, `river.HalfSpaceTrees`, `IsolationForest`, optional flagged autoencoder); Fusion -> Deterioration Index `0..100` + attribution + confounder control; condition modules (`HF`, `COPD Scale 2`, `HTN`, `Diabetes`, `Frailty`); offline evaluation harness (synthetic scenarios + public dataset loaders).
- **Verification Gate:** `pytest` + Hypothesis property tests pass (boundedness, NaN safety, quarantine invariance, exercise confounder suppression); golden scenario suite achieves measured sensitivity/lead-time before touching dashboard polish; ablation report emitted.

## Phase 4: Alerting & Escalation
- **Scope:** Anti-fatigue policy engine (`N of M` persistence, hysteresis, cooldowns, daily budget, quiet hours with Urgent bypass, deduplication); Escalation ladder with timers (Patient Nudge -> Primary Caregiver -> Secondary Caregiver -> Clinician -> Emergency `112`/`108` + OpenStreetMap nearest hospital lookup); Transactional outbox worker + SSE live stream + Web Push (VAPID) + Email + Telegram + `ntfy` (+ flag-gated SMS/WhatsApp adapter); Acknowledge / Snooze / False Alarm bounded sensitivity feedback.
- **Verification Gate:** Outbox retry/idempotency tests, escalation ladder timer progression tests, multi-channel integration test (In-App SSE + Email/ntfy/Telegram adapter), and browser verification in `docs/evidence/phase-4/`.

## Phase 5: Dashboards & Clinical Workflows
- **Scope:** **Patient Today (Elder Mode)** (`>=18px`, `>=48px` targets, 1 sentence, 3 vitals, 1-tap `I am OK` / `I feel unwell` / `Call my caregiver`, read-aloud); **Caregiver Console** (risk-ranked circle, explainable Alert Inbox, timeline, quick call/message, shareable summary); **Clinician View** (zoomable Apache ECharts traces with baseline bands, change-points, alert & medication adherence overlays, window comparison, partial NEWS2 table, cohort table); **Signal Explorer**; **Settings** (devices, consent withdrawal, care circle, thresholds, quiet hours, language, DPDP export & erasure).
- **Verification Gate:** Full end-to-end Playwright flow (ingest -> baseline -> deterioration -> multi-channel alert -> caregiver ack -> real-time SSE dashboard update with explanation) + mobile (`375px`) & desktop (`1440px`) screenshots in `docs/evidence/phase-5/`.

## Phase 6: Experience, Signature Visuals, i18n & Performance
- **Scope:** Landing page with lazy-loaded `ShaderGradient` + single R3F physiological pulse waveform (1 WebGL context/page, off-screen paused, `prefers-reduced-motion` static fallback); Patient subtle state aura; `motion` transitions; restrained `liquid-glass` floating chrome; full `next-intl` English / Kannada (`ಕನ್ನಡ`) / Hindi (`हिन्दी`) translations; PWA service worker offline shell; WCAG 2.2 AA/axe pass; Lighthouse performance & LCP optimization.
- **Verification Gate:** Playwright light/dark & `en`/`kn`/`hi` checks, `@axe-core/playwright` 0 serious violations, Lighthouse perf >= 90 & accessibility 100 checks, screenshots in `docs/evidence/phase-6/`.

## Phase 7: Companion Voice Check-In, Inbox & Telegram
- **Scope:** Elder Voice Check-In companion (`en`/`kn`/`hi` Web Audio + VAD + ASR/TTS + barge-in + tap fallback, deterministic symptom parser stored as check-in events feeding detector, optional Open-LLM-VTuber WebSocket bridge); `workers/inbox` Cloudflare Worker email-reply acknowledgement (`OK`, `CALL ME`, `SNOOZE`) with local webhook simulator; Telegram bot webhook/polling integration; Medication schedule + RxNorm/openFDA helper + adherence tracking.
- **Verification Gate:** Voice check-in symptom persistence -> detector scoring test, simulated email reply & Telegram callback ack tests, Playwright checks in `docs/evidence/phase-7/`.

## Phase 8: Evaluation Lab, Model Card & Clinical Exports
- **Scope:** In-App **Evaluation Lab** (interactive benchmark results, layer ablations vs fixed threshold, LifeSnaps/PMData/WESAD/MMASH offline metrics, bias/PPG caveats); **Model Card** page & `docs/MODEL-CARD.md`; **Clinician PDF summary** generator; valid **FHIR R4 Bundle** export (`@medplum/fhirtypes`: `Patient`, `Observation`, `Flag`); de-identified cohort export.
- **Verification Gate:** FHIR R4 schema validation tests, PDF generation byte/structure verification, Evaluation Lab measured numbers verified against actual Python harness outputs, screenshots in `docs/evidence/phase-8/`.

## Phase 9: Hardening, Load Testing, Docs & Delivery
- **Scope:** Security & OWASP ASVS L2 audit (`docs/ARCHITECTURE.md` with C4 Mermaid, sequences, STRIDE, RADIO frontend design), k6 load test (`ingest` + `dashboard` + `SSE`), free-tier deployment configs (Vercel + Neon + Render/Koyeb + Cloudflare Workers), final `README.md`, `docs/PITCH.md` (3-minute live demo script), final Definition-of-Done full-stack regression check.
- **Verification Gate:** All Vitest, pytest/Hypothesis, Playwright+axe, and k6 benchmarks pass after final edit; zero console errors; complete evidence bundle in `docs/evidence/phase-9/`.
