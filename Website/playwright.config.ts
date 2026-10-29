import { defineConfig, devices } from '@playwright/test'

const MAIN_PORT = 8799
const EMPTY_PORT = 8788

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  use: { baseURL: `http://localhost:${MAIN_PORT}` },
  projects: [
    { name: 'chromium', testMatch: /(home|seo)\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'Pixel 7', testMatch: /home\.spec\.ts/, use: { ...devices['Pixel 7'] } },
    {
      name: 'api',
      testMatch: /(api|ingest)\.spec\.ts/,
      dependencies: ['chromium', 'Pixel 7'],
    },
    {
      name: 'empty-db',
      testMatch: /empty\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${EMPTY_PORT}` },
    },
  ],
  webServer: [
    {
      command: 'bun run e2e:serve',
      url: `http://localhost:${MAIN_PORT}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'bun run e2e:serve:ingest',
      url: 'http://localhost:8789/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'bun run e2e:serve:empty',
      url: `http://localhost:${EMPTY_PORT}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
})
