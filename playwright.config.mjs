import { defineConfig } from '@playwright/test';

const python = process.platform === 'win32' ? 'python' : 'python3';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8100',
    headless: true,
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `${python} scripts/e2e_server.py`,
    url: 'http://127.0.0.1:8100/',
    reuseExistingServer: false,
    timeout: 90_000,
    env: { ...process.env, MM_E2E_TOKEN: 'e2e-token', MM_E2E_PORT: '8100' },
  },
});
