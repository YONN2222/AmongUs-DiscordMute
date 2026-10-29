import { expect, test } from '@playwright/test'

test('empty database renders zero counters and returns 200', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  const stats = page.locator('#stats')
  await stats.scrollIntoViewIfNeeded()
  await expect(stats.locator('article')).toHaveCount(2)
  for (const label of ['Games muted', 'Players linked']) {
    await expect(stats.locator('article', { hasText: label }).locator('.stat-num')).toHaveText('0')
  }
})

test('empty database stats endpoint reports zeros', async ({ request }) => {
  const response = await request.get('/api/v1/stats')
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.data.gamesMuted).toEqual({ total: 0, selfHost: 0, hosted: 0 })
  expect(body.data.uniqueUsers).toEqual({ total: 0, selfHost: 0, hosted: 0 })
})
