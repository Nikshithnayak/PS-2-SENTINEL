# Phase 7 Plan — Voice Check-In Companion, Agentic Inbox Worker, Telegram & Medications

## Objectives
1. **Elder Voice Check-In Companion (`apps/web/src/lib/voice/parser.ts` + `components/voice/voice-checkin.tsx` + `/api/v1/voice/checkin`):**
   - Multilingual (`en-IN`, `kn-IN`, `hi-IN`) deterministic clinical check-in transcript parser recognizing symptom intents (`fever`, `breathless`, `chest_pain`, `dizziness`, `fatigue`, `okay`) & red-flag escalation phrases (`chest pain`, `cannot breathe`, `unconscious`, Kannada/Hindi equivalents).
   - Browser Web Audio microphone volume indicator (when mic permitted) + Web Speech Recognition (`SpeechRecognition`/`webkitSpeechRecognition`) + Speech Synthesis TTS reply with instant **barge-in interrupt button** (`Stop Speaking`) + accessible **guided text/tap fallback** (critical for desktop/Playwright/elder users with muted mics!) + optional `OPEN_LLM_VTUBER_WS` WebSocket hook documented in `SETUP-NEEDED.md`.
   - Persists structured results directly to `checkin_events` (`kind: 'voice'`) and triggers red-flag caregiver nudge when severe symptoms match!

2. **Cloudflare Agentic Inbox Email Reply Worker (`workers/inbox/` + `POST /api/v1/webhooks/inbox-reply`):**
   - `workers/inbox/package.json`, `tsconfig.json`, `wrangler.toml`, `src/index.ts` implementing Cloudflare Email Routing inbound handler parsing reply bodies (`OK`, `CALL ME`, `SNOOZE`) and forwarding signed webhooks with `x-inbox-signature` HMAC/secret to SENTINEL.
   - `POST /api/v1/webhooks/inbox-reply` verifying signature/session and driving `applyAlertAction` (`OK -> acknowledge`, `CALL ME -> escalate`, `SNOOZE -> snooze`), plus interactive Reply Simulator widget on `/alerts`.

3. **Telegram Webhook (`POST /api/v1/webhooks/telegram`):**
   - Handles Telegram bot replies/callbacks (`/ok`, `/callme`, `/snooze` or `OK <alertId>`) verified via `x-telegram-bot-api-secret-token`.

4. **Medications, Adherence & Public RxNorm/openFDA Helper (`apps/web/src/lib/meds/rxnorm.ts`, `/api/v1/medications`):**
   - Non-PII public medication name lookup via NLM RxNorm REST (`rxnav.nlm.nih.gov/REST/drugs.json`) & openFDA (`api.fda.gov/drug/label.json`), noting heart-rate effects (e.g., beta blockers `Metoprolol`, `Atenolol`).
   - CRUD + Dose event logger (`medications` & `medication_events`: `taken`, `missed`, `late`) wired into `/today` & `/settings` and rendered directly as `Rx:missed`/`Rx:taken` markers on Clinician ECharts!

5. **Verification:**
   - Unit + DB integration tests (`phase7-channels.test.ts` on port `5439`) covering voice transcript red-flag extraction (EN/KN/HI), Cloudflare inbox parser/action (`OK`, `CALL ME`, `SNOOZE`), Telegram command parsing, and RxNorm/medication adherence persistence.
   - Playwright + axe E2E (`phase7.spec.ts`) executing voice check-in on `/today`, email reply webhook (`SNOOZE` / `OK`) on `/alerts`, and medication adherence tracking with screenshots in `docs/evidence/phase-7/`.
