import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';

function parseKey(hexKey: string): Buffer {
  const clean = hexKey.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error('PHI_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(clean, 'hex');
}

/**
 * Encrypts sensitive patient identifiers (name, phone, address) using AEAD AES-256-GCM.
 */
export function encryptPhi(plaintext: string, hexKey: string): string {
  const key = parseKey(hexKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptPhi(payload: string, hexKey: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted PHI envelope');
  }
  const [ivB64, tagB64, dataB64] = parts;
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted PHI envelope');
  }
  const key = parseKey(hexKey);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function generateApiKey(): { rawKey: string; prefix: string; hash: string } {
  const secret = randomBytes(24).toString('base64url');
  const rawKey = `snt_live_${secret}`;
  const prefix = rawKey.slice(0, 16);
  const hash = hashApiKey(rawKey);
  return { rawKey, prefix, hash };
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function computeSampleHash(
  patientId: string,
  metricType: string,
  recordedAtIso: string,
  source: string,
  value: number,
): string {
  return createHash('sha256')
    .update(`${patientId}|${metricType}|${recordedAtIso}|${source}|${value}`)
    .digest('hex')
    .slice(0, 32);
}

export interface AuditChainInput {
  seq: number;
  prevHash: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  payloadJson: string;
  createdAtIso: string;
}

export function computeAuditHash(input: AuditChainInput): string {
  const canonical = [
    String(input.seq),
    input.prevHash,
    input.actorUserId ?? 'system',
    input.action,
    input.targetType,
    input.targetId,
    input.payloadJson,
    input.createdAtIso,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

export function verifyAuditChain(
  entries: Array<AuditChainInput & { entryHash: string }>,
): { valid: boolean; brokenAtSeq?: number } {
  let expectedPrev = '0'.repeat(64);
  for (const entry of entries) {
    if (entry.prevHash !== expectedPrev) {
      return { valid: false, brokenAtSeq: entry.seq };
    }
    const recomputed = computeAuditHash({
      seq: entry.seq,
      prevHash: entry.prevHash,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      payloadJson: entry.payloadJson,
      createdAtIso: entry.createdAtIso,
    });
    if (recomputed !== entry.entryHash) {
      return { valid: false, brokenAtSeq: entry.seq };
    }
    expectedPrev = entry.entryHash;
  }
  return { valid: true };
}

export function signWebhookToken(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}
