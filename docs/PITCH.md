# 3-Minute Walkthrough Guide — Sachet · SENTINEL

> **Problem Statement:** S2 · Nitte Pharma Innovation Centre — Wearable-Based Early Health Deterioration System  
> **Non-Diagnostic Framing:** *"Changes from your personal normal"* · Default India Emergency Safety: `112` / `108`

---

## Setup Checklist Before Live Walkthrough
1. Open live production (`https://ps-2-sentinel.vercel.app`) or start locally (`pnpm --filter @sentinel/web dev` for PostgreSQL + FastAPI engine + Next.js on `http://localhost:3000`).
2. Create or sign in with real **Patient**, **Caregiver**, and **Clinician** accounts on `/auth` (via **Continue with Google** or Email Sign Up) and connect them via `/settings/consent` Care Circle invites.

---

## Minute 0:00–0:45 — Problem & Elder Simplicity (`/today` + Voice Companion)
1. Open `/`: warm light-mode healthcare design (`DESIGN.md`), single restrained ambient pulse visual with `prefers-reduced-motion` safety, and live PostgreSQL RLS + Hash-Chained Audit Ledger status.
2. Sign in as a **Patient (`Elder Care View`)** on `/today`:
   - Highlight **Elder Mode**: >=18px type, >=48px touch buttons, non-diagnostic copy, one-tap **"I Feel Okay" / "Not Feeling Well"**, `"Read Aloud"` speech synthesis, and live **EN / ಕನ್ನಡ / हिन्दी** switching.
   - Show the **Wispr-Powered Voice Check-In Companion** (`Auto` / on-device Open-Source Whisper AI): natural greetings (`"Hello!"`), everyday symptom questions, filler cleanup, live audio waveform, and **Today's Medication Check** (RxNorm-verified beta-blocker awareness).

## Minute 0:45–1:45 — Direct Watch / Phone Sync & Personal Baseline (`/ingest` & `/eval`)
1. Open `/ingest`:
   - Connect directly via **1-Click Google Fit / Google Health OAuth**, **Android Health Connect QR Link** (HC Webhook JSON), or **Direct Bluetooth Watch (BLE `0x180D`)** — zero manual CSV downloads needed.
   - Historical Apple Health `export.xml`, Google Takeout JSON, and custom CSV importers remain available below for longitudinal backfill.
2. Click **Run Detection Engine** (or evaluate from `/alerts`): point out how **Partial NEWS2** may still read `0 pts` on generic cutoffs while SENTINEL's personal shrinkage baseline detects multi-signal shifts across Resting HR, Breathing Rate, HRV, and Skin Temp early.
3. Show `/eval` Model Card & dataset adapters (`PMData`, `LifeSnaps`, `WESAD`, `MMASH`).

## Minute 1:45–2:30 — Anti-Fatigue Caregiver Escalation (`/caregiver` & `/alerts`)
1. Sign in as the linked **Caregiver (`Caregiver Monitor`)**: notice the dedicated Caregiver navigation & workspace showing elder status, recent voice check-in transcripts, live SSE updates, quiet hours/budget controls, India `112` / `108` safety card + nearby hospitals, and instant **Acknowledge / Snooze / Escalate**.
2. Inbound Cloudflare Email / Telegram reply commands (`OK`, `CALL ME`, `SNOOZE`) update alert state in real time via SSE.

## Minute 2:30–3:00 — Clinician Triage, Quarantine & DPDP Privacy (`/clinician`, `/signals`, `/settings`)
1. Sign in as the linked **Clinician (`Clinician Workstation`)**: inspect Cohort Triage ranking, zoomable Apache ECharts trajectories with shaded personal normal tolerance bands, Window-vs-Window deltas, and transparent 7-row **Partial NEWS2** breakdown (`unavailable_from_wearable` rows explicitly labeled).
2. Export a printable summary & LOINC **FHIR R4 Bundle** (`/clinician/report`), inspect contamination quarantine windows (`/signals`), verify audit hash-chain integrity (`/settings/consent`), and download DPDP Act 2023 full JSON export (`/settings`).
