import type { Principal } from '../contracts/index.js'
import type { Session } from '../store/index.js'

export const principalFromSession = (s: Session): Principal => ({
  kind: 'user',
  userId: s.userId,
  userName: s.userName,
  guilds: { ...s.guilds },
})

export const principalFromServiceToken = (name: string): Principal => ({
  kind: 'service',
  userId: null,
  userName: name,
  guilds: {},
})
