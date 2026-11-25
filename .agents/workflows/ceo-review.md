---
name: ceo-review
description: Adapted from garrytan/gstack plan-ceo-review (MIT). Scope challenge, sharpest wedge check, failure/zero-state audit, and explicit cuts before committing to a phase plan.
---

# CEO Scope & Product Review Workflow

Adapted from `_refs/gstack/plan-ceo-review` for SENTINEL.

## Step 0: Scope Challenge & Posture
Choose posture consciously per phase: **SELECTIVE EXPANSION** for core clinical safety & elder accessibility; **SCOPE REDUCTION** against decorative bloat or speculative ML models.

## Checklist (Run Before Locking Any Phase)
1. **Premise & Wedge Check:** Does every planned screen/feature directly strengthen the 4 pillars (Personal Baseline, Anomaly Detection, Early Alerts, Clear Health Dashboard) or required clinical deployment readiness?
2. **Zero Silent Failures:** Trace every failure path — malformed Apple XML, off-wrist gaps, engine timeout, failed email/Telegram/push delivery, offline PWA. Every failure must surface a clear state and fallback.
3. **Trace Happy / Empty / Loading / Error / Offline Paths:** Every list and chart must handle Day-0 (0 samples), Learning phase (Day 1–13 of 14), Calibrated, Confounded (exercise/heat/illness exclusion), Offline, and API 500 states.
4. **What to Cut / Defer:** Explicitly move non-wedge complexity (e.g., uncalibrated cuffless BP claims, unvalidated deep-learning black-box autoencoders as default, fake LLM chatbots) to `NOT in Scope` or `P2`.
5. **12-Month Ideal Trajectory:** Verify today's schema and adapter boundaries support real clinic pilots at Nitte Pharma Innovation Centre without rewrite.
