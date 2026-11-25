import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

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

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL('**/settings/consent');

    // Reset synthetic alert sandbox so cooldowns from prior test runs never pollute this flow
    await page.request.delete('/api/v1/alerts');

    // Ensure patient has urgent scenario samples loaded (urgent bypasses quiet hours 24/7)
    await page.goto('/ingest');
    await page.getByLabel('Scenario').selectOption('copd_exacerbation');
    await page.getByRole('button', { name: 'Generate Synthetic Series' }).click();
    await expect(page.getByRole('status')).toContainText('SYNTHETIC scenario "copd_exacerbation"');

    // Open Alerts Operations & wait for SSE connected
    await page.goto('/alerts');
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
