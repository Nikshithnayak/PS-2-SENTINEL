import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { computeAuditHash, encryptPhi, decryptPhi, verifyAuditChain } from '@sentinel/shared';
import { proxy } from '@/proxy';

describe('Phase 9 OWASP ASVS Level 2 & DPDP Security Controls', () => {
  it('enforces CSP, X-Frame-Options, nosniff, and no-store on /api/* routes', () => {
    const pageReq = new NextRequest('http://127.0.0.1:3100/today');
    const pageRes = proxy(pageReq);
    expect(pageRes.headers.get('X-Frame-Options')).toBe('DENY');
    expect(pageRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(pageRes.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(pageRes.headers.get('Cache-Control')).toBeNull();

    const apiReq = new NextRequest('http://127.0.0.1:3100/api/v1/alerts');
    const apiRes = proxy(apiReq);
    expect(apiRes.headers.get('Cache-Control')).toBe('no-store');
  });

  it('encrypts PHI at rest with authenticated AEAD and rejects tampered audit ledger links', () => {
    const keyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const cipher = encryptPhi('Ramesh Pai · +91-98450-12345', keyHex);
    expect(cipher).not.toContain('Ramesh');
    expect(decryptPhi(cipher, keyHex)).toBe('Ramesh Pai · +91-98450-12345');

    const p1 = JSON.stringify({ scope: 'vitals_read' });
    const p2 = JSON.stringify({ level: 'warning' });
    const genesisPrev = '0'.repeat(64);

    const h1 = computeAuditHash({
      prevHash: genesisPrev,
      seq: 1,
      actorUserId: 'usr-1',
      action: 'consent.granted',
      targetType: 'consent_grant',
      targetId: 'g-1',
      payloadJson: p1,
      createdAtIso: '2026-11-25T10:00:00.000Z',
    });
    const h2 = computeAuditHash({
      prevHash: h1,
      seq: 2,
      actorUserId: 'usr-1',
      action: 'alert.created',
      targetType: 'alert',
      targetId: 'a-1',
      payloadJson: p2,
      createdAtIso: '2026-11-25T10:05:00.000Z',
    });

    const entries = [
      {
        seq: 1,
        prevHash: genesisPrev,
        entryHash: h1,
        actorUserId: 'usr-1',
        action: 'consent.granted',
        targetType: 'consent_grant',
        targetId: 'g-1',
        payloadJson: p1,
        createdAtIso: '2026-11-25T10:00:00.000Z',
      },
      {
        seq: 2,
        prevHash: h1,
        entryHash: h2,
        actorUserId: 'usr-1',
        action: 'alert.created',
        targetType: 'alert',
        targetId: 'a-1',
        payloadJson: p2,
        createdAtIso: '2026-11-25T10:05:00.000Z',
      },
    ];
    expect(verifyAuditChain(entries).valid).toBe(true);

    // Mutate entry 1 payloadJson and confirm chain verification catches tamper immediately
    entries[0]!.payloadJson = JSON.stringify({ scope: 'forged' });
    expect(verifyAuditChain(entries).valid).toBe(false);
  });
});
