# DiscordMute website

Nuxt 4 site deployed as a Cloudflare Worker with a D1 database.

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Nuxt dev server for the pages and Nitro API routes |
| `bun run build` | Production Worker build into `.output/` |
| `bun run preview` | `wrangler dev` on the last build |
| `bun run test` | Unit tests and Worker tests against local D1 |
| `bun run test:e2e` | Builds, starts `wrangler dev` on port 8799 and runs Playwright |
| `bun run check:entry` | Dry-run bundle check that the Worker entry serves telemetry ingest |
| `bun run db:migrate:local` | Applies D1 migrations to the local database |

## Telemetry ingest

`POST /api/v1/telemetry` is served by the Worker entry `server/cloudflare-entry.ts` on the raw request, before
Nitro reads the body, so the 8192-byte limit also holds for streamed bodies. That entry is used only for the
production build, so the route exists only on the built Worker (`bun run build` then `bun run preview`, and in
production). It is not available in `bun run dev`.

Local secrets go in `.dev.vars` (for example `HOSTED_TELEMETRY_TOKEN=...`), which is never committed.
