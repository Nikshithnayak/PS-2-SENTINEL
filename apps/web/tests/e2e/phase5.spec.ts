import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  buildRealisticVitalsCsv,
  setupPatientCaregiverClinician,
  signUpViaUi,
} from './helpers/real-auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(__dirname, '../../../../docs/evidence/phase-5');
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.describe('Phase 5 Multi-Role Dashboards Closed Loop E2E', () => {
  test('patient Today Elder Mode -> caregiver live SSE & ack -> clinician ECharts & NEWS2 -> signals & settings', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const suffix = `${Date.now()}-p5`;
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Patient signs up, invites caregiver + clinician, imports real telemetry & evaluates
    const creds = await setupPatientCaregiverClinician(page, suffix);

    await page.goto('/ingest');
    await page.locator('#csv-takeout-text').fill(buildRealisticVitalsCsv('respiratory'));
    await page.getByRole('button', { name: 'Import Mapped Records' }).click();
    await expect(page.getByText(/Imported .* samples via csv/i)).toBeVisible();
    await page.getByRole('button', { name: 'Run Detection Engine' }).click();
    await expect(page.getByTestId('deterioration-index-value')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('engine-source-tag')).toContainText('python-engine');

    // 2. Patient /today Elder Mode: verify Why? drawer + Quick Check-In + axe
    await page.goto('/today');
    await expect(page.getByRole('heading', { name: /Patient Today/i })).toBeVisible();
    await page.getByRole('button', { name: /Why am I seeing this/i }).click();
    await expect(page.getByTestId('why-drawer')).toBeVisible();
    await page.getByRole('button', { name: 'I Feel Okay', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('I feel okay today');

    let axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'today-elder-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'today-elder-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });

    // 3. Signals Explorer + Quarantine window
    await page.goto('/signals');
    await expect(page.getByTestId('echarts-vitals-canvas')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Quarantine Last 24h' }).click();
    await expect(page.getByRole('status')).toContainText('Quarantine window saved');

    // 4. Settings: update & save profile + check DPDP download link
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.getByRole('status')).toContainText('Care preferences & alert thresholds saved');
    await expect(page.getByRole('link', { name: /Download Full DPDP JSON/i })).toBeVisible();

    // 5. Register Caregiver (auto-linked to pending invite) -> verify live SSE & Acknowledge
    await signUpViaUi(page, {
      name: 'Deepa Rao',
      email: creds.caregiverEmail,
      password: creds.password,
      role: 'caregiver',
      expectedUrlPart: '/caregiver',
    });

    await expect(page.getByTestId('caregiver-sse-pill')).toContainText('Live SSE', { timeout: 10_000 });
    await expect(page.getByTestId('caregiver-index')).toBeVisible();
    const ackBtn = page.getByRole('button', { name: 'Acknowledge' }).first();
    if (await ackBtn.isVisible()) {
      await ackBtn.click();
      await expect(page.getByRole('status')).toContainText('acknowledged');
    }
    axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'caregiver-desktop.png'), fullPage: true });

    // 6. Register Clinician (auto-linked) -> verify Cohort table + ECharts + Partial NEWS2
    await signUpViaUi(page, {
      name: 'Dr. Anand Kulkarni',
      email: creds.clinicianEmail,
      password: creds.password,
      role: 'clinician',
      expectedUrlPart: '/clinician',
    });

    await expect(page.getByText(/Consented Patient Cohort/i)).toBeVisible();
    await expect(page.getByText(/Asha Menon/i).first()).toBeVisible();
    await page.getByRole('button', { name: /Asha Menon/i }).first().click();
    await expect(page.getByTestId('echarts-vitals-canvas')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Partial NEWS2 Assessment/i)).toBeVisible();
    await expect(page.getByRole('cell', { name: 'respiratory_rate' })).toBeVisible({ timeout: 10_000 });

    axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'clinician-desktop.png'), fullPage: true });

    expect(errors).toEqual([]);
  });
});
