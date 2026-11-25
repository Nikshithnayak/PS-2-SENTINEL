# Phase 4 Plan — Anti-Fatigue Alerting, Escalation Ladder & Multi-Channel Outbox

## Objectives
1. **Anti-Fatigue Alert Policy Engine (`apps/web/src/lib/alerts/policy.ts`):**
   - **N-of-M persistence** (`watch` requires >=2 elevated evaluations or critical `urgent` bypass).
   - **Hysteresis:** clearing requires `deteriorationIndex < 24` (below the `30` watch entry threshold) to avoid flip-flop chatter.
   - **Cooldown & Deduplication:** suppress repeat open/recent alerts with identical `(patientId, ruleKey)` within cooldown window (`240 min` watch, `90 min` warning, `30 min` urgent) while upgrading level cleanly if worsening.
   - **Daily Alert Budget & Quiet Hours:** enforce `dailyAlertBudget` (default `6/day`) and local quiet hours (`22:00–06:00`), ALWAYS allowing `urgent` alerts through quiet hours & budget!
   - **Bounded Self-Tuning Feedback:** patient/caregiver feedback (`helpful`, `expected_activity`, `false_alarm`) adjusts `patientProfiles.sensitivityOffset` clamped safely in `[-0.25, +0.25]` (`<= 0.05` step per feedback, never muting `L1 urgent` safety rules).

2. **Timed Escalation Ladder & Emergency Routing (`apps/web/src/lib/alerts/escalation.ts`):**
   - Step 0: Patient Nudge (`0m`).
   - Step 1: Primary Caregiver (`+15m` warning / `+5m` urgent, ordered by `care_circle_members.priorityOrder`).
   - Step 2: Secondary Caregiver (`+30m`).
   - Step 3: Assigned Clinician (`+45m`).
   - Step 4: Emergency Safety Screen (`112` Emergency / `108` Ambulance defaults configurable per patient profile + OpenStreetMap Overpass/Nominatim nearest hospital lookup cached cleanly without patient PII).
   - Lifecycle actions: Acknowledge (`OK`), Snooze (`SNOOZE 2h`), Escalate Now (`CALL ME` / Step+1), False Alarm (`false_alarm`), Resolve.

3. **Transactional Outbox, SSE & Delivery Adapters (`apps/web/src/lib/alerts/outbox.ts`, `adapters.ts`):**
   - Atomic `alerts` + `alert_deliveries` + `job_queue` insertion inside Postgres transactions.
   - Retry backoff worker (`processOutboxBatch`) supporting idempotent delivery keys (`alertId:recipientId:channel:step`).
   - Live SSE event stream (`/api/v1/stream`) notifying connected browsers immediately upon new alerts, acknowledgements, or escalations.
   - Real channel adapters: `in_app`, `web_push` (VAPID via `web-push`), `email` (Resend / SMTP with full formatted body & reply-action tokens + Outbox Preview when credentials unset), `telegram`, `ntfy`, and `sms_flag` (feature-gated per `SETUP-NEEDED.md`).

4. **APIs, Interactive Care-Alert Drawer & Verification:**
   - Endpoints: `/api/v1/alerts`, `/api/v1/alerts/[id]/ack`, `/api/v1/alerts/escalate`, `/api/v1/stream`, `/api/v1/push/subscribe`, `/api/v1/emergency/hospitals`.
   - Vitest unit/integration checks covering N-of-M, hysteresis, quiet hours Urgent bypass, daily budget, outbox idempotency/retry, multi-step escalation, and bounded feedback clamping.
   - Playwright + axe E2E test verifying deterioration -> alert firing -> live SSE push -> outbox delivery receipts (`in_app` + `email` + `ntfy`/`web_push`) -> nearest hospital lookup -> Acknowledge / Escalate actions -> screenshots in `docs/evidence/phase-4/`.
