export interface Principal {
  kind: 'stdio' | 'service' | 'user'
  userId: string | null
  userName: string
  guilds: Record<string, string>
}
export const principalKey = (p: Principal): string => `${p.kind}:${p.userId ?? p.userName}`
