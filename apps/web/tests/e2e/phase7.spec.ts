import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signUpViaUi } from './helpers/real-auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(__dirname, '../../../../docs/evidence/phase-7');
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.describe('Phase 7 Voice Check-In, Inbox Reply Webhook & Medications E2E', () => {
  test('processes voice red-flag check-in on /today, logs medication dose, and handles Cloudflare Email Reply webhook on /alerts', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const suffix = `${Date.now()}-p7`;
    const password = 'SentinelReal#2026!';
    const caregiverEmail = `caregiver-${suffix}@example.com`;
    const patientEmail = `patient-${suffix}@example.com`;

    await page.setViewportSize({ width: 1440, height: 900 });
    await signUpViaUi(page, {
      name: 'Meera Hegde',
      email: caregiverEmail,
      password,
      role: 'caregiver',
      expectedUrlPart: '/caregiver',
    });

    await signUpViaUi(page, {
      name: 'Mohan Hegde',
      email: patientEmail,
      password,
      role: 'patient',
      expectedUrlPart: '/today',
    });

    // Invite caregiver so email reply webhook resolves authentic care-circle member
    await page.goto('/settings/consent');
    await page.getByLabel('Caregiver or clinician email').fill(caregiverEmail);
    await page.getByLabel('Relationship').selectOption('primary_caregiver');
    await page.getByRole('button', { name: 'Invite' }).click();
    await expect(page.getByText('Meera Hegde').first()).toBeVisible();

    const medRes = await page.request.post('/api/v1/medications', {
      data: {
        action: 'add_medication',
        name: 'Metoprolol Succinate',
        dosage: '25 mg',
        scheduleTimes: ['08:00'],
      },
    });
    expect(medRes.status()).toBe(201);

    // 1. /today Elder Voice Companion red-flag escalation + Medication Taken tap
    await page.goto('/today');
    await page.getByRole('button', { name: /Short of breath and chest tightness/i }).click();
    await expect(page.getByTestId('voice-companion-reply')).toContainText('112');

    await page.getByRole('button', { name: /Mark Taken/i }).first().click();
    await expect(page.getByRole('status').last()).toContainText(/Dose|care circle|feeling/i);

    const axe1 = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
    expect(axe1.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'today-voice-meds-desktop.png'), fullPage: true });

    // 2. Verify /alerts has no UI email simulator and handles genuine inbound worker webhook POST
    await page.goto('/alerts');
    await expect(page.getByRole('button', { name: /Simulate Email Reply/i })).toHaveCount(0);
    await expect(page.getByText(/urgent/i).first()).toBeVisible();

    const webhookRes = await page.request.post('/api/v1/webhooks/inbox-reply', {
      data: {
        fromEmail: caregiverEmail,
        bodyText: 'OK',
      },
    });
    expect(webhookRes.status()).toBe(200);
    const webhookJson = (await webhookRes.json()) as { status: string; parsedCommand: string };
    expect(webhookJson.parsedCommand).toBe('acknowledge');
    expect(webhookJson.status).toBe('acknowledged');

    await page.reload();
    await expect(page.getByText('acknowledged').first()).toBeVisible();
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'alerts-inbox-reply-desktop.png'), fullPage: true });
    expect(errors).toEqual([]);
  });
});
