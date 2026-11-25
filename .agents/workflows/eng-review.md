---
name: eng-review
description: Adapted from garrytan/gstack plan-eng-review (MIT). Architecture, two-shape module review, error/rescue map, security boundaries, and test plan verification.
---

# Engineering & Architecture Review Workflow

Adapted from `_refs/gstack/plan-eng-review` for SENTINEL.

## Review Sections (Mandatory Order)
1. **Architecture & Boundaries:**
   - Sketch two structurally different shapes before locking any new boundary; pick the deeper module (smaller public contract, hidden policy).
   - Screen against red flags: information leakage across Next.js/Python boundaries, split state ownership, two ways to do ingestion/alerts, hand-synced TypeScript/Python schemas (derive from OpenAPI / shared JSON schema / Zod!).
   - Require ASCII data-flow diagrams for: `Ingestion -> Quality -> Baseline/Engine -> Alerting/Outbox -> Escalation -> Ack -> SSE Dashboard`.
2. **Code Quality & Shared Contracts:**
   - Single source of truth for canonical metric types (`resting_heart_rate`, `hrv_rmssd`, `spo2`, `respiratory_rate`, `skin_temp_deviation`, `steps`, `sleep_*`).
   - Deterministic, seeded Python statistical core; LLM layer strictly isolated to structured-finding phrasing with zero PII.
3. **Test Matrix & Value Bar:**
   - Every critical path requires unit/property tests (Hypothesis for engine invariants, Vitest for TS schemas/policies) AND full E2E Playwright + axe checks with screenshots in `docs/evidence/`.
   - Golden deterioration scenarios (infection, HF, COPD, arrhythmia, dehydration/heat stress, post-discharge, missed meds, fall, off-wrist silence) must have ground-truth onset assertions.
4. **Performance, Security & Reliability:**
   - Check N+1 queries, time-series indexing/partitioning, rate limits, field-level PHI encryption, append-only hash-chained audit logs, CSP, and transactional outbox idempotency.
5. **Post-Build Verification Gate:**
   - Compiling != done. Execute tests + real headless/headed browser check + capture screenshot evidence before closing any phase.
