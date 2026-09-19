import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    trace: 'off',
  },
  webServer: {
    command: 'node tests/browser-server.js',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});