import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(__dirname, '../../../../docs/evidence/phase-1');
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.describe('Phase 1 Foundations E2E & Accessibility', () => {
  test('renders home, design tokens, signs in, and verifies consent + audit ledger', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Desktop Home
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByText('Sachet · SENTINEL')).toBeVisible();
    await expect(page.getByText('Connected')).toBeVisible();
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'home-desktop-light.png'), fullPage: true });

    const homeAxe = await new AxeBuilder({ page }).analyze();
    const seriousHome = homeAxe.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(seriousHome).toEqual([]);

    // Design System Dark Mode check
    await page.goto('/design');
    await page.getByRole('button', { name: /Switch to dark theme/i }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'design-dark.png'), fullPage: true });
    await page.getByRole('button', { name: /Switch to light theme/i }).click();

    // Quick Open 1-click sign-in + direct workspace routing on /auth
    await page.goto('/auth');
    const authAxe = await new AxeBuilder({ page }).analyze();
    expect(authAxe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await expect(page.getByRole('button', { name: 'Quick Open /today' })).toBeVisible();
    await page.getByRole('button', { name: 'Quick Open /today' }).click();
    await page.waitForURL('**/today');

    // Sign in as Ramesh Pai via Better Auth standard Sign In -> Consent Ledger
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL('**/settings/consent');
    await expect(page.getByText('DPDP Act 2023 Granular Consent Ledger')).toBeVisible();
    await expect(page.getByText('Kavitha Pai').first()).toBeVisible();
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

    // Mobile 375px check
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings/consent');
    await expect(page.getByText('Chain Verified')).toBeVisible();
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'consent-ledger-mobile.png'), fullPage: true });

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
