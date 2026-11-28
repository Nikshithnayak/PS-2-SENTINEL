import { generateVAPIDKeys } from 'web-push';

export interface VapidConfig {
  publicKey: string | null;
  privateKey: string | null;
  subject: string;
  source: 'env' | 'ephemeral_local' | 'unconfigured';
}

export interface NtfyConfig {
  baseUrl: string;
  topic: string | null;
}

const globalForVapid = globalThis as typeof globalThis & {
  __sentinelEphemeralVapid?: { publicKey: string; privateKey: string };
};

/**
 * Resolves Web Push VAPID credentials across `VAPID_PUBLIC_KEY` and
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, generating a cached ephemeral pair for local
 * runs when no explicit keys are configured.
 */
export function resolveVapidConfig(
  env: NodeJS.ProcessEnv = process.env,
  allowEphemeral = env.NODE_ENV !== 'production' || env.SENTINEL_LOCAL_BOOT === '1',
): VapidConfig {
  const publicKey =
    env.VAPID_PUBLIC_KEY?.trim() || env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null;
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() || null;
  const subject = env.VAPID_SUBJECT?.trim() || 'mailto:care@sentinel.local';

  if (publicKey && privateKey) {
    return { publicKey, privateKey, subject, source: 'env' };
  }

  if (allowEphemeral && env === process.env && !publicKey && !privateKey) {
    if (!globalForVapid.__sentinelEphemeralVapid) {
      globalForVapid.__sentinelEphemeralVapid = generateVAPIDKeys();
    }
    return {
      publicKey: globalForVapid.__sentinelEphemeralVapid.publicKey,
      privateKey: globalForVapid.__sentinelEphemeralVapid.privateKey,
      subject,
      source: 'ephemeral_local',
    };
  }

  return { publicKey, privateKey, subject, source: 'unconfigured' };
}

/**
 * Parses `NTFY_TOPIC_URL` (full URL such as `https://ntfy.sh/<topic>` or topic
 * slug) with fallback to `NTFY_TOPIC` + `NTFY_URL`.
 */
export function resolveNtfyConfig(env: NodeJS.ProcessEnv = process.env): NtfyConfig {
  const fallbackBase = (env.NTFY_URL?.trim() || 'https://ntfy.sh').replace(/\/$/, '');
  const rawTopicUrl = env.NTFY_TOPIC_URL?.trim();

  if (rawTopicUrl) {
    if (/^https?:\/\//i.test(rawTopicUrl)) {
      try {
        const parsed = new URL(rawTopicUrl);
        const segments = parsed.pathname.split('/').filter(Boolean);
        if (segments.length === 0) {
          return { baseUrl: parsed.origin, topic: null };
        }
        const topic = decodeURIComponent(segments[segments.length - 1]!);
        const prefix = segments.slice(0, -1).join('/');
        const baseUrl = prefix ? `${parsed.origin}/${prefix}` : parsed.origin;
        return { baseUrl, topic };
      } catch {
        return { baseUrl: fallbackBase, topic: null };
      }
    }
    const cleanTopic = rawTopicUrl.replace(/^\/+/, '');
    return { baseUrl: fallbackBase, topic: cleanTopic || null };
  }

  const topic = env.NTFY_TOPIC?.trim() || null;
  return { baseUrl: fallbackBase, topic };
}

/**
 * Resolves outbound alert sender identity, supporting both `ALERT_FROM_EMAIL`
 * and `EMAIL_FROM`.
 */
export function resolveEmailFrom(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.ALERT_FROM_EMAIL?.trim() ||
    env.EMAIL_FROM?.trim() ||
    'SENTINEL Alerts <alerts@sentinel.local>'
  );
}

/**
 * Checks whether optional paid SMS delivery has been explicitly enabled.
 */
export function isSmsAdapterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_SMS_ADAPTER === 'true' || env.ENABLE_SMS_GATEWAY === 'true';
}

/**
 * Resolves the shared secret authenticating Cloudflare `workers/inbox` reply
 * webhooks.
 */
export function resolveInboxWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  return (
    env.INBOX_WEBHOOK_SECRET?.trim() ||
    env.CLOUDFLARE_INBOX_WEBHOOK_SECRET?.trim() ||
    env.BETTER_AUTH_SECRET?.trim() ||
    null
  );
}

export interface ChannelEnvReadiness {
  inApp: { configured: true };
  webPush: { configured: boolean; publicKey: string | null; source: VapidConfig['source'] };
  ntfy: { configured: boolean; topicUrl: string | null };
  email: { configured: boolean; from: string };
  telegram: { configured: boolean };
  sms: { configured: boolean };
}

/**
 * Returns honest live readiness for every outbound alert channel based on server env vars.
 */
export function resolveChannelEnvReadiness(
  env: NodeJS.ProcessEnv = process.env,
): ChannelEnvReadiness {
  const vapid = resolveVapidConfig(env);
  const ntfy = resolveNtfyConfig(env);
  const topicUrl = ntfy.topic ? `${ntfy.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(ntfy.topic)}` : null;

  return {
    inApp: { configured: true },
    webPush: {
      configured: Boolean(vapid.publicKey && vapid.privateKey),
      publicKey: vapid.publicKey,
      source: vapid.source,
    },
    ntfy: {
      configured: Boolean(topicUrl),
      topicUrl,
    },
    email: {
      configured: Boolean(env.RESEND_API_KEY?.trim()),
      from: resolveEmailFrom(env),
    },
    telegram: {
      configured: Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_DEFAULT_CHAT_ID?.trim()),
    },
    sms: {
      configured: isSmsAdapterEnabled(env),
    },
  };
}
