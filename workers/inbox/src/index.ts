/**
 * Cloudflare Email Routing worker (adapted from cloudflare/agentic-inbox pattern).
 * Receives caregiver email replies (`OK`, `CALL ME`, `SNOOZE`) and posts signed commands
 * back into SENTINEL `/api/v1/webhooks/inbox-reply`.
 */

export interface InboxWorkerEnv {
  SENTINEL_API_URL: string;
  INBOX_WEBHOOK_SECRET: string;
}

export interface EmailMessageLike {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array> | string;
}

export function extractReplyBodyText(rawEmail: string): string {
  const splitIdx = rawEmail.search(/\r?\n\r?\n/);
  const body = splitIdx >= 0 ? rawEmail.slice(splitIdx).trim() : rawEmail.trim();
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('>'));
  return lines[0] ?? '';
}

export function parseReplyIntent(text: string): 'OK' | 'CALL ME' | 'SNOOZE' | null {
  const upper = text.trim().toUpperCase();
  if (/^(OK|ACK|ACKNOWLEDGE)\b/.test(upper)) return 'OK';
  if (/^(CALL\s*ME|ESCALATE|URGENT|HELP)\b/.test(upper)) return 'CALL ME';
  if (/^(SNOOZE|LATER)\b/.test(upper)) return 'SNOOZE';
  return null;
}

async function readStreamText(raw: ReadableStream<Uint8Array> | string): Promise<string> {
  if (typeof raw === 'string') return raw;
  const reader = raw.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

const worker = {
  async email(message: EmailMessageLike, env: InboxWorkerEnv): Promise<void> {
    const rawText = await readStreamText(message.raw);
    const bodyText = extractReplyBodyText(rawText);
    const intent = parseReplyIntent(bodyText);
    if (!intent) return;

    const matchAlert = rawText.match(/alert[:=\s]+([0-9a-f-]{36})/i);
    await fetch(`${env.SENTINEL_API_URL.replace(/\/$/, '')}/api/v1/webhooks/inbox-reply`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-inbox-secret': env.INBOX_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        alertId: matchAlert?.[1],
        fromEmail: message.from,
        bodyText: intent,
      }),
    });
  },
};

export default worker;
