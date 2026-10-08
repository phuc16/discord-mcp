import type { DiscordPort } from '../contracts/index.js'
import { channelMethods } from './port-channels.js'
import { guildMethods } from './port-guild.js'
import { messageMethods } from './port-messages.js'
import { miscMethods } from './port-misc.js'
import { moderationMethods } from './port-moderation.js'
import { roleMemberMethods } from './port-roles-members.js'
import { createRest, type Rest } from './rest.js'

export const createDiscordPort = (o: { botToken: string; rest?: Rest }): DiscordPort => {
  const rest = o.rest ?? createRest(o.botToken)
  return {
    ...guildMethods(rest),
    ...channelMethods(rest),
    ...roleMemberMethods(rest),
    ...moderationMethods(rest),
    ...messageMethods(rest),
    ...miscMethods(rest),
  }
}
