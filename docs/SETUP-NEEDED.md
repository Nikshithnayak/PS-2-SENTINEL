# External Accounts, Free-for-Dev Services & Setup — SENTINEL

SENTINEL runs **completely out-of-the-box locally** using local embedded PostgreSQL, real Web Bluetooth smartwatch pairing (`0x180D`), universal watch webhooks (`/api/v1/ingest/watch`), Apple Health XML / Takeout / CSV importers, in-app SSE, and local Web Push VAPID keys — **without requiring paid accounts**.

To enable cloud hosting, Google Sign-In, remote push/email alerts, or cloud wearable bridges, connect any of these **free-tier (free-for-dev)** providers in `.env.local`:

| Variable(s) | Free-for-Dev Service | Purpose | How to Provision |
|---|---|---|---|
| `DATABASE_URL` | **Supabase** (Free 500 MB) or Neon | Managed PostgreSQL + RLS instead of local embedded PG | Create project at `supabase.com` → Connect → URI (`postgres://...`) |
| `BETTER_AUTH_SECRET`, `PHI_ENCRYPTION_KEY` | Local CSPRNG | Session signing & AES-256-GCM field encryption | Auto-generated cleanly into `.env.local` (64 hex chars) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **Google Cloud Console** (Free) | Real **Continue with Google** OAuth 2.0 Sign-In | Create Web OAuth 2.0 Client; Redirect URI: `http://localhost:3000/api/auth/callback/google` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Built-in `web-push` (Free) | Real PWA browser & mobile push notifications | Generated locally via `npx web-push generate-vapid-keys` |
| `RESEND_API_KEY`, `EMAIL_FROM` (or `SMTP_*`) | **Resend** (Free 3,000/mo) or **Brevo** (300/day) | Real outbound caregiver alert emails | Create API key at `resend.com` (or SMTP credentials from `brevo.com`) |
| `NTFY_TOPIC_URL` | **ntfy.sh** (Free, zero account) | Instant Android/iOS/Desktop push alerts | Set `https://ntfy.sh/<private-topic>` and subscribe in the ntfy phone app |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID` | **Telegram Bot API** (Free) | Instant caregiver Telegram alerts with `OK` / `CALL ME` / `SNOOZE` buttons | Message `@BotFather` on Telegram → `/newbot` |
| `OPEN_WEARABLES_URL`, `OPEN_WEARABLES_API_KEY` | Self-hosted **Open Wearables** | Sync Garmin, Polar, Oura, Whoop, Suunto clouds | Run `docker compose --profile open-wearables up` |
| `GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET` | **Google Health API** | Sync Android Health Connect / Wear OS via Google cloud | Register project + Google Health OAuth scopes |
| `LLM_PHRASING_API_KEY`, `LLM_PHRASING_BASE_URL` | **Groq** / **Google AI Studio Gemini** (Free tier) | Optional PII-stripped calm alert phrasing | Create free API key at `console.groq.com` or `aistudio.google.com` |
| `SENTRY_DSN` | **Sentry** / **GlitchTip** (Free tier) | Error tracking | Create Next.js DSN on `sentry.io` |
