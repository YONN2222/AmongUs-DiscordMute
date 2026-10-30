import { hostedInviteUrl } from './site'

export const HOSTED_STATUSES = ['available', 'coming-soon', 'unavailable'] as const
export type HostedStatus = (typeof HOSTED_STATUSES)[number]

export const DEFAULT_HOSTED_STATUS: HostedStatus = 'coming-soon'

const SELF_HOST_CTA = { label: 'Self-host now', href: '/#setup' }
const DISCORD_ID = /^\d{17,20}$/

export type HostedView = {
  status: HostedStatus
  inviteUrl: string | null
  badge: string
  headline: string
  body: string
  cta: { label: string; href: string }
}

export function parseHostedStatus(raw: unknown): HostedStatus {
  return HOSTED_STATUSES.find((status) => status === raw) ?? DEFAULT_HOSTED_STATUS
}

function parseClientId(raw: string | null | undefined): string | null {
  const id = raw?.trim()
  return id && DISCORD_ID.test(id) ? id : null
}

// A status of "available" without a usable client id would render a broken invite, so it counts as coming soon.
export function hostedView(status: HostedStatus, clientId: string | null | undefined): HostedView {
  const id = parseClientId(clientId)

  if (status === 'available' && id) {
    const inviteUrl = hostedInviteUrl(id)
    return {
      status,
      inviteUrl,
      badge: 'Hosted',
      headline: 'Add the hosted bot in one click',
      body: 'Invite the bot to your server, run /setup, create a secret and set the mod to hosted mode. There is no bot of your own to run.',
      cta: { label: 'Add the bot', href: inviteUrl },
    }
  }

  if (status === 'unavailable') {
    return {
      status,
      inviteUrl: null,
      badge: 'Currently unavailable',
      headline: 'The hosted bot is temporarily unavailable',
      body: 'Existing setups reconnect automatically once it is back. Self-hosting works in the meantime.',
      cta: SELF_HOST_CTA,
    }
  }

  return {
    status: 'coming-soon',
    inviteUrl: null,
    badge: 'Coming soon',
    headline: 'A hosted bot is planned',
    body: 'Self-hosting works today. Run your own bot and you are set.',
    cta: SELF_HOST_CTA,
  }
}
