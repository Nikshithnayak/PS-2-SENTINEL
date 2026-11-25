import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices } from '@playwright/test';

const hasBundledChromium = existsSync(chromium.executablePath());
const systemChromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
    launchOptions:
      !hasBundledChromium && existsSync(systemChromePath)
        ? { executablePath: systemChromePath }
        : undefined,
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node --experimental-strip-types ./scripts/boot-local.ts start',
        port: 3100,
        timeout: 120000,
        reuseExistingServer: false,
        env: {
          ...process.env,
          PORT: '3100',
          NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
          BETTER_AUTH_URL: 'http://127.0.0.1:3100',
        },
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
