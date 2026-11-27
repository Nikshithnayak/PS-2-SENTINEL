import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { buildRealisticVitalsCsv, signUpViaUi } from './helpers/real-auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(__dirname, '../../../../docs/evidence/phase-4');
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.describe('Phase 4 Alerting, Escalation Ladder & Transactional Outbox E2E', () => {
  test('triggers multi-channel alert via SSE, shows 112/108 + hospitals, escalates and acknowledges', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const suffix = `${Date.now()}-p4`;
    const password = 'SentinelReal#2026!';
    const caregiverEmail = `caregiver-${suffix}@example.com`;
    const patientEmail = `patient-${suffix}@example.com`;

    await page.setViewportSize({ width: 1440, height: 900 });
    await signUpViaUi(page, {
      name: 'Priya Menon',
      email: caregiverEmail,
      password,
      role: 'caregiver',
      expectedUrlPart: '/caregiver',
    });

    await signUpViaUi(page, {
      name: 'Raghav Menon',
      email: patientEmail,
      password,
      role: 'patient',
      expectedUrlPart: '/today',
    });

    // Link primary caregiver via Care Circle so email + step 1 escalation target exists
    await page.goto('/settings/consent');
    await page.getByLabel('Caregiver or clinician email').fill(caregiverEmail);
    await page.getByLabel('Relationship').selectOption('primary_caregiver');
    await page.getByRole('button', { name: 'Invite' }).click();
    await expect(page.getByText('Priya Menon').first()).toBeVisible();

    // Import urgent respiratory telemetry CSV (real non-synthetic readings)
    await page.goto('/ingest');
    await page.locator('#csv-takeout-text').fill(buildRealisticVitalsCsv('respiratory'));
    await page.getByRole('button', { name: 'Import Mapped Records' }).click();
    await expect(page.getByText(/Imported .* samples via csv/i)).toBeVisible();

    // Open Alerts Operations & verify zero demo Email Simulator card
    await page.goto('/alerts');
    await expect(page.getByRole('button', { name: /Simulate Email Reply/i })).toHaveCount(0);
    await expect(page.getByTestId('sse-status')).toContainText('Live SSE', { timeout: 10_000 });
    await expect(page.getByText('Emergency: 112')).toBeVisible();
    await expect(page.getByText('Ambulance: 108')).toBeVisible();
    await expect(page.getByText(/Hospital/i).first()).toBeVisible();

    // Evaluate & Dispatch Alert
    await page.getByRole('button', { name: 'Evaluate & Dispatch Alerts' }).click();
    await expect(page.getByText(/Evaluated \(Index/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Step 1 · Primary Caregiver/).first()).toBeVisible();
    await expect(page.getByText('Transactional Outbox Delivery Receipts')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'email' }).first()).toBeVisible();

    // Escalate step 1 -> step 2
    await page.getByRole('button', { name: /Escalate Step/i }).first().click();
    await expect(page.getByText(/Step 2 · Secondary Caregiver/).first()).toBeVisible();

    // Acknowledge with feedback
    await page.getByRole('button', { name: /Acknowledge/i }).first().click();
    await expect(page.getByText('Alert updated to status: acknowledged.')).toBeVisible();

    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(
      axeResults.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
    ).toEqual([]);

    await page.screenshot({
      path: resolve(EVIDENCE_DIR, 'alerts-escalation-desktop.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({
      path: resolve(EVIDENCE_DIR, 'alerts-escalation-mobile.png'),
      fullPage: true,
    });

    expect(errors).toEqual([]);
  });
});
