import { hostedView, parseHostedStatus, type HostedView } from '#shared/hostedStatus'

// The single source for every hosted bot mention on the site.
export function useHostedView(): ComputedRef<HostedView> {
  const config = useRuntimeConfig().public
  return computed(() => hostedView(parseHostedStatus(config.hostedStatus), String(config.hostedBotClientId ?? '')))
}
