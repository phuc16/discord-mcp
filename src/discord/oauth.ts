import { type DiscordOAuthPort, McpToolError, type Snowflake } from '../contracts/index.js'

const API = 'https://discord.com/api/v10'
const TOKEN_URL = 'https://discord.com/api/oauth2/token'

export const createDiscordOAuthPort = (o: {
  clientId: string
  clientSecret: string
  fetchImpl?: typeof fetch
}): DiscordOAuthPort => {
  const doFetch = o.fetchImpl ?? fetch

  const unauthorized = () => new McpToolError('unauthorized', 'discord authorization failed')

  const send = async (url: string, init: RequestInit): Promise<unknown> => {
    let res: Response
    try {
      res = await doFetch(url, init)
    } catch {
      throw unauthorized()
    }
    if (!res.ok) throw unauthorized()
    return res.json()
  }

  const bearerGet = (path: string, accessToken: string) =>
    send(`${API}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } })

  return {
    async exchangeCode(code, redirectUri) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: o.clientId,
        client_secret: o.clientSecret,
        code,
        redirect_uri: redirectUri,
      })
      const data = (await send(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })) as { access_token?: string }
      if (!data.access_token) throw unauthorized()
      return { accessToken: data.access_token }
    },
    async fetchUser(accessToken) {
      const u = (await bearerGet('/users/@me', accessToken)) as { id: Snowflake; username: string }
      return { id: u.id, username: u.username }
    },
    async fetchUserGuilds(accessToken) {
      const gs = (await bearerGet('/users/@me/guilds', accessToken)) as { id: Snowflake; permissions: string }[]
      return gs.map((g) => ({ id: g.id, permissions: g.permissions }))
    },
  }
}
