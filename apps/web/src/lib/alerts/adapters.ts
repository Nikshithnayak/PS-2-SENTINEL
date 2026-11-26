import type { ChannelType } from '@sentinel/shared';
import { sendNotification, setVapidDetails } from 'web-push';
import {
  isSmsAdapterEnabled,
  resolveEmailFrom,
  resolveNtfyConfig,
  resolveVapidConfig,
} from './env-config';

export interface DeliveryDispatchInput {
  channel: ChannelType;
  alertId: string;
  recipientEmail: string | null;
  recipientName: string;
  subject: string;
  bodyText: string;
  actionToken: string;
  pushSubscription?: {
    endpoint: string;
    p256dh: string;
    auth: string;
  } | null;
}

export interface DeliveryDispatchResult {
  status: 'delivered' | 'captured_local' | 'skipped_flag_disabled' | 'failed';
  receipt: string | null;
  error: string | null;
}

export async function dispatchChannelDelivery(
  input: DeliveryDispatchInput,
): Promise<DeliveryDispatchResult> {
  switch (input.channel) {
    case 'in_app': {
      return {
        status: 'delivered',
        receipt: `sse://alert/${input.alertId}`,
        error: null,
      };
    }

    case 'web_push': {
      const vapid = resolveVapidConfig();
      const pub = vapid.publicKey;
      const priv = vapid.privateKey;
      if (!pub || !priv || !input.pushSubscription) {
        return {
          status: 'captured_local',
          receipt: `local-outbox://web-push/${input.alertId}`,
          error: null,
        };
      }
      try {
        setVapidDetails(vapid.subject, pub, priv);
        await sendNotification(
          {
            endpoint: input.pushSubscription.endpoint,
            keys: {
              p256dh: input.pushSubscription.p256dh,
              auth: input.pushSubscription.auth,
            },
          },
          JSON.stringify({
            title: input.subject,
            body: input.bodyText,
            alertId: input.alertId,
          }),
        );
        return {
          status: 'delivered',
          receipt: `vapid://${input.alertId}`,
          error: null,
        };
      } catch (err) {
        return {
          status: 'failed',
          receipt: null,
          error: err instanceof Error ? err.message : 'VAPID push send failed',
        };
      }
    }

    case 'email': {
      const resendKey = process.env.RESEND_API_KEY;
      const toEmail = input.recipientEmail;
      if (!resendKey || !toEmail) {
        return {
          status: 'captured_local',
          receipt: `local-outbox://email/${input.alertId}?replyHint=OK|CALL+ME|SNOOZE&token=${input.actionToken}`,
          error: null,
        };
      }
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: resolveEmailFrom(),
            to: [toEmail],
            subject: input.subject,
            text: `${input.bodyText}\n\nReply OK, CALL ME, or SNOOZE (token: ${input.actionToken}).`,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) {
          return {
            status: 'failed',
            receipt: null,
            error: `Resend HTTP ${resp.status}`,
          };
        }
        const json = (await resp.json()) as { id?: string };
        return {
          status: 'delivered',
          receipt: `resend://${json.id ?? input.alertId}`,
          error: null,
        };
      } catch (err) {
        return {
          status: 'failed',
          receipt: null,
          error: err instanceof Error ? err.message : 'Email send error',
        };
      }
    }

    case 'telegram': {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_DEFAULT_CHAT_ID;
      if (!token || !chatId) {
        return {
          status: 'captured_local',
          receipt: `local-outbox://telegram/${input.alertId}`,
          error: null,
        };
      }
      try {
        const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `${input.subject}\n\n${input.bodyText}`,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) {
          return { status: 'failed', receipt: null, error: `Telegram HTTP ${resp.status}` };
        }
        return { status: 'delivered', receipt: `telegram://${chatId}`, error: null };
      } catch (err) {
        return {
          status: 'failed',
          receipt: null,
          error: err instanceof Error ? err.message : 'Telegram error',
        };
      }
    }

    case 'ntfy': {
      const { topic, baseUrl } = resolveNtfyConfig();
      if (!topic) {
        return {
          status: 'captured_local',
          receipt: `local-outbox://ntfy/${input.alertId}`,
          error: null,
        };
      }
      try {
        const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(topic)}`, {
          method: 'POST',
          headers: { Title: input.subject },
          body: input.bodyText,
          signal: AbortSignal.timeout(4000),
        });
        if (!resp.ok) {
          return { status: 'failed', receipt: null, error: `ntfy HTTP ${resp.status}` };
        }
        return { status: 'delivered', receipt: `ntfy://${topic}`, error: null };
      } catch (err) {
        return {
          status: 'failed',
          receipt: null,
          error: err instanceof Error ? err.message : 'ntfy error',
        };
      }
    }

    case 'sms_flag': {
      if (!isSmsAdapterEnabled()) {
        return {
          status: 'skipped_flag_disabled',
          receipt: null,
          error:
            'SMS gateway disabled (set ENABLE_SMS_ADAPTER=true + Twilio credentials per SETUP-NEEDED.md)',
        };
      }
      return {
        status: 'captured_local',
        receipt: `sms-flag-ready://${input.alertId}`,
        error: null,
      };
    }
  }
}
