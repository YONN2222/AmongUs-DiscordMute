import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  use: { baseURL: 'http://localhost:8799' },
  webServer: {
    command: 'bun run build && bunx wrangler dev --port 8799',
    url: 'http://localhost:8799/api/v1/health',
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
