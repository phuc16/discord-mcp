import type { AnyToolDef } from '../contracts/index.js'
import { auditLogTools } from './audit-log.js'
import { channelsTools } from './channels.js'
import { emojisTools } from './emojis.js'
import { guildTools } from './guild.js'
import { invitesTools } from './invites.js'
import { membersTools } from './members.js'
import { messagesTools } from './messages.js'
import { metaTools } from './meta.js'
import { moderationTools } from './moderation.js'
import { rolesTools } from './roles.js'
import { scheduledEventsTools } from './scheduled-events.js'
import { threadsTools } from './threads.js'
import { webhooksTools } from './webhooks.js'

export { auditReason, defineTool, guildId, snowflake } from './define.js'

export const allTools: AnyToolDef[] = [
  ...guildTools,
  ...channelsTools,
  ...threadsTools,
  ...rolesTools,
  ...membersTools,
  ...moderationTools,
  ...messagesTools,
  ...webhooksTools,
  ...scheduledEventsTools,
  ...invitesTools,
  ...emojisTools,
  ...auditLogTools,
  ...metaTools,
]
