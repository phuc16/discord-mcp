import { describe, expect, it } from 'vitest'
import { scheduledEventsTools } from '../../../src/tools/scheduled-events.js'
import { G, OTHER_G, byName, id, makeCtx, run, runPreview } from './helpers.js'

const t = (name: string) => byName(scheduledEventsTools, name)
const E = id('6')
const C = id('2')
const reason = 'via discord-mcp by tester (corr-1)'
const start = '2026-12-01T10:00:00.000Z'
const end = '2026-12-01T12:00:00.000Z'
const inGuild = { getChannel: async () => ({ id: C, guild_id: G }) }
const foreign = { getChannel: async () => ({ id: C, guild_id: OTHER_G }) }

describe('reads', () => {
  it('sevents_list', async () => {
    const ctx = makeCtx({ discord: { listScheduledEvents: async () => [{ id: E }] } })
    expect(await run(t('sevents_list'), ctx, { guild_id: G })).toEqual({ items: [{ id: E }] })
  })
  it('sevents_get', async () => {
    const ctx = makeCtx({ discord: { getScheduledEvent: async () => ({ id: E }) } })
    await run(t('sevents_get'), ctx, { guild_id: G, event_id: E })
    expect(ctx.calls[0]).toEqual({ method: 'getScheduledEvent', args: [G, E] })
  })
  it('sevents_list_users defaults and bounds limit', async () => {
    const ctx = makeCtx({ discord: { listScheduledEventUsers: async () => [] } })
    await run(t('sevents_list_users'), ctx, { guild_id: G, event_id: E })
    expect(ctx.calls[0]?.args).toEqual([G, E, 100])
    expect(t('sevents_list_users').input.safeParse({ guild_id: G, event_id: E, limit: 101 }).success).toBe(false)
  })
})

describe('sevents_create', () => {
  it('creates a voice event with privacy_level 2 after channel guard', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, createScheduledEvent: async () => ({ id: E }) } })
    await run(t('sevents_create'), ctx, { guild_id: G, name: 'party', scheduled_start_time: start, entity_type: 2, channel_id: C })
    expect(ctx.calls[1]).toEqual({
      method: 'createScheduledEvent',
      args: [G, { name: 'party', scheduled_start_time: start, entity_type: 2, channel_id: C, privacy_level: 2 }, reason],
    })
  })
  it('creates an external event', async () => {
    const ctx = makeCtx({ discord: { createScheduledEvent: async () => ({ id: E }) } })
    await run(t('sevents_create'), ctx, {
      guild_id: G, name: 'meetup', scheduled_start_time: start, scheduled_end_time: end, entity_type: 3, entity_metadata: { location: 'HQ' },
    })
    expect(ctx.calls[0]?.args[1]).toMatchObject({ entity_type: 3, entity_metadata: { location: 'HQ' }, scheduled_end_time: end })
  })
  it('rejects invalid dates', () => {
    expect(t('sevents_create').input.safeParse({ guild_id: G, name: 'a', scheduled_start_time: 'tomorrow', entity_type: 2, channel_id: C }).success).toBe(false)
  })
  it('external needs end time and location; voice needs channel', async () => {
    const ctx = makeCtx({ discord: { createScheduledEvent: async () => ({ id: E }) } })
    await expect(run(t('sevents_create'), ctx, { guild_id: G, name: 'm', scheduled_start_time: start, entity_type: 3 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(run(t('sevents_create'), ctx, { guild_id: G, name: 'm', scheduled_start_time: start, entity_type: 2 })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(ctx.calls).toEqual([])
  })
  it('rejects foreign channel', async () => {
    const ctx = makeCtx({ discord: { ...foreign, createScheduledEvent: async () => ({ id: E }) } })
    await expect(run(t('sevents_create'), ctx, { guild_id: G, name: 'm', scheduled_start_time: start, entity_type: 2, channel_id: C })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('sevents_update and delete', () => {
  it('update forwards patch and status', async () => {
    const ctx = makeCtx({ discord: { updateScheduledEvent: async () => ({ id: E }) } })
    await run(t('sevents_update'), ctx, { guild_id: G, event_id: E, status: 2, name: 'new' })
    expect(ctx.calls[0]).toEqual({ method: 'updateScheduledEvent', args: [G, E, { name: 'new', status: 2 }, reason] })
  })
  it('update guards a new channel', async () => {
    const ctx = makeCtx({ discord: { ...foreign, updateScheduledEvent: async () => ({ id: E }) } })
    await expect(run(t('sevents_update'), ctx, { guild_id: G, event_id: E, channel_id: C })).rejects.toMatchObject({ code: 'not_found' })
  })
  it('delete preview names event without mutating', async () => {
    const ctx = makeCtx({ discord: { getScheduledEvent: async () => ({ id: E, name: 'party', user_count: 9 }) } })
    const p = await runPreview(t('sevents_delete'), ctx, { guild_id: G, event_id: E })
    expect(p.summary).toContain('party')
    expect(p.affected).toEqual({ events: 1, interested_users: 9 })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getScheduledEvent'])
  })
  it('delete handler deletes', async () => {
    const ctx = makeCtx({ discord: { deleteScheduledEvent: async () => undefined } })
    await run(t('sevents_delete'), ctx, { guild_id: G, event_id: E })
    expect(ctx.calls[0]).toEqual({ method: 'deleteScheduledEvent', args: [G, E] })
  })
})
