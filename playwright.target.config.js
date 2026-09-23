import { defineConfig } from '@playwright/test';

/**
 * Target-stack (Next.js) browser tests for Phase 3 media UI.
 * Prototype suite remains on playwright.config.js + tests/browser/meeting.spec.js.
 */
export default defineConfig({
  testDir: './tests/browser',
  testMatch: /target-.*\.spec\.js/,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://127.0.0.1:3005',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    trace: 'off',
  },
  webServer: {
    command: 'npx next dev -H 127.0.0.1 -p 3005',
    url: 'http://127.0.0.1:3005',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
