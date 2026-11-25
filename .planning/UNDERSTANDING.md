# UNDERSTANDING.md — SENTINEL (`Sachet`) in Plain Words

## What Are We Building?
We are building **SENTINEL** (branded in Phase 1 as **Sachet · SENTINEL**), a real, end-to-end **wearable early-awareness system** for elderly adults and chronic-care patients living at home (built for Nitte Pharma Innovation Centre Problem S2). Instead of comparing everyone to a generic textbook chart, SENTINEL learns *each person's own normal* across resting heart rate, heart-rate variability (HRV), blood oxygen, breathing rate, skin temperature trend, activity, and sleep — and detects subtle multi-day physiological shifts before they become emergencies.

## Who Is It For?
1. **Elderly Patients (e.g., 72-year-old Kannada speaker at home):** Gets a calm, high-contrast, >=18px screen in English, Kannada, or Hindi with one plain sentence, three vitals, read-aloud audio, and giant one-tap buttons (*"I am OK"*, *"I feel unwell"*, *"Call my caregiver"*).
2. **Remote Caregivers (e.g., working adult child):** Gets peace of mind when normal, and quiet, explainable alerts (via app, push, email reply `OK`/`CALL ME`/`SNOOZE`, Telegram, or `ntfy`) only when persistent changes occur — never for a brisk walk.
3. **Clinicians & R&D Leads:** Gets zoomable baseline-band timelines with medication overlays, partial NEWS2 framing (honest about missing blood pressure), PDF & FHIR R4 export, and a transparent Evaluation Lab proving real detection performance.

## What Does "Done" Mean?
- One command (`docker compose up` in container environments, plus local zero-Docker dev parity) brings up Next.js web, Python detection engine, and PostgreSQL.
- Every UI number reads real persisted PostgreSQL records via authenticated APIs — zero fake arrays.
- A real Apple Health `export.xml` imports cleanly and builds a personal baseline.
- An automated end-to-end test proves the complete loop: ingest wearable data -> baseline calibrates -> deterioration scenario injected -> deterministic Python engine scores `0..100` with attribution -> anti-fatigue escalation fires to caregiver on >=2 channels -> caregiver acknowledges -> dashboards update live via SSE.
- Synthetic Mode is explicitly isolated and labeled `SYNTHETIC`; Lighthouse, axe accessibility (`0 serious` violations), unit/property tests, and browser screenshot evidence all pass.

## What We Will Deliberately NOT Build
- **No medical diagnosis or treatment claims:** Always *"changes from your personal normal"*, never *"you have sepsis/heart failure"*.
- **No LLM-decided clinical alerts:** Detection is 100% deterministic, seeded, and auditable in Python; LLMs never gate alerts or receive patient identifiers.
- **No legacy Fitbit Web API OAuth:** Shut down Nov 2026; use our `ProviderAdapter` (Apple XML, Takeout, CSV, REST push, Open Wearables, Google Health API).
- **No native mobile binary app in P0/P1:** Delivered as an installable offline-capable PWA (native HealthKit/Health Connect sync via Open Wearables SDK documented as P2).
- **No decorative AI slop or fake patient portraits:** Zero `Open-Generative-AI` stock faces, zero `liquid-logo` PolyForm-restricted code, zero unrequested bloat.
