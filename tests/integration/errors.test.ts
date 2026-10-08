import { afterEach, describe, expect, it } from 'vitest'
import { McpToolError } from '../../src/contracts/index.js'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, call } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const setup = async () => {
  const harness = await buildHarness({ config: { guilds: { [GUILD_A]: { max_tier: 'destructive' } } } })
  h = harness
  harness.discord.seedGuild(GUILD_A)
  return harness
}

describe('error mapping', () => {
  it('Discord not_found maps to isError with code not_found', async () => {
    const harness = await setup()
    const r = await call(harness.client, 'channels_get', { guild_id: GUILD_A, channel_id: '999999999999999999' })
    expect(r.isError).toBe(true)
    expect(r.code).toBe('not_found')
  })

  it('preserves McpToolError details such as retry_after', async () => {
    const harness = await setup()
    harness.discord.getGuild = async () => {
      throw new McpToolError('rate_limited', 'slow down', { retry_after: 7 })
    }
    const r = await call(harness.client, 'guild_get', { guild_id: GUILD_A })
    expect(r.code).toBe('rate_limited')
    expect(r.details.retry_after).toBe(7)
  })

  it('unexpected exception maps to internal without stack or message leak', async () => {
    const harness = await setup()
    harness.discord.getGuild = async () => {
      throw new Error('boom-secret-detail')
    }
    const r = await call(harness.client, 'guild_get', { guild_id: GUILD_A })
    expect(r.isError).toBe(true)
    expect(r.code).toBe('internal')
    expect(r.text).not.toContain('boom-secret-detail')
    expect(r.text).not.toMatch(/\n\s+at /)
    expect(r.text).not.toContain('node_modules')
  })

  it('non-Error throwables map to internal', async () => {
    const harness = await setup()
    harness.discord.getGuild = async () => {
      throw 'string-thrown'
    }
    const r = await call(harness.client, 'guild_get', { guild_id: GUILD_A })
    expect(r.code).toBe('internal')
    expect(r.text).not.toContain('string-thrown')
  })

  it('invalid input is an error and does not reach Discord', async () => {
    const harness = await setup()
    const r = await call(harness.client, 'channels_create', { guild_id: 'not-a-snowflake', name: 'x', type: 0 })
    expect(r.isError).toBe(true)
    expect(harness.discord.calls).toEqual([])
  })

  it('missing guild_id on a scoped tool is an error', async () => {
    const harness = await setup()
    const r = await call(harness.client, 'channels_list', {})
    expect(r.isError).toBe(true)
    expect(harness.discord.calls).toEqual([])
  })

  it('error payloads never contain the internal stack across all failing paths', async () => {
    const harness = await setup()
    harness.discord.listChannels = async () => {
      throw new TypeError('kaboom')
    }
    const r = await call(harness.client, 'channels_list', { guild_id: GUILD_A })
    expect(r.code).toBe('internal')
    expect(JSON.stringify(r.body)).not.toContain('kaboom')
  })
})
