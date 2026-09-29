import { describe, expect, it } from 'vitest'
import type { DiscordPort } from '../../../src/contracts/index.js'
import { createDiscordPort } from '../../../src/discord/index.js'
import { type Call, recordingRest } from './helpers.js'

const PORT_KEYS: (keyof DiscordPort)[] = [
  'listBotGuildIds', 'fetchMemberPermissions', 'getGuild', 'listGuilds', 'updateGuild', 'getGuildPreview',
  'getPruneCount', 'pruneGuild', 'getWidget', 'updateWidget', 'listChannels', 'getChannel', 'createChannel',
  'updateChannel', 'moveChannels', 'setChannelPermissions', 'deleteChannelPermissions', 'deleteChannel',
  'listActiveThreads', 'listArchivedThreads', 'createThread', 'addThreadMember', 'removeThreadMember',
  'createForumPost', 'listRoles', 'createRole', 'updateRole', 'reorderRoles', 'deleteRole', 'listMembers',
  'getMember', 'searchMembers', 'updateMember', 'addMemberRole', 'removeMemberRole', 'kickMember', 'banMember',
  'unbanMember', 'bulkBan', 'listBans', 'listAutomodRules', 'createAutomodRule', 'updateAutomodRule',
  'deleteAutomodRule', 'listMessages', 'getMessage', 'sendMessage', 'editMessage', 'deleteMessage',
  'bulkDeleteMessages', 'pinMessage', 'unpinMessage', 'listPins', 'crosspostMessage', 'addReaction',
  'removeReaction', 'clearReactions', 'listWebhooks', 'createWebhook', 'updateWebhook', 'executeWebhook',
  'deleteWebhook', 'listScheduledEvents', 'getScheduledEvent', 'createScheduledEvent', 'updateScheduledEvent',
  'listScheduledEventUsers', 'deleteScheduledEvent', 'listInvites', 'createInvite', 'deleteInvite', 'listEmojis',
  'createEmoji', 'updateEmoji', 'deleteEmoji', 'listStickers', 'createSticker', 'deleteSticker', 'listAuditLog',
]

describe('createDiscordPort', () => {
  const calls: Call[] = []
  const port = createDiscordPort({ botToken: 't', rest: recordingRest(calls, {}) }) satisfies DiscordPort

  it('implements every DiscordPort method', () => {
    for (const key of PORT_KEYS) expect(typeof port[key], key).toBe('function')
  })

  it('has no extra members', () => {
    expect(Object.keys(port).sort()).toEqual([...PORT_KEYS].sort())
  })

  it('routes through the injected rest', async () => {
    await port.listRoles('1')
    expect(calls.at(-1)).toEqual({ verb: 'get', route: '/guilds/1/roles' })
  })

  it('builds a default rest from the bot token', () => {
    expect(typeof createDiscordPort({ botToken: 't' }).getGuild).toBe('function')
  })
})
