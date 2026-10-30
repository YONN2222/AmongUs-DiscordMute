import { expect, test, type Page } from '@playwright/test'
import { faqFor } from '../../app/content/faq'
import { hostedView } from '../../shared/hostedStatus'
import { DEFAULT_HOSTED_BOT_CLIENT_ID } from '../../shared/site'

const ORIGIN = 'https://mute.yonn2222.com'

const attr = (page: Page, selector: string, name: string) => page.locator(selector).first().getAttribute(name)

async function jsonLdTypes(page: Page): Promise<string[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents()
  return blocks.flatMap((text) => {
    const parsed = JSON.parse(text)
    const nodes: Array<{ '@type'?: string | string[] }> = parsed['@graph'] ?? [parsed]
    return nodes.flatMap((node) => [node['@type'] ?? []].flat())
  })
}

test('home has title, description, canonical', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('DiscordMute: automatic Discord muting for Among Us')
  expect(await attr(page, 'link[rel="canonical"]', 'href')).toBe(`${ORIGIN}/`)
  const description = (await attr(page, 'meta[name="description"]', 'content')) ?? ''
  expect(description.length).toBeGreaterThanOrEqual(50)
  expect(description.length).toBeLessThanOrEqual(160)
  expect(description).toMatch(/Among Us/)
  expect(description).toMatch(/Discord/)
  expect(description).toMatch(/auto mute/)
})

test('home has og and twitter tags', async ({ page }) => {
  await page.goto('/')
  expect(await attr(page, 'meta[property="og:image"]', 'content')).toMatch(/\/og\.png$/)
  expect(await attr(page, 'meta[name="twitter:card"]', 'content')).toBe('summary_large_image')
  expect(await attr(page, 'html', 'lang')).toBe('en')
})

test('home JSON-LD contains SoftwareApplication and FAQPage with all FAQ questions', async ({ page }) => {
  await page.goto('/')
  const types = await jsonLdTypes(page)
  expect(types).toContain('SoftwareApplication')
  expect(types).toContain('FAQPage')
  expect(types.filter((type) => type === 'Question')).toHaveLength(faqFor(hostedView('coming-soon', DEFAULT_HOSTED_BOT_CLIENT_ID)).length)
})

test('privacy and terms have own canonical and title', async ({ page }) => {
  for (const [path, title] of [['/privacy', 'Privacy policy | DiscordMute'], ['/terms', 'Terms of service | DiscordMute']] as const) {
    await page.goto(path)
    await expect(page).toHaveTitle(title)
    expect(await attr(page, 'link[rel="canonical"]', 'href')).toBe(`${ORIGIN}${path}`)
  }
})

test('sitemap.xml lists /, /privacy, /terms and no /api', async ({ request }) => {
  const response = await request.get('/sitemap.xml')
  expect(response.status()).toBe(200)
  const body = await response.text()
  for (const path of ['/', '/privacy', '/terms']) expect(body).toContain(`<loc>${ORIGIN}${path}</loc>`)
  expect(body).not.toContain('/api')
})

test('robots.txt allows / and references the sitemap', async ({ request }) => {
  const body = await (await request.get('/robots.txt')).text()
  expect(body).not.toMatch(/^Disallow: \/\s*$/m)
  expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
  expect(body).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes')
})

test('html pages keep their content security policy', async ({ request }) => {
  for (const path of ['/', '/privacy', '/terms']) {
    const response = await request.get(path)
    expect(response.headers()['content-security-policy'], path).toContain("default-src 'self'")
  }
})
