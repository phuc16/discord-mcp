import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allTools } from '../../src/tools/index.js'
import { call, mutatingCalls } from './helpers.js'
import { argsFor, buildWorld } from './world.js'
import type { World } from './world.js'

let world: World

beforeEach(async () => {
  world = await buildWorld()
})

afterEach(async () => {
  await world.harness.close()
})

const destructive = allTools.filter((t) => t.tier === 'destructive')

describe('destructive tools preview without mutating', () => {
  it('covers every destructive tool', () => {
    expect(destructive.length).toBeGreaterThanOrEqual(17)
  })

  it.each(destructive.map((t) => [t.name, t] as const))('%s returns confirm_required with a preview and touches nothing', async (_name, tool) => {
    const { harness } = world
    const args = argsFor(tool, world)
    const r = await call(harness.client, tool.name, args)
    expect({ code: r.code, text: r.text.slice(0, 200) }).toMatchObject({ code: 'confirm_required' })
    const preview = r.details.preview as { summary: string; affected: Record<string, number> }
    expect(preview.summary.length).toBeGreaterThan(0)
    expect(typeof preview.affected).toBe('object')
    expect(typeof r.details.confirm_token).toBe('string')
    expect(mutatingCalls(harness.discord)).toEqual([])
  })

  it.each(destructive.map((t) => [t.name, t] as const))('%s executes only after confirmation and only once', async (_name, tool) => {
    const { harness } = world
    const args = argsFor(tool, world)
    const first = await call(harness.client, tool.name, args)
    const token = first.details.confirm_token
    const done = await call(harness.client, tool.name, { ...args, confirm_token: token })
    expect({ code: done.code, text: done.text.slice(0, 200) }).toMatchObject({ code: null })
    expect(done.isError).toBe(false)
    expect(mutatingCalls(harness.discord).length).toBeGreaterThan(0)
    const replay = await call(harness.client, tool.name, { ...args, confirm_token: token })
    expect(replay.code).toBe('confirm_invalid')
  })
})
