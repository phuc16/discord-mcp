import { REST, type ResponseLike } from 'discord.js'

export const createDiscordRest = (botToken: string, fetchImpl?: typeof fetch): REST => {
  const rest = new REST({
    version: '10',
    ...(fetchImpl
      ? { makeRequest: (url: string, init: unknown) => fetchImpl(url, init as RequestInit) as Promise<ResponseLike> }
      : {}),
  })
  return rest.setToken(botToken)
}
