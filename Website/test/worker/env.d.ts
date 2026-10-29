declare namespace Cloudflare {
  interface Env {
    OPS_STATS_TOKEN?: string
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
  }
}
