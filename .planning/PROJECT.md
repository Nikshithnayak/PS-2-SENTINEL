# PROJECT: SENTINEL (`Sachet`) — Wearable-Based Early Warning System

> **Hackathon Brief:** Problem S2 · Nitte Pharma Innovation Centre (Mangaluru, Karnataka)  
> **Working Codename:** `SENTINEL` (Phase 1 product brand identity: **Sachet · SENTINEL** — *Wearable Early-Awareness Platform*)  
> **Stage:** Phase 0 Complete — Ready for Phase 1 Foundations

---

## 1. Vision & Problem Statement

Elderly patients and individuals managing chronic conditions (heart failure, COPD, hypertension, diabetes, post-discharge fragility) experience subtle autonomic, cardiorespiratory, thermal, and behavioral shifts **hours to days before acute clinical deterioration**. Standard consumer smartwatches trigger noisy false alarms against fixed population thresholds, while families rely on intermittent phone calls or clinic visits that catch decompensation too late.

**SENTINEL** turns multi-vendor wearable telemetry, environmental context, and lightweight patient check-ins into a **calm, explainable, deterministic early-awareness system** spanning four pillars:

1. **Personal Baseline:** Learns each person's own circadian, weekday, and context-aware (`sleep`, `rest`, `light`, `exercise`) physiological normal over a 14-day shrinkage warm-up with strict anomaly quarantine.
2. **Anomaly Detection:** Combines three auditable statistical layers — L1 cited clinical safety rules, L2 personal univariate change/EWMA/CUSUM/change-points (`ruptures`), and L3 multivariate robust Mahalanobis + streaming `HalfSpaceTrees` / `IsolationForest` — yielding a **0–100 Deterioration Index** with per-signal attribution and data confidence.
3. **Early Alerts & Escalation:** Combats alarm fatigue via persistence (`N of M` windows), hysteresis, cooldowns, daily budgets, quiet hours, and a timed escalation ladder across in-app SSE, Web Push, two-way email replies (`OK`/`CALL ME`/`SNOOZE`), Telegram, and `ntfy` — culminating in localized emergency guidance (`112` / `108` India defaults + nearest hospital lookup).
4. **Clear Multi-Role Dashboards:**
   - **Elder Today (`Patient`)**: High-contrast >=18px UI, >=48px targets, English/Kannada/Hindi, read-aloud, one calm sentence, 3 vitals, 3 instant action buttons.
   - **Caregiver Console**: Circle ranked by risk, explainable alert inbox, acknowledgements, timeline, quick call/message, shareable summary.
   - **Clinician View**: Zoomable Apache ECharts traces with personal baseline bands, change-points, medication overlays, partial NEWS2 breakdown, PDF & FHIR R4 export, de-identified cohorts.
   - **Signal Explorer, Evaluation Lab & Model Card**: Transparent live signal inspection, seeded scenario & public dataset benchmarking, and documented failure/bias bounds.

---

## 2. Target Users & Roles

| Role | Primary Persona | Core Job-to-be-Done |
|---|---|---|
| **Patient (Elder Mode)** | Ramesh Pai (72), post-HF/HTN in Mangaluru, Kannada speaker, low tech literacy | Know I am safe today in 3 seconds; tell my family if I feel unwell in 1 tap; hear alerts read aloud |
| **Caregiver** | Kavitha Pai (41), working daughter in Bengaluru | Sleep soundly unless real multi-hour deterioration emerges; acknowledge or escalate in 1 reply/tap |
| **Clinician** | Dr. Arvind Shetty, outpatient physician/cardiologist | Inspect trend vs personal baseline + medication adherence + data confidence in <60s; export FHIR/PDF |
| **Org Admin / Researcher** | Nitte Pharma Innovation Centre R&D lead | Audit detection lead time, false alarms/week, layer ablations, and de-identified cohort trends |

---

## 3. Clinical & Safety Framing

- SENTINEL is a **screening and early-awareness tool**, never a diagnostic medical device.
- Every explanation says *"changes from your personal normal"*, never *"you have [diagnosis]"*.
- Every urgent state prominently surfaces configurable local emergency numbers (`112` Emergency, `108` Ambulance in India) and nearest hospital lookup.
- Every number displayed is traceable to persisted database records (`vital_samples`, `quality_flags`, `detector_decisions`); synthetic scenarios run only in explicitly toggled Synthetic Mode and always display a `SYNTHETIC` badge.

---

## 4. Technical Stack Summary (ADR-Locked Baseline)

- **Monorepo:** `pnpm` + Turborepo
- **Frontend (`apps/web`):** Next.js 16 (`App Router`, `proxy.ts`, Turbopack), React 19, TypeScript (`strict`), Tailwind CSS v4, shadcn/ui, TanStack Query, `next-intl` (`en`, `kn`, `hi`), Apache ECharts, `motion`, `@shadergradient/react` + `@react-three/fiber`, Zod, `@medplum/fhirtypes`, PWA Service Worker + VAPID Web Push
- **Detection Engine (`services/engine`):** FastAPI, Python 3.12 (`uv`), `numpy`, `pandas`, `scipy`, `statsmodels`, `scikit-learn`, `river`, `ruptures`, `neurokit2`, `pydantic`, `pytest` + `hypothesis`
- **Shared Contracts (`packages/shared`):** Canonical Zod schemas, units, metric definitions, FHIR helpers, and JSON Schema contracts
- **Email Reply Worker (`workers/inbox`):** Cloudflare Worker + Email Routing pattern (`agentic-inbox`) with local simulator for dev/CI
- **Database & Auth:** PostgreSQL (TimescaleDB when available, native range-partitioned tables + rollups otherwise; `embedded-postgres` automatic zero-Docker local fallback on Windows), Drizzle ORM, Row-Level Security, Better Auth RBAC, Postgres transactional outbox & job queue, SSE live stream
- **Testing & CI:** Vitest, pytest + Hypothesis, Playwright E2E + `@axe-core/playwright`, k6 load test, GitHub Actions + Lighthouse CI
