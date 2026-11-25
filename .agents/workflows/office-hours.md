---
name: office-hours
description: Adapted from garrytan/gstack office-hours (MIT). Six forcing questions + premise challenge + alternatives before locking any new SENTINEL capability.
---

# Office Hours — Problem & Wedge Validation Workflow

Adapted from `_refs/gstack/office-hours` for SENTINEL's autonomous zero-question execution model (where the agent convenes the stakeholder panel and answers with clinical/product rigor, logging outcomes in `.planning/DECISIONS.md`).

## Hard Gate
- Produce design/decision documentation ONLY; never write application code during an office-hours pass.

## The Six Forcing Questions (Must Answer Specifically)
1. **Demand Reality:** What real human behavior proves elderly patients, caregivers, and clinicians actually want this (not "sounds cool")?
2. **Status Quo:** What clumsy workaround do Mangalore/Indian families and discharge clinics currently rely on (WhatsApp vitals photos, phone calls at 10 PM, missed early fever/dyspnea)?
3. **Desperate Specificity:** Name concrete humans, not categories (e.g., 72-year-old Kannada-speaking post-HF patient at home; working daughter in Bengaluru; geriatrician/physician at K.S. Hegde / Nitte clinic).
4. **Narrowest Wedge:** What is the smallest reliable loop that creates immediate life-safety value? (Passive personal baseline + silent-device check + clear explainable caregiver escalation + one-tap elder check-in).
5. **Observation & Friction:** Where will an elderly patient actually fail or abandon the flow? (Small fonts, English-only medical jargon, false alarms waking family at 2 AM, forgetting to charge watch).
6. **Future-Fit (3-Year Horizon):** With Fitbit Web API shut down (Nov 2026) and fragmented HealthKit/Health Connect ecosystems, why does an adapter-based, self-hosted data layer + deterministic auditable engine endure?

## Premise Challenge & Alternatives
Before locking scope, challenge at least 3 premises (e.g. "Do we need raw continuous ECG streaming on day 1?", "Should an LLM decide alerts?") and evaluate:
- **Approach A (Minimal Viable)**
- **Approach B (Ideal Balanced Architecture — Recommended)**
- **Approach C (Over-scoped / Lateral)**
Record the chosen trade-offs in `.planning/DECISIONS.md`.
