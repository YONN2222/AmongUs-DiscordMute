import { expect, test } from '@playwright/test'
import { DOWNLOAD_URL, GITHUB_URL } from '../../shared/site'

test('shows hero buttons', async ({ page }) => {
  await page.goto('/')
  const hero = page.locator('.hero')
  await expect(hero.getByRole('link', { name: 'Download the mod' })).toHaveAttribute('href', DOWNLOAD_URL)
  expect(DOWNLOAD_URL.endsWith('/releases/latest')).toBe(true)
  await expect(hero.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', GITHUB_URL)
  await expect(page.getByRole('link', { name: /Invite the bot/ })).toHaveCount(0)
})

test('shows games muted 1,234 and players linked 56', async ({ page }) => {
  await page.goto('/')
  const stats = page.locator('#stats')
  await stats.scrollIntoViewIfNeeded()
  const games = stats.locator('article', { hasText: 'Games muted' })
  const players = stats.locator('article', { hasText: 'Players linked' })
  await expect(games.locator('.stat-num')).toHaveText('1,234')
  await expect(players.locator('.stat-num')).toHaveText('56')
  await expect(games.locator('dd').first()).toHaveText('1,000')
  await expect(games.locator('dd').nth(1)).toContainText('234')
  await expect(players.locator('dd').first()).toHaveText('40')
  await expect(players.locator('dd').nth(1)).toContainText('16')
})

test('does not render hidden counters', async ({ page }) => {
  await page.goto('/')
  const stats = page.locator('#stats')
  await expect(stats.locator('article')).toHaveCount(2)
  await expect(stats).not.toContainText('Games running now')
  await expect(stats).not.toContainText('Servers')
})

test('setup tabs switch between Self-host and Hosted', async ({ page }) => {
  await page.goto('/')
  const self = page.getByRole('tab', { name: /Self-host/ })
  const hosted = page.getByRole('tab', { name: /Hosted/ })
  await expect(self).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Install BepInEx', { exact: false }).first()).toBeVisible()
  await hosted.click()
  await expect(hosted).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('The hosted bot is coming soon.')).toBeVisible()
  await self.click()
  await expect(self).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Set up the bot').first()).toBeVisible()
})

test('FAQ items expand with keyboard', async ({ page }) => {
  await page.goto('/')
  const trigger = page.locator('#faq button[aria-expanded]').nth(1)
  await trigger.scrollIntoViewIfNeeded()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Space')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

test('footer links to privacy and terms and shows the Innersloth disclaimer', async ({ page }) => {
  await page.goto('/')
  const footer = page.locator('footer')
  await expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
  await expect(footer.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
  await expect(footer).toContainText('Not affiliated with or endorsed by Innersloth.')
})

test('no horizontal scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('CLS below 0.1', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number }
    w.__cls = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
        if (!entry.hadRecentInput) w.__cls += entry.value
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
  await page.goto('/', { waitUntil: 'load' })
  await page.waitForTimeout(2000)
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls)
  expect(cls).toBeLessThan(0.1)
})

test('makes no requests to other origins', async ({ page, baseURL }) => {
  const foreign: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol.startsWith('http') && url.origin !== new URL(baseURL!).origin) foreign.push(request.url())
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  expect(foreign).toEqual([])
})

test('404 page renders for /nope with status 404', async ({ page }) => {
  const response = await page.goto('/nope')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('drifted off into space')
})
