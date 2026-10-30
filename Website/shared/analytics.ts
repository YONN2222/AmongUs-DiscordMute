export const UMAMI_ORIGIN = 'https://umami.yonn2222.com'
export const UMAMI_WEBSITE_ID = 'b22920b4-df24-40fc-a3bf-ce6de91dc515'
export const UMAMI_SCRIPT_URLS: readonly string[] = [`${UMAMI_ORIGIN}/script.js`, `${UMAMI_ORIGIN}/recorder.js`]

export const ANALYTICS_EVENTS = {
  download: 'download-click',
  docs: 'docs-click',
  github: 'github-click',
  hostedCta: 'hosted-cta-click',
  setup: 'setup-click',
  guide: 'guide-click',
  faqOpen: 'faq-open',
  nav: 'nav-click',
  footer: 'footer-click',
} as const

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS]
export type AnalyticsProps = Readonly<Record<string, string>>

// Declarative events: Umami reads these attributes from the clicked element.
// Use them on external links only; on in-app links Umami would turn the click into a full page load.
export function trackAttrs(event: AnalyticsEvent, props: AnalyticsProps = {}): Record<string, string> {
  const attrs: Record<string, string> = { 'data-umami-event': event }
  for (const [key, value] of Object.entries(props)) attrs[`data-umami-event-${key}`] = value
  return attrs
}

// Programmatic events for in-app links, menu items and accordions that cannot carry attributes.
export function trackEvent(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  if (!import.meta.client) return
  ;(window as { umami?: { track: (name: string, data?: AnalyticsProps) => void } }).umami?.track(event, props)
}
