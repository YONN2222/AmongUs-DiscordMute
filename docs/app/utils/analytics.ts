export const UMAMI_ORIGIN = 'https://umami.yonn2222.com'
export const UMAMI_WEBSITE_ID = '8996e4ed-b593-4482-9a4e-15bb019ca619'
export const UMAMI_SCRIPT_URLS: readonly string[] = [`${UMAMI_ORIGIN}/script.js`, `${UMAMI_ORIGIN}/recorder.js`]

export const ANALYTICS_EVENTS = {
  github: 'github-click',
  privacy: 'privacy-click',
  editPage: 'edit-page-click',
  pageNav: 'page-nav-click',
  searchOpen: 'search-open',
  codeCopy: 'code-copy',
} as const

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS]
export type AnalyticsProps = Readonly<Record<string, string>>

export function trackEvent(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  ;(globalThis as { umami?: { track: (name: string, data?: AnalyticsProps) => void } }).umami?.track(event, props)
}
