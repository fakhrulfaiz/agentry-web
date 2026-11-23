import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run the web app (`next dev`, apikey mode) against the mock
 * Agentry API (`mock/agentry-mock.ts`). Both servers start here on their own
 * ports; the tests share the mock's state, so they run one at a time.
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3019)
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 4019)
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node mock/agentry-mock.ts',
      url: `${MOCK_URL}/health`,
      env: { MOCK_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
      stdout: 'ignore',
    },
    {
      command: `pnpm exec next dev -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        AGENTRY_WEB_AUTH: 'apikey',
        AGENTRY_API_URL: MOCK_URL,
        AGENTRY_WEB_SESSION_SECRET: 'e2e-session-secret-0123456789abcdef-0123',
        AGENTRY_WEB_MODELS: 'mock-model,mock-large',
        // Its own build directory: `next dev` refuses to share `.next` with another dev server.
        AGENTRY_WEB_DIST_DIR: '.next-e2e',
        // Its own connector-key store: the dev store is encrypted with another session secret.
        AGENTRY_WEB_DATA_DIR: '.data-e2e',
      },
    },
  ],
})
