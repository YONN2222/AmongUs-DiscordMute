export default defineEventHandler(async (event) => {
  const bindings = cloudflareEnv(event)
  await bindings.DB.prepare('SELECT 1').first()
  return { ok: true }
})
