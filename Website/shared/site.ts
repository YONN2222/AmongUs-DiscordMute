export const SITE_NAME = 'DiscordMute'
export const SITE_DESCRIPTION =
  'Free Among Us mod and Discord bot: auto mute your voice channel during rounds, let the living talk in meetings and keep the dead quiet.'
export const CANONICAL_ORIGIN = 'https://mute.yonn2222.com'
export const REDIRECT_HOSTS: readonly string[] = ['amongus-mute.yonn2222.com']
export const GITHUB_URL = 'https://github.com/YONN2222/AmongUs-DiscordMute'
export const DOWNLOAD_URL = `${GITHUB_URL}/releases/latest`
export const DEFAULT_HOSTED_BOT_CLIENT_ID = '1565436340114423808'

// View Channels, Send Messages, Manage Messages, Read Message History, Mute Members, Deafen Members, Manage Nicknames
export const HOSTED_BOT_PERMISSIONS = '146877440'

export function hostedInviteUrl(clientId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&scope=bot+applications.commands&permissions=${HOSTED_BOT_PERMISSIONS}`
}
