import { z } from 'zod'
import type { AnyToolDef, Tier } from '../../../src/contracts/index.js'

export const fakeTool = (name: string, tier: Tier): AnyToolDef => ({
  name,
  group: 'g',
  description: 'd',
  tier,
  input: z.object({ guild_id: z.string() }),
  guildFrom: (i) => i.guild_id,
  preview: tier === 'destructive' ? async () => ({ summary: 's', affected: {} }) : undefined,
  handler: async () => ({ data: name }),
})
