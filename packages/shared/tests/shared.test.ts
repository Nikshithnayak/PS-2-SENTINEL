import { describe, expect, it } from 'vitest';
import {
  computeAuditHash,
  decryptPhi,
  encryptPhi,
  generateApiKey,
  hashApiKey,
  isWithinPhysicalBounds,
  normalizeToCanonicalUnit,
  verifyAuditChain,
} from '../src/index.ts';

describe('@sentinel/shared units & physical bounds', () => {
  it('converts HealthKit 0..1 fraction spo2 to 0..100 percent', () => {
    const res = normalizeToCanonicalUnit('spo2', 0.94, '%');
    expect(res.value).toBe(94);
    expect(res.unit).toBe('%');
    expect(res.converted).toBe(true);
  });

  it('keeps standard 0..100 spo2 intact', () => {
    const res = normalizeToCanonicalUnit('spo2', 96, '%');
    expect(res.value).toBe(96);
    expect(res.converted).toBe(false);
  });

  it('converts degF body temperature and skin temp deviation', () => {
    const body = normalizeToCanonicalUnit('body_temperature', 98.6, 'degF');
    expect(body.value).toBeCloseTo(37.0, 2);
    const delta = normalizeToCanonicalUnit('skin_temp_deviation', 1.8, 'degF');
    expect(delta.value).toBeCloseTo(1.0, 2);
  });

  it('enforces physiological hard bounds', () => {
    expect(isWithinPhysicalBounds('heart_rate', 72)).toBe(true);
    expect(isWithinPhysicalBounds('heart_rate', 310)).toBe(false);
    expect(isWithinPhysicalBounds('spo2', 105)).toBe(false);
    expect(isWithinPhysicalBounds('spo2', Number.NaN)).toBe(false);
  });
});

describe('@sentinel/shared crypto & hash-chained audit log', () => {
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('encrypts and decrypts PHI identifiers with AES-256-GCM', () => {
    const cipher = encryptPhi('Ramesh Pai (+91 98450 12345)', testKey);
    expect(cipher).not.toContain('Ramesh');
    expect(decryptPhi(cipher, testKey)).toBe('Ramesh Pai (+91 98450 12345)');
  });

  it('rejects tampered PHI ciphertext', () => {
    const cipher = encryptPhi('Sensitive patient record', testKey);
    const parts = cipher.split('.');
    parts[2] = `${parts[2]}tamper`;
    expect(() => decryptPhi(parts.join('.'), testKey)).toThrow();
  });

  it('generates verifiable API key hashes', () => {
    const { rawKey, prefix, hash } = generateApiKey();
    expect(rawKey.startsWith('snt_live_')).toBe(true);
    expect(prefix).toBe(rawKey.slice(0, 16));
    expect(hashApiKey(rawKey)).toBe(hash);
  });

  it('verifies valid audit chains and catches tampering', () => {
    const zero = '0'.repeat(64);
    const e1Base = {
      seq: 1,
      prevHash: zero,
      actorUserId: 'user-1',
      action: 'consent.grant',
      targetType: 'consent_grant',
      targetId: 'grant-1',
      payloadJson: '{"scopes":["vitals_read"]}',
      createdAtIso: '2026-11-25T10:00:00.000Z',
    };
    const h1 = computeAuditHash(e1Base);
    const e2Base = {
      seq: 2,
      prevHash: h1,
      actorUserId: 'user-1',
      action: 'consent.withdraw',
      targetType: 'consent_grant',
      targetId: 'grant-1',
      payloadJson: '{"reason":"done"}',
      createdAtIso: '2026-11-25T11:00:00.000Z',
    };
    const h2 = computeAuditHash(e2Base);

    expect(verifyAuditChain([{ ...e1Base, entryHash: h1 }, { ...e2Base, entryHash: h2 }])).toEqual({
      valid: true,
    });

    // Tamper entry 1 payload
    expect(
      verifyAuditChain([
        { ...e1Base, payloadJson: '{"scopes":["all"]}', entryHash: h1 },
        { ...e2Base, entryHash: h2 },
      ]),
    ).toEqual({ valid: false, brokenAtSeq: 1 });
  });
});
