import { defineConfig } from '@playwright/test';

const python = process.platform === 'win32' ? 'python' : 'python3';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8000',
    headless: true,
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `${python} -m http.server 8000 --directory code/frontend`,
    url: 'http://127.0.0.1:8000',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
