import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TELEMETRY_PATH } from '../shared/telemetry/contract'

const outdir = mkdtempSync(join(tmpdir(), 'discordmute-dry-run-'))
try {
  const build = spawnSync(process.execPath, ['x', 'wrangler', 'deploy', '--dry-run', '--outdir', outdir], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  if (build.status !== 0) throw new Error(`wrangler dry run failed with exit code ${build.status}`)

  const bundle = readFileSync(join(outdir, 'index.js'), 'utf8')
  const checks: Array<[string, boolean]> = [
    ['telemetry path is routed in the worker entry', bundle.includes(JSON.stringify(TELEMETRY_PATH))],
    ['ingest pipeline is bundled', bundle.includes('telemetry limiter failed')],
    ['no buffered Nitro telemetry route', !bundle.includes('telemetry.post')],
  ]
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name)
  if (failed.length > 0) throw new Error(`worker entry check failed: ${failed.join(', ')}`)
  console.log('worker entry check passed')
} finally {
  rmSync(outdir, { recursive: true, force: true })
}
