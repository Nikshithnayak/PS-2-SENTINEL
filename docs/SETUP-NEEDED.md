# External Accounts, Secrets & Optional Setup — SENTINEL

SENTINEL is built to run **completely out-of-the-box locally** (using local PostgreSQL, Synthetic Data mode, Apple Health XML / Takeout / CSV importers, in-app SSE, local Web Push VAPID keys, and local webhook/inbox emulators) **without requiring paid external accounts**.

For live production integrations that require human account registration or vendor partner approval, clean adapters are implemented and environment-gated in `.env.example`:

| Variable(s) | Purpose | Required for Core Local Run? | How to Provision |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (`postgres://...`) | No (auto-starts local `embedded-postgres` when unset; used directly in `docker compose up`) | Set for Neon / Supabase / self-hosted Postgres |
| `BETTER_AUTH_SECRET`, `PHI_ENCRYPTION_KEY` | Session signing & AES-256-GCM field encryption | Auto-generated dev defaults provided in local `.env` template; **required in prod** | Generate via `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (optional `GOOGLE_HOSTED_DOMAIN`) | Real Google Sign-In OAuth 2.0 via Better Auth (`/auth`) | No (email/password & seeded local accounts work standalone; required for live Google OAuth) | Create Web OAuth 2.0 Client in Google Cloud Console with Authorized Redirect URI `http://localhost:3000/api/auth/callback/google` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (or `VAPID_PUBLIC_KEY`), `VAPID_PRIVATE_KEY` | PWA Web Push notifications | Local dev auto-generates ephemeral VAPID pair if unset | `npx web-push generate-vapid-keys` |
| `OPEN_WEARABLES_URL`, `OPEN_WEARABLES_API_KEY` | Optional `the-momentum/open-wearables` unified wearable connector | No (direct Apple XML, Takeout, CSV, REST push, and Synthetic work standalone) | Run `docker compose --profile open-wearables up` and generate key at `http://localhost:3000` |
| `GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET` | Optional Google Health API v4 OAuth connector (replaces retired Fitbit Web API) | No (partner review required by Google) | Register Google Cloud project + Google Health API OAuth 2.0 credentials |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` / `RESEND_API_KEY`, `EMAIL_FROM` | Live outbound caregiver alert emails | No (outbox records & previews every email in Alert Delivery Inspector when unset) | Free tier: Resend (3,000/mo) or Brevo (300/day) |
| `CLOUDFLARE_INBOX_WEBHOOK_SECRET` (or `INBOX_WEBHOOK_SECRET`) | `workers/inbox` Cloudflare Email Routing worker for `OK` / `CALL ME` / `SNOOZE` email replies | No (local `/api/v1/webhooks/inbox-reply` works in dev/CI) | Deploy `workers/inbox` via Wrangler on Cloudflare domain with Email Routing |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` | Telegram caregiver alert bot & inline Ack/Snooze buttons | No (adapter disabled gracefully if unset; dry-run payload logged in outbox) | Create bot via `@BotFather` on Telegram and configure `/api/v1/webhooks/telegram` |
| `NTFY_TOPIC_URL` (e.g. `https://ntfy.sh/<topic>`) | Zero-account push via `ntfy.sh` or self-hosted `ntfy` | No (optional public/private topic URL) | Pick unique secret topic or self-host `ntfy` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `ENABLE_SMS_ADAPTER` | Feature-flagged paid SMS / WhatsApp adapter | No (`ENABLE_SMS_ADAPTER=false` by default) | Twilio account + verified sender |
| `NEXT_PUBLIC_OPEN_LLM_VTUBER_WS` | Optional self-hosted Open-LLM-VTuber WebSocket voice bridge | No (browser Web Speech & deterministic multilingual responder work standalone) | Run `Open-LLM-VTuber` server and set `ws://` URL |
| `LLM_PHRASING_API_KEY`, `LLM_PHRASING_BASE_URL` | Optional PII-stripped explanation phrasing adapter | No (deterministic multilingual template explainer always active) | OpenAI-compatible API key (never receives patient PII) |
| `SENTRY_DSN` | Error tracking | No (GlitchTip / Sentry free tier optional) | Create project on `sentry.io` or self-hosted GlitchTip |
