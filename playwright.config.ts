import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against a mock Agentry API (added with the e2e suite).
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
