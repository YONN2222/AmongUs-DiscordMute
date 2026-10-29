import { expect, test, type Page } from '@playwright/test'
import { hostedView, type HostedView } from '../../shared/hostedStatus'
import { DEFAULT_HOSTED_BOT_CLIENT_ID } from '../../shared/site'

// Each project runs against a Worker started with different NUXT_PUBLIC_* variables, without a rebuild.
const VIEWS: Record<string, HostedView> = {
  'hosted-available': hostedView('available', DEFAULT_HOSTED_BOT_CLIENT_ID),
  'hosted-unavailable': hostedView('unavailable', DEFAULT_HOSTED_BOT_CLIENT_ID),
}

const STATS_HIDDEN: Record<string, boolean> = { 'hosted-available': false, 'hosted-unavailable': true }

const INVITE_LINKS = 'a[href^="https://discord.com/oauth2/authorize"]'
const HOSTED_FAQ_QUESTION = 'Can I use a hosted bot instead of running my own?'

type JsonLdNode = { '@type'?: string; name?: string; acceptedAnswer?: { text?: string } | string }

async function jsonLdNodes(page: Page): Promise<JsonLdNode[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents()
  return blocks.flatMap((text) => {
    const parsed = JSON.parse(text)
    return (parsed['@graph'] ?? [parsed]) as JsonLdNode[]
  })
}

const viewOf = () => VIEWS[test.info().project.name]!
const statsHidden = () => STATS_HIDDEN[test.info().project.name]!

test('the setup section shows the headline of the active status', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#setup')).toContainText(viewOf().headline)
})

test('invite links exist only while the hosted bot is available', async ({ page }) => {
  await page.goto('/')
  const view = viewOf()
  const links = page.locator(INVITE_LINKS)
  if (view.inviteUrl === null) {
    await expect(links).toHaveCount(0)
    return
  }
  await expect(links.first()).toHaveAttribute('href', view.inviteUrl)
  await expect(page.locator('.hero').getByRole('link', { name: view.cta.label })).toHaveAttribute('href', view.inviteUrl)
})

test('a closed hosted bot shows its badge on the Hosted tab and the hosted counter', async ({ page }) => {
  await page.goto('/')
  const view = viewOf()
  const tab = page.getByRole('tab', { name: /Hosted/ })
  const counter = page.locator('#stats article').first()
  if (view.status === 'available') {
    await expect(tab).not.toContainText('unavailable')
    await expect(counter).not.toContainText('Coming soon')
    return
  }
  await expect(tab).toContainText(view.badge)
  if (!statsHidden()) await expect(counter).toContainText(view.badge)
})

test('hidden stats render no counter panel and fetch no stats', async ({ page }) => {
  test.skip(!statsHidden(), 'this server shows the stats')
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/stats')) requests.push(request.url())
  })
  const response = await page.goto('/')
  await page.waitForLoadState('networkidle')
  const html = (await response?.text()) ?? ''
  await expect(page.locator('#stats')).toHaveCount(0)
  await expect(page.locator('a[href$="#stats"]')).toHaveCount(0)
  expect(requests).toEqual([])
  expect(html).not.toContain('public-stats')
  expect(html).not.toContain('Rounds kept quiet')
})

test('visible stats render the counters', async ({ page }) => {
  test.skip(statsHidden(), 'this server hides the stats')
  await page.goto('/')
  await expect(page.locator('#stats article').first()).toBeVisible()
})

test('the FAQ answer and the structured data match the active status', async ({ page }) => {
  await page.goto('/')
  const view = viewOf()
  const answer = `${view.headline}. ${view.body}`
  await expect(page.locator('#faq')).toContainText(HOSTED_FAQ_QUESTION)
  await expect(page.locator('#faq')).toContainText(answer)
  const question = (await jsonLdNodes(page)).find((node) => node.name === HOSTED_FAQ_QUESTION)
  const accepted = question?.acceptedAnswer
  expect(typeof accepted === 'string' ? accepted : accepted?.text).toBe(answer)
})
