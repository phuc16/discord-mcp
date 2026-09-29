const bit = (n: bigint): bigint => 1n << n
const VIEW_CHANNEL = bit(10n), READ_HISTORY = bit(16n), VIEW_AUDIT_LOG = bit(7n)
const KICK = bit(1n), BAN = bit(2n), MOD_MEMBERS = bit(40n), MANAGE_MESSAGES = bit(13n), MANAGE_THREADS = bit(34n)
const MANAGE_CHANNELS = bit(4n), MANAGE_GUILD = bit(5n), MANAGE_ROLES = bit(28n), MANAGE_WEBHOOKS = bit(29n)
const MANAGE_EXPRESSIONS = bit(30n), MANAGE_EVENTS = bit(33n), CREATE_INVITE = bit(0n)
const SEND = bit(11n), REACT = bit(6n), EMBED = bit(14n)

const read = VIEW_CHANNEL | READ_HISTORY | VIEW_AUDIT_LOG
const moderator = read | KICK | BAN | MOD_MEMBERS | MANAGE_MESSAGES | MANAGE_THREADS
const manager = moderator | MANAGE_CHANNELS | MANAGE_GUILD | MANAGE_ROLES | MANAGE_WEBHOOKS | MANAGE_EXPRESSIONS | MANAGE_EVENTS | CREATE_INVITE | SEND | REACT | EMBED

export const PERMISSION_PRESETS: Record<'read' | 'moderator' | 'manager' | 'admin', bigint> = { read, moderator, manager, admin: bit(3n) }

export const buildInviteUrl = (clientId: string, preset: string | bigint): string => {
  const bits = typeof preset === 'bigint' ? preset : Object.hasOwn(PERMISSION_PRESETS, preset) ? PERMISSION_PRESETS[preset as keyof typeof PERMISSION_PRESETS] : undefined
  if (bits === undefined) throw new Error(`unknown preset "${preset}"; use ${Object.keys(PERMISSION_PRESETS).join(', ')} or a numeric bitfield`)
  const url = new URL('https://discord.com/oauth2/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', 'bot')
  url.searchParams.set('permissions', bits.toString())
  return url.toString()
}
