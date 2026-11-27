import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signUpViaUi } from './helpers/real-auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(__dirname, '../../../../docs/evidence/phase-2');
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.describe('Phase 2 Data Ingestion & Smartwatch Sync E2E', () => {
  test('connects watch webhook, generates API key, imports Apple Health XML & CSV without synthetic simulator', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const suffix = `${Date.now()}-p2`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await signUpViaUi(page, {
      name: 'Neha Rao',
      email: `patient-${suffix}@example.com`,
      password: 'SentinelReal#2026!',
      role: 'patient',
      expectedUrlPart: '/today',
    });

    await page.goto('/ingest');
    await expect(page.getByText('Wearable Data Ingestion & Quality Pipeline')).toBeVisible();
    await expect(page.getByText('Synthetic Physiological Scenario Mode')).toHaveCount(0);

    // Verify Universal Watch Sync Hub & generate device API key
    await expect(
      page.getByText('Connect Any Smartwatch Directly or via Companion Webhook'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Apple Watch (iOS)' }).click();
    await expect(page.getByText(/Health Auto Export/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Watch JSON / curl' }).click();

    await page.getByLabel('Device key name').fill('Galaxy Watch 7');
    await page.getByRole('button', { name: 'Generate Key' }).click();
    const keyNotice = page.getByText(/Copy now \(shown once\):/);
    await expect(keyNotice).toBeVisible();
    const keyNoticeText = (await keyNotice.innerText()).trim();
    const apiKeyMatch = keyNoticeText.match(/snt_live_[A-Za-z0-9_-]+/);
    expect(apiKeyMatch?.[0]).toBeTruthy();

    // Sync real smartwatch JSON payload via universal watch webhook using issued x-api-key
    const watchWebhookRes = await page.request.post('/api/v1/ingest/watch', {
      headers: { 'x-api-key': apiKeyMatch![0]! },
      data: {
        deviceModel: 'Samsung Galaxy Watch 7',
        heartRate: 74,
        spo2: 98,
        steps: 5120,
        evaluate: false,
      },
    });
    expect(watchWebhookRes.status()).toBe(201);
    const watchWebhookJson = (await watchWebhookRes.json()) as {
      recordsAccepted: number;
      isSynthetic: boolean;
    };
    expect(watchWebhookJson.recordsAccepted).toBe(3);
    expect(watchWebhookJson.isSynthetic).toBe(false);

    // Clicking unconfigured cloud adapter explains setup clearly with zero console errors
    await page.getByRole('button', { name: 'Sync Open Wearables' }).click();
    await expect(
      page.getByText(/Push live watch readings with Bluetooth or the Webhook tab/i),
    ).toBeVisible();

    // Upload real Apple Health XML fixture
    const fixturePath = resolve(EVIDENCE_DIR, 'sample-export.xml');
    writeFileSync(
      fixturePath,
      `<HealthData>
        <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Apple Watch Series 10" unit="bpm" startDate="2026-11-25 06:15:00 +0530" endDate="2026-11-25 06:16:00 +0530" value="67"/>
        <Record type="HKQuantityTypeIdentifierOxygenSaturation" sourceName="Apple Watch Series 10" unit="%" startDate="2026-11-25 06:20:00 +0530" endDate="2026-11-25 06:21:00 +0530" value="0.97"/>
        <Record type="HKQuantityTypeIdentifierRespiratoryRate" sourceName="Apple Watch Series 10" unit="count/min" startDate="2026-11-25 06:25:00 +0530" endDate="2026-11-25 06:26:00 +0530" value="15"/>
      </HealthData>`,
      'utf8',
    );
    await page.locator('#apple-xml-input').setInputFiles(fixturePath);
    await expect(page.getByText(/Apple Health XML imported: 3 samples persisted/i)).toBeVisible();
    await expect(page.getByText('apple_health_xml').first()).toBeVisible();
    await expect(page.getByText('Real Import').first()).toBeVisible();

    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'ingest-desktop.png'), fullPage: true });

    const axeRes = await new AxeBuilder({ page }).analyze();
    const serious = axeRes.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious).toEqual([]);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'ingest-mobile.png'), fullPage: true });

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
