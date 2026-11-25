import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(__dirname, '../../../../docs/evidence/phase-8');
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.describe('Phase 8 Evaluation Lab, Model Card & Clinical Exports E2E', () => {
  test('runs live causal ablation benchmark on /eval, inspects /model-card, /clinician/report, FHIR & cohort APIs', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/auth');
    await page.getByRole('button', { name: /Dr. Arvind Shetty/i }).click();
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL('**/settings/consent');

    // 1. /eval Live Benchmark against Python FastAPI engine
    await page.goto('/eval');
    await expect(page.getByText(/Public Wearable Dataset Format Adapters/i)).toBeVisible();
    await page.getByRole('button', { name: /Run Live Ablation Benchmark/i }).click();
    await expect(page.getByText('Ablation Comparison (Measured Live)')).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByRole('cell', { name: 'L1_L2_L3_full' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'copd_exacerbation' })).toBeVisible();

    let axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual(
      [],
    );
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'eval-lab-desktop.png'), fullPage: true });

    // 2. /model-card
    await page.goto('/model-card');
    await expect(page.getByText(/Optical PPG Skin-Tone & Perfusion Bias/i)).toBeVisible();
    axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual(
      [],
    );
    await page.screenshot({
      path: resolve(EVIDENCE_DIR, 'model-card-desktop.png'),
      fullPage: true,
    });

    // 3. /clinician/report printable view & FHIR/cohort downloads
    await page.goto('/clinician/report');
    await expect(page.getByText(/Sachet · SENTINEL Longitudinal Telemetry Summary/i)).toBeVisible();
    await page.screenshot({
      path: resolve(EVIDENCE_DIR, 'clinician-report-desktop.png'),
      fullPage: true,
    });

    const fhirResp = await page.request.get('/api/v1/export/fhir');
    expect(fhirResp.status()).toBe(200);
    const fhirJson = await fhirResp.json();
    expect(fhirJson.resourceType).toBe('Bundle');

    const cohortResp = await page.request.get('/api/v1/export/cohort-deidentified');
    expect(cohortResp.status()).toBe(200);
    const cohortJson = await cohortResp.json();
    expect(cohortJson.piiFieldsIncluded).toEqual([]);
    expect(Array.isArray(cohortJson.records)).toBe(true);

    expect(errors).toEqual([]);
  });
});
