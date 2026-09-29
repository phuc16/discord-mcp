import { describe, expect, it, vi } from 'vitest'
import { webhooksTools } from '../../../src/tools/webhooks.js'
import { G, OTHER_G, byName, id, makeCtx, run, runPreview } from './helpers.js'

const t = (name: string) => byName(webhooksTools, name)
const C = id('2')
const W = id('6')
const reason = 'via discord-mcp by tester (corr-1)'
const secret = 'SECRET-TOKEN-VALUE'
const hook = { id: W, guild_id: G, channel_id: C, name: 'hook', token: secret, url: `https://discord.com/api/webhooks/${W}/${secret}` }
const inGuildChannel = { getChannel: async () => ({ id: C, guild_id: G }) }
const foreignChannel = { getChannel: async () => ({ id: C, guild_id: OTHER_G }) }
const hasSecret = (v: unknown): boolean => JSON.stringify(v).includes(secret)

describe('webhooks_list', () => {
  it('lists by guild and strips tokens', async () => {
    const ctx = makeCtx({ discord: { listWebhooks: async () => [hook] } })
    const out = await run(t('webhooks_list'), ctx, { guild_id: G })
    expect(ctx.calls[0]).toEqual({ method: 'listWebhooks', args: [{ guildId: G }] })
    expect(hasSecret(out)).toBe(false)
    expect(out).toEqual({ items: [{ id: W, guild_id: G, channel_id: C, name: 'hook' }] })
  })
  it('lists by channel after guild check', async () => {
    const ctx = makeCtx({ discord: { ...inGuildChannel, listWebhooks: async () => [hook] } })
    await run(t('webhooks_list'), ctx, { guild_id: G, channel_id: C })
    expect(ctx.calls[1]).toEqual({ method: 'listWebhooks', args: [{ channelId: C }] })
  })
  it('rejects foreign channel', async () => {
    const ctx = makeCtx({ discord: foreignChannel })
    await expect(run(t('webhooks_list'), ctx, { guild_id: G, channel_id: C })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('webhooks_create', () => {
  it('creates and strips token', async () => {
    const ctx = makeCtx({ discord: { ...inGuildChannel, createWebhook: async () => hook } })
    const out = await run(t('webhooks_create'), ctx, { guild_id: G, channel_id: C, name: 'hook' })
    expect(ctx.calls[1]).toEqual({ method: 'createWebhook', args: [C, { name: 'hook' }, reason] })
    expect(hasSecret(out)).toBe(false)
  })
  it('rejects foreign channel', async () => {
    const ctx = makeCtx({ discord: foreignChannel })
    await expect(run(t('webhooks_create'), ctx, { guild_id: G, channel_id: C, name: 'x' })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('webhooks_update', () => {
  it('checks webhook guild then updates, stripping token', async () => {
    const ctx = makeCtx({ discord: { listWebhooks: async () => [hook], updateWebhook: async () => hook } })
    const out = await run(t('webhooks_update'), ctx, { guild_id: G, webhook_id: W, name: 'new' })
    expect(ctx.calls[1]).toEqual({ method: 'updateWebhook', args: [W, { name: 'new' }, reason] })
    expect(hasSecret(out)).toBe(false)
  })
  it('rejects webhook of another guild', async () => {
    const ctx = makeCtx({ discord: { listWebhooks: async () => [{ ...hook, guild_id: OTHER_G }], updateWebhook: async () => hook } })
    await expect(run(t('webhooks_update'), ctx, { guild_id: G, webhook_id: W, name: 'n' })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).toEqual(['listWebhooks'])
  })
  it('guards the target channel when moving', async () => {
    const ctx = makeCtx({ discord: { ...foreignChannel, listWebhooks: async () => [hook], updateWebhook: async () => hook } })
    await expect(run(t('webhooks_update'), ctx, { guild_id: G, webhook_id: W, channel_id: C })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).not.toContain('updateWebhook')
  })
})

describe('webhooks_execute', () => {
  it('uses stored token, never accepts one, never logs or returns it', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const ctx = makeCtx({ logger, discord: { listWebhooks: async () => [hook], executeWebhook: async () => ({ id: id('7'), content: 'hi' }) } })
    const out = await run(t('webhooks_execute'), ctx, { guild_id: G, webhook_id: W, content: 'hi', username: 'bot' })
    expect(ctx.calls[1]).toEqual({ method: 'executeWebhook', args: [W, secret, { content: 'hi', username: 'bot', allowed_mentions: { parse: [] } }] })
    expect(hasSecret(out)).toBe(false)
    expect(hasSecret(logger.info.mock.calls) || hasSecret(logger.warn.mock.calls) || hasSecret(logger.error.mock.calls) || hasSecret(logger.debug.mock.calls)).toBe(false)
    expect('token' in t('webhooks_execute').input.shape).toBe(false)
  })
  it('handles null result', async () => {
    const ctx = makeCtx({ discord: { listWebhooks: async () => [hook], executeWebhook: async () => null } })
    expect(await run(t('webhooks_execute'), ctx, { guild_id: G, webhook_id: W, content: 'hi' })).toEqual({ sent: true })
  })
  it('fails when webhook has no token', async () => {
    const noToken = { id: W, guild_id: G, channel_id: C, name: 'hook' }
    const ctx = makeCtx({ discord: { listWebhooks: async () => [noToken], executeWebhook: async () => null } })
    await expect(run(t('webhooks_execute'), ctx, { guild_id: G, webhook_id: W, content: 'hi' })).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('rejects foreign webhook', async () => {
    const ctx = makeCtx({ discord: { listWebhooks: async () => [], executeWebhook: async () => null } })
    await expect(run(t('webhooks_execute'), ctx, { guild_id: G, webhook_id: W, content: 'hi' })).rejects.toMatchObject({ code: 'not_found' })
  })
  it('disables mentions by default', async () => {
    const ctx = makeCtx({ discord: { listWebhooks: async () => [hook], executeWebhook: async () => null } })
    await run(t('webhooks_execute'), ctx, { guild_id: G, webhook_id: W, content: '@everyone' })
    expect(ctx.calls[1]?.args[2]).toMatchObject({ allowed_mentions: { parse: [] } })
  })
})

describe('webhooks_delete', () => {
  it('preview names webhook, no mutation', async () => {
    const ctx = makeCtx({ discord: { listWebhooks: async () => [hook] } })
    const p = await runPreview(t('webhooks_delete'), ctx, { guild_id: G, webhook_id: W })
    expect(p.summary).toContain('hook')
    expect(p.affected).toEqual({ webhooks: 1 })
    expect(hasSecret(p)).toBe(false)
  })
  it('handler checks guild then deletes', async () => {
    const ctx = makeCtx({ discord: { listWebhooks: async () => [hook], deleteWebhook: async () => undefined } })
    await run(t('webhooks_delete'), ctx, { guild_id: G, webhook_id: W })
    expect(ctx.calls[1]).toEqual({ method: 'deleteWebhook', args: [W, reason] })
  })
  it('handler rejects foreign webhook', async () => {
    const ctx = makeCtx({ discord: { listWebhooks: async () => [], deleteWebhook: async () => undefined } })
    await expect(run(t('webhooks_delete'), ctx, { guild_id: G, webhook_id: W })).rejects.toMatchObject({ code: 'not_found' })
  })
})
