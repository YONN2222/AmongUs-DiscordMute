# DiscordMute website

Nuxt 4 site with Nuxt UI, deployed as a Cloudflare Worker with a D1 database. Bun is the only package manager and runtime.

## Local development

```sh
bun install
cp .dev.vars.example .dev.vars
bun run db:migrate:local
bun run dev
```

`.dev.vars` holds local secrets (for example `HOSTED_TELEMETRY_TOKEN`) and is never committed.

The telemetry ingest route lives in the custom Worker entry `server/cloudflare-entry.ts`, which is used only by the production
build. It therefore exists on the built Worker (`bun run build`, then `bun run preview`), not in `bun run dev`.

| Command | What it does |
| --- | --- |
| `bun run dev` | Nuxt dev server for the pages and the Nitro stats route |
| `bun run build` | Production Worker build into `.output/` |
| `bun run preview` | `wrangler dev` on the last build |
| `bun run typecheck` | Nuxt and vue-tsc type check |
| `bun run db:migrate:local` | Applies D1 migrations to the local database |
| `bun run schema:export` | Regenerates `shared/telemetry/telemetry.schema.json` |
| `bun run check:entry` | Dry-run bundle check that the Worker entry serves telemetry ingest |

## Tests

| Command | What it does |
| --- | --- |
| `bun run test` | Vitest unit tests, then Worker tests against local D1 |
| `bun run test:e2e` | Builds, starts three `wrangler dev` servers and runs Playwright |

The e2e run uses three local databases: `.wrangler/e2e` on port 8799 (reseeded on every run by `test/e2e/seed.sql` with 1,234
games muted and 56 players linked), `.wrangler/e2e-ingest` on port 8789 (same seed, used by the test that posts a packet and
reads the stats afterwards, because the stats response is edge cached for 60 s) and `.wrangler/e2e-empty` on port 8788 (no data). Install the
browser once with `bunx playwright install chromium`. The build happens in `test:e2e`, so call `bun run build` yourself before
running `bunx playwright test` directly. Tests that write to the database (`api`, `ingest`) run after the read-only page tests.

## Telemetry contract

- Endpoint: `POST /api/v1/telemetry`, `Content-Type: application/json`, one packet per request.
- Limits: body at most 8192 bytes (also enforced while streaming), at least 60 seconds between accepted packets per instance,
  per-client request limiter and a separate limiter for new instances. Implausible values are rejected: self-host gauges are
  capped at 5,000 linked users, 10 servers and 100 games or plugins, deltas scale with the elapsed time, and the first packet of
  an instance is checked against a 60 s window.
- Public totals count an instance's linked users only after it has reported over at least one hour (last report minus first
  report), so throwaway instance IDs do not move the counter.
- Hosted bots authenticate with `Authorization: Bearer <HOSTED_TELEMETRY_TOKEN>`. Self-hosted bots send no credentials.
- Responses: `202` accepted, `200` duplicate packet, `400` invalid, `401` unauthorized, `413` too large, `415` wrong media type,
  `422` implausible, `429` rate limited, `503` unavailable.
- Retry rule: retry only on `429`, `503` or a network failure, and resend the same `packetId`. On every other error drop that
  window of deltas. Send deltas since the last accepted packet.
- The packet is strict: unknown keys are rejected, and it never carries Discord IDs, names or hashes of them. Client IPs are used
  only as the transient limiter key and are never stored.
- Schema and constants live in `shared/telemetry/schema.ts` (zod 4) and `shared/telemetry/contract.ts`. The JSON Schema export is
  `shared/telemetry/telemetry.schema.json`. The 16-key limit on version maps is a zod refine, so the JSON file alone is not a
  complete validator.

`GET /api/v1/stats` returns the public counters with a per-mode breakdown and `Cache-Control: public, max-age=60`.

## Counter switch

`shared/counters.ts` exports `PUBLIC_COUNTERS`. Set a key to `true` to show it on the home page and in the stats response.
`gamesMuted` and `uniqueUsers` are on, `activeGames` and `guilds` are implemented but off.

## Deployment (prepared, not executed)

Nothing here has been run. The commands create real Cloudflare resources, so run them yourself when you are ready.

1. Create the database and commit its id into `wrangler.jsonc` (`d1_databases[0].database_id`). Workers Builds reads the
   repository, so the real id must be in the committed file:
   `bunx wrangler d1 create discordmute-website`
2. Set the secret for hosted telemetry before the first deploy. `secrets.required` lists `HOSTED_TELEMETRY_TOKEN`, so a deploy
   fails until it exists. On a Worker that does not exist yet, `bunx wrangler secret put HOSTED_TELEMETRY_TOKEN` offers to create
   it: accept that prompt. Alternatively set the secret in the dashboard after connecting Workers Builds.
3. Workers Builds: connect the GitHub repository and use
   - Worker name in the dashboard: `discordmute-website`, exactly the `name` in `wrangler.jsonc`, otherwise Builds creates or
     deploys a different Worker
   - root directory: `Website`
   - build command: `bun run build`
   - deploy command: `bunx wrangler d1 migrations apply DB --remote && bunx wrangler deploy`
   - build watch path: `Website/**`
   - production branch: `master`
   - the build token needs D1 edit rights, because the deploy command applies migrations with `--remote`. Check this on the
     first build.
4. DNS cutover for `amongus-mute.yonn2222.com`. Custom domains come from `routes` in `wrangler.jsonc` (`mute.yonn2222.com` and
   `amongus-mute.yonn2222.com`, both on the `yonn2222.com` zone). A Custom Domain cannot be attached while the hostname already
   has a DNS record, and `amongus-mute.yonn2222.com` is the live old domain, so the first deploy fails on that route until the
   old record is deleted. Delete it, deploy, and expect a short gap. `mute.yonn2222.com` must not have a record either.
5. Old hostname coverage. The server answers pages on `amongus-mute.yonn2222.com` with a 301 to `mute.yonn2222.com`, so no
   Cloudflare redirect rule is needed for pages. Static assets (`/brand/*`, `/fonts/*`, `/og.png`, `/_nuxt/*`) and telemetry
   POSTs are answered on the old host without a redirect, which is intended (existing bots keep working). Add a zone Redirect
   Rule for `amongus-mute.yonn2222.com/*` if assets should redirect too. After the deploy check
   `curl -I https://amongus-mute.yonn2222.com/privacy` returns a 301 to the canonical host.
6. Zone features that rewrite or inject scripts must stay off for both hostnames: Rocket Loader, Zaraz, Web Analytics automatic
   setup, Email Address Obfuscation, JS detections and any other HTML rewriting. They change inline scripts after the Worker
   runs, so the per-response CSP hashes no longer match and hydration breaks, or they inject external or `/cdn-cgi/` scripts that
   the CSP blocks and that break the rule that nothing is loaded from outside. These are settings of the `yonn2222.com` zone,
   so check the zone's current defaults before the first deploy.
7. Observability: `observability.enabled` in `wrangler.jsonc` turns on Workers Logs. Retention is 3 days on the Free plan and 7
   on Paid, which the privacy policy covers with "up to 7 days". Mind the daily log volume of the plan and lower
   `head_sampling_rate` if traffic grows.
8. The `ratelimits` `namespace_id` values in `wrangler.jsonc` (4101 and 4102) must be unique within the Cloudflare account.
   Change them if another Worker already uses them.
9. Check that Workers Builds picks Bun from `bun.lock`. If it does not, set the build environment variable `BUN_VERSION`.

Before the first deploy, `bunx wrangler deploy --dry-run --outdir .wrangler/dry-run` shows the bundle size without uploading
anything.
