import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /screenshots\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], browserName: 'chromium', viewport: { width: 390, height: 844 } },
      testIgnore: /screenshots\.spec\.ts/,
    },
    {
      name: 'screenshots',
      testMatch: /screenshots\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node e2e/start-e2e.mjs',
    url: 'http://127.0.0.1:8788/api/health',
    reuseExistingServer: false,
    timeout: 240_000,
  },
});