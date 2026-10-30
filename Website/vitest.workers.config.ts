import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { unstable_readConfig } from 'wrangler'
import { defineConfig } from 'vitest/config'

// Bindings come from wrangler.jsonc, but are passed to Miniflare directly so .dev.vars is never read.
const wrangler = unstable_readConfig({ config: './wrangler.jsonc' }, { hideWarnings: true })

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: './test/worker/entry.ts',
      miniflare: {
        compatibilityDate: wrangler.compatibility_date,
        compatibilityFlags: wrangler.compatibility_flags,
        d1Databases: Object.fromEntries(wrangler.d1_databases.map((db) => [db.binding, db.database_id ?? db.binding])),
        ratelimits: Object.fromEntries(
          wrangler.ratelimits.map((limiter) => [limiter.name, { namespace_id: limiter.namespace_id, simple: limiter.simple }]),
        ),
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          OPS_STATS_TOKEN: 'test-ops-stats-token-0123456789abcdef',
          HOSTED_TELEMETRY_TOKEN: 'test-hosted-token',
        },
      },
    })),
  ],
  test: {
    include: ['test/worker/**/*.test.ts'],
    setupFiles: ['./test/worker/apply-migrations.ts'],
  },
})
