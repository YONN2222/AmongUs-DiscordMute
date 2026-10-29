# DiscordMute website

Nuxt 4 and Nuxt UI, deployed as a Cloudflare Worker with a D1 database. Bun is the only package manager and runtime.

## Development

```sh
bun install
cp .dev.vars.example .dev.vars
bun run db:migrate:local
bun run dev
```

`.dev.vars` holds local secrets such as `HOSTED_TELEMETRY_TOKEN` and is not committed. The telemetry ingest route lives in the Worker entry `server/cloudflare-entry.ts`, so it only exists in the built Worker (`bun run build`, then `bun run preview`), not in `bun run dev`.

| Command                    | Purpose                                                   |
|----------------------------|-----------------------------------------------------------|
| `bun run dev`              | Nuxt dev server                                           |
| `bun run build`            | Production Worker build into `.output/`                   |
| `bun run preview`          | `wrangler dev` on the last build                          |
| `bun run typecheck`        | Nuxt and vue-tsc type check                               |
| `bun run db:migrate:local` | Apply D1 migrations locally                               |
| `bun run schema:export`    | Regenerate `shared/telemetry/telemetry.schema.json`       |
| `bun run check:entry`      | Dry-run bundle check that the Worker entry serves ingest  |
| `bun run test`             | Vitest unit tests, then Worker tests against local D1     |
| `bun run test:e2e`         | Build, start five `wrangler dev` servers, run Playwright |

For e2e, install the browser once with `bunx playwright install chromium`. The servers use local databases on ports 8799 (seeded), 8789 (seeded, for the ingest test), 8788 (empty), 8790 (hosted bot available) and 8791 (hosted bot unavailable).

## Telemetry API

- `POST /api/v1/telemetry`, `Content-Type: application/json`, one packet per request, body up to 8192 bytes.
- At least 60 seconds between accepted packets per instance; per-client and new-instance rate limits apply. Implausible values are rejected.
- Public totals count an instance's linked users only after it has reported over at least one hour.
- Hosted bots send `Authorization: Bearer <HOSTED_TELEMETRY_TOKEN>`. Self-hosted bots send no credentials.
- Responses: `202` accepted, `200` duplicate, `400` invalid, `401` unauthorized, `413` too large, `415` wrong media type, `422` implausible, `429` rate limited, `503` unavailable.
- Retry only on `429`, `503` or a network failure, with the same `packetId`. Otherwise drop that window of deltas.
- Packets are strict: unknown keys are rejected, and client IPs are never stored.
- Schema: `shared/telemetry/schema.ts` and `contract.ts`, exported to `telemetry.schema.json`. The 16-key limit on version maps is a zod refine, so the JSON file alone is not a full validator.

`GET /api/v1/stats` returns the public counters with a per-mode breakdown, cached for 60 seconds. Which counters are shown on the home page and in the stats response is set in `shared/counters.ts` (`PUBLIC_COUNTERS`).

## More

Setup guides, configuration and the FAQ are at https://docs.mute.yonn2222.com.
