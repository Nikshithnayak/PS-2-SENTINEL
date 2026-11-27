import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { buildRealisticVitalsCsv, signUpViaUi } from './helpers/real-auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(__dirname, '../../../../docs/evidence/phase-3');
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.describe('Phase 3 Personal Baseline & 3-Layer Detection Engine E2E', () => {
  test('imports multi-day telemetry and scores it via live Python FastAPI engine', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const suffix = `${Date.now()}-p3`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await signUpViaUi(page, {
      name: 'Suresh Kamath',
      email: `patient-${suffix}@example.com`,
      password: 'SentinelReal#2026!',
      role: 'patient',
      expectedUrlPart: '/today',
    });

    await page.goto('/ingest');
    await expect(page.getByRole('heading', { name: /Wearable Data Ingestion/i })).toBeVisible();

    await page.locator('#csv-takeout-text').fill(buildRealisticVitalsCsv('febrile'));
    await page.getByRole('button', { name: 'Import Mapped Records' }).click();
    await expect(page.getByRole('status').last()).toContainText(/Imported .* samples via csv/i);

    // Trigger Detection Engine pass (backed by real Python uvicorn service on port 8000)
    await page.getByRole('button', { name: 'Run Detection Engine' }).click();
    const scoreBadge = page.getByTestId('deterioration-index-value');
    await expect(scoreBadge).toBeVisible({ timeout: 20_000 });
    const scoreText = await scoreBadge.innerText();
    expect(Number(scoreText)).toBeGreaterThanOrEqual(45);

    await expect(page.getByTestId('engine-source-tag')).toContainText('python-engine');
    await expect(page.getByText(/Partial NEWS2/i)).toBeVisible();

    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(
      axeResults.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
    ).toEqual([]);

    await page.screenshot({
      path: resolve(EVIDENCE_DIR, 'engine-preview-desktop.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({
      path: resolve(EVIDENCE_DIR, 'engine-preview-mobile.png'),
      fullPage: true,
    });

    expect(errors).toEqual([]);
  });
});
