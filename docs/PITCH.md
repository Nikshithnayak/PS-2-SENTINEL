# 3-Minute Demo Script — Sachet · SENTINEL

> **Problem Statement:** S2 · Nitte Pharma Innovation Centre — Wearable-Based Early Health Deterioration System  
> **Non-Diagnostic Framing:** *"Changes from your personal normal"* · Default India Emergency Safety: `112` / `108`

---

## Setup Checklist Before Opening Screen
1. Start local stack: `pnpm --filter @sentinel/web dev` (auto-starts embedded PostgreSQL + Python FastAPI engine + Next.js on `http://localhost:3000`).
2. Seeded demo credentials (Password for all accounts: `SentinelDemo#2026`):
   - **Patient (Elder):** `ramesh@sentinel.local` (Ramesh Pai, 72, Mangaluru)
   - **Primary Caregiver:** `kavitha@sentinel.local` (Kavitha Pai)
   - **Clinician:** `dr.shetty@sentinel.local` (Dr. Arvind Shetty)
   - **Research Admin:** `research@sentinel.local` (Nitte Pharma R&D)

---

## Minute 0:00–0:45 — Problem & Elder Simplicity (`/today` + `/`)
1. Open `/` (`http://localhost:3000`): point out warm editorial healthcare readability (`DESIGN.md`), single restrained ambient pulse ribbon with `prefers-reduced-motion` safety, and live PostgreSQL RLS + Hash-Chained Audit Ledger status cards.
2. Sign in as **Ramesh Pai** on `/auth` and visit `/today`:
   - Highlight **Elder Mode**: >=18px type, >=56px touch buttons, non-diagnostic copy, one-tap **"I Feel Okay" / "Not Feeling Well"**, `"Read Aloud"` speech synthesis, and live switch to **ಕನ್ನಡ** or **हिन्दी**.
   - Show the **Voice Check-In Companion** & **Today's Medication Check** (RxNorm-verified beta blocker tracking).

## Minute 0:45–1:45 — Ingestion, Personal Baseline & Why Generic Thresholds Miss Deterioration (`/ingest` & `/eval`)
1. Open `/ingest`: demonstrate streaming Apple Health `export.xml`, CSV column mapper, single-show API key creation, and explicit `SYNTHETIC` badging.
2. Select **`early_infection`**, click **Generate Synthetic Series**, then click **Run Detection Engine**:
   - Point out exact observed behavior: **Partial NEWS2 = `0 pts`** (fixed clinical threshold misses early prodrome!), while SENTINEL's personal baseline catches **`Deterioration Index ~68–70 (WARNING)`** because Resting HR, Breathing Rate, HRV, and Skin Temp shifted together relative to Ramesh's own 15+ day personal normal.
3. Open `/eval` and run the live causal walk-forward benchmark: compare `fixed_clinical_only` vs `L1_L2_L3_full` across all 11 scenarios (including `copd_exacerbation` Scale 2 and zero false alarms on `exercise_confounder`).

## Minute 1:45–2:30 — Anti-Fatigue Caregiver Escalation & Bidirectional Replies (`/alerts` & `/caregiver`)
1. Open `/alerts`: point out live `EventSource` SSE badge, Quiet Hours / Daily Budget controls, India `112` / `108` safety card + Mangaluru/Nitte hospitals list, and idempotent outbox receipts (`in_app`, `email`, `web_push`, `ntfy`, `telegram`, gated `sms_flag`).
2. Demonstrate Cloudflare Agentic Inbox reply workflow (`OK`, `CALL ME`, `SNOOZE`) via the reply buttons, updating alert state instantaneously over live SSE in Kavitha's Caregiver Console (`/caregiver`).

## Minute 2:30–3:00 — Clinician Triage, Quarantine & Privacy Exports (`/clinician`, `/signals`, `/settings`)
1. Switch to **Dr. Arvind Shetty** (`/clinician`): inspect Cohort Triage ranking, zoomable Apache ECharts Resting HR curve with shaded personal normal tolerance band (`normalLow..normalHigh`), Window-vs-Window delta, and the explicit 7-row **Partial NEWS2** breakdown (`unavailable_from_wearable` rows honestly shown).
2. Click **PDF / FHIR** (`/clinician/report`) -> downloadable LOINC **FHIR R4 Bundle**, `/signals` contamination quarantine window, `/model-card` equity disclosures, and `/settings` DPDP Act 2023 JSON Export + Erasure.
