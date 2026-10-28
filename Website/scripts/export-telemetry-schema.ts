import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { telemetryPacketSchema } from '../shared/telemetry/schema'

const target = new URL('../shared/telemetry/telemetry.schema.json', import.meta.url)
writeFileSync(target, `${JSON.stringify(z.toJSONSchema(telemetryPacketSchema), null, 2)}\n`)
