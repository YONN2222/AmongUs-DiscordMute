// Renders public/brand/discord-footer.png, the banner the bot puts at the bottom of every Discord message.
// Run from Website/: bun scripts/render-discord-footer.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// A very wide, low strip: Discord scales it to the message width, so it stays a thin line under the content.
const WIDTH = 5170
const HEIGHT = 106
const BACKGROUND = '#0a0a0f'
const RULE_COLOR = '#9295ff'
const RULE_OPACITY = 0.35
const RULE_HEIGHT = 14
const EDGE_PADDING = 60
const WORDMARK_HEIGHT = 90
const WORDMARK_GAP = 48
const WORDMARK_SOURCE = { file: 'logo-wordmark-480.png', width: 480, height: 131 }

const brandDir = fileURLToPath(new URL('../public/brand/', import.meta.url))
const wordmark = readFileSync(join(brandDir, WORDMARK_SOURCE.file)).toString('base64')
const wordmarkWidth = Math.round((WORDMARK_SOURCE.width / WORDMARK_SOURCE.height) * WORDMARK_HEIGHT)
const wordmarkX = (WIDTH - wordmarkWidth) / 2
const ruleY = (HEIGHT - RULE_HEIGHT) / 2
const ruleWidth = wordmarkX - WORDMARK_GAP - EDGE_PADDING

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" rx="${HEIGHT / 2}" fill="${BACKGROUND}"/>
  <rect x="${EDGE_PADDING}" y="${ruleY}" width="${ruleWidth}" height="${RULE_HEIGHT}" rx="${RULE_HEIGHT / 2}" fill="${RULE_COLOR}" fill-opacity="${RULE_OPACITY}"/>
  <rect x="${WIDTH - EDGE_PADDING - ruleWidth}" y="${ruleY}" width="${ruleWidth}" height="${RULE_HEIGHT}" rx="${RULE_HEIGHT / 2}" fill="${RULE_COLOR}" fill-opacity="${RULE_OPACITY}"/>
  <image x="${wordmarkX}" y="${(HEIGHT - WORDMARK_HEIGHT) / 2}" width="${wordmarkWidth}" height="${WORDMARK_HEIGHT}" href="data:image/png;base64,${wordmark}"/>
</svg>
`

const workDir = mkdtempSync(join(tmpdir(), 'discord-footer-'))
const svgPath = join(workDir, 'discord-footer.svg')
writeFileSync(svgPath, svg)
const render = Bun.spawnSync(
  ['bunx', '--bun', '@resvg/resvg-js-cli@2.6.2-beta.1', svgPath, join(brandDir, 'discord-footer.png')],
  { stdout: 'inherit', stderr: 'inherit' },
)
rmSync(workDir, { recursive: true, force: true })
if (render.exitCode !== 0) process.exit(render.exitCode ?? 1)
