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
| `bun run test:e2e`         | Build, start three `wrangler dev` servers, run Playwright |

For e2e, install the browser once with `bunx playwright install chromium`. The servers use local databases on ports 8799 (seeded), 8789 (seeded, for the ingest test) and 8788 (empty).

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

## Deployment

1. Create the database and commit its id to `wrangler.jsonc` (`d1_databases[0].database_id`), since Workers Builds reads the repository:
   ```sh
   bunx wrangler d1 create discordmute-website
   ```
2. Set the telemetry secret. Deploys fail until `HOSTED_TELEMETRY_TOKEN` exists:
   ```sh
   bunx wrangler secret put HOSTED_TELEMETRY_TOKEN
   ```
   On a Worker that does not exist yet, accept the prompt to create it, or set the secret in the dashboard after connecting Workers Builds.
3. Connect the GitHub repository in Workers Builds:
   - Worker name: `discordmute-website` (must match `name` in `wrangler.jsonc`)
   - root directory: `Website`
   - build command: `bun run build`
   - deploy command: `bunx wrangler d1 migrations apply DB --remote && bunx wrangler deploy`
   - build watch path: `Website/**`
   - production branch: `master`
   - the build token needs D1 edit rights, and Bun must be picked up from `bun.lock` (otherwise set `BUN_VERSION`)
4. Domains: `routes` in `wrangler.jsonc` attach `mute.yonn2222.com` and `amongus-mute.yonn2222.com` as Custom Domains. Neither hostname may have an existing DNS record, so delete the old `amongus-mute` record before the first deploy.
5. Old hostname: pages on `amongus-mute.yonn2222.com` get a 301 to `mute.yonn2222.com`. Assets and telemetry POSTs are served there without a redirect so existing bots keep working. Add a zone Redirect Rule if assets should redirect too. Check with `curl -I https://amongus-mute.yonn2222.com/privacy`.
6. Keep these zone features off for both hostnames, because they change inline scripts and break the CSP hashes or inject blocked scripts: Rocket Loader, Zaraz, Web Analytics automatic setup, Email Address Obfuscation, JS detections and any other HTML rewriting.
7. Workers Logs are enabled in `wrangler.jsonc` (3 days retention on Free, 7 on Paid, matching the privacy policy). Lower `head_sampling_rate` if traffic grows.
8. The `ratelimits` `namespace_id` values (4101, 4102) must be unique in the Cloudflare account.

`bunx wrangler deploy --dry-run --outdir .wrangler/dry-run` shows the bundle size without uploading.
