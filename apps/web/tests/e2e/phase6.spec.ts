import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signUpViaUi } from './helpers/real-auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(__dirname, '../../../../docs/evidence/phase-6');
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.describe('Phase 6 Signature Visuals, Reduced Motion, i18n & PWA Verification', () => {
  test('renders restrained hero visual, obeys prefers-reduced-motion static fallback, serves PWA manifest & sw.js, and switches EN/KN/HI', async ({
    page,
    browser,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByText(/Personal physiological baselines/i)).toBeVisible();

    const webglCanvases = await page.locator('canvas').count();
    expect(webglCanvases).toBeLessThanOrEqual(1);

    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return nav ? Math.round(nav.domContentLoadedEventEnd) : 0;
    });
    expect(timing).toBeLessThan(3500);

    const manifestRes = await page.request.get('/manifest.webmanifest');
    expect(manifestRes.status()).toBe(200);
    const manifestJson = await manifestRes.json();
    expect(manifestJson.short_name).toBe('SENTINEL');

    const swRes = await page.request.get('/sw.js');
    expect(swRes.status()).toBe(200);

    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'home-visual-desktop.png'), fullPage: true });

    const reducedCtx = await browser.newContext({ reducedMotion: 'reduce' });
    const reducedPage = await reducedCtx.newPage();
    await reducedPage.goto('http://127.0.0.1:3100/');
    await expect(reducedPage.getByTestId('pulse-static-fallback')).toBeVisible();
    await reducedPage.screenshot({
      path: resolve(EVIDENCE_DIR, 'home-reduced-motion.png'),
      fullPage: true,
    });
    await reducedCtx.close();

    // Register real patient and check Kannada & Hindi on Elder Mode /today
    const suffix = `${Date.now()}-p6`;
    await signUpViaUi(page, {
      name: 'Lakshmi Bhat',
      email: `patient-${suffix}@example.com`,
      password: 'SentinelReal#2026!',
      role: 'patient',
      expectedUrlPart: '/today',
    });

    await page.getByRole('button', { name: 'ಕನ್ನಡ' }).click();
    await expect(page.getByText(/ನಮಸ್ಕಾರ/)).toBeVisible();
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'today-kannada-desktop.png'), fullPage: true });

    await page.getByRole('button', { name: 'हिन्दी' }).click();
    await expect(page.getByText(/नमस्ते/)).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

    expect(errors).toEqual([]);
  });
});
