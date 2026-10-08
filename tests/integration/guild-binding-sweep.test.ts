import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allTools } from '../../src/tools/index.js'
import { GUILD_A, call, succeededMutations } from './helpers.js'
import { RESOURCE_KEYS, argsFor, buildWorld } from './world.js'
import type { World } from './world.js'

let world: World

beforeEach(async () => {
  world = await buildWorld()
})

afterEach(async () => {
  await world.harness.close()
})

const swept = allTools.filter((t) => Object.keys(t.input.shape).some((k) => RESOURCE_KEYS.includes(k)))

describe('every resource-scoped tool binds ids to guild_id', () => {
  it('covers a meaningful number of tools', () => {
    expect(swept.length).toBeGreaterThanOrEqual(40)
  })

  describe.each(swept.map((t) => [t.name, t] as const))('%s', (_name, tool) => {
    const keys = Object.keys(tool.input.shape).filter((k) => RESOURCE_KEYS.includes(k))
    it.each(keys)('foreign %s is not_found and nothing mutates', async (key) => {
      const { harness } = world
      const args = argsFor(tool, world, key)
      let r = await call(harness.client, tool.name, args)
      if (r.code === 'confirm_required') r = await call(harness.client, tool.name, { ...args, confirm_token: r.details.confirm_token })
      expect({ code: r.code, text: r.text.slice(0, 200) }).toMatchObject({ code: 'not_found' })
      expect(await succeededMutations(harness.discord)).toEqual([])
      expect(args.guild_id).toBe(GUILD_A)
    })
  })
})
