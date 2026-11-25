import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(__dirname, '../../../../docs/evidence/phase-7');
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.describe('Phase 7 Voice Check-In, Inbox Reply Webhook & Medications E2E', () => {
  test('processes voice red-flag check-in on /today, logs medication dose, and executes Email Reply CALL ME / OK webhook on /alerts', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL('**/settings/consent');
    await page.request.delete('/api/v1/alerts');

    // Add a heart-rate medication via /api/v1/medications so /today renders adherence controls
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

    // 2. /alerts Cloudflare Agentic Inbox Email Reply Simulator -> send "OK" to acknowledge the voice alert
    await page.goto('/alerts');
    await expect(page.getByRole('button', { name: /Simulate Email Reply: OK/i })).toBeVisible();
    await page.getByRole('button', { name: /Simulate Email Reply: OK/i }).click();
    await expect(page.getByRole('status').first()).toContainText(/acknowledged/i);

    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'alerts-inbox-reply-desktop.png'), fullPage: true });
    expect(errors).toEqual([]);
  });
});
