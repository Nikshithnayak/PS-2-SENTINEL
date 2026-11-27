import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signUpViaUi } from './helpers/real-auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(__dirname, '../../../../docs/evidence/phase-1');
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.describe('Phase 1 Foundations E2E & Accessibility', () => {
  test('verifies demo-free home & auth, registers real accounts, and manages consent + audit ledger', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const suffix = `${Date.now()}-p1`;
    const password = 'SentinelReal#2026!';
    const caregiverEmail = `caregiver-${suffix}@example.com`;
    const patientEmail = `patient-${suffix}@example.com`;

    // Desktop Home (must contain zero fake sample previews or demo instructions)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByText('Sachet · SENTINEL')).toBeVisible();
    await expect(page.getByText('Connected')).toBeVisible();
    await expect(page.getByText('SYNTHETIC PREVIEW')).toHaveCount(0);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'home-desktop-light.png'), fullPage: true });

    const homeAxe = await new AxeBuilder({ page }).analyze();
    const seriousHome = homeAxe.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(seriousHome).toEqual([]);

    // Light healthcare theme only (no dark mode toggle)
    await page.goto('/design');
    await expect(page.getByRole('button', { name: /Switch to dark theme/i })).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'design-dark.png'), fullPage: true });

    // Auth page must be 100% clean (no Quick Open, no Seeded Local Demo Accounts, empty fields)
    await page.goto('/auth');
    const providersRes = await page.request.get('/api/v1/auth/providers');
    expect(providersRes.status()).toBe(200);
    const providersJson = (await providersRes.json()) as { google: { enabled: boolean } };
    await expect(page.getByText(/Seeded Local Demo Accounts/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Quick Open/i })).toHaveCount(0);
    await expect(page.getByLabel('Email Address')).toHaveValue('');

    const googleBtn = page.getByTestId('google-signin-button');
    await expect(googleBtn).toBeVisible();
    if (providersJson.google.enabled) {
      const oauthRes = await page.request.post('/api/auth/sign-in/social', {
        data: { provider: 'google', callbackURL: '/today', disableRedirect: true },
      });
      expect(oauthRes.status()).toBe(200);
      const oauthJson = (await oauthRes.json()) as { url?: string };
      expect(oauthJson.url).toContain('accounts.google.com/o/oauth2/v2/auth');
    } else {
      await googleBtn.click();
      await expect(page.getByTestId('google-setup-notice')).toContainText('GOOGLE_CLIENT_ID');
    }

    const authAxe = await new AxeBuilder({ page }).analyze();
    expect(authAxe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

    // Register real caregiver first, then patient -> patient invites caregiver -> instant ConsentGrant
    await signUpViaUi(page, {
      name: 'Maya Nair',
      email: caregiverEmail,
      password,
      role: 'caregiver',
      expectedUrlPart: '/caregiver',
    });

    await signUpViaUi(page, {
      name: 'Vikram Menon',
      email: patientEmail,
      password,
      role: 'patient',
      expectedUrlPart: '/today',
    });

    await page.goto('/settings/consent');
    await expect(page.getByText('DPDP Act 2023 Granular Consent Ledger')).toBeVisible();
    await page.getByLabel('Caregiver or clinician email').fill(caregiverEmail);
    await page.getByLabel('Relationship').selectOption('primary_caregiver');
    await page.getByRole('button', { name: 'Invite' }).click();
    await expect(page.getByText('Maya Nair').first()).toBeVisible();
    await expect(page.getByText('Chain Verified')).toBeVisible();

    // Exercise live consent withdrawal -> audit chain entry -> re-grant
    const withdrawButtons = page.getByRole('button', { name: 'Withdraw Consent' });
    await expect(withdrawButtons.first()).toBeVisible();
    await withdrawButtons.first().click();
    await expect(page.getByText(/Consent withdrawn immediately/i)).toBeVisible();
    await expect(page.getByText('Chain Verified')).toBeVisible();
    await page.getByRole('button', { name: 'Re-grant Consent' }).first().click();
    await expect(page.getByText(/Consent restored/i)).toBeVisible();
    await expect(page.getByText('Chain Verified')).toBeVisible();

    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'consent-ledger-desktop.png'), fullPage: true });

    const consentAxe = await new AxeBuilder({ page }).analyze();
    const seriousConsent = consentAxe.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(seriousConsent).toEqual([]);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings/consent');
    await expect(page.getByText('Chain Verified')).toBeVisible();
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'consent-ledger-mobile.png'), fullPage: true });

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
