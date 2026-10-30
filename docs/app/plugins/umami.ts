import {
  ANALYTICS_EVENTS,
  UMAMI_SCRIPT_URLS,
  UMAMI_WEBSITE_ID,
  trackEvent,
  type AnalyticsEvent,
  type AnalyticsProps,
} from '~/utils/analytics'

// Docus renders these elements itself, so clicks are matched here instead of by attribute.
function eventForClick(target: Element): { event: AnalyticsEvent; props: AnalyticsProps } | null {
  const link = target.closest<HTMLAnchorElement>('a[href]')
  if (link?.getAttribute('aria-label') === 'GitHub repository') {
    return { event: ANALYTICS_EVENTS.github, props: { location: 'footer' } }
  }
  if (link?.pathname.includes('/edit/')) {
    return { event: ANALYTICS_EVENTS.editPage, props: { page: location.pathname } }
  }
  if (link?.dataset.slot === 'link' && link.querySelector('[data-slot="linkDescription"]')) {
    return { event: ANALYTICS_EVENTS.pageNav, props: { from: location.pathname, to: link.pathname } }
  }
  // The copy button sits next to the <pre> it belongs to
  const button = target.closest('button')
  if (button?.parentElement?.querySelector(':scope > pre')) {
    return { event: ANALYTICS_EVENTS.codeCopy, props: { page: location.pathname } }
  }
  return null
}

export default defineNuxtPlugin(() => {
  if (import.meta.dev) return
  useHead({
    script: UMAMI_SCRIPT_URLS.map((src) => ({ src, defer: true, 'data-website-id': UMAMI_WEBSITE_ID })),
  })
  if (!import.meta.client) return

  window.addEventListener('click', (click) => {
    if (!(click.target instanceof Element)) return
    const match = eventForClick(click.target)
    if (match) trackEvent(match.event, match.props)
  }, { capture: true })

  const { open } = useContentSearch()
  watch(open, (isOpen) => {
    if (isOpen) trackEvent(ANALYTICS_EVENTS.searchOpen)
  })
})
